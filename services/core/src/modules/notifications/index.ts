import { Router } from "express";
import { subscribe } from "../../shared/bus.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { runAs } from "../../shared/tenancy.ts";
// Channel adapters (SMS/e-mail/push) plug in here. This build records every message in a per-tenant outbox (no external sends).
export type Note = { id: string; at: string; channel: "sms" | "email" | "push" | "in_app"; to: string; text: string; kind: string; ref?: string; read?: boolean };
export const outbox = tenantRepo<Note>("outbox", (t) => seedOf(t, "outbox") as Note[]);
let n = 0;
export const notify = (x: Omit<Note, "id" | "at">) => outbox.put({ id: "n" + Date.now().toString(36) + (n++).toString(36), at: new Date().toISOString(), ...x });
subscribe((e) => runAs(e.tenantId, () => {
  const p = e.payload as any;
  if (e.type === "GateIn") notify({ channel: "sms", to: "driver", kind: "gate", ref: p.unitId, text: `Checked in (${p.decision}). Wait for door call.` });
  if (e.type === "DoorOccupied") notify({ channel: "in_app", to: "dock team", kind: "dock", ref: p.unitId, text: `Unit placed at door ${p.doorLabel ?? p.doorId}` });
  if (e.type === "TaskCompleted") notify({ channel: "push", to: "yard manager", kind: "task", ref: p.taskId, text: `Move ${p.taskId} completed` });
  if (e.type === "ChargeStateChanged") notify({ channel: "email", to: "carrier billing", kind: "detention", ref: p.chargeId, text: `Charge ${p.chargeId} is now ${p.state}` });
}));
export const router = Router()
  .get("/outbox", (_q, r) => r.json(outbox.all().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100)))
  .post("/read-all", (_q, r) => { for (const x of outbox.all()) x.read = true; r.json({ ok: true }); })
  .post("/:id/read", (q, r) => { const x = outbox.get(q.params.id); if (!x) return r.sendStatus(404); x.read = true; r.json(x); });
