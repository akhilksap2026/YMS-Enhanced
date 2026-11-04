import { Router, type Request, type Response } from "express";
import { subscribe } from "../../shared/bus.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { runAs, tid } from "../../shared/tenancy.ts";
import { flush, dbReady } from "../../shared/db.ts";
import { settings, siteConfig } from "../tenant/index.ts";
import { emailProvider, smsProvider, type Lang, type NotifyConfig } from "./providers.ts";
import { DEFAULTS, KINDS, render } from "./templates.ts";
// In-app notes live in the outbox; e-mail and SMS also go through a provider and every attempt is a delivery row.
export type Note = { id: string; at: string; channel: "sms" | "email" | "push" | "in_app"; to: string; text: string; kind: string; ref?: string; read?: boolean };
export interface Delivery { id: string; at: string; channel: "email" | "sms"; to: string; subject?: string; text: string; kind: string; lang: Lang; provider: string; status: "sent" | "failed"; error?: string; providerId?: string; ref?: string }
export const outbox = tenantRepo<Note>("outbox", (t) => seedOf(t, "outbox") as Note[]);
export const deliveries = tenantRepo<Delivery>("deliveries", () => []);
const LANGS: Lang[] = ["en", "fr", "sw"];
export function notifyConfig(): NotifyConfig {
  let c = settings.get("notify") as unknown as NotifyConfig | undefined;
  if (!c) c = settings.put({ id: "notify", language: "en", email: { provider: "capture", host: "", port: 1025, secure: false, user: "", pass: "", from: "YMSNow <yms@localhost>" },
    sms: { provider: "capture", url: "", token: "", from: "YMSNow" },
    routing: { gate: { sms: "+25779000001" }, dock: { email: "dock.team@ksap.example" }, detention: { email: "carrier.billing@ksap.example" }, appointment: { email: "carrier@ksap.example" } }, templates: {} } as any) as unknown as NotifyConfig;
  return c;
}
export function template(kind: string, lang: Lang) { const o = notifyConfig().templates?.[lang]?.[kind]; const d = (DEFAULTS[lang] ?? DEFAULTS.en)[kind as (typeof KINDS)[number]] ?? { subject: kind, text: "{{text}}" }; return { subject: o?.subject ?? d.subject, text: o?.text ?? d.text }; }
let n = 0;
const nid = (p: string) => p + Date.now().toString(36) + (n++).toString(36);
export const notify = (x: Omit<Note, "id" | "at">) => outbox.put({ id: nid("n"), at: new Date().toISOString(), ...x });
/** Render and send through the configured provider; always records a delivery row. */
export async function send(channel: "email" | "sms", to: string, kind: string, vars: Record<string, unknown>, lang?: Lang) {
  const c = notifyConfig(); const l = lang ?? c.routing[kind]?.language ?? c.language; const t = template(kind, l); const v = { site: siteConfig()?.siteName, ...vars };
  const subject = render(t.subject, v), text = render(t.text, v);
  const p = channel === "email" ? emailProvider(c) : smsProvider(c);
  const r = channel === "email" ? await (p as ReturnType<typeof emailProvider>).send({ to, subject, text }) : await (p as ReturnType<typeof smsProvider>).send({ to, text });
  return deliveries.put({ id: nid("dl"), at: new Date().toISOString(), channel, to, subject: channel === "email" ? subject : undefined, text, kind, lang: l, provider: p.kind, status: r.ok ? "sent" : "failed", error: r.error, providerId: r.providerId, ref: String(vars.ref ?? "") || undefined });
}
/** In-app note plus e-mail/SMS to whoever the tenant routed this kind of event to. */
export async function dispatch(kind: string, vars: Record<string, unknown>, inApp: Omit<Note, "id" | "at" | "kind">) {
  const tenant = tid(); notify({ ...inApp, kind }); const r = notifyConfig().routing[kind] ?? {};
  const jobs: Promise<unknown>[] = []; if (r.email) jobs.push(send("email", r.email, kind, vars)); if (r.sms) jobs.push(send("sms", r.sms, kind, vars));
  await Promise.allSettled(jobs); if (jobs.length && dbReady()) await flush(tenant);
}
subscribe((e) => runAs(e.tenantId, () => {
  const p = e.payload as any;
  if (e.type === "GateIn") void dispatch("gate", { unit: p.unitNumber ?? p.unitId, decision: p.decision, ref: p.unitId }, { channel: "sms", to: "driver", ref: p.unitId, text: `Checked in (${p.decision}). Wait for door call.` });
  if (e.type === "DoorOccupied") void dispatch("dock", { unit: p.unitNumber ?? p.unitId, door: p.doorLabel ?? p.doorId, ref: p.unitId }, { channel: "in_app", to: "dock team", ref: p.unitId, text: `Unit placed at door ${p.doorLabel ?? p.doorId}` });
  if (e.type === "TaskCompleted") void dispatch("task", { task: p.taskId, ref: p.taskId }, { channel: "push", to: "yard manager", ref: p.taskId, text: `Move ${p.taskId} completed` });
  if (e.type === "ChargeStateChanged") void dispatch("detention", { charge: p.chargeId, state: p.state, ref: p.chargeId }, { channel: "email", to: "carrier billing", ref: p.chargeId, text: `Charge ${p.chargeId} is now ${p.state}` });
}));
const mask = (c: NotifyConfig) => ({ ...c, email: { ...c.email, pass: c.email.pass ? "••••••" : "" }, sms: { ...c.sms, token: c.sms.token ? "••••••" : "" } });
const bad = (m: string) => Object.assign(new Error(m), { status: 422 });
const isEmail = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s); const isPhone = (s: string) => /^\+?[0-9 ]{6,18}$/.test(s);
function patchConfig(b: any) {
  const c = notifyConfig();
  if (b.language !== undefined) { if (!LANGS.includes(b.language)) throw bad("Language must be en, fr or sw"); c.language = b.language; }
  if (b.email) { const e = b.email; if (e.provider && !["capture", "smtp"].includes(e.provider)) throw bad("Unknown e-mail provider"); if (e.port !== undefined && !(Number(e.port) > 0 && Number(e.port) < 65536)) throw bad("Invalid port");
    c.email = { ...c.email, ...e, port: Number(e.port ?? c.email.port), secure: !!(e.secure ?? c.email.secure), pass: e.pass === "••••••" || e.pass === undefined ? c.email.pass : String(e.pass) }; }
  if (b.sms) { const s = b.sms; if (s.provider && !["capture", "console", "http"].includes(s.provider)) throw bad("Unknown SMS provider"); if (s.url && !/^https?:\/\//.test(s.url)) throw bad("SMS URL must be http(s)");
    c.sms = { ...c.sms, ...s, token: s.token === "••••••" || s.token === undefined ? c.sms.token : String(s.token) }; }
  if (b.routing) { for (const [k, v] of Object.entries<any>(b.routing)) { if (!KINDS.includes(k as any)) throw bad("Unknown kind " + k); if (v.email && !isEmail(v.email)) throw bad(`Invalid e-mail for ${k}`); if (v.sms && !isPhone(v.sms)) throw bad(`Invalid phone for ${k}`); if (v.language && !LANGS.includes(v.language)) throw bad("Bad language"); }
    c.routing = b.routing; }
  if (b.templates) { for (const [l, m] of Object.entries<any>(b.templates)) { if (!LANGS.includes(l as Lang)) throw bad("Bad language"); for (const [k, t] of Object.entries<any>(m)) { if (!KINDS.includes(k as any)) throw bad("Unknown kind " + k); if (typeof t.text !== "string" || t.text.length > 1000) throw bad("Template text required (max 1000)"); } }
    c.templates = b.templates; }
  settings.put(c as any); return mask(c);
}
const wrap = (f: (q: Request) => unknown) => async (q: Request, r: Response) => { try { r.json(await f(q)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export const router = Router()
  .get("/outbox", (_q, r) => r.json(outbox.all().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100)))
  .post("/read-all", (_q, r) => { for (const x of outbox.all()) x.read = true; r.json({ ok: true }); })
  .get("/deliveries", (_q, r) => r.json(deliveries.all().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200)))
  .get("/config", wrap(() => ({ config: mask(notifyConfig()), defaults: DEFAULTS, kinds: KINDS, languages: LANGS })))
  .put("/config", wrap((q) => patchConfig(q.body ?? {})))
  .post("/test", wrap(async (q) => { const { channel, to, kind = "appointment", lang } = q.body ?? {}; if (!["email", "sms"].includes(channel)) throw bad("channel must be email or sms");
    if (channel === "email" ? !isEmail(String(to)) : !isPhone(String(to))) throw bad("Invalid recipient"); return send(channel, String(to), kind, { ref: "APT-TEST", status: "confirmed", time: new Date().toLocaleString("en-GB"), unit: "MSKU1234565", door: "D01", charge: "CH-TEST", state: "approved", task: "T-TEST", decision: "admitted", code: "123456" }, lang); }))
  .post("/:id/read", (q, r) => { const x = outbox.get(q.params.id); if (!x) return r.sendStatus(404); x.read = true; r.json(x); });
