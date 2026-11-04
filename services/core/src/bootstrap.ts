import { initDb, ensureTenant, hydrate, getDb } from "./shared/db.ts";
import { createUser } from "./modules/auth/index.ts";
import { SEED_USERS, DEMO_PASSWORD } from "./users.seed.ts";
import { TENANT_NAMES } from "./modules/tenant/index.ts";
import { runAs } from "./shared/tenancy.ts";
/** Migrate, create tenants, seed users once, load each tenant's data (seeding empty tables). */
export async function bootstrap(dir?: string) {
  await initDb(dir);
  await ensureTenant("t-ksap", TENANT_NAMES["t-ksap"]); await ensureTenant("t-demo", TENANT_NAMES["t-demo"], "demo");
  const n = Number((await getDb().query<{ n: number }>("SELECT count(*)::int AS n FROM users")).rows[0].n);
  if (!n) for (const u of SEED_USERS) await createUser(u.tenant, { ...u, password: DEMO_PASSWORD });
  for (const t of ["t-ksap", "t-demo"]) await runAs(t, () => hydrate(t));
}
