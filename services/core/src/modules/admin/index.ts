import { Router, type Request, type Response } from "express";
import type { Zone, Door } from "../../../../../packages/contracts/index.ts";
import { z } from "zod";
import { tid, sid, runAtSite, DEFAULT_SITE, ROLES } from "../../shared/tenancy.ts";
import { stores } from "../../shared/repo.ts";
import { sites, SiteInput, SitePatch, type Site } from "../tenant/sites.ts";
import { queryAudit } from "./audit.ts";
import { units } from "../yard/index.ts";
import { asTenant } from "../../shared/db.ts";
import { createUser, listUsers, adminSetPassword } from "../auth/index.ts";
import { zones } from "../yard/index.ts";
import { doors } from "../dock/index.ts";
const err = (m: string, status = 422) => Object.assign(new Error(m), { status });
const wrap = (f: (q: Request) => unknown) => async (q: Request, r: Response) => { try { r.json(await f(q)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
const pad = (n: number) => String(n).padStart(2, "0");
/** Resize a zone. Shrinking is refused while a slot that would be removed holds a unit. */
export function setZone(name: string, count: number, kind?: Zone["kind"]) {
  if (!/^[A-Z]$/.test(name)) throw err("Zone name must be one letter"); if (!(count >= 1 && count <= 40)) throw err("Slots must be 1–40");
  let z = zones.all().find((x) => x.name === name);
  if (!z) { if (!kind) throw err("Kind required for a new zone"); z = { id: "z" + name, name, kind, slots: [] }; }
  const removed = z.slots.slice(count); const busy = removed.find((s) => s.unitId); if (busy) throw err(`${busy.label} is occupied; move the unit first`, 409);
  z.slots = Array.from({ length: count }, (_, k) => z!.slots[k] ?? { id: `${name}${pad(k + 1)}`, zoneId: z!.id, label: `${name}${pad(k + 1)}` });
  if (kind) z.kind = kind; return zones.put(z);
}
export function deleteZone(name: string) { const z = zones.all().find((x) => x.name === name); if (!z) throw err("Not found", 404); if (z.slots.some((s) => s.unitId)) throw err("Zone has units", 409); zones.del(z.id); return { ok: true }; }
export function setDoors(count: number) {
  if (!(count >= 1 && count <= 40)) throw err("Doors must be 1–40");
  const all = doors.all().sort((a, b) => a.label.localeCompare(b.label));
  const busy = all.slice(count).find((d) => d.unitId); if (busy) throw err(`${busy.label} is occupied`, 409);
  all.slice(count).forEach((d) => doors.del(d.id));
  for (let i = all.length; i < count; i++) doors.put({ id: `d${i + 1}`, label: `D${pad(i + 1)}`, state: "free" } as Door);
  return doors.all();
}
export function setDoorState(id: string, state: "free" | "blocked") { const d = doors.get(id); if (!d) throw err("Not found", 404); if (d.unitId) throw err("Door is occupied", 409); d.state = state; return d; }
/** Parse with zod; respond 422 with the first readable message. */
export const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> => { const r = schema.safeParse(body ?? {});
  if (!r.success) { const i = r.error.issues[0]; throw err((i.path.length ? i.path.join(".") + ": " : "") + i.message); } return r.data; };
export function createSite(body: unknown): Site {
  const b = parse(SiteInput, body); if (sites.all().some((x) => x.code === b.code)) throw err("Site code already used", 409);
  const s: Site = { id: "s-" + b.code.toLowerCase(), code: b.code, name: b.name, tz: b.tz, address: b.address, active: true, createdAt: new Date().toISOString() };
  if (sites.get(s.id)) throw err("Site exists", 409);
  runAtSite(s.id, () => { b.zones.forEach((zz) => setZone(zz.name, zz.slots, zz.kind)); setDoors(b.doors); });
  return sites.put(s);
}
export function patchSite(id: string, body: unknown) { const s = sites.get(id); if (!s) throw err("Not found", 404); const b = parse(SitePatch, body);
  if (id === DEFAULT_SITE && b.active === false) throw err("The main site cannot be deactivated", 409); return sites.put({ ...s, ...b }); }
export function deleteSite(id: string) { if (id === DEFAULT_SITE) throw err("The main site cannot be deleted", 409); if (!sites.get(id)) throw err("Not found", 404);
  if (runAtSite(id, () => units.all().length)) throw err("Site still has units on yard; move or gate them out first", 409);
  for (const st of stores()) if (st.siteScoped) st.dropSite(tid(), id); sites.del(id); return { ok: true }; }
const UserIn = z.object({ email: z.string().trim().email(), name: z.string().trim().min(2).max(80), role: z.enum(ROLES), password: z.string().min(10).max(200), carrierId: z.string().max(40).optional() });
const UserPatch = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), password: z.string().min(10).max(200).optional() });
const ZoneIn = z.object({ slots: z.coerce.number().int().min(1).max(40), kind: z.enum(["row", "hold", "waiting", "reefer"]).optional() });
export const router = Router()
  .get("/sites", wrap(() => sites.all()))
  .post("/sites", wrap((q) => createSite(q.body)))
  .patch("/sites/:id", wrap((q) => patchSite(String(q.params.id), q.body)))
  .delete("/sites/:id", wrap((q) => deleteSite(String(q.params.id))))
  .get("/audit", wrap((q) => queryAudit({ user: q.query.user as string, q: q.query.q as string, from: q.query.from as string, to: q.query.to as string, limit: Number(q.query.limit) || undefined })))
  .get("/users", wrap(() => listUsers(tid())))
  .post("/users", wrap((q) => createUser(tid(), parse(UserIn, q.body))))
  .patch("/users/:id", wrap((q) => asTenant(tid(), async (tx) => { const b = parse(UserPatch, q.body); if (b.password) await adminSetPassword(tid(), String(q.params.id), b.password);
    if (b.role) await tx.query("UPDATE users SET role=$1 WHERE id=$2", [b.role, q.params.id]); if (typeof b.active === "boolean") await tx.query("UPDATE users SET active=$1 WHERE id=$2", [b.active, q.params.id]); return { ok: true }; })))
  .put("/zones/:name", wrap((q) => { const b = parse(ZoneIn, q.body); return setZone(String(q.params.name).toUpperCase(), b.slots, b.kind); }))
  .delete("/zones/:name", wrap((q) => deleteZone(String(q.params.name).toUpperCase())))
  .put("/doors", wrap((q) => setDoors(parse(z.object({ count: z.coerce.number().int().min(1).max(40) }), q.body).count)))
  .post("/doors/:id/state", wrap((q) => setDoorState(String(q.params.id), parse(z.object({ state: z.enum(["free", "blocked"]) }), q.body).state)));
