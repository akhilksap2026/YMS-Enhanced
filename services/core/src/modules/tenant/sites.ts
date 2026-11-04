// Sites of a tenant (multi-site). Tenant-level store; operational stores are partitioned by site (see shared/repo.ts).
import { z } from "zod";
import { tenantRepo } from "../../shared/repo.ts";
import { DEFAULT_SITE } from "../../shared/tenancy.ts";
import { seedOf } from "../../seedcache.ts";
export interface Site { id: string; code: string; name: string; tz: string; address?: string; active: boolean; createdAt: string }
export const sites = tenantRepo<Site>("sites", (t) => {
  const s = seedOf(t, "settings").find((x: any) => x.id === "site") as any;
  return [{ id: DEFAULT_SITE, code: "RSR", name: s?.siteName ?? "Main site", tz: "Africa/Bujumbura", active: true, createdAt: new Date(0).toISOString() }];
});
export const SiteInput = z.object({ code: z.string().trim().regex(/^[A-Z0-9]{2,6}$/, "Code: 2–6 capital letters/digits"), name: z.string().trim().min(2).max(80),
  tz: z.string().trim().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown time zone").default("Africa/Bujumbura"),
  address: z.string().max(200).optional(), doors: z.number().int().min(1).max(40).default(6), zones: z.array(z.object({ name: z.string().regex(/^[A-Z]$/), kind: z.enum(["row", "hold", "waiting", "reefer"]), slots: z.number().int().min(1).max(40) })).max(12).default([{ name: "A", kind: "row", slots: 12 }, { name: "W", kind: "waiting", slots: 6 }]) });
export const SitePatch = z.object({ name: z.string().trim().min(2).max(80).optional(), tz: SiteInput.shape.tz.optional(), address: z.string().max(200).optional(), active: z.boolean().optional() });
