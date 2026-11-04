import { Router } from "express";
import type { Door } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { doors as seed } from "../../seed.ts";
import { units } from "../yard/index.ts";
import { publish } from "../../shared/bus.ts";
export const doors = memoryRepo<Door>(seed);
export function assign(doorId: string, unitId: string) {
  const d = doors.get(doorId); const u = units.get(unitId);
  if (!d || !u) throw Object.assign(new Error("Not found"), { status: 404 });
  if (d.state !== "free") throw Object.assign(new Error(d.label + " is " + d.state), { status: 409 });
  if (u.status === "hold" || u.status === "quarantine") throw Object.assign(new Error("Unit on " + u.status), { status: 409 });
  for (const o of doors.all()) if (o.unitId === unitId) { o.unitId = undefined; o.state = "free"; }
  Object.assign(d, { state: "occupied", unitId, since: new Date().toISOString() }); u.location = d.label;
  publish({ type: "DoorOccupied", aggregateId: d.id, aggregateVersion: 1, payload: { doorId: d.id, unitId } } as any);
  return d;
}
export function release(doorId: string) {
  const d = doors.get(doorId); if (!d) throw Object.assign(new Error("Not found"), { status: 404 });
  Object.assign(d, { state: "free", unitId: undefined, since: undefined });
  publish({ type: "DoorReleased", aggregateId: d.id, aggregateVersion: 1, payload: { doorId: d.id } } as any);
  return d;
}
const wrap = (f: () => unknown) => (_q: any, r: any) => { try { r.json(f()); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export const router = Router()
  .get("/doors", (_q, r) => r.json(doors.all()))
  .post("/doors/:id/assign", (q, r) => wrap(() => assign(q.params.id, q.body.unitId))(q, r))
  .post("/doors/:id/release", (q, r) => wrap(() => release(q.params.id))(q, r));
