import { Router } from "express";
import type { Task } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { tasks as seed } from "../../seed.ts";
import { publish } from "../../shared/bus.ts";
import { units, slotByLabel, vacate } from "../yard/index.ts";
import { doors, assign as assignDoor } from "../dock/index.ts";
export const tasks = memoryRepo<Task>(seed);
/** Offline-safe transition: client sends the version it saw. Superseded completions are accepted as facts and flagged. */
export function transition(id: string, to: Task["status"], seenVersion: number, assignee?: string) {
  const t = tasks.get(id); if (!t) throw Object.assign(new Error("Not found"), { status: 404 });
  const conflict = seenVersion !== t.version;
  if (conflict && to !== "done") throw Object.assign(new Error("Task changed; refresh"), { status: 409 });
  t.status = to; t.version++; if (assignee) t.assignee = assignee;
  if (to === "done") complete(t);
  if (to === "done") publish({ type: "TaskCompleted", aggregateId: t.id, aggregateVersion: t.version, payload: { taskId: t.id } } as any);
  return { task: t, conflict };
}
const err = (m: string, status = 409) => Object.assign(new Error(m), { status });
/** Create a move to a slot label (A07) or door label (D03). Validates target and unit state up front. */
export function createMove(body: { unitId: string; to: string; priority?: 1 | 2 | 3 }) {
  const u = units.get(body.unitId); if (!u) throw err("Unit not found", 404);
  if (u.status === "quarantine") throw err("Unit is quarantined");
  const to = String(body.to ?? "").toUpperCase();
  if (to === u.location) throw err("Unit is already at " + to, 400);
  const door = doors.all().find((d) => d.label === to); const slot = slotByLabel(to);
  if (!door && !slot) throw err("Unknown target " + to, 400);
  if (door && door.state !== "free") throw err(to + " is " + door.state);
  if (door && u.status === "hold") throw err("Unit on hold cannot go to a door");
  if (slot?.unitId) throw err(to + " is occupied");
  if (tasks.all().some((t) => t.status !== "done" && (t.to === to || t.unitId === u.id))) throw err("A move is already pending for this unit or target");
  const t: Task = { id: "t" + (tasks.all().length + 1) + "-" + Date.now().toString(36), version: 1, type: door ? "spot" : "move", unitId: u.id, from: u.location || "W", to, priority: body.priority ?? 2, status: "open", createdAt: new Date().toISOString() };
  return tasks.put(t);
}
/** Apply a completed move to yard state. */
function complete(t: Task) {
  const u = units.get(t.unitId); if (!u) return;
  const door = doors.all().find((d) => d.label === t.to);
  if (door) { if (door.state === "free") { vacate(u.id); assignDoor(door.id, u.id); } return; }
  const s = slotByLabel(t.to); if (!s || (s.unitId && s.unitId !== u.id)) return;
  vacate(u.id); for (const d of doors.all()) if (d.unitId === u.id) Object.assign(d, { state: "free", unitId: undefined, since: undefined });
  s.unitId = u.id; u.location = s.label;
}
export const router = Router()
  .get("/", (_q, r) => r.json(tasks.all()))
  .post("/", (q, r) => { try { r.status(201).json(createMove(q.body)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } })
  .post("/:id/:to", (q, r) => { try { r.json(transition(q.params.id, q.params.to as Task["status"], Number(q.body.version), q.body.assignee)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
