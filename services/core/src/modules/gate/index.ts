import multer from "multer";
import { ocr } from "./ocr.ts";
import { Router } from "express";
import { validateContainer } from "../../shared/iso6346.ts";
import { appointments } from "../appointments/index.ts";
import { publish } from "../../shared/bus.ts";
import { units } from "../yard/index.ts";
import { tasks } from "../tasks/index.ts";
export type GateDecision = "pass" | "hold" | "quarantine";
export function checkIn(body: { appointmentId: string; plate: string; unitNumber: string; decision: GateDecision; seal?: string; note?: string }) {
  const a = appointments.get(body.appointmentId);
  if (!a) throw Object.assign(new Error("Appointment not found"), { status: 404 });
  const isContainer = /^[A-Z]{4}/i.test(body.unitNumber);
  const v = isContainer ? validateContainer(body.unitNumber) : { valid: true, normalized: body.unitNumber.toUpperCase() };
  if (!v.valid && body.decision === "pass") throw Object.assign(new Error("Unit number invalid: " + v.reason), { status: 422 });
  a.status = "arrived";
  const id = "u" + (units.all().length + 1);
  units.put({ id, number: v.normalized, kind: isContainer ? "container" : "trailer", carrierId: a.carrierId, status: body.decision === "pass" ? "ok" : body.decision, location: body.decision === "quarantine" ? "H-zone" : "W-zone", gateInAt: new Date().toISOString(), load: a.direction === "inbound" ? "loaded" : "empty" });
  if (body.decision === "pass") tasks.put({ id: "t" + (tasks.all().length + 1), version: 1, type: "spot", unitId: id, from: "Gate 1", to: "W01", priority: 2, status: "open", createdAt: new Date().toISOString() });
  publish({ type: "GateIn", aggregateId: id, aggregateVersion: 1, payload: { unitId: id, decision: body.decision } } as any);
  return { appointment: a, unitId: id };
}
const uploadMw = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, /^image\//.test(f.mimetype)) }).single("image");
export const router = Router()
  .get("/ocr/health", async (_q, r) => r.json({ ok: await ocr().health() }))
  .post("/ocr", uploadMw, async (q, r) => { try { if (!q.file) return r.status(422).json({ error: "Attach an image (JPEG/PNG, max 8 MB)" });
    const k = String(q.body?.kind ?? "auto"); r.json(await ocr().read(q.file.buffer, q.file.mimetype, (["auto", "container", "plate"].includes(k) ? k : "auto") as any)); }
    catch (e: any) { r.status(e.status ?? 500).json({ error: e.message }); } })
  .get("/validate/:n", (q, r) => r.json(validateContainer(q.params.n)))
  .post("/checkin", (q, r) => { try { r.json(checkIn(q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
