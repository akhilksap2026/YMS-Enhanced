import type { Unit, Zone, Door, Appointment, Task, Charge, ExceptionItem, Carrier } from "../../../packages/contracts/index.ts";
export type { Unit, Zone, Door, Appointment, Task, Charge, ExceptionItem, Carrier };
export const TOKEN_KEY = "yms.token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t?: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
export class ApiError extends Error { status: number; constructor(m: string, status: number) { super(m); this.status = status; } }
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const tok = getToken(); const isForm = init?.body instanceof FormData;
  const r = await fetch("/v1" + path, { ...init, headers: { ...(isForm ? {} : { "content-type": "application/json" }), ...(tok ? { authorization: "Bearer " + tok } : {}) } });
  if (r.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("yms:signed-out"));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error ?? r.statusText, r.status);
  return j as T;
}
export const get = <T,>(p: string) => req<T>(p);
export const post = <T,>(p: string, body: unknown = {}) => req<T>(p, { method: "POST", body: JSON.stringify(body) });
export const patch = <T,>(p: string, body: unknown = {}) => req<T>(p, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T,>(p: string, body: unknown = {}) => req<T>(p, { method: "PUT", body: JSON.stringify(body) });
export const del = <T,>(p: string) => req<T>(p, { method: "DELETE" });
export const upload = <T,>(p: string, form: FormData) => req<T>(p, { method: "POST", body: form });
export type Role = "yard_manager" | "gate_guard" | "dock_supervisor" | "spotter" | "carrier" | "tenant_admin" | "detention_approver";
export interface SessionUser { userId: string; tenantId: string; role: Role; roleLabel: string; name: string; perms: string[]; demo?: boolean; carrierId?: string }
export interface SiteConfig { appointmentSource: "native" | "sap" | "otm"; features: Record<string, boolean>; brandName: string; brandLogo: string; siteName: string; rates: { detention: number; demurrage: number; freeHoursDetention: number; freeHoursDemurrage: number } }
export interface TenantInfo { tenant: { id: string; name: string; demo: boolean }; sites: { id: string; name: string }[]; siteConfig: SiteConfig }
export interface Note { id: string; at: string; channel: string; to: string; text: string; kind: string; ref?: string; read?: boolean }
export const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "–";
export const hoursSince = (iso?: string) => iso ? (Date.now() - Date.parse(iso)) / 3600e3 : 0;
export const fmtDur = (h: number) => h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
export const money = (n: number, c = "USD") => n.toLocaleString("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 });
