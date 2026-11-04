/** Integration hub: outbound queue with idempotency keys, exponential backoff, dead-letter; inbound journal with
 *  duplicate suppression. Systems: Oracle OTM (GLog XML), SAP TM/EWM (OData/IDoc JSON), ERP (detention export), WMS (door events). */
import { Router, type Request, type Response } from "express";
import express from "express";
import { randomBytes, createHash } from "node:crypto";
import type { Appointment, YardEvent } from "../../../../../packages/contracts/index.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { subscribe } from "../../shared/bus.ts";
import { runAs, tid, DEFAULT_TENANT, DEMO_TENANT } from "../../shared/tenancy.ts";
import { flush, dbReady } from "../../shared/db.ts";
import { settings } from "../tenant/index.ts";
import { otm, sap, toCsv, type InboundAppt } from "./mapping.ts";

export type System = "otm" | "sap" | "erp" | "wms";
export const SYSTEMS: System[] = ["otm", "sap", "erp", "wms"];
export interface SysConfig { enabled: boolean; endpoint: string; username: string; password: string; inboundKey: string; domain: string; maxAttempts: number; retryBaseMs: number; timeoutMs: number }
export interface Msg { id: string; system: System; direction: "out" | "in"; type: string; idemKey: string; contentType: string; body: string; path: string;
  status: "pending" | "sent" | "failed" | "dead" | "received" | "duplicate" | "rejected"; attempts: number; nextAt: string; lastError?: string; httpStatus?: number; createdAt: string; doneAt?: string; ref?: string }
export const msgs = tenantRepo<Msg>("integration_msgs", () => []);
const PATHS: Record<System, Record<string, string>> = {
  otm: { event: "/GC3/glog.integration.servlets.WMServlet", appointment: "/GC3/glog.integration.servlets.WMServlet", ping: "/GC3/glog.integration.servlets.WMServlet" },
  sap: { event: "/sap/opu/odata/sap/ZYMS_YARD_SRV/EventSet", appointment: "/sap/opu/odata/sap/ZYMS_YARD_SRV/AppointmentSet", ping: "/sap/opu/odata/sap/ZYMS_YARD_SRV/$metadata" },
  erp: { charges: "/api/detention/charges", ping: "/api/health" },
  wms: { door: "/api/door-events", ping: "/api/health" },
};
const def = (s: System): SysConfig => ({ enabled: false, endpoint: process.env.YMS_MOCK_URL ? `${process.env.YMS_MOCK_URL}/${s}` : `http://127.0.0.1:9100/${s}`, username: "yms", password: "", inboundKey: randomBytes(12).toString("hex"), domain: "KSAP", maxAttempts: 6, retryBaseMs: 2000, timeoutMs: 10000 });
export function config(): Record<System, SysConfig> {
  let c = settings.get("integrations") as any;
  if (!c) c = settings.put({ id: "integrations", ...Object.fromEntries(SYSTEMS.map((s) => [s, def(s)])) } as any);
  for (const s of SYSTEMS) c[s] ??= def(s);
  return c;
}
const now = () => new Date().toISOString();
const mid = () => "m" + Date.now().toString(36) + randomBytes(3).toString("hex");
/** Queue an outbound message. Same idempotency key never queues twice; the key is also sent as Idempotency-Key. */
export function enqueue(system: System, type: string, body: string, idemKey: string, ref?: string) {
  const c = config()[system]; if (!c.enabled) return undefined;
  const dup = msgs.all().find((m) => m.direction === "out" && m.system === system && m.idemKey === idemKey); if (dup) return dup;
  return msgs.put({ id: mid(), system, direction: "out", type, idemKey, contentType: system === "otm" ? otm.contentType : "application/json", body, path: PATHS[system][type] ?? "/",
    status: "pending", attempts: 0, nextAt: now(), createdAt: now(), ref });
}
export const backoff = (attempt: number, base: number) => Math.min(base * 2 ** (attempt - 1), 5 * 60_000);
const retryable = (status?: number) => status === undefined || status >= 500 || status === 408 || status === 429;
async function deliver(m: Msg) {
  const c = config()[m.system]; m.attempts++;
  try {
    const r = await fetch(c.endpoint.replace(/\/$/, "") + m.path, { method: "POST", body: m.body, signal: AbortSignal.timeout(c.timeoutMs),
      headers: { "content-type": m.contentType, "idempotency-key": m.idemKey, "x-yms-message-id": m.id, ...(c.username || c.password ? { authorization: "Basic " + Buffer.from(`${c.username}:${c.password}`).toString("base64") } : {}) } });
    m.httpStatus = r.status; const text = (await r.text()).slice(0, 300);
    if (r.ok) { m.status = "sent"; m.doneAt = now(); m.lastError = undefined; return; }
    throw Object.assign(new Error(`HTTP ${r.status}: ${text}`), { http: r.status });
  } catch (e: any) {
    m.lastError = String(e.message ?? e).slice(0, 300);
    if (!retryable(e.http) || m.attempts >= c.maxAttempts) { m.status = "dead"; m.doneAt = now(); }
    else { m.status = "failed"; m.nextAt = new Date(Date.now() + backoff(m.attempts, c.retryBaseMs)).toISOString(); }
  }
}
/** One worker pass for the current tenant: deliver everything that is due, oldest first. */
export async function drain(limit = 50) {
  const due = msgs.all().filter((m) => m.direction === "out" && (m.status === "pending" || m.status === "failed") && m.nextAt <= now()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
  for (const m of due) await deliver(m); return due.length;
}
let timer: NodeJS.Timeout | undefined; let busy = false;
export function startWorker(tenants = [DEFAULT_TENANT, DEMO_TENANT], everyMs = 1000) {
  stopWorker(); timer = setInterval(async () => { if (busy) return; busy = true;
    try { for (const t of tenants) { const n = await runAs(t, () => drain()); if (n && dbReady()) await flush(t); } } catch (e) { console.error("integration worker", e); } finally { busy = false; } }, everyMs); timer.unref?.();
}
export const stopWorker = () => { if (timer) clearInterval(timer); timer = undefined; };

// ---- outbound triggers -------------------------------------------------------
type Ctx = { unitNumber?: string; shipmentRef?: string; door?: string };
let lookup: (e: YardEvent) => Ctx = () => ({});
export const setLookup = (f: typeof lookup) => { lookup = f; };
subscribe((e) => runAs(e.tenantId, () => {
  if (!["GateIn", "DoorOccupied", "DoorReleased", "TaskCompleted", "GateOut"].includes(e.type)) return;
  const ctx = lookup(e); const c = config();
  if (c.otm.enabled) enqueue("otm", "event", otm.event(e, c.otm.domain, ctx), "evt-" + e.eventId, ctx.unitNumber);
  if (c.sap.enabled) enqueue("sap", "event", sap.event(e, ctx), "evt-" + e.eventId, ctx.unitNumber);
  if (c.wms.enabled && (e.type === "DoorOccupied" || e.type === "DoorReleased")) enqueue("wms", "door", JSON.stringify({ eventId: e.eventId, type: e.type === "DoorOccupied" ? "door.occupied" : "door.released", at: e.at, site: e.siteId, door: ctx.door, unit: ctx.unitNumber, shipmentRef: ctx.shipmentRef }), "evt-" + e.eventId, ctx.door);
}, undefined, e.siteId));
/** Appointment changes made in YMSNow go back to the system of record. */
export function publishAppointment(a: Appointment) {
  const c = config(); const key = `appt-${a.id}-${a.status}-${a.slotStart}`;
  if (a.source === "otm") return enqueue("otm", "appointment", otm.appointment(a, c.otm.domain), key, a.ref);
  if (a.source === "sap") return enqueue("sap", "appointment", sap.appointment(a), key, a.ref);
}

// ---- inbound -----------------------------------------------------------------
let applyInbound: (system: System, a: InboundAppt) => { id: string; created: boolean } = () => { throw new Error("appointments not wired"); };
export const setInboundHandler = (f: typeof applyInbound) => { applyInbound = f; };
export function receive(system: "otm" | "sap", raw: string | object) {
  const parsed = system === "otm" ? otm.parse(String(raw)) : sap.parse(raw);
  const id = "in-" + system + "-" + createHash("sha1").update(parsed.transmissionNo).digest("hex").slice(0, 16);
  const body = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (msgs.get(id)) { msgs.put({ ...msgs.get(id)!, attempts: msgs.get(id)!.attempts + 1, lastError: "duplicate transmission ignored", nextAt: now() }); return { duplicate: true, transmissionNo: parsed.transmissionNo, results: [] }; }
  const results = parsed.appts.map((a) => ({ ref: a.externalRef, ...applyInbound(system, a) }));
  msgs.put({ id, system, direction: "in", type: "appointments", idemKey: parsed.transmissionNo, contentType: system === "otm" ? "application/xml" : "application/json", body: body.slice(0, 20000), path: "inbound",
    status: "received", attempts: 1, nextAt: now(), createdAt: now(), doneAt: now(), ref: results.map((r) => r.ref).join(", ").slice(0, 200) });
  return { duplicate: false, transmissionNo: parsed.transmissionNo, results };
}
function reject(system: System, raw: string, err: string) { msgs.put({ id: mid(), system, direction: "in", type: "appointments", idemKey: "-", contentType: "text/plain", body: raw.slice(0, 20000), path: "inbound", status: "rejected", attempts: 1, nextAt: now(), createdAt: now(), doneAt: now(), lastError: err }); }

/** Unauthenticated by JWT; authenticated by the per-tenant inbound key (header x-api-key). Mounted before authn. */
export const inboundRouter = Router()
  .use(express.text({ type: ["application/xml", "text/xml"], limit: "2mb" }))
  .post("/:tenant/:system", async (q: Request, r: Response) => {
    const tenant = String(q.params.tenant), system = String(q.params.system) as "otm" | "sap";
    if (!["otm", "sap"].includes(system) || ![DEFAULT_TENANT, DEMO_TENANT].includes(tenant)) return r.status(404).json({ error: "Unknown endpoint" });
    await runAs(tenant, async () => {
      const c = config()[system];
      if (!c.enabled) return r.status(503).json({ error: `${system} integration disabled` });
      if (q.headers["x-api-key"] !== c.inboundKey) return r.status(401).json({ error: "Invalid x-api-key" });
      try { const out = receive(system, system === "otm" ? String(q.body ?? "") : q.body); r.status(out.duplicate ? 200 : 202).json(out); }
      catch (e: any) { reject(system, typeof q.body === "string" ? q.body : JSON.stringify(q.body ?? {}), e.message); r.status(e.status ?? 400).json({ error: e.message }); }
      if (dbReady()) await flush(tenant);
    });
  });

// ---- ERP detention export ------------------------------------------------------
let exportCharges: () => Record<string, unknown>[] = () => [];
export const setExporter = (f: typeof exportCharges) => { exportCharges = f; };

const mask = (c: SysConfig) => ({ ...c, password: c.password ? "••••••" : "" });
const stats = (s: System) => { const m = msgs.all().filter((x) => x.system === s); const by = (st: Msg["status"]) => m.filter((x) => x.status === st).length;
  const last = m.filter((x) => x.status === "sent" || x.status === "received").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""))[0];
  return { pending: by("pending") + by("failed"), sent: by("sent"), dead: by("dead"), received: by("received"), rejected: by("rejected"), lastOk: last?.doneAt }; };
const Cfg = (b: any): Partial<SysConfig> => { const o: Partial<SysConfig> = {};
  if (b.enabled !== undefined) o.enabled = !!b.enabled;
  if (b.endpoint !== undefined) { const u = String(b.endpoint); if (!/^https?:\/\/[^\s]+$/.test(u)) throw Object.assign(new Error("Endpoint must be an http(s) URL"), { status: 422 }); o.endpoint = u; }
  for (const k of ["username", "domain"] as const) if (b[k] !== undefined) o[k] = String(b[k]).slice(0, 100);
  if (b.password !== undefined && b.password !== "••••••") o.password = String(b.password).slice(0, 200);
  for (const [k, lo, hi] of [["maxAttempts", 1, 20], ["retryBaseMs", 100, 600000], ["timeoutMs", 500, 60000]] as const) if (b[k] !== undefined) { const n = Number(b[k]); if (!(n >= lo && n <= hi)) throw Object.assign(new Error(`${k} must be ${lo}–${hi}`), { status: 422 }); o[k] = n; }
  return o; };
const wrap = (f: (q: Request, r: Response) => unknown) => async (q: Request, r: Response) => { try { const v = await f(q, r); if (v !== undefined) r.json(v); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export const router = Router()
  .get("/", wrap(() => ({ systems: SYSTEMS.map((s) => ({ system: s, config: mask(config()[s]), stats: stats(s), inboundUrl: s === "otm" || s === "sap" ? `/v1/integrations/inbound/${tid()}/${s}` : undefined })) })))
  .put("/config/:system", wrap((q) => { const s = q.params.system as System; if (!SYSTEMS.includes(s)) throw Object.assign(new Error("Unknown system"), { status: 404 }); const c = config(); c[s] = { ...c[s], ...Cfg(q.body ?? {}) }; settings.put(c as any); return mask(c[s]); }))
  .post("/config/:system/rotate-key", wrap((q) => { const c = config(); const s = q.params.system as System; c[s].inboundKey = randomBytes(12).toString("hex"); settings.put(c as any); return { inboundKey: c[s].inboundKey }; }))
  .get("/messages", wrap((q) => msgs.all().filter((m) => (!q.query.system || m.system === q.query.system) && (!q.query.status || m.status === q.query.status) && (!q.query.direction || m.direction === q.query.direction))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200)))
  .post("/messages/:id/retry", wrap((q) => { const m = msgs.get(String(q.params.id)); if (!m || m.direction !== "out") throw Object.assign(new Error("Not found"), { status: 404 }); if (m.status === "sent") throw Object.assign(new Error("Already delivered"), { status: 409 });
    m.status = "pending"; m.attempts = 0; m.nextAt = now(); m.lastError = undefined; return m; }))
  .post("/retry-dead/:system", wrap((q) => { let n = 0; for (const m of msgs.all()) if (m.system === q.params.system && m.status === "dead" && m.direction === "out") { m.status = "pending"; m.attempts = 0; m.nextAt = now(); n++; } return { requeued: n }; }))
  .post("/drain", wrap(async () => ({ processed: await drain() })))
  .post("/test/:system", wrap(async (q) => { const s = q.params.system as System; const c = config()[s];
    try { const r = await fetch(c.endpoint.replace(/\/$/, "") + PATHS[s].ping, { method: s === "otm" ? "POST" : "GET", body: s === "otm" ? "<Ping/>" : undefined, signal: AbortSignal.timeout(c.timeoutMs) }); return { ok: r.ok, status: r.status }; }
    catch (e: any) { return { ok: false, error: e.message }; } }))
  .post("/erp/export", wrap((q, r) => { const rows = exportCharges(); const mode = q.body?.mode === "push" ? "push" : "csv";
    if (mode === "push") { if (!config().erp.enabled) throw Object.assign(new Error("ERP integration is disabled. Enable it, or export CSV."), { status: 409 }); }
    if (!rows.length) throw Object.assign(new Error("No approved charges to export"), { status: 409 });
    const batch = "EXP-" + new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    if (mode === "push") { enqueue("erp", "charges", JSON.stringify({ batchId: batch, currency: "USD", lines: rows }), batch, `${rows.length} charges`); return { batch, queued: rows.length }; }
    r.setHeader("content-type", "text/csv"); r.setHeader("content-disposition", `attachment; filename="${batch}.csv"`); r.send(toCsv(rows)); return undefined; }));
