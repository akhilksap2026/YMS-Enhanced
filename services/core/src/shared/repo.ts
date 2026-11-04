// Repository interface. Tenant-scoped: every call resolves the tenant from the request context.
// Implementation keeps a per-tenant working set in memory and is persisted to Postgres (PGlite) by shared/db.ts.
import { tid } from "./tenancy.ts";
export interface Repo<T extends { id: string }> { all(): T[]; get(id: string): T | undefined; put(x: T): T; del(id: string): void }
export interface TenantStore<T extends { id: string }> extends Repo<T> { readonly table: string; load(tenant: string, rows: T[]): void; rows(tenant: string): T[]; has(tenant: string): boolean; reset(tenant: string): void }
const registry: TenantStore<any>[] = [];
export const stores = () => registry;
/** seedFor(tenant) supplies initial rows when a tenant has nothing persisted yet. */
export function tenantRepo<T extends { id: string }>(table: string, seedFor: (tenant: string) => T[]): TenantStore<T> {
  const byTenant = new Map<string, Map<string, T>>();
  const m = (t = tid()) => { let x = byTenant.get(t); if (!x) { x = new Map(seedFor(t).map((r) => [r.id, r])); byTenant.set(t, x); } return x; };
  const s: TenantStore<T> = { table,
    all: () => [...m().values()], get: (id) => m().get(id), put: (x) => (m().set(x.id, x), x), del: (id) => void m().delete(id),
    load: (t, rows) => void byTenant.set(t, new Map(rows.map((r) => [r.id, r]))), rows: (t) => [...m(t).values()], has: (t) => byTenant.has(t),
    reset: (t) => void byTenant.delete(t) };
  registry.push(s); return s;
}
/** Back-compat helper used by tests and stubs. */
export const memoryRepo = <T extends { id: string }>(seed: T[] = []) => tenantRepo<T>("mem_" + registry.length, () => structuredClone(seed));
