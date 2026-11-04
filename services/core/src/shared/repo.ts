// Repository interface. Tenant-scoped: every call resolves the tenant (and, for site-scoped stores, the site) from the request context.
// Implementation keeps a per-tenant working set in memory and is persisted to Postgres (PGlite) by shared/db.ts.
// Site-scoped rows of non-default sites are persisted with id "<siteId>|<id>" so ids never collide between sites.
import { tid, sid, DEFAULT_SITE } from "./tenancy.ts";
export interface Repo<T extends { id: string }> { all(): T[]; get(id: string): T | undefined; put(x: T): T; del(id: string): void }
export interface TenantStore<T extends { id: string }> extends Repo<T> { readonly table: string; readonly siteScoped: boolean;
  load(tenant: string, rows: T[], keys?: string[]): void; rows(tenant: string): T[]; entries(tenant: string): [string, T][]; has(tenant: string): boolean; reset(tenant: string): void; dropSite(tenant: string, site: string): void }
const registry: TenantStore<any>[] = [];
export const stores = () => registry;
/** seedFor(tenant, site) supplies initial rows when a tenant/site has nothing persisted yet. */
export function tenantRepo<T extends { id: string }>(table: string, seedFor: (tenant: string, site: string) => T[], opts: { site?: boolean } = {}): TenantStore<T> {
  const siteScoped = !!opts.site;
  const byTenant = new Map<string, Map<string, Map<string, T>>>(); // tenant -> site -> id -> row
  const sites = (t: string) => { let x = byTenant.get(t); if (!x) { x = new Map(); byTenant.set(t, x); } return x; };
  const m = (t = tid(), site = siteScoped ? sid() : DEFAULT_SITE) => { const ss = sites(t); let x = ss.get(site);
    if (!x) { x = new Map(seedFor(t, site).map((r) => [r.id, r])); ss.set(site, x); } return x; };
  const s: TenantStore<T> = { table, siteScoped,
    all: () => [...m().values()], get: (id) => m().get(id), put: (x) => (m().set(x.id, x), x), del: (id) => void m().delete(id),
    load: (t, rows, keys) => { const ss = new Map<string, Map<string, T>>(); rows.forEach((r, i) => { const k = keys?.[i] ?? r.id; const site = siteScoped && k.includes("|") ? k.split("|")[0] : DEFAULT_SITE;
      if (!ss.has(site)) ss.set(site, new Map()); ss.get(site)!.set(r.id, r); }); if (!ss.has(DEFAULT_SITE) && !rows.length) ss.delete(DEFAULT_SITE); byTenant.set(t, ss); },
    rows: (t) => s.entries(t).map(([, r]) => r),
    entries: (t) => { m(t, DEFAULT_SITE); const out: [string, T][] = []; for (const [site, x] of sites(t)) for (const r of x.values()) out.push([site === DEFAULT_SITE ? r.id : `${site}|${r.id}`, r]); return out; },
    has: (t) => byTenant.has(t), reset: (t) => void byTenant.delete(t), dropSite: (t, site) => void sites(t).delete(site) };
  registry.push(s); return s;
}
/** Back-compat helper used by tests and stubs. */
export const memoryRepo = <T extends { id: string }>(seed: T[] = []) => tenantRepo<T>("mem_" + registry.length, () => structuredClone(seed));
