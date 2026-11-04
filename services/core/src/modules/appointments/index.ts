import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Appointment } from "../../../../../packages/contracts/index.ts";
import { currentUser, runAs, runAtSite, sid, DEFAULT_SITE } from "../../shared/tenancy.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { sources } from "./source.ts";
import { settings, siteConfig } from "../tenant/index.ts";
import { sites } from "../tenant/sites.ts";
import { doors } from "../dock/index.ts";
import { flush, dbReady } from "../../shared/db.ts";
import { Rules, defaultRules, evaluate, evaluateReschedule, sweep, availability, type RulesT, type Ctx } from "./rules.ts";
export type Appt = Appointment & { reschedules?: number; history?: { at: string; by: string; action: string; from?: string; to?: string }[] };
export const appointments = tenantRepo<Appt>("appointments", (t, site) => site === DEFAULT_SITE ? seedOf(t, "appointments") : [], { site: true });
const err = (m: string, status = 422, extra?: object) => Object.assign(new Error(m), { status, ...extra });
/** Rules are per site: settings doc "appt_rules:<siteId>". */
export function rules(): RulesT { const d = settings.get(("appt_rules:" + sid()) as any) as any; return d ? Rules.parse(d.rules) : defaultRules(); }
export function setRules(body: unknown): RulesT {
  const r = Rules.safeParse(body ?? {}); if (!r.success) { const i = r.error.issues[0]; throw err((i.path.length ? i.path.join(".") + ": " : "") + i.message); }
  for (const c of r.data.carriers) if (c.from && c.to && c.from >= c.to) throw err(`Carrier ${c.carrierId}: window start must be before end`);
  for (const w of r.data.windows) if (w.from >= w.to) throw err(`Window ${w.label ?? ""} start must be before end`);
  settings.put({ id: "appt_rules:" + sid(), rules: r.data } as any); return r.data;
}
const ctx = (): Ctx => ({ now: Date.now(), tz: sites.get(sid())?.tz ?? "Africa/Bujumbura", doors: doors.all().filter((d) => d.state !== "blocked").map((d) => d.label), bookings: appointments.all() });
const who = () => currentUser()?.name ?? "system";
const BookIn = z.object({ carrierId: z.string().min(1).max(40), slotStart: z.string().datetime({ offset: true }), direction: z.enum(["inbound", "outbound"]), door: z.string().max(10).optional(),
  unitNumber: z.string().trim().toUpperCase().max(15).optional(), plate: z.string().trim().toUpperCase().max(15).optional(), override: z.boolean().optional() });
/** Book through the rules engine. Admin/yard manager may override with a reason (recorded). */
export function book(input: unknown, opts: { canOverride?: boolean } = {}) {
  const b = BookIn.safeParse(input); if (!b.success) throw err(b.error.issues[0].path.join(".") + ": " + b.error.issues[0].message);
  const r = rules(); const v = evaluate(r, ctx(), b.data);
  if (v.length && !(b.data.override && opts.canOverride)) throw err(v[0].message, 409, { violations: v });
  const start = Date.parse(b.data.slotStart); const n = appointments.all().length;
  const a: Appt = { id: "a" + Date.now().toString(36) + n, ref: "APT-" + (71000 + n), status: "booked", slotEnd: new Date(start + r.slotMinutes * 60e3).toISOString(), source: siteConfig().appointmentSource,
    carrierId: b.data.carrierId, slotStart: new Date(start).toISOString(), direction: b.data.direction, door: b.data.door, unitNumber: b.data.unitNumber, plate: b.data.plate,
    reschedules: 0, history: [{ at: new Date().toISOString(), by: who(), action: v.length ? "booked (override: " + v.map((x) => x.rule).join(",") + ")" : "booked" }] };
  void sources[a.source].publish(a);
  return appointments.put(a);
}
export function reschedule(id: string, body: unknown, opts: { canOverride?: boolean } = {}) {
  const a = appointments.get(id); if (!a) throw err("Not found", 404);
  const b = z.object({ slotStart: z.string().datetime({ offset: true }), door: z.string().max(10).optional(), override: z.boolean().optional() }).parse(body ?? {});
  const r = rules(); const v = evaluateReschedule(r, ctx(), a, b.slotStart, b.door);
  if (v.length && !(b.override && opts.canOverride)) throw err(v[0].message, 409, { violations: v });
  const from = a.slotStart; const s = Date.parse(b.slotStart);
  Object.assign(a, { slotStart: new Date(s).toISOString(), slotEnd: new Date(s + r.slotMinutes * 60e3).toISOString(), door: b.door ?? a.door, status: "booked", reschedules: (a.reschedules ?? 0) + 1 });
  (a.history ??= []).push({ at: new Date().toISOString(), by: who(), action: "rescheduled", from, to: a.slotStart }); void sources[a.source].publish(a); return appointments.put(a);
}
export const sweepNow = () => sweep(rules(), Date.now(), appointments.all()).map((c) => { const a = appointments.get(c.id)!; (a.history ??= []).push({ at: new Date().toISOString(), by: "rules", action: c.to }); return c; });
export function startRulesWorker(everyMs = 30_000, tenants = ["t-ksap", "t-demo"]) {
  const t = setInterval(() => { for (const tn of tenants) runAs(tn, () => { let n = 0; for (const s of sites.all()) n += runAtSite(s.id, () => sweepNow().length); if (n && dbReady()) void flush(tn); }); }, everyMs); t.unref?.(); return t;
}
const mgr = () => ["tenant_admin", "yard_manager"].includes(currentUser()?.role ?? "");
const wrap = (f: (q: Request) => unknown) => (q: Request, r: Response) => { try { r.json(f(q)); } catch (e: any) { r.status(e.status ?? (e.issues ? 422 : 400)).json({ error: e.issues ? e.issues[0].message : e.message, violations: e.violations }); } };
export const router = Router()
  .get("/", (_q, r) => { sweepNow(); const u = currentUser(); r.json(u?.role === "carrier" ? appointments.all().filter((a) => a.carrierId === u.carrierId) : appointments.all()); })
  .get("/rules", wrap(() => rules()))
  .put("/rules", wrap((q) => setRules(q.body)))
  .get("/availability", wrap((q) => { const u = currentUser(); const date = String(q.query.date ?? new Date().toISOString().slice(0, 10)); if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw err("date must be YYYY-MM-DD");
    const carrierId = u?.role === "carrier" ? u.carrierId : (q.query.carrierId as string | undefined); const dir = q.query.direction === "outbound" ? "outbound" : "inbound";
    return { date, slotMinutes: rules().slotMinutes, slots: availability(rules(), ctx(), date, carrierId, dir) }; }))
  .post("/check", wrap((q) => ({ violations: evaluate(rules(), ctx(), BookIn.parse(q.body ?? {})) })))
  .post("/", (q, r) => { try { const u = currentUser(); r.status(201).json(book(u?.role === "carrier" ? { ...q.body, carrierId: u.carrierId, override: false } : q.body, { canOverride: mgr() })); }
    catch (e: any) { r.status(e.status ?? 400).json({ error: e.message, violations: e.violations }); } })
  .post("/:id/reschedule", wrap((q) => { const a = appointments.get(String(q.params.id)); const u = currentUser(); if (a && u?.role === "carrier" && a.carrierId !== u.carrierId) throw err("Not found", 404);
    return reschedule(String(q.params.id), u?.role === "carrier" ? { ...q.body, override: false } : q.body, { canOverride: mgr() }); }))
  .post("/:id/cancel", wrap((q) => { const a = appointments.get(String(q.params.id)); const u = currentUser(); if (!a || (u?.role === "carrier" && a.carrierId !== u.carrierId)) throw err("Not found", 404);
    if (a.status === "arrived") throw err("Already arrived", 409); a.status = "cancelled"; (a.history ??= []).push({ at: new Date().toISOString(), by: who(), action: "cancelled" }); return appointments.put(a); }));
