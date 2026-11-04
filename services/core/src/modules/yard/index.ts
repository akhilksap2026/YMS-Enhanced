import { DEFAULT_SITE } from "../../shared/tenancy.ts";
import { Router } from "express";
import type { Unit, Zone } from "../../../../../packages/contracts/index.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import type { Carrier, ExceptionItem } from "../../../../../packages/contracts/index.ts";
import { body, id } from "../../shared/validate.js";
import { z } from "zod";
export const units = tenantRepo<Unit>("units", (t, site) => site === DEFAULT_SITE ? seedOf(t, "units") : [], { site: true });
export const zones = tenantRepo<Zone>("zones", (t, site) => site === DEFAULT_SITE ? seedOf(t, "zones") : [], { site: true })
export const carriers = tenantRepo<Carrier>("carriers", (t) => seedOf(t, "carriers"));
export const exceptions = tenantRepo<ExceptionItem>("exceptions", (t, site) => site === DEFAULT_SITE ? seedOf(t, "exceptions") : [], { site: true });
export const raise = (x: Omit<ExceptionItem, "id" | "at"> & { id?: string }) => exceptions.put({ id: "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), ...x });;
const wrap = (r: any, f: () => unknown) => { try { r.json(f()); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
/** Place or lift an operational hold. Quarantine is not lifted here (needs inspection workflow). */
export function setHold(id: string, on: boolean, reason?: string) {
  const u = units.get(id); if (!u) throw Object.assign(new Error("Not found"), { status: 404 });
  if (u.status === "quarantine") throw Object.assign(new Error("Unit is quarantined; inspection required"), { status: 409 });
  if (on) { if (u.status === "hold") throw Object.assign(new Error("Already on hold"), { status: 409 }); u.status = "hold"; ((u as any).holdLog ??= []).push({ from: new Date().toISOString() }); raise({ severity: "med", text: `${u.number} placed on hold${reason ? ": " + reason : ""}`, unitId: u.id }); }
  else { if (u.status !== "hold") throw Object.assign(new Error("Unit is not on hold"), { status: 409 }); u.status = "ok"; const l = (u as any).holdLog?.at(-1); if (l && !l.to) l.to = new Date().toISOString(); }
  return u;
}
/** Slot bookkeeping used by moves. */
export function slotByLabel(label: string) { for (const z of zones.all()) { const s = z.slots.find((x) => x.label === label); if (s) return s; } }
export function vacate(unitId: string) { for (const z of zones.all()) for (const s of z.slots) if (s.unitId === unitId) s.unitId = undefined; }
export const router = Router()
  .get("/units", (_q, r) => r.json(units.all()))
  .get("/zones", (_q, r) => r.json(zones.all()))
  .get("/carriers", (_q, r) => r.json(carriers.all()))
  .get("/exceptions", (_q, r) => r.json(exceptions.all().sort((a, b) => b.at.localeCompare(a.at))))
  .post("/units/:id/hold", body(z.object({ reason: z.string().max(300).optional() })), (q, r) => wrap(r, () => setHold(String(q.params.id), true, q.body?.reason)))
  .post("/units/:id/release", (q, r) => wrap(r, () => setHold(q.params.id, false)))
  .post("/exceptions/:id/ack", (q, r) => { exceptions.del(q.params.id); r.json({ ok: true }); });
