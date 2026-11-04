import multer from "multer";
import { ocr } from "./ocr.ts";
import { Router } from "express";
import { validateContainer } from "../../shared/iso6346.ts";
import { appointments } from "../appointments/index.ts";
import { publish } from "../../shared/bus.ts";
import { z } from "zod";
import { units, vacate } from "../yard/index.ts";
import { doors, release } from "../dock/index.ts";
import { yardVisits } from "../reports/history.ts";
import { tasks } from "../tasks/index.ts";
export type GateDecision = "pass" | "hold" | "quarantine";
const CheckIn = z.object({ appointmentId: z.string().min(1).max(60), plate: z.string().trim().max(15).default(""), unitNumber: z.string().trim().min(3).max(15), decision: z.enum(["pass", "hold", "quarantine"]), seal: z.string().max(30).optional(), note: z.string().max(500).optional() });
export function checkIn(input: unknown) {
  const p = CheckIn.safeParse(input); if (!p.success) throw Object.assign(new Error(p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message), { status: 422 }); const body = p.data;
  const a = appointments.get(body.appointmentId);
  if (!a) throw Object.assign(new Error("Appointment not found"), { status: 404 });
  const isContainer = /^[A-Z]{4}/i.test(body.unitNumber);
  const v = isContainer ? validateContainer(body.unitNumber) : { valid: true, normalized: body.unitNumber.toUpperCase() };
  if (!v.valid && body.decision === "pass") throw Object.assign(new Error("Unit number invalid: " + v.reason), { status: 422 });
  if (a.status === "arrived" || a.status === "cancelled") throw Object.assign(new Error(`Appointment already ${a.status}`), { status: 409 });
  const lateMin = Math.round((Date.now() - Date.parse(a.slotStart)) / 60e3); a.status = "arrived"; (a as any).arrivedAt = new Date().toISOString(); (a as any).lateMin = lateMin;
  const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  units.put({ id, number: v.normalized, kind: isContainer ? "container" : "trailer", carrierId: a.carrierId, status: body.decision === "pass" ? "ok" : body.decision, location: body.decision === "quarantine" ? "H-zone" : "W-zone", gateInAt: new Date().toISOString(), apptRef: a.ref, apptSlot: a.slotStart, lateMin, direction: a.direction, load: a.direction === "inbound" ? "loaded" : "empty" });
  if (body.decision === "pass") tasks.put({ id: "t" + (tasks.all().length + 1), version: 1, type: "spot", unitId: id, from: "Gate 1", to: "W01", priority: 2, status: "open", createdAt: new Date().toISOString() });
  publish({ type: "GateIn", aggregateId: id, aggregateVersion: 1, payload: { unitId: id, decision: body.decision } } as any);
  return { appointment: a, unitId: id };
}
/** Gate-out: frees slot/door, closes open tasks, records the completed visit (turn time) and publishes GateOut. */
export function checkOut(unitId: string) {
  const u = units.get(unitId) as any; if (!u) throw Object.assign(new Error("Unit not found"), { status: 404 });
  if (u.status === "hold" || u.status === "quarantine") throw Object.assign(new Error(`Unit is on ${u.status}; release it first`), { status: 409 });
  const d = doors.all().find((x) => x.unitId === unitId); if (d) release(d.id); vacate(unitId);
  for (const t of tasks.all()) if (t.unitId === unitId && t.status !== "done") tasks.del(t.id);
  const v = { id: "yv-" + unitId, unitId, unitNumber: u.number, carrierId: u.carrierId, apptRef: u.apptRef, slotStart: u.apptSlot, gateIn: u.gateInAt, gateOut: new Date().toISOString(), lateMin: u.lateMin, outcome: "completed" as const, direction: u.direction ?? "inbound" };
  yardVisits.put(v); units.del(unitId);
  publish({ type: "GateOut", aggregateId: unitId, aggregateVersion: 2, payload: { unitId, unitNumber: u.number } } as any);
  return v;
}
const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, /^image\//.test(f.mimetype)) }).single("image");
export const router = Router()
  .get("/ocr/health", async (_q, r) => r.json({ ok: await ocr().health() }))
  .post("/ocr", uploadMw, async (q, r) => { try { if (!q.file) return r.status(422).json({ error: "Attach an image (JPEG/PNG, max 8 MB)" });
    const k = String(q.body?.kind ?? "auto"); r.json(await ocr().read(q.file.buffer, q.file.mimetype, (["auto", "container", "plate"].includes(k) ? k : "auto") as any)); }
    catch (e: any) { r.status(e.status ?? 500).json({ error: e.message }); } })
  .get("/validate/:n", (q, r) => r.json(validateContainer(q.params.n)))
  .post("/checkin", (q, r) => { try { r.json(checkIn(q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } })
  .post("/checkout", (q, r) => { try { r.json(checkOut(String(q.body?.unitId ?? ""))); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
