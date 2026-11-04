// Gate evidence: photos per visit, configurable inspection templates with damage marking, hazmat placards, seal check.
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { tenantRepo } from "../../shared/repo.ts";
import { units, raise } from "../yard/index.ts";
import { appointments } from "../appointments/index.ts";

export interface Photo { id: string; unitId: string; apptRef?: string; view: string; mime: string; size: number; data: string; at: string; by: string }
export interface TemplateItem { id: string; label: string; kind: "check" | "damage" | "text"; required?: boolean }
export interface InspectionTemplate { id: string; name: string; appliesTo: "all" | "container" | "trailer" | "reefer" | "hazmat"; items: TemplateItem[] }
export interface Damage { side: "front" | "rear" | "left" | "right" | "top" | "floor"; x: number; y: number; type: "dent" | "hole" | "scratch" | "rust" | "leak" | "other"; severity: "minor" | "major"; note?: string }
export interface Inspection { id: string; unitId: string; apptRef?: string; templateId: string; answers: Record<string, string | boolean>; damage: Damage[]; placards: { un: string; cls: string }[]; seal: SealCheck; result: "pass" | "fail"; at: string; by: string }
export interface SealCheck { expected?: string; observed?: string; status: "match" | "mismatch" | "missing" | "not_expected" }

export const photos = tenantRepo<Photo>("gate_evidence", () => [], { site: true });
export const templates = tenantRepo<InspectionTemplate>("inspection_templates", () => [
  { id: "std", name: "Standard gate inspection", appliesTo: "all", items: [
    { id: "tyres", label: "Tyres and wheels OK", kind: "check", required: true }, { id: "lights", label: "Lights working", kind: "check" },
    { id: "doors", label: "Doors close and lock", kind: "check", required: true }, { id: "body", label: "Body damage (mark on diagram)", kind: "damage" },
    { id: "notes", label: "Notes", kind: "text" }] },
  { id: "reefer", name: "Reefer inspection", appliesTo: "reefer", items: [
    { id: "unit_on", label: "Reefer unit running", kind: "check", required: true }, { id: "display", label: "Display temperature recorded", kind: "text", required: true }, { id: "body", label: "Body damage", kind: "damage" }] },
  { id: "haz", name: "Hazmat inspection", appliesTo: "hazmat", items: [
    { id: "placards", label: "Placards on all four sides", kind: "check", required: true }, { id: "docs", label: "Dangerous-goods note present", kind: "check", required: true }, { id: "leak", label: "No leaks or odour", kind: "check", required: true }, { id: "body", label: "Body damage", kind: "damage" }] },
]);
export const inspections = tenantRepo<Inspection>("inspections", () => [], { site: true });
const err = (m: string, status: number) => Object.assign(new Error(m), { status });
const nid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const norm = (s?: string) => (s ?? "").replace(/[\s-]/g, "").toUpperCase();

/** Compare the seal read at the gate with the seal on the appointment (from SAP/OTM or the import). */
export function sealCheck(expected?: string, observed?: string): SealCheck {
  const e = norm(expected), o = norm(observed);
  if (!e) return { expected: undefined, observed: observed || undefined, status: "not_expected" };
  if (!o) return { expected, observed: undefined, status: "missing" };
  return { expected, observed, status: e === o ? "match" : "mismatch" };
}
// UN number 4 digits, class like 3, 2.1, 5.1, 8
const Placard = z.object({ un: z.string().regex(/^(UN)?\d{4}$/i, "UN number is 4 digits"), cls: z.string().regex(/^[1-9](\.[1-6])?$/, "Class like 3 or 2.1") });
const Insp = z.object({ unitId: z.string().min(1), templateId: z.string().min(1), answers: z.record(z.string(), z.union([z.string().max(500), z.boolean()])).default({}),
  damage: z.array(z.object({ side: z.enum(["front", "rear", "left", "right", "top", "floor"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1), type: z.enum(["dent", "hole", "scratch", "rust", "leak", "other"]), severity: z.enum(["minor", "major"]), note: z.string().max(200).optional() })).max(50).default([]),
  placards: z.array(Placard).max(8).default([]), seal: z.string().max(30).optional(), by: z.string().max(64).optional() });
export function inspect(input: unknown) {
  const p = Insp.safeParse(input); if (!p.success) throw err(p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message, 422); const b = p.data;
  const u = units.get(b.unitId); if (!u) throw err("Unit not found", 404);
  const t = templates.get(b.templateId); if (!t) throw err("Template not found", 404);
  const missing = t.items.filter((i) => i.required && (b.answers[i.id] === undefined || b.answers[i.id] === "")).map((i) => i.label);
  if (missing.length) throw err("Required: " + missing.join(", "), 422);
  const a = appointments.all().find((x) => x.ref === u.apptRef) as any;
  const seal = sealCheck(a?.seal, b.seal);
  const failedCheck = t.items.some((i) => i.kind === "check" && b.answers[i.id] === false);
  const placards = b.placards.map((x) => ({ un: x.un.toUpperCase().replace(/^(?!UN)/, "UN"), cls: x.cls }));
  if (u.hazmat && !placards.length) throw err("Hazmat unit: capture at least one placard", 422);
  if (placards.length && !u.hazmat) u.hazmat = placards[0].cls;
  const result = failedCheck || seal.status === "mismatch" || b.damage.some((d) => d.severity === "major") ? "fail" : "pass";
  const x = inspections.put({ id: nid("in"), unitId: u.id, apptRef: u.apptRef, templateId: t.id, answers: b.answers, damage: b.damage, placards, seal, result, at: new Date().toISOString(), by: b.by ?? "gate" });
  if (result === "fail") raise({ severity: seal.status === "mismatch" ? "high" : "med", text: `${u.number} failed gate inspection${seal.status === "mismatch" ? `: seal ${seal.observed} ≠ ${seal.expected}` : ""}`, unitId: u.id });
  return x;
}
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024, files: 8 }, fileFilter: (_q, f, cb) => cb(null, /^image\//.test(f.mimetype)) }).array("photo", 8);
const Tpl = z.object({ id: z.string().regex(/^[a-z0-9-]{2,30}$/), name: z.string().min(2).max(60), appliesTo: z.enum(["all", "container", "trailer", "reefer", "hazmat"]), items: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,30}$/), label: z.string().min(1).max(80), kind: z.enum(["check", "damage", "text"]), required: z.boolean().optional() })).min(1).max(30) });
export const router = Router()
  .get("/templates", (_q, r) => r.json(templates.all()))
  .put("/templates/:id", (q, r) => { const p = Tpl.safeParse({ ...q.body, id: q.params.id }); if (!p.success) return r.status(422).json({ error: p.error.issues[0].path.join(".") + ": " + p.error.issues[0].message }); r.json(templates.put(p.data)); })
  .get("/seal/:unitId", (q, r) => { const u = units.get(String(q.params.unitId)); const a = u && (appointments.all().find((x) => x.ref === u.apptRef) as any); r.json(sealCheck(a?.seal, String(q.query.observed ?? ""))); })
  .get("/visit/:unitId", (q, r) => r.json({ photos: photos.all().filter((p) => p.unitId === q.params.unitId).map(({ data, ...p }) => p), inspections: inspections.all().filter((i) => i.unitId === q.params.unitId) }))
  .get("/photos/:id", (q, r) => { const p = photos.get(String(q.params.id)); if (!p) return r.status(404).json({ error: "Not found" }); r.setHeader("content-type", p.mime); r.send(Buffer.from(p.data, "base64")); })
  .post("/photos/:unitId", up, (q, r) => { const u = units.get(String(q.params.unitId)); if (!u) return r.status(404).json({ error: "Unit not found" });
    const fs = (q.files as Express.Multer.File[] | undefined) ?? []; if (!fs.length) return r.status(422).json({ error: "Attach at least one image" });
    const views = String(q.body?.views ?? "").split(","); r.json(fs.map((f, i) => { const { data, ...m } = photos.put({ id: nid("ph"), unitId: u.id, apptRef: u.apptRef, view: (views[i] || "general").slice(0, 20), mime: f.mimetype, size: f.size, data: f.buffer.toString("base64"), at: new Date().toISOString(), by: String(q.body?.by ?? "gate") }); return m; })); })
  .post("/inspections", (q, r) => { try { r.json(inspect(q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
