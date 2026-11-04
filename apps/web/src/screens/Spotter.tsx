import { useApp } from "../store";
import { fmtTime, post, type Task } from "../api";

const NEXT: Partial<Record<Task["status"], [Task["status"], string]>> = { open: ["assigned", "Accept"], assigned: ["in_progress", "Start move"], in_progress: ["done", "Confirm by scan"] };
export default function Spotter() {
  const { d, run, unit } = useApp();
  const mine = d.tasks.filter((t) => t.status !== "done" && (!t.assignee || t.assignee === "Spotter 1")).sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  const go = (t: Task) => { const n = NEXT[t.status]!; return run(() => post(`/tasks/${t.id}/${n[0]}`, { version: t.version, assignee: "Spotter 1" }), `${unit(t.unitId)?.number}: ${n[1]}`); };
  return (<div style={{ maxWidth: 520 }}>
    <div className="ph"><h1>My moves</h1><span className="meta">Spotter 1 · truck YT-03 · online · {mine.length} in queue</span></div>
    <div className="grid">{mine.map((t, i) => { const u = unit(t.unitId); const n = NEXT[t.status]!; return (
      <div key={t.id} className={`spot-card p${t.priority}`}>
        <div className="row" style={{ justifyContent: "space-between" }}><span className="pill s-idle">{t.type}</span>
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>P{t.priority} · {fmtTime(t.createdAt)}{t.status === "in_progress" ? " · in progress" : ""}{!t.assignee ? " · unassigned" : ""}</span></div>
        <div className="route">{t.from} → {t.to}</div>
        <div className="mono" style={{ color: "var(--text-2)" }}>{u?.number}{u?.reefer ? " · reefer" : ""}{u?.hazmat ? " · " + u.hazmat : ""}</div>
        <button className={`btn ${i === 0 ? "pri" : ""}`} onClick={() => go(t)}>{n[1]}</button>
      </div>); })}</div>
    {!mine.length && <div className="empty-note">Queue clear. New moves appear automatically.</div>}
  </div>);
}
