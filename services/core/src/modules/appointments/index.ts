import { Router } from "express";
import type { Appointment } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { appointments as seed } from "../../seed.ts";
import { sources } from "./source.ts";
import { siteConfig } from "../tenant/index.ts";
export const appointments = memoryRepo<Appointment>(seed);
export const DOOR_CAPACITY_PER_HOUR = 4;
export function book(input: Pick<Appointment, "carrierId" | "slotStart" | "direction"> & Partial<Appointment>) {
  const start = Date.parse(input.slotStart);
  const clash = appointments.all().filter((a) => a.status !== "cancelled" && Math.abs(Date.parse(a.slotStart) - start) < 3600e3).length;
  if (clash >= DOOR_CAPACITY_PER_HOUR) throw Object.assign(new Error("Slot full"), { status: 409 });
  const id = "a" + (appointments.all().length + 1);
  const a: Appointment = { id, ref: "APT-" + (71000 + appointments.all().length), status: "booked", slotEnd: new Date(start + 3600e3).toISOString(), source: siteConfig.appointmentSource, ...input };
  void sources[a.source].publish(a);
  return appointments.put(a);
}
export const router = Router()
  .get("/", (_q, r) => r.json(appointments.all()))
  .post("/", (q, r) => { try { r.status(201).json(book(q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } })
  .post("/:id/cancel", (q, r) => { const a = appointments.get(q.params.id); if (!a) return r.sendStatus(404); a.status = "cancelled"; r.json(a); });
