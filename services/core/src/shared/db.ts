// Postgres persistence (embedded PGlite; apt Postgres was not installable on this host). Same SQL runs on server Postgres.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stores } from "./repo.ts";
const here = dirname(fileURLToPath(import.meta.url));
let db: PGlite | undefined;
const snap = new Map<string, string>(); // `${table}|${tenant}|${id}` -> json last written
let chain: Promise<unknown> = Promise.resolve();
export const getDb = () => { if (!db) throw new Error("db not initialised"); return db; };
export const dbReady = () => !!db;
export async function initDb(dir = process.env.YMS_DB_DIR ?? join(here, "../../data/pg")) {
  if (!dir.startsWith("memory://")) mkdirSync(dir, { recursive: true });
  db = new PGlite(dir);
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const mdir = join(here, "../../migrations");
  for (const f of readdirSync(mdir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.transaction(async (tx) => { await tx.exec(readFileSync(join(mdir, f), "utf8")); await tx.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]); });
  }
  return db;
}
/** Run f as the RLS-restricted app role with app.tenant set. */
export async function asTenant<T>(tenant: string, f: (tx: any) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => { await tx.query("SELECT set_config('app.tenant', $1, true)", [tenant]); await tx.exec("SET LOCAL ROLE app_user"); return f(tx); });
}
export async function ensureTenant(id: string, name: string, kind = "customer") { await getDb().query("INSERT INTO tenants(id,name,kind) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [id, name, kind]); }
export async function tenants() { return (await getDb().query<{ id: string; name: string; kind: string }>("SELECT id,name,kind FROM tenants ORDER BY id")).rows; }
/** Load persisted rows for a tenant into the stores; tables with no rows keep their seed and get written on the next flush. */
export async function hydrate(tenant: string) {
  await asTenant(tenant, async (tx) => { for (const s of stores()) { if (s.table.startsWith("mem_")) continue;
    const rows = (await tx.query(`SELECT id, data FROM ${s.table}`)).rows as { id: string; data: any }[];
    if (rows.length) { s.load(tenant, rows.map((r) => r.data), rows.map((r) => r.id)); rows.forEach((r) => snap.set(`${s.table}|${tenant}|${r.id}`, JSON.stringify(r.data))); } } });
  return flush(tenant);
}
/** Write changed rows (diff against last write) and delete removed ones. Serialised. */
export function flush(tenant: string): Promise<number> {
  if (!db) return Promise.resolve(0);
  const p = chain.then(() => asTenant(tenant, async (tx) => { let n = 0;
    for (const s of stores()) { if (s.table.startsWith("mem_")) continue; const live = new Set<string>();
      for (const [id, r] of s.entries(tenant)) { const k = `${s.table}|${tenant}|${id}`; live.add(k); const j = JSON.stringify(r);
        if (snap.get(k) !== j) { await tx.query(`INSERT INTO ${s.table}(tenant_id,id,data,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (tenant_id,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [tenant, id, j]); snap.set(k, j); n++; } }
      for (const k of [...snap.keys()]) if (k.startsWith(`${s.table}|${tenant}|`) && !live.has(k)) { await tx.query(`DELETE FROM ${s.table} WHERE id=$1`, [k.split("|").slice(2).join("|")]); snap.delete(k); n++; } }
    return n; }));
  chain = p.catch((e) => console.error("flush failed", e)); return p;
}
/** Drop a tenant's working set and rows (used by demo reset). */
export async function wipeTenantData(tenant: string) {
  for (const s of stores()) s.reset(tenant);
  for (const k of [...snap.keys()]) if (k.split("|")[1] === tenant) snap.delete(k);
  if (db) await asTenant(tenant, async (tx) => { for (const s of stores()) if (!s.table.startsWith("mem_")) await tx.query(`DELETE FROM ${s.table}`); });
}
export async function closeDb() { await chain; await db?.close(); db = undefined; snap.clear(); }
