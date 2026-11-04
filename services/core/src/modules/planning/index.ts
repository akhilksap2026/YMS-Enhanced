// Planning: CSV/Excel appointment import with a row report, daily cut-off with amendments, placement and hazmat
// segregation rules, hot loads and a staging queue for outbound units.
import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { tenantRepo } from "../../shared/repo.ts";
import { sid, currentUser } from "../../shared/tenancy.ts";
import { appointments, book, reschedule, bookingGuards, type Appt } from "../appointments/index.ts";
import { sites } from "../tenant/sites.ts";
import { carriers, units, zones, slotByLabel } from "../yard/index.ts";
import { tasks, placementGuards, createMove } from "../tasks/index.ts";
import { doors } from "../dock/index.ts";
import { notify } from "../notifications/index.ts";
import type { Unit } from "../../../../../packages/contracts/index.ts";

const err = (m: string, status = 400) => Object.assign(new Error(m), { status });
const nid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const tz = () => sites.get(sid())?.tz ?? "Africa/Bujumbura";
/** Offset in minutes of a time zone at an instant. */
export function tzOffset(zone: string, at: number) { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at / 60e3) * 60e3) / 60e3; }
export const localToUtc = (ymd: string, hm: string, zone: string) => { const guess = Date.parse(`${ymd}T${hm}:00Z`); return new Date(guess - tzOffset(zone, guess) * 60e3).toISOString(); };
const localYmd = (ms: number, zone: string) => new Date(ms + tzOffset(zone, ms) * 60e3).toISOString().slice(0, 10);

// ---------- settings (cut-off) ----------
export interface PlanSettings { id: string; cutoffEnabled: boolean; cutoff: string }
export const planSettings = tenantRepo<PlanSettings>("plan_settings", () => [], { site: true });
export const settings = (): PlanSettings => planSettings.get("plan") ?? { id: "plan", cutoffEnabled: false, cutoff: "16:00" };
/** Plan for day D is frozen from the cut-off time on day D-1 (site time). Returns why, or null. */
export function frozen(slotStart: string, now = Date.now()): string | null {
  const s = settings(); if (!s.cutoffEnabled) return null; const zone = tz(); const day = localYmd(Date.parse(slotStart), zone);
  const prev = localYmd(Date.parse(day + "T12:00:00Z") - 864e5, zone); const cut = Date.parse(localToUtc(prev, s.cutoff, zone));
  return now >= cut ? `Plan for ${day} closed at ${s.cutoff} on ${prev}; request an amendment` : null;
}
bookingGuards.push((slot) => { const f = frozen(slot); if (f) throw Object.assign(err(f, 423), { code: "cutoff" }); });

export interface Amendment { id: string; appointmentId: string; ref: string; change: { slotStart?: string; door?: string; plate?: string; cancel?: boolean }; reason: string; state: "pending" | "approved" | "rejected"; by: string; at: string; decidedBy?: string; decidedAt?: string; note?: string }
export const amendments = tenantRepo<Amendment>("amendments", () => [], { site: true });
const AmIn = z.object({ appointmentId: z.string().min(1), reason: z.string().trim().min(3).max(300), change: z.object({ slotStart: z.string().datetime({ offset: true }).optional(), door: z.string().max(10).optional(), plate: z.string().max(15).optional(), cancel: z.boolean().optional() }).refine((c) => Object.keys(c).length > 0, "Nothing to change") });
export function requestAmend(input: unknown) {
  const p = AmIn.safeParse(input); if (!p.success) throw err(p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message, 422);
  const a = appointments.get(p.data.appointmentId); if (!a) throw err("Appointment not found", 404); const u = currentUser();
  if (u?.role === "carrier" && a.carrierId !== u.carrierId) throw err("Appointment not found", 404);
  if (amendments.all().some((x) => x.appointmentId === a.id && x.state === "pending")) throw err("An amendment is already pending for " + a.ref, 409);
  const x = amendments.put({ id: nid("am"), appointmentId: a.id, ref: a.ref, change: p.data.change, reason: p.data.reason, state: "pending", by: u?.name ?? "user", at: new Date().toISOString() });
  notify({ channel: "in_app", to: "yard_manager", text: `Amendment requested for ${a.ref}: ${p.data.reason}`, kind: "amendment", ref: a.ref }); return x;
}
export function decideAmend(id: string, approve: boolean, note?: string) {
  const x = amendments.get(id); if (!x) throw err("Not found", 404); if (x.state !== "pending") throw err("Already " + x.state, 409);
  const a = appointments.get(x.appointmentId) as Appt; if (!a) throw err("Appointment gone", 404);
  if (approve) { const c = x.change;
    if (c.cancel) { a.status = "cancelled"; (a.history ??= []).push({ at: new Date().toISOString(), by: currentUser()?.name ?? "user", action: "cancelled (amendment)" }); }
    else { if (c.slotStart) reschedule(a.id, { slotStart: c.slotStart, door: c.door, override: true }, { canOverride: true, skipGuards: true }); else if (c.door) a.door = c.door; if (c.plate) a.plate = c.plate.toUpperCase(); } }
  Object.assign(x, { state: approve ? "approved" : "rejected", decidedBy: currentUser()?.name ?? "user", decidedAt: new Date().toISOString(), note }); return x;
}

// ---------- import ----------
export interface RowReport { row: number; ok: boolean; ref?: string; errors: string[]; data: Record<string, string> }
const COLS = ["carrier", "date", "time", "direction", "door", "plate", "unit", "seal", "hazmat"];
function parseCsv(text: string): string[][] { const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === "," || ch === ";") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; } else cell += ch; }
  if (cell || row.length) { row.push(cell); out.push(row); } return out.filter((r) => r.some((c) => c.trim())); }
async function readSheet(buf: Buffer, name: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(name)) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); const ws = wb.worksheets[0]; const rows: string[][] = [];
    ws.eachRow((r) => rows.push((r.values as any[]).slice(1).map((v) => v instanceof Date ? v.toISOString() : v?.text ?? v?.result ?? String(v ?? "")))); return rows; }
  return parseCsv(buf.toString("utf8").replace(/^\ufeff/, ""));
}
function normRow(h: string[], r: string[]) { const o: Record<string, string> = {}; h.forEach((k, i) => { o[k] = String(r[i] ?? "").trim(); });
  if (/^\d{4}-\d\d-\d\dT/.test(o.date ?? "")) o.date = o.date.slice(0, 10); if (/^\d{4}-\d\d-\d\dT/.test(o.time ?? "")) o.time = o.time.slice(11, 16); if (/^\d:\d\d$/.test(o.time ?? "")) o.time = "0" + o.time; return o; }
/** Validate every row; with commit=true, book the valid ones. Bad rows never block good ones. */
export async function importPlan(buf: Buffer, name: string, commit: boolean) {
  const rows = await readSheet(buf, name); if (!rows.length) throw err("The file is empty", 422);
  const head = rows[0].map((c) => c.trim().toLowerCase().replace(/[^a-z]/g, "")); const missing = ["carrier", "date", "time", "direction"].filter((c) => !head.includes(c));
  if (missing.length) throw err("Missing columns: " + missing.join(", ") + ". Expected: " + COLS.join(", "), 422);
  if (rows.length > 2001) throw err("At most 2000 rows per file", 422);
  const zone = tz(); const doorSet = new Set(doors.all().map((d) => d.label)); const seen = new Set<string>(); const report: RowReport[] = [];
  for (let i = 1; i < rows.length; i++) { const d = normRow(head, rows[i]); const e: string[] = [];
    const c = carriers.all().find((x) => [x.id, x.name, x.scac].some((k) => k.toLowerCase() === d.carrier?.toLowerCase())); if (!c) e.push(`Unknown carrier "${d.carrier}"`);
    if (!/^\d{4}-\d\d-\d\d$/.test(d.date ?? "") || isNaN(Date.parse(d.date + "T00:00:00Z"))) e.push("Date must be a real date, YYYY-MM-DD"); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time ?? "")) e.push("Time must be HH:MM (00:00-23:59)");
    const dir = (d.direction ?? "").toLowerCase(); if (!["inbound", "outbound", "in", "out"].includes(dir)) e.push("Direction must be inbound or outbound");
    if (d.door && !doorSet.has(d.door.toUpperCase())) e.push(`Unknown door ${d.door}`);
    if (d.hazmat && !/^(class\s*)?[1-9](\.[1-6])?$/i.test(d.hazmat)) e.push("Hazmat must be a class like 3 or 2.1");
    const key = `${d.carrier}|${d.date}|${d.time}|${d.plate}`; if (seen.has(key)) e.push("Duplicate of an earlier row"); seen.add(key);
    let slotStart = ""; if (!e.length) { slotStart = localToUtc(d.date, d.time, zone); const f = frozen(slotStart); if (f) e.push(f); }
    let ref: string | undefined;
    if (!e.length && commit) { try { const a = book({ carrierId: c!.id, slotStart, direction: dir.startsWith("in") ? "inbound" : "outbound", door: d.door?.toUpperCase() || undefined, plate: d.plate || undefined, unitNumber: d.unit || undefined }) as any;
      if (d.seal) a.seal = d.seal; if (d.hazmat) a.hazmat = "Class " + d.hazmat.replace(/class\s*/i, ""); a.source = a.source; (a.history ??= []).push({ at: new Date().toISOString(), by: "import", action: "imported from " + name }); ref = a.ref; }
      catch (x: any) { e.push(x.message); } }
    report.push({ row: i + 1, ok: !e.length, ref, errors: e, data: d }); }
  return { file: name, committed: commit, total: report.length, valid: report.filter((r) => r.ok).length, invalid: report.filter((r) => !r.ok).length, rows: report };
}

// ---------- placement + hazmat segregation ----------
export interface PlacementRule { id: string; zone: string; reefer?: "only" | "no"; hazmat?: "only" | "no"; kinds?: ("trailer" | "container")[]; maxUnits?: number; note?: string }
export interface Rules { id: string; zones: PlacementRule[]; segregation: { a: string; b: string; minSlots: number }[]; hotPriority: boolean }
export const placementRules = tenantRepo<Rules>("placement_rules", () => [], { site: true });
export const DEFAULT_SEGREGATION = [{ a: "1", b: "*", minSlots: 4 }, { a: "3", b: "5.1", minSlots: 2 }, { a: "2.1", b: "5.1", minSlots: 2 }, { a: "4.1", b: "5.1", minSlots: 2 }, { a: "4.3", b: "8", minSlots: 2 }, { a: "3", b: "2.3", minSlots: 2 }];
export const getRules = (): Rules => placementRules.get("rules") ?? { id: "rules", zones: [], segregation: DEFAULT_SEGREGATION, hotPriority: true };
const cls = (h?: string) => (h ?? "").replace(/class\s*/i, "").trim();
const zoneOf = (label: string) => zones.all().find((z) => z.slots.some((s) => s.label === label));
/** Returns rule violations for putting unit u in slot label (empty = allowed). Doors are not slots and are not checked here. */
export function placementViolations(u: Unit, label: string): string[] {
  const z = zoneOf(label); if (!z) return []; const r = getRules(); const v: string[] = [];
  for (const p of r.zones.filter((x) => x.zone.toLowerCase() === z.name.toLowerCase() || x.zone === z.id)) {
    if (p.reefer === "only" && !u.reefer) v.push(`${z.name} is for reefers only`); if (p.reefer === "no" && u.reefer) v.push(`No reefers in ${z.name}`);
    if (p.hazmat === "only" && !u.hazmat) v.push(`${z.name} is for hazmat only`); if (p.hazmat === "no" && u.hazmat) v.push(`No hazmat in ${z.name}`);
    if (p.kinds?.length && !p.kinds.includes(u.kind)) v.push(`${z.name} takes ${p.kinds.join("/")} only`);
    if (p.maxUnits && z.slots.filter((s) => s.unitId && s.unitId !== u.id).length >= p.maxUnits) v.push(`${z.name} is at its limit of ${p.maxUnits}`); }
  const c = cls(u.hazmat); if (c) { const idx = z.slots.findIndex((s) => s.label === label);
    z.slots.forEach((s, i) => { if (!s.unitId || s.unitId === u.id) return; const o = units.get(s.unitId); const oc = cls(o?.hazmat); if (!oc) return;
      const rule = r.segregation.find((g) => (g.a === c && (g.b === oc || g.b === "*")) || (g.a === oc && (g.b === c || g.b === "*")));
      if (rule && Math.abs(i - idx) < rule.minSlots) v.push(`Hazmat ${c} must be ${rule.minSlots} slots from ${oc} (${o!.number} at ${s.label})`); }); }
  return v;
}
placementGuards.push((u, to) => { if (!slotByLabel(to)) return; const v = placementViolations(u, to); if (v.length) throw Object.assign(err(v[0], 409), { violations: v }); });
const RulesIn = z.object({ zones: z.array(z.object({ id: z.string().max(30).optional(), zone: z.string().min(1).max(30), reefer: z.enum(["only", "no"]).optional(), hazmat: z.enum(["only", "no"]).optional(), kinds: z.array(z.enum(["trailer", "container"])).optional(), maxUnits: z.number().int().min(1).max(999).optional(), note: z.string().max(120).optional() })).max(50),
  segregation: z.array(z.object({ a: z.string().regex(/^[1-9](\.[1-6])?$/), b: z.string().regex(/^([1-9](\.[1-6])?|\*)$/), minSlots: z.number().int().min(1).max(20) })).max(40), hotPriority: z.boolean().default(true) });

// ---------- hot loads + staging ----------
export function setHot(unitId: string, on: boolean) {
  const u = units.get(unitId) as Unit & { hot?: boolean }; if (!u) throw err("Unit not found", 404); u.hot = on;
  if (on && getRules().hotPriority) for (const t of tasks.all()) if (t.unitId === u.id && t.status !== "done") { t.priority = 1; t.version++; }
  if (on) notify({ channel: "in_app", to: "spotter", text: `HOT load ${u.number}: move first`, kind: "hot_load", ref: u.number }); return u;
}
/** Outbound units waiting in the yard, hot loads first, then by appointment slot, then by dwell. */
export function stagingQueue() {
  const busy = new Set(tasks.all().filter((t) => t.status !== "done").map((t) => t.unitId)); const atDoor = new Set(doors.all().map((d) => d.unitId).filter(Boolean));
  return units.all().filter((u) => u.direction === "outbound" && u.status === "ok" && u.location && !atDoor.has(u.id))
    .map((u: any) => ({ unitId: u.id, number: u.number, location: u.location, hot: !!u.hot, slot: u.apptSlot ?? null, apptRef: u.apptRef ?? null, pending: busy.has(u.id), gateInAt: u.gateInAt }))
    .sort((a, b) => Number(b.hot) - Number(a.hot) || (a.slot ?? "9").localeCompare(b.slot ?? "9") || (a.gateInAt ?? "").localeCompare(b.gateInAt ?? ""));
}

const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } }).single("file");
const wrap = (f: (q: any) => unknown) => async (q: any, r: any) => { try { r.json(await f(q)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message, violations: e.violations }); } };
export const router = Router()
  .get("/settings", wrap(() => ({ ...settings(), tz: tz(), frozenTomorrow: !!frozen(new Date(Date.now() + 864e5).toISOString()) })))
  .put("/settings", wrap((q) => { const p = z.object({ cutoffEnabled: z.boolean(), cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).parse(q.body); return planSettings.put({ id: "plan", ...p }); }))
  .get("/template.csv", (_q, r) => { r.setHeader("content-type", "text/csv"); r.setHeader("content-disposition", 'attachment; filename="appointments-template.csv"'); r.send(COLS.join(",") + "\nNorthline Haulage,2026-11-10,08:00,inbound,D03,AB-123-CD,TSTU1234565,SL998877,\n"); })
  .post("/import", up, wrap(async (q) => { if (!q.file) throw err("Attach a .csv or .xlsx file", 422); return importPlan(q.file.buffer, q.file.originalname, q.query.commit === "1" || q.body?.commit === "1"); }))
  .get("/amendments", wrap(() => { const u = currentUser(); return amendments.all().filter((x) => u?.role !== "carrier" || appointments.get(x.appointmentId)?.carrierId === u.carrierId).sort((a, b) => b.at.localeCompare(a.at)); }))
  .post("/amendments", wrap((q) => requestAmend(q.body)))
  .post("/amendments/:id/:verb", wrap((q) => { const v = String(q.params.verb); if (!["approve", "reject"].includes(v)) throw err("Unknown action", 404); return decideAmend(String(q.params.id), v === "approve", q.body?.note); }))
  .get("/rules", wrap(() => getRules()))
  .put("/rules", wrap((q) => { const p = RulesIn.safeParse(q.body); if (!p.success) throw err(p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message, 422); return placementRules.put({ id: "rules", ...p.data, zones: p.data.zones.map((z, i) => ({ ...z, id: z.id ?? "pr" + i })) }); }))
  .get("/check/:unitId/:slot", wrap((q) => { const u = units.get(String(q.params.unitId)); if (!u) throw err("Unit not found", 404); return { violations: placementViolations(u, String(q.params.slot).toUpperCase()) }; }))
  .post("/hot/:unitId", wrap((q) => setHot(String(q.params.unitId), q.body?.on !== false)))
  .get("/staging", wrap(() => stagingQueue()))
  .post("/staging/:unitId", wrap((q) => { const u = units.get(String(q.params.unitId)) as any; if (!u) throw err("Unit not found", 404); const to = String(q.body?.to ?? "").toUpperCase(); if (!to) throw err("Pick a door", 422);
    return createMove({ unitId: u.id, to, priority: u.hot ? 1 : 2 }); }));
