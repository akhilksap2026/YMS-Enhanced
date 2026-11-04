import { Router, type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { asTenant, getDb, dbReady, flush } from "../../shared/db.ts";
import { runAs, ROLES, DEMO_TENANT, type Principal, type Role, currentUser } from "../../shared/tenancy.ts";
import { can, required, ROLE_PERMS } from "../../shared/authz.ts";
const here = dirname(fileURLToPath(import.meta.url));
function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = join(here, "../../../data/jwt.secret");
  if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, randomBytes(32).toString("hex"), { mode: 0o600 }); }
  return readFileSync(f, "utf8");
}
const SECRET = secret(); const TTL = "12h";
export const ROLE_LABEL: Record<Role, string> = { yard_manager: "Yard manager", gate_guard: "Gate guard", dock_supervisor: "Dock supervisor", spotter: "Spotter", carrier: "Carrier", tenant_admin: "Tenant admin", detention_approver: "Detention approver" };
export const sign = (p: Principal) => jwt.sign(p, SECRET, { expiresIn: TTL });
const view = (p: Principal) => ({ ...p, roleLabel: ROLE_LABEL[p.role], perms: ROLE_PERMS[p.role] });
const err = (m: string, status: number) => Object.assign(new Error(m), { status });
type UserRow = { id: string; tenant_id: string; email: string; name: string; role: Role; password_hash: string; carrier_id: string | null; active: boolean };
export async function login(email: string, password: string) {
  // Lookup across tenants runs as the owner role (RLS bypass) because the tenant is not known yet; everything after login runs as app_user.
  const r = await getDb().query<UserRow>("SELECT * FROM users WHERE lower(email) = lower($1) AND active", [email.trim()]);
  const u = r.rows[0]; if (!u || !(await bcrypt.compare(password, u.password_hash))) throw err("Email or password is incorrect", 401);
  const p: Principal = { userId: u.id, tenantId: u.tenant_id, role: u.role, name: u.name, carrierId: u.carrier_id ?? undefined };
  return { token: sign(p), user: view(p) };
}
export const demoPrincipal = (role: Role = "tenant_admin"): Principal => ({ userId: "demo-" + role, tenantId: DEMO_TENANT, role, name: "Demo " + ROLE_LABEL[role], carrierId: role === "carrier" ? "c2" : undefined, demo: true });
const OPEN = [/^\/auth\/(login|demo)$/, /^\/health$/];
/** Authenticate every /v1 request, bind tenant + user to the async context, enforce permission, flush writes on finish. */
export function authn(q: Request, r: Response, next: NextFunction) {
  const path = q.path; if (OPEN.some((re) => re.test(path))) return next();
  const h = q.headers.authorization ?? ""; const tok = h.startsWith("Bearer ") ? h.slice(7) : (q.query.token as string | undefined);
  let p: Principal; try { p = jwt.verify(tok ?? "", SECRET) as Principal; } catch { return r.status(401).json({ error: "Sign in required" }); }
  if (!path.startsWith("/auth/")) { const need = required(q.method, path); if (!can(p.role, need)) return r.status(403).json({ error: `Your role (${ROLE_LABEL[p.role]}) cannot do this`, need }); }
  if (q.method !== "GET") r.on("finish", () => void flush(p.tenantId));
  runAs(p.tenantId, () => next(), p);
}
const wrap = (f: (q: Request) => Promise<unknown> | unknown) => async (q: Request, r: Response) => { try { r.json(await f(q)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export async function createUser(tenant: string, u: { email: string; name: string; role: Role; password: string; carrierId?: string }) {
  if (!ROLES.includes(u.role)) throw err("Unknown role", 422); if (!u.email?.includes("@")) throw err("Valid email required", 422); if ((u.password ?? "").length < 8) throw err("Password must be at least 8 characters", 422);
  const id = "usr_" + randomBytes(6).toString("hex"); const hash = await bcrypt.hash(u.password, 10);
  await asTenant(tenant, (tx) => tx.query("INSERT INTO users(id,tenant_id,email,name,role,password_hash,carrier_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, tenant, u.email.toLowerCase(), u.name, u.role, hash, u.carrierId ?? null]));
  return { id, email: u.email.toLowerCase(), name: u.name, role: u.role };
}
export const listUsers = (tenant: string) => asTenant(tenant, async (tx) => (await tx.query("SELECT id,email,name,role,carrier_id,active,created_at FROM users ORDER BY role, email")).rows);
export const router = Router()
  .post("/login", wrap((q) => login(String(q.body?.email ?? ""), String(q.body?.password ?? ""))))
  .post("/demo", wrap(() => { const p = demoPrincipal(); return { token: sign(p), user: view(p) }; }))
  .get("/me", wrap(() => view(currentUser()!)))
  .post("/demo/role", wrap((q) => { const me = currentUser()!; if (!me.demo) throw err("Role switching is only available in demo mode", 403);
    const role = q.body?.role as Role; if (!ROLES.includes(role)) throw err("Unknown role", 422); const p = demoPrincipal(role); return { token: sign(p), user: view(p) }; }));
export const ready = dbReady;
