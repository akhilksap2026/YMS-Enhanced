import { Router, type Request, type Response } from "express";
import type { Zone, Door } from "../../../../../packages/contracts/index.ts";
import { tid } from "../../shared/tenancy.ts";
import { asTenant } from "../../shared/db.ts";
import { createUser, listUsers } from "../auth/index.ts";
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
export const router = Router()
  .get("/users", wrap(() => listUsers(tid())))
  .post("/users", wrap((q) => createUser(tid(), q.body)))
  .patch("/users/:id", wrap((q) => asTenant(tid(), async (tx) => { const b = q.body ?? {};
    if (b.role) await tx.query("UPDATE users SET role=$1 WHERE id=$2", [b.role, q.params.id]); if (typeof b.active === "boolean") await tx.query("UPDATE users SET active=$1 WHERE id=$2", [b.active, q.params.id]); return { ok: true }; })))
  .put("/zones/:name", wrap((q) => setZone(String(q.params.name).toUpperCase(), Number(q.body?.slots), q.body?.kind)))
  .delete("/zones/:name", wrap((q) => deleteZone(String(q.params.name).toUpperCase())))
  .put("/doors", wrap((q) => setDoors(Number(q.body?.count))))
  .post("/doors/:id/state", wrap((q) => setDoorState(String(q.params.id), q.body?.state)));
