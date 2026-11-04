/** Pluggable delivery providers. Defaults keep everything local: e-mail and SMS are captured in the
 *  "local mailbox" (deliveries table, like MailHog) and echoed to the console. SMTP and an HTTP SMS gateway are opt-in. */
import nodemailer from "nodemailer";
export interface EmailMsg { to: string; subject: string; text: string }
export interface SmsMsg { to: string; text: string }
export interface Result { ok: boolean; providerId?: string; error?: string }
export interface EmailProvider { readonly kind: string; send(m: EmailMsg): Promise<Result> }
export interface SmsProvider { readonly kind: string; send(m: SmsMsg): Promise<Result> }
export interface NotifyConfig {
  id: "notify"; language: Lang;
  email: { provider: "capture" | "smtp"; host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  sms: { provider: "capture" | "console" | "http"; url: string; token: string; from: string };
  routing: Record<string, { email?: string; sms?: string; language?: Lang }>;
  templates: Partial<Record<Lang, Partial<Record<string, { subject?: string; text: string }>>>>;
}
export type Lang = "en" | "fr" | "sw";
export const capture = { kind: "capture", send: async () => ({ ok: true, providerId: "local" }) } satisfies EmailProvider & SmsProvider;
export const consoleSms: SmsProvider = { kind: "console", send: async (m) => { console.log(`[sms] → ${m.to}: ${m.text}`); return { ok: true, providerId: "console" }; } };
export function smtp(c: NotifyConfig["email"]): EmailProvider {
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined, tls: { rejectUnauthorized: false }, connectionTimeout: 8000 });
  return { kind: "smtp", send: async (m) => { try { const r = await t.sendMail({ from: c.from, to: m.to, subject: m.subject, text: m.text }); return { ok: true, providerId: r.messageId }; } catch (e: any) { return { ok: false, error: e.message }; } } };
}
/** Generic HTTP SMS gateway: POST { to, from, text } with Bearer token. Adapt per vendor here (Twilio, Africa's Talking, …). */
export function httpSms(c: NotifyConfig["sms"]): SmsProvider {
  return { kind: "http", send: async (m) => { try { const r = await fetch(c.url, { method: "POST", headers: { "content-type": "application/json", ...(c.token ? { authorization: "Bearer " + c.token } : {}) }, body: JSON.stringify({ to: m.to, from: c.from, text: m.text }), signal: AbortSignal.timeout(8000) });
    return r.ok ? { ok: true, providerId: (await r.text()).slice(0, 80) } : { ok: false, error: `HTTP ${r.status}` }; } catch (e: any) { return { ok: false, error: e.message }; } } };
}
export const emailProvider = (c: NotifyConfig): EmailProvider => (c.email.provider === "smtp" && c.email.host ? smtp(c.email) : capture);
export const smsProvider = (c: NotifyConfig): SmsProvider => (c.sms.provider === "http" && c.sms.url ? httpSms(c.sms) : c.sms.provider === "console" ? consoleSms : capture);
