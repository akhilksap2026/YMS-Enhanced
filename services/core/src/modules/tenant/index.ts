import { Router } from "express";
import type { AppointmentSource } from "../../../../../packages/contracts/index.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { tid, sid } from "../../shared/tenancy.ts";
import { sites } from "./sites.ts";
import { body, id } from "../../shared/validate.js";
import { z } from "zod";
export type SiteConfig = ReturnType<typeof seedOf<"settings">>[number] & { appointmentSource: AppointmentSource };
export const settings = tenantRepo<SiteConfig>("settings", (t) => seedOf(t, "settings") as SiteConfig[]);
export const siteConfig = () => settings.get("site")!;
export const TENANT_NAMES: Record<string, string> = { "t-ksap": "Ksap Riverside (operations)", "t-demo": "Demo workspace" };
const EDITABLE = ["appointmentSource", "features", "brandName", "brandLogo", "rates", "siteName"] as const;
export function patchConfig(body: Record<string, unknown>) {
  const c = siteConfig();
  if (body.appointmentSource && !["native", "sap", "otm"].includes(String(body.appointmentSource))) throw Object.assign(new Error("Unknown appointment source"), { status: 422 });
  if (typeof body.brandLogo === "string" && body.brandLogo.length > 200_000) throw Object.assign(new Error("Logo too large (max ~150 KB)"), { status: 413 });
  for (const k of EDITABLE) if (k in body) (c as any)[k] = body[k];
  return settings.put(c);
}
export const router = Router()
  .get("/", (_q, r) => { const c = siteConfig(); r.json({ tenant: { id: tid(), name: TENANT_NAMES[tid()] ?? tid(), demo: tid() === "t-demo" }, sites: sites.all().filter((x) => x.active), site: sites.get(sid()), siteConfig: { ...c, siteName: sites.get(sid())?.name ?? c.siteName } }); })
  .patch("/config", body(z.record(z.string(), z.unknown()).refine((o) => JSON.stringify(o).length < 20000, "Config too large")), (q, r) => { try { r.json(patchConfig(q.body ?? {})); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
