import { AsyncLocalStorage } from "node:async_hooks";
export type Principal = { userId: string; tenantId: string; role: Role; name: string; carrierId?: string; demo?: boolean };
export const ROLES = ["yard_manager", "gate_guard", "dock_supervisor", "spotter", "carrier", "tenant_admin", "detention_approver"] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_TENANT = process.env.YMS_TENANT ?? "t-ksap";
export const DEMO_TENANT = "t-demo";
export const DEFAULT_SITE = "s-rsr";
const als = new AsyncLocalStorage<{ tenantId: string; user?: Principal; siteId?: string }>();
export const runAs = <T,>(tenantId: string, f: () => T, user?: Principal, siteId?: string) => als.run({ tenantId, user, siteId }, f);
/** Current site (multi-site per tenant). Site-scoped stores partition by it. */
export const sid = () => als.getStore()?.siteId ?? DEFAULT_SITE;
export const runAtSite = <T,>(siteId: string, f: () => T) => { const s = als.getStore(); return als.run({ tenantId: s?.tenantId ?? DEFAULT_TENANT, user: s?.user, siteId }, f); };
export const tid = () => als.getStore()?.tenantId ?? DEFAULT_TENANT;
export const currentUser = () => als.getStore()?.user;
export const enterTenant = (tenantId: string, user?: Principal) => als.enterWith({ tenantId, user });
