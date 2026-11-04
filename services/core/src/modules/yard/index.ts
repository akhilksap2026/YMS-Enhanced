import { Router } from "express";
import type { Unit, Zone } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { units as useed, zones as zseed, carriers, exceptions } from "../../seed.ts";
export const units = memoryRepo<Unit>(useed);
export const zones = memoryRepo<Zone>(zseed);
export const router = Router()
  .get("/units", (_q, r) => r.json(units.all()))
  .get("/zones", (_q, r) => r.json(zones.all()))
  .get("/carriers", (_q, r) => r.json(carriers))
  .get("/exceptions", (_q, r) => r.json(exceptions))
  .post("/exceptions/:id/ack", (q, r) => { const i = exceptions.findIndex((e) => e.id === q.params.id); if (i >= 0) exceptions.splice(i, 1); r.json({ ok: true }); });
