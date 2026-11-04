import type { Unit, Zone, Door, Appointment, Task, Charge, ExceptionItem, Carrier } from "../../../packages/contracts/index.ts";
export type { Unit, Zone, Door, Appointment, Task, Charge, ExceptionItem, Carrier };
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/v1" + path, { headers: { "content-type": "application/json" }, ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}
export const get = <T,>(p: string) => req<T>(p);
export const post = <T,>(p: string, body: unknown = {}) => req<T>(p, { method: "POST", body: JSON.stringify(body) });
export const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "–";
export const hoursSince = (iso?: string) => iso ? (Date.now() - Date.parse(iso)) / 3600e3 : 0;
export const fmtDur = (h: number) => h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h`;
export const money = (n: number, c = "USD") => n.toLocaleString("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 });
