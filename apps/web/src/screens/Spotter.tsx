import { useRef, useState } from "react";
import { ChevronsRight, Snowflake, Flame, ListTodo, Map as MapIcon, User, ScanLine } from "lucide-react";
import { useApp } from "../store";
import { fmtTime, post, type Task } from "../api";
import { locRect, center, routeFor } from "../yard/geo";

const NEXT: Partial<Record<Task["status"], [Task["status"], string]>> = { open: ["assigned", "Slide to accept"], assigned: ["in_progress", "Slide to start move"], in_progress: ["done", "Slide to confirm drop"] };
export default function Spotter() {
  const { d, run, unit } = useApp();
  const mine = d.tasks.filter((t) => t.status !== "done" && (!t.assignee || t.assignee === "Spotter 1")).sort((a, b) => (b.status === "in_progress" ? 1 : 0) - (a.status === "in_progress" ? 1 : 0) || a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  const t = mine[0]; const u = t && unit(t.unitId);
  const act = (t: Task) => { const n = NEXT[t.status]!; return run(() => post(`/tasks/${t.id}/${n[0]}`, { version: t.version, assignee: "Spotter 1" }), `${unit(t.unitId)?.number}: ${n[0].replace("_", " ")}`); };
  return (<div className="spot2">
    <div className="sp-top"><div><b>My moves</b><small className="mu">Spotter 1 · YT-03</small></div><span className="live"><i />online</span></div>
    {t && u ? <div className="sp-job enter" key={t.id}>
      <div className="row" style={{ justifyContent: "space-between" }}><span className={"tag " + (t.priority === 1 ? "t-late" : "t-idle")}>P{t.priority} · {t.type}</span><span className="mu m" style={{ fontSize: 12 }}>{t.status.replace("_", " ")} · {fmtTime(t.createdAt)}</span></div>
      <div className="sp-route m"><span>{t.from}</span><ChevronsRight size={26} /><span style={{ color: "var(--accent)" }}>{t.to}</span></div>
      <div className="sp-unit m">{u.number}{u.reefer && <span className="tag t-reefer"><Snowflake size={11} />reefer</span>}{u.hazmat && <span className="tag t-haz"><Flame size={11} />{u.hazmat}</span>}</div>
      <MiniRoute from={t.from} to={t.to} />
      <Slide key={t.id + t.status} label={NEXT[t.status]![1]} onDone={() => act(t)} />
      {t.status === "in_progress" && <span className="hint" style={{ textAlign: "center" }}><ScanLine size={12} /> Confirming records the drop at {t.to}; the core updates the slot or door.</span>}
    </div> : <div className="empty-note" style={{ padding: 30 }}>Queue clear. New moves appear automatically.</div>}
    <div className="sp-next"><div className="mu sec2">Next · {Math.max(0, mine.length - 1)}</div>
      {mine.slice(1, 6).map((x) => { const xu = unit(x.unitId); return <div key={x.id} className="sp-row"><span className="m">{x.from} → {x.to}</span><span className="m mu ell">{xu?.number}</span><span className="tag t-idle">P{x.priority}</span></div>; })}</div>
    <nav className="sp-tabs"><span className="on"><ListTodo size={18} />Moves</span><span><MapIcon size={18} />Map</span><span><User size={18} />Me</span></nav>
  </div>);
}
function MiniRoute({ from, to }: { from: string; to: string }) {
  const [ax, ay] = center(locRect(from)), [bx, by] = center(locRect(to)); const pts = routeFor(from, to).map(([x, y]) => ({ x, y })); const a = { x: ax, y: ay }, b = { x: bx, y: by };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); let x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4, w = Math.max(...xs) - x0 + 4, h = Math.max(...ys) - y0 + 4; if (h < w / 3) { y0 -= (w / 3 - h) / 2; h = w / 3; }
  return <svg className="sp-map" viewBox={`${x0} ${y0} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
    <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: Math.max(w, h) / 90, strokeDasharray: `${Math.max(w, h) / 40} ${Math.max(w, h) / 60}`, animation: "dash 1.2s linear infinite" }} />
    <circle cx={a.x} cy={a.y} r={Math.max(w, h) / 45} style={{ fill: "var(--text-2)" }} /><circle cx={b.x} cy={b.y} r={Math.max(w, h) / 35} style={{ fill: "var(--accent)" }} /></svg>;
}
function Slide({ label, onDone }: { label: string; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const [x, setX] = useState(0); const [drag, setDrag] = useState<number | null>(null); const [done, setDone] = useState(false);
  const max = () => (ref.current?.clientWidth ?? 300) - 60;
  return <div ref={ref} className={"slide" + (done ? " done" : "")} role="button" tabIndex={0} aria-label={label}
    onKeyDown={(e) => { if (e.key === "Enter" && !done) { setDone(true); onDone(); } }}
    onPointerDown={(e) => { if (done) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(e.clientX - x); }}
    onPointerMove={(e) => { if (drag !== null) setX(Math.max(0, Math.min(max(), e.clientX - drag))); }}
    onPointerUp={() => { if (drag === null) return; setDrag(null); if (x > max() * 0.85) { setX(max()); setDone(true); onDone(); } else setX(0); }}>
    <span className="fill" style={{ width: x + 56 }} /><span className="lbl" style={{ opacity: 1 - x / max() }}>{done ? "Sent" : label}</span>
    <span className="knob" style={{ transform: `translateX(${x}px)`, transition: drag === null ? "transform 220ms var(--ease)" : "none" }}><ChevronsRight size={22} /></span></div>;
}
