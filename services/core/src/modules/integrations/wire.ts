/** Connects the integration hub to domain modules without the hub importing them directly at load time. */
import type { Appointment } from "../../../../../packages/contracts/index.ts";
import { setLookup, setInboundHandler, setExporter } from "./index.ts";
import { units, carriers } from "../yard/index.ts";
import { doors } from "../dock/index.ts";
import { appointments } from "../appointments/index.ts";
import { charges, decide } from "../detention/index.ts";
import { currentUser } from "../../shared/tenancy.ts";
setLookup((e) => { const p = e.payload as any; const u = units.get(p.unitId); const door = p.doorLabel ?? (p.doorId ? doors.get(p.doorId)?.label : undefined);
  const appt = u ? appointments.all().find((a) => a.unitNumber === u.number && a.status !== "cancelled") : undefined;
  return { unitNumber: u?.number, door, shipmentRef: appt?.ref }; });
setInboundHandler((system, a) => {
  let c = carriers.all().find((x) => x.id === a.carrierCode || x.scac === a.carrierCode || x.name.toUpperCase() === a.carrierCode.toUpperCase());
  if (!c && a.carrierCode) c = carriers.put({ id: "c-" + a.carrierCode.toLowerCase().replace(/[^a-z0-9]/g, ""), name: a.carrierCode, scac: a.carrierCode.slice(0, 4).toUpperCase() });
  const ex = appointments.all().find((x) => x.ref === a.externalRef);
  const start = a.slotStart, end = a.slotEnd ?? new Date(Date.parse(start) + 3600e3).toISOString();
  const next: Appointment = { ...(ex ?? { id: "a" + system + "-" + a.externalRef.replace(/[^A-Za-z0-9]/g, ""), status: "booked" }), ref: a.externalRef, carrierId: c?.id ?? ex?.carrierId ?? "", slotStart: start, slotEnd: end,
    direction: a.direction, source: system, ...(a.unitNumber ? { unitNumber: a.unitNumber } : {}), ...(a.plate ? { plate: a.plate } : {}), ...(a.door ? { door: a.door } : {}) } as Appointment;
  if (a.cancelled) next.status = "cancelled"; else if (ex?.status === "cancelled") next.status = "booked";
  appointments.put(next); return { id: next.id, created: !ex };
});
setExporter(() => charges.all().filter((c) => c.state === "approved").map((c) => { decide(c.id, "exported", currentUser()?.name ?? "system", "ERP export");
  return { chargeId: c.id, visitRef: c.visitRef, carrierId: c.carrierId, unitId: c.unitId, kind: c.kind, freeHours: c.freeHours, billableHours: c.billableHours, rate: c.rate, currency: c.currency, amount: c.amount,
    approvedBy: [...c.history].reverse().find((h) => h.action === "approved")?.by ?? "", approvedAt: [...c.history].reverse().find((h) => h.action === "approved")?.at ?? "" }; }));
