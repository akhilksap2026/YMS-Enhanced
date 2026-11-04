import { Router } from "express";
import type { Unit, Zone } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { units as useed, zones as zseed, carriers, exceptions } from "../../seed.ts";
export const units = memoryRepo<Unit>(useed);
export const zones = memoryRepo<Zone>(zseed);
const wrap = (r: any, f: () => unknown) => { try { r.json(f()); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
/** Place or lift an operational hold. Quarantine is not lifted here (needs inspection workflow). */
export function setHold(id: string, on: boolean, reason?: string) {
  const u = units.get(id); if (!u) throw Object.assign(new Error("Not found"), { status: 404 });
  if (u.status === "quarantine") throw Object.assign(new Error("Unit is quarantined; inspection required"), { status: 409 });
  if (on) { if (u.status === "hold") throw Object.assign(new Error("Already on hold"), { status: 409 }); u.status = "hold"; exceptions.unshift({ id: "x" + Date.now(), severity: "med", text: `${u.number} placed on hold${reason ? ": " + reason : ""}`, unitId: u.id, at: new Date().toISOString() }); }
  else { if (u.status !== "hold") throw Object.assign(new Error("Unit is not on hold"), { status: 409 }); u.status = "ok"; }
  return u;
}
/** Slot bookkeeping used by moves. */
export function slotByLabel(label: string) { for (const z of zones.all()) { const s = z.slots.find((x) => x.label === label); if (s) return s; } }
export function vacate(unitId: string) { for (const z of zones.all()) for (const s of z.slots) if (s.unitId === unitId) s.unitId = undefined; }
export const router = Router()
  .get("/units", (_q, r) => r.json(units.all()))
  .get("/zones", (_q, r) => r.json(zones.all()))
  .get("/carriers", (_q, r) => r.json(carriers))
  .get("/exceptions", (_q, r) => r.json(exceptions))
  .post("/units/:id/hold", (q, r) => wrap(r, () => setHold(q.params.id, true, q.body?.reason)))
  .post("/units/:id/release", (q, r) => wrap(r, () => setHold(q.params.id, false)))
  .post("/exceptions/:id/ack", (q, r) => { const i = exceptions.findIndex((e) => e.id === q.params.id); if (i >= 0) exceptions.splice(i, 1); r.json({ ok: true }); });
