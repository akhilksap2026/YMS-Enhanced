import { Router } from "express";
import type { Appointment } from "../../../../../packages/contracts/index.ts";
import { currentUser } from "../../shared/tenancy.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { sources } from "./source.ts";
import { siteConfig } from "../tenant/index.ts";
export const appointments = tenantRepo<Appointment>("appointments", (t) => seedOf(t, "appointments"));
export const DOOR_CAPACITY_PER_HOUR = 4;
export function book(input: Pick<Appointment, "carrierId" | "slotStart" | "direction"> & Partial<Appointment>) {
  const start = Date.parse(input.slotStart);
  const clash = appointments.all().filter((a) => a.status !== "cancelled" && Math.abs(Date.parse(a.slotStart) - start) < 3600e3).length;
  if (clash >= DOOR_CAPACITY_PER_HOUR) throw Object.assign(new Error("Slot full"), { status: 409 });
  const id = "a" + (appointments.all().length + 1);
  const a: Appointment = { id, ref: "APT-" + (71000 + appointments.all().length), status: "booked", slotEnd: new Date(start + 3600e3).toISOString(), source: siteConfig().appointmentSource, ...input };
  void sources[a.source].publish(a);
  return appointments.put(a);
}
export const router = Router()
  .get("/", (_q, r) => { const u = currentUser(); r.json(u?.role === "carrier" ? appointments.all().filter((a) => a.carrierId === u.carrierId) : appointments.all()); })
  .post("/", (q, r) => { try { const u = currentUser(); r.status(201).json(book(u?.role === "carrier" ? { ...q.body, carrierId: u.carrierId } : q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } })
  .post("/:id/cancel", (q, r) => { const a = appointments.get(q.params.id); if (!a) return r.sendStatus(404); a.status = "cancelled"; r.json(a); });
