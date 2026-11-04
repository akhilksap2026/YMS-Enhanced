// Driver channel without an app: signed SMS/web links per appointment, a public status page, document upload and a gate kiosk.
import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z } from "zod";
import { signingSecret } from "../auth/index.ts";
import { runAs, tid, sid, DEFAULT_SITE } from "../../shared/tenancy.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { dbReady, flush } from "../../shared/db.ts";
import { appointments } from "../appointments/index.ts";
import { units } from "../yard/index.ts";
import { doors } from "../dock/index.ts";
import { send, notify } from "../notifications/index.ts";
import { publish } from "../../shared/bus.ts";

export type DriverLang = "en" | "fr" | "sw";
export interface DriverDoc { id: string; apptId: string; kind: "bol" | "id" | "permit" | "other"; name: string; mime: string; size: number; data: string; at: string; status: "received" | "accepted" | "rejected" }
export const driverDocs = tenantRepo<DriverDoc>("driver_docs", () => [], { site: true });
const err = (m: string, status: number) => Object.assign(new Error(m), { status });

type Link = { t: string; s: string; a: string; k?: undefined } | { t: string; s: string; k: true; a?: undefined };
export const linkToken = (apptId: string, days = 3) => jwt.sign({ t: tid(), s: sid(), a: apptId }, signingSecret(), { expiresIn: `${days}d` });
export const kioskToken = () => jwt.sign({ t: tid(), s: sid(), k: true }, signingSecret(), { expiresIn: "365d" });
function verify(tok: string): Link { try { return jwt.verify(tok, signingSecret()) as Link; } catch { throw err("This link has expired or is not valid. Ask the gate for a new one.", 401); } }

const TEXT: Record<DriverLang, Record<string, string>> = {
  en: { queued: "You are checked in. Wait in the truck lane.", gate: "Drive to the gate when called.", door: "Go to door {door}.", hold: "Stay at the gate. Staff will inspect your unit.", done: "Visit complete. Safe trip.", booked: "Check in when you are within 30 minutes of the site.", docs: "Upload your BOL, ID and any permits before you arrive." },
  fr: { queued: "Enregistrement effectué. Attendez dans la file camions.", gate: "Présentez-vous à la barrière quand on vous appelle.", door: "Allez au quai {door}.", hold: "Restez à la barrière. Le personnel va inspecter votre unité.", done: "Visite terminée. Bonne route.", booked: "Enregistrez-vous à moins de 30 minutes du site.", docs: "Téléversez la lettre de voiture, la pièce d'identité et les permis avant d'arriver." },
  sw: { queued: "Umesajiliwa. Subiri kwenye mstari wa malori.", gate: "Endesha hadi getini ukiitwa.", door: "Nenda mlango {door}.", hold: "Kaa getini. Wafanyakazi watakagua gari lako.", done: "Ziara imekamilika. Safari njema.", booked: "Jisajili ukiwa ndani ya dakika 30 kutoka eneo.", docs: "Pakia BOL, kitambulisho na vibali kabla ya kufika." },
};
const lang = (x: unknown): DriverLang => (["en", "fr", "sw"].includes(String(x)) ? x : "en") as DriverLang;

/** Status as the driver sees it: queue position among pre-checked arrivals, door, instructions in their language. */
export function driverStatus(apptId: string, l: DriverLang = "en") {
  const a = appointments.get(apptId) as any; if (!a) throw err("Appointment not found", 404);
  const u = units.all().find((x) => x.apptRef === a.ref); const door = u && doors.all().find((d) => d.unitId === u.id);
  const queue = appointments.all().filter((x: any) => x.precheck && x.status !== "arrived" && x.status !== "cancelled").sort((x: any, y: any) => x.precheck.at.localeCompare(y.precheck.at));
  const pos = queue.findIndex((x) => x.id === a.id);
  const T = TEXT[l]; let state: string, text: string;
  if (a.status === "cancelled") { state = "cancelled"; text = ""; }
  else if (u && door) { state = "at_door"; text = T.door.replace("{door}", door.label); }
  else if (u && (u.status === "hold" || u.status === "quarantine")) { state = "hold"; text = T.hold; }
  else if (u) { state = "in_yard"; text = T.queued; }
  else if (a.status === "arrived") { state = "done"; text = T.done; }
  else if (a.precheck) { state = "queued"; text = pos === 0 ? T.gate : T.queued; }
  else { state = "booked"; text = T.booked; }
  const docs = driverDocs.all().filter((d) => d.apptId === a.id).map(({ data, ...d }) => d);
  return { ref: a.ref, slotStart: a.slotStart, slotEnd: a.slotEnd, direction: a.direction, state, queuePosition: pos >= 0 ? pos + 1 : null, queueLength: queue.length, door: door?.label ?? a.door ?? null, instructions: text, docsHint: T.docs, lang: l, docs, precheck: a.precheck ?? null };
}
const Pre = z.object({ plate: z.string().trim().min(2).max(15), unitNumber: z.string().trim().max(15).optional(), phone: z.string().trim().max(20).optional(), lang: z.enum(["en", "fr", "sw"]).default("en"), via: z.enum(["sms", "web", "kiosk"]).default("web") });
export function precheck(apptId: string, input: unknown) {
  const p = Pre.safeParse(input); if (!p.success) throw err(p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message, 422);
  const a = appointments.get(apptId) as any; if (!a) throw err("Appointment not found", 404);
  if (a.status === "arrived" || a.status === "cancelled") throw err(`Appointment already ${a.status}`, 409);
  a.precheck = { at: a.precheck?.at ?? new Date().toISOString(), ...p.data, plate: p.data.plate.toUpperCase() }; if (!a.plate) a.plate = a.precheck.plate;
  notify({ channel: "in_app", to: "gate", text: `${a.ref} driver checked in by ${p.data.via} (${a.precheck.plate})`, kind: "driver_precheck", ref: a.ref });
  publish({ type: "DriverPrecheck", aggregateId: a.id, aggregateVersion: 1, payload: { ref: a.ref, via: p.data.via } } as any);
  return driverStatus(a.id, p.data.lang);
}
const DOC_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
export function addDoc(apptId: string, kind: string, f: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
  if (!appointments.get(apptId)) throw err("Appointment not found", 404);
  if (!DOC_MIME.test(f.mimetype)) throw err("Upload a PDF, JPEG, PNG or WebP", 422);
  const k = (["bol", "id", "permit", "other"].includes(kind) ? kind : "other") as DriverDoc["kind"];
  const { data, ...meta } = driverDocs.put({ id: "doc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), apptId, kind: k, name: f.originalname.slice(0, 120), mime: f.mimetype, size: f.size, data: f.buffer.toString("base64"), at: new Date().toISOString(), status: "received" });
  return meta;
}
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single("file");
/** Public endpoints: the token carries tenant, site and appointment, so no login is needed. */
const pub = (f: (l: Link, q: Request) => unknown) => async (q: Request, r: Response) => {
  try { const l = verify(String(q.params.token)); const out = await runAs(l.t, () => f(l, q), undefined, l.s ?? DEFAULT_SITE);
    if (q.method !== "GET" && dbReady()) await flush(l.t); r.json(out); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
const apptOf = (l: Link) => { if (!l.a) throw err("Not a driver link", 403); return l.a; };
export const router = Router()
  // staff: issue a link and (optionally) text it to the driver
  .post("/links", async (q, r) => { try { const a = appointments.get(String(q.body?.appointmentId ?? "")); if (!a) throw err("Appointment not found", 404);
    const token = linkToken(a.id); const url = `/driver/${token}`; let delivery;
    if (q.body?.phone) delivery = await send("sms", String(q.body.phone).slice(0, 20), "driver_link", { ref: a.ref, text: `Ksap YMS: check in for ${a.ref} and see your door here: ${q.body.base ?? ""}${url}` }, lang(q.body.lang));
    r.json({ token, url, delivery: delivery && { status: delivery.status, to: delivery.to } }); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } })
  .post("/kiosk-token", (_q, r) => r.json({ token: kioskToken(), url: `/?kiosk=` }))
  .get("/docs/:apptId", (q, r) => r.json(driverDocs.all().filter((d) => d.apptId === q.params.apptId).map(({ data, ...d }) => d)))
  .get("/docs/:apptId/:docId/file", (q, r) => { const d = driverDocs.get(String(q.params.docId)); if (!d || d.apptId !== q.params.apptId) return r.status(404).json({ error: "Not found" }); r.setHeader("content-type", d.mime); r.send(Buffer.from(d.data, "base64")); })
  .post("/docs/:apptId/:docId/:status", (q, r) => { const d = driverDocs.get(String(q.params.docId)); const s = String(q.params.status);
    if (!d || !["accepted", "rejected"].includes(s)) return r.status(404).json({ error: "Not found" }); d.status = s as DriverDoc["status"]; const { data, ...m } = d; r.json(m); })
  .get("/p/:token", pub((l, q) => driverStatus(apptOf(l), lang(q.query.lang))))
  .post("/p/:token/checkin", pub((l, q) => precheck(apptOf(l), { ...q.body, via: q.body?.via === "sms" ? "sms" : "web" })))
  .post("/p/:token/docs", (q, r, n) => up(q, r, n), pub((l, q) => { if (!q.file) throw err("Attach a file (max 5 MB)", 422); return addDoc(apptOf(l), String(q.body?.kind ?? "other"), q.file); }))
  // kiosk: driver types booking ref + plate; no login on the device, token issued by an admin
  .post("/kiosk/:token/lookup", pub((l, q) => { if (!l.k) throw err("Not a kiosk token", 403); const ref = String(q.body?.ref ?? "").trim().toUpperCase(); const plate = String(q.body?.plate ?? "").replace(/\W/g, "").toUpperCase();
    const a = appointments.all().find((x) => x.ref.toUpperCase() === ref); if (!a || (a.plate && plate && a.plate.replace(/\W/g, "").toUpperCase() !== plate)) throw err("No booking matches that reference and plate", 404);
    return { appointmentId: a.id, token: linkToken(a.id, 1), ...driverStatus(a.id, lang(q.body?.lang)) }; }))
  .post("/kiosk/:token/checkin", pub((l, q) => { if (!l.k) throw err("Not a kiosk token", 403); return precheck(String(q.body?.appointmentId ?? ""), { ...q.body, via: "kiosk" }); }));
