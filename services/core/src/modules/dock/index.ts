import { DEFAULT_SITE } from "../../shared/tenancy.ts";
import { Router } from "express";
import type { Door } from "../../../../../packages/contracts/index.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { units } from "../yard/index.ts";
import { publish } from "../../shared/bus.ts";
import { doorVisits } from "../reports/history.ts";
import { body, id } from "../../shared/validate.js";
import { z } from "zod";
export const doors = tenantRepo<Door>("doors", (t, site) => site === DEFAULT_SITE ? seedOf(t, "doors") : [], { site: true });
export function assign(doorId: string, unitId: string) {
  const d = doors.get(doorId); const u = units.get(unitId);
  if (!d || !u) throw Object.assign(new Error("Not found"), { status: 404 });
  if (d.state !== "free") throw Object.assign(new Error(d.label + " is " + d.state), { status: 409 });
  if (u.status === "hold" || u.status === "quarantine") throw Object.assign(new Error("Unit on " + u.status), { status: 409 });
  for (const o of doors.all()) if (o.unitId === unitId) { o.unitId = undefined; o.state = "free"; }
  for (const v of doorVisits.all()) if (!v.end && (v.unitId === unitId || v.doorId === d.id)) v.end = new Date().toISOString();
  Object.assign(d, { state: "occupied", unitId, since: new Date().toISOString() }); u.location = d.label;
  doorVisits.put({ id: "dv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), doorId: d.id, doorLabel: d.label, unitId, unitNumber: u.number, carrierId: u.carrierId, start: d.since! });
  publish({ type: "DoorOccupied", aggregateId: d.id, aggregateVersion: 1, payload: { doorId: d.id, doorLabel: d.label, unitId } } as any);
  return d;
}
export function release(doorId: string) {
  const d = doors.get(doorId); if (!d) throw Object.assign(new Error("Not found"), { status: 404 });
  for (const v of doorVisits.all()) if (!v.end && v.doorId === d.id) v.end = new Date().toISOString();
  Object.assign(d, { state: "free", unitId: undefined, since: undefined });
  publish({ type: "DoorReleased", aggregateId: d.id, aggregateVersion: 1, payload: { doorId: d.id } } as any);
  return d;
}
const wrap = (f: () => unknown) => (_q: any, r: any) => { try { r.json(f()); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export const router = Router()
  .get("/doors", (_q, r) => r.json(doors.all()))
  .post("/doors/:id/assign", body(z.object({ unitId: id })), (q, r) => wrap(() => assign(String(q.params.id), q.body.unitId))(q, r))
  .post("/doors/:id/release", (q, r) => wrap(() => release(q.params.id))(q, r));
