import { Router, type Request, type Response, type NextFunction } from "express";
import { DEMO_TENANT, runAs, tid, currentUser } from "../../shared/tenancy.ts";
import { wipeTenantData, flush, hydrate, dbReady } from "../../shared/db.ts";
import { dropSeed } from "../../seedcache.ts";
import { units, raise, zones } from "../yard/index.ts";
import { doors } from "../dock/index.ts";
import { tasks, transition, createMove } from "../tasks/index.ts";
import { appointments } from "../appointments/index.ts";
import { checkIn } from "../gate/index.ts";
// Demo mode: everything here is hard-wired to the demo tenant and refuses to run for any other tenant.
const onlyDemo = (_q: Request, r: Response, next: NextFunction) => (tid() === DEMO_TENANT && currentUser()?.demo ? next() : r.status(403).json({ error: "Demo tenant only" }));
let timer: NodeJS.Timeout | undefined; let ticks = 0; export const autoplay = { on: false, intervalMs: 5000, last: "" };
export async function resetDemo() {
  stop(); await wipeTenantData(DEMO_TENANT); dropSeed(DEMO_TENANT);
  if (dbReady()) await runAs(DEMO_TENANT, () => hydrate(DEMO_TENANT)); return { ok: true };
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** One simulated event: progresses moves, books arrivals, raises alerts. Returns a short description. */
export function tick(): string {
  return runAs(DEMO_TENANT, () => {
    ticks++; const open = tasks.all().filter((t) => t.status !== "done");
    const step = ticks % 5;
    try {
      if (step === 0 || step === 3) { const t = pick(open.filter((x) => x.status === "in_progress")) ?? pick(open.filter((x) => x.status === "assigned"));
        if (t) { const to = t.status === "in_progress" ? "done" : "in_progress"; transition(t.id, to, t.version, t.assignee); return `${t.to}: move ${to.replace("_", " ")}`; } }
      if (step === 1) { const t = pick(open.filter((x) => x.status === "open")); if (t) { transition(t.id, "assigned", t.version, pick(["Spotter 1", "Spotter 2", "Spotter 3"])); return `${t.id} assigned`; } }
      if (step === 2) { const a = appointments.all().filter((x) => x.status === "booked" || x.status === "late").sort((x, y) => x.slotStart.localeCompare(y.slotStart))[0];
        if (a) { checkIn({ appointmentId: a.id, plate: a.plate ?? "", unitNumber: a.unitNumber ?? "TR-0000", decision: "pass" }); return `${a.unitNumber} arrived at gate`; } }
      if (step === 4) { if (ticks % 10 === 4) { const u = pick(units.all().filter((x) => x.reefer && x.location)); if (u) { raise({ severity: "high", text: `Reefer ${u.number} set-point deviation +${(1 + Math.random() * 3).toFixed(1)}°C`, unitId: u.id }); return `alert on ${u.number}`; } }
        const free = doors.all().find((d) => d.state === "free" && !tasks.all().some((t) => t.status !== "done" && t.to === d.label));
        const u = pick(units.all().filter((x) => /^[ABC]\d/.test(x.location) && x.status !== "hold" && x.status !== "quarantine" && !open.some((t) => t.unitId === x.id)));
        if (free && u) { createMove({ unitId: u.id, to: free.label, priority: 2 }); return `${u.number} → ${free.label} requested`; } }
    } catch (e: any) { return "skipped: " + e.message; }
    return "idle";
  });
}
function stop() { if (timer) clearInterval(timer); timer = undefined; autoplay.on = false; }
export function setAutoplay(on: boolean, intervalMs = 5000) {
  stop(); if (!on) return autoplay;
  autoplay.on = true; autoplay.intervalMs = Math.max(1500, intervalMs);
  timer = setInterval(() => { autoplay.last = tick(); void flush(DEMO_TENANT); }, autoplay.intervalMs); timer.unref?.(); return autoplay;
}
export const router = Router().use(onlyDemo)
  .get("/status", (_q, r) => r.json({ ...autoplay, zones: zones.all().length }))
  .post("/reset", async (_q, r) => r.json(await resetDemo()))
  .post("/tick", (_q, r) => r.json({ did: tick() }))
  .post("/autoplay", (q, r) => r.json(setAutoplay(!!q.body?.on, Number(q.body?.intervalMs) || 5000)));
