import { makeSeed, type Seed } from "./seed.ts";
import { DEMO_TENANT } from "./shared/tenancy.ts";
const cache = new Map<string, Seed>();
/** Fresh seed per tenant (built once per tenant, then handed out per table). Demo tenant gets the richer data set. */
export function seedOf<K extends keyof Seed>(tenant: string, k: K): Seed[K] {
  let s = cache.get(tenant); if (!s) { s = makeSeed(tenant === DEMO_TENANT ? "demo" : "ops"); cache.set(tenant, s); }
  return s[k];
}
export const dropSeed = (tenant: string) => cache.delete(tenant);
