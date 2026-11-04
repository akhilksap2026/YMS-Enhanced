/** Spotter offline queue: task transitions are stored in IndexedDB and replayed in order when the network returns.
 *  Conflict rule (server, tasks module): a stale version is accepted for "done" (the drop happened physically) and
 *  rejected with 409 for any other step; rejected items are dropped from the queue and reported. */
import { ApiError, post, type Task } from "../api";
export interface Pending { key: number; taskId: string; to: Task["status"]; version: number; assignee: string; at: string; label: string }
const DB = "yms-offline", ST = "queue";
const open = () => new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: "key", autoIncrement: true }); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => { const db = await open(); return new Promise<T>((ok, no) => { const r = f(db.transaction(ST, mode).objectStore(ST)); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); };
export const list = () => tx<Pending[]>("readonly", (s) => s.getAll() as IDBRequest<Pending[]>);
export const enqueue = (p: Omit<Pending, "key">) => tx("readwrite", (s) => s.add(p));
const remove = (key: number) => tx("readwrite", (s) => s.delete(key));
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);
export interface SyncResult { sent: number; rejected: { label: string; reason: string }[]; remaining: number }
let syncing: Promise<SyncResult> | null = null;
export function sync(): Promise<SyncResult> {
  return syncing ??= (async () => { const res: SyncResult = { sent: 0, rejected: [], remaining: 0 };
    const items = (await list()).sort((a, b) => a.key - b.key);
    for (const [i, p] of items.entries()) {
      try { await post(`/tasks/${p.taskId}/${p.to}`, { version: p.version, assignee: p.assignee }); await remove(p.key); res.sent++; }
      catch (e) { if (isNetworkError(e)) { res.remaining = items.length - i; break; } await remove(p.key); res.rejected.push({ label: p.label, reason: (e as Error).message }); }
    }
    return res; })().finally(() => { syncing = null; });
}
/** Apply queued steps locally so the spotter sees their own progress while offline. */
export function overlay(tasks: Task[], q: Pending[]): Task[] {
  const m = new Map(tasks.map((t) => [t.id, { ...t }]));
  for (const p of [...q].sort((a, b) => a.key - b.key)) { const t = m.get(p.taskId); if (t) { t.status = p.to; t.version = p.version + 1; t.assignee = p.assignee; } }
  return [...m.values()];
}
