import { Router } from "express";
import type { Task } from "../../../../../packages/contracts/index.ts";
import { memoryRepo } from "../../shared/repo.ts";
import { tasks as seed } from "../../seed.ts";
import { publish } from "../../shared/bus.ts";
export const tasks = memoryRepo<Task>(seed);
/** Offline-safe transition: client sends the version it saw. Superseded completions are accepted as facts and flagged. */
export function transition(id: string, to: Task["status"], seenVersion: number, assignee?: string) {
  const t = tasks.get(id); if (!t) throw Object.assign(new Error("Not found"), { status: 404 });
  const conflict = seenVersion !== t.version;
  if (conflict && to !== "done") throw Object.assign(new Error("Task changed; refresh"), { status: 409 });
  t.status = to; t.version++; if (assignee) t.assignee = assignee;
  if (to === "done") publish({ type: "TaskCompleted", aggregateId: t.id, aggregateVersion: t.version, payload: { taskId: t.id } } as any);
  return { task: t, conflict };
}
export const router = Router()
  .get("/", (_q, r) => r.json(tasks.all()))
  .post("/:id/:to", (q, r) => { try { r.json(transition(q.params.id, q.params.to as Task["status"], Number(q.body.version), q.body.assignee)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
