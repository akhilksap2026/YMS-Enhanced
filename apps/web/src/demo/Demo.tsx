import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw, LogOut, Presentation, X, Zap } from "lucide-react";
import { get, post, setToken, type Role } from "../api";

const ROLES: [Role, string][] = [["tenant_admin", "Tenant admin"], ["yard_manager", "Yard manager"], ["gate_guard", "Gate guard"], ["dock_supervisor", "Dock supervisor"], ["spotter", "Spotter"], ["carrier", "Carrier"], ["detention_approver", "Detention approver"]];

/** Scripted walk-through. Each step sets role + screen, then spotlights the first selector that exists. */
export const STEPS: { title: string; role: Role; screen: string; sel: string; text: string }[] = [
  { title: "Control tower", role: "yard_manager", screen: "tower", sel: ".kpis2", text: "One screen for the shift: live KPIs with trend, and every number is clickable through to the units behind it." },
  { title: "Flow strip", role: "yard_manager", screen: "tower", sel: ".fstage-wrap", text: "Gate → yard → door → out. Each stage shows count and the slowest dwell, so the bottleneck is visible at a glance." },
  { title: "Exceptions and door timeline", role: "yard_manager", screen: "tower", sel: ".gantt", text: "Alerts on the left need an action; the timeline shows which doors are tied up and for how long." },
  { title: "Yard map", role: "yard_manager", screen: "map", sel: ".ymap2 .world", text: "2.5D site plan. Click a unit to select it, drag it to a slot to create a move, or drop it on a door." },
  { title: "Hold, release, assign door", role: "yard_manager", screen: "map", sel: ".hud.queue", text: "The selected unit's card offers hold/release and door assignment. Open moves queue here for spotters." },
  { title: "Gate check-in with OCR", role: "gate_guard", screen: "gate", sel: ".cams", text: "Upload or capture a photo, or pick a sample. Native Python OCR reads the container number, repairs O/0 and I/1 mix-ups, and checks the ISO 6346 digit." },
  { title: "One-tap decision", role: "gate_guard", screen: "gate", sel: ".gacts", text: "High-confidence valid reads route straight to admit. Anything else asks the guard to confirm. The guard always has the final say." },
  { title: "Door board", role: "dock_supervisor", screen: "dock", sel: ".dock-gantt", text: "Door timeline: actual time at each door, plus planned moves. KPIs on the right: utilisation, time at door, load/unload mix." },
  { title: "Spotter app", role: "tenant_admin", screen: "spotter", sel: ".spot2", text: "This is the phone app that drivers use: next move, route, and a swipe to confirm. It keeps working offline and syncs later." },
  { title: "Carrier booking", role: "carrier", screen: "carrier", sel: ".panel", text: "Carriers book their own slots and only see their own loads. At SAP/OTM sites, bookings come from the ERP adapter instead." },
  { title: "Detention: indicative charge", role: "detention_approver", screen: "detention", sel: ".panel", text: "Charges are calculated from free time and rates, but they are indicative only. The approver decides." },
  { title: "Approve and export", role: "detention_approver", screen: "detention", sel: ".act, .btn.pri", text: "Approve, waive or dispute with a reason. Approved lines export as CSV for billing. Nothing is invoiced automatically." },
  { title: "Notifications", role: "tenant_admin", screen: "tower", sel: "[data-tour=notifications]", text: "Every event goes to the outbox: SMS, email and webhook messages, all visible here. In the demo, nothing leaves the system." },
  { title: "Tenant admin", role: "tenant_admin", screen: "admin", sel: ".adm", text: "Sites, yard layout (zones, slots, doors), users and roles, detention rates, and the appointment source per site: native, SAP TM/EWM or Oracle OTM." },
  { title: "AI tier (preview)", role: "tenant_admin", screen: "ai", sel: ".ai-prev", text: "A separate, optional tier: dwell prediction, door suggestions and anomaly flags. This is a preview with illustrative output, not live models." },
];

export function DemoBadge({ onTour }: { onTour: () => void }) {
  const [open, setOpen] = useState(false); const [auto, setAuto] = useState(false); const [busy, setBusy] = useState("");
  useEffect(() => { get<{ on: boolean }>("/demo/status").then((s) => setAuto(s.on)).catch(() => {}); }, []);
  const toggle = async () => { const s = await post<{ on: boolean }>("/demo/autoplay", { on: !auto, intervalMs: 4000 }); setAuto(s.on); };
  const reset = async () => { setBusy("reset"); try { await post("/demo/reset"); location.reload(); } finally { setBusy(""); } };
  const exit = () => { setToken(); location.href = "/"; };
  return <span className="pop-wrap demo-wrap" data-tour="demo">
    <button className={"chip demo" + (auto ? " live" : "")} onClick={() => setOpen(!open)} aria-expanded={open}><Zap size={13} />DEMO{auto && <i className="pulse" />}</button>
    {open && <div className="pop demo-pop" onMouseLeave={() => setOpen(false)}>
      <p className="mu">Separate demo tenant. Real tenant data is never touched.</p>
      <button className="btn sm" onClick={() => { setOpen(false); onTour(); }}><Presentation size={14} />Guided tour</button>
      <button className="btn sm" onClick={toggle}>{auto ? <Pause size={14} /> : <Play size={14} />}{auto ? "Stop live simulation" : "Start live simulation"}</button>
      <button className="btn sm" disabled={!!busy} onClick={reset}><RotateCcw size={14} />{busy ? "Resetting…" : "Reset demo data"}</button>
      <button className="btn sm ghost" onClick={exit}><LogOut size={14} />Exit demo</button>
    </div>}
  </span>;
}

export function DemoRoleSwitch({ role, onSwitch }: { role: Role; onSwitch: (r: Role) => void }) {
  return <label className="role-sw" title="Switch role instantly (demo only)"><span className="mu">View as</span>
    <select className="ctl sm" value={role} onChange={(e) => onSwitch(e.target.value as Role)}>{ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></label>;
}

export function Tour({ onClose, switchRole, go, role }: { onClose: () => void; switchRole: (r: Role) => Promise<void>; go: (s: string) => void; role: Role }) {
  const [i, setI] = useState(() => Math.min(STEPS.length - 1, Number(new URLSearchParams(location.search).get("step") || 0)));
  const [rect, setRect] = useState<DOMRect | null>(null); const s = STEPS[i]; const roleRef = useRef(role); roleRef.current = role;
  useEffect(() => { let dead = false; (async () => { if (roleRef.current !== s.role) await switchRole(s.role); if (!dead) go(s.screen); })(); return () => { dead = true; }; }, [i]); // eslint-disable-line
  const measure = useCallback(() => { const el = s.sel.split(",").map((x) => document.querySelector(x.trim())).find(Boolean) as HTMLElement | undefined; setRect(el ? el.getBoundingClientRect() : null); }, [s.sel]);
  useLayoutEffect(() => { measure(); const t = setInterval(measure, 400); addEventListener("resize", measure); return () => { clearInterval(t); removeEventListener("resize", measure); }; }, [measure]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest("input,select,textarea")) return;
    if (e.key === "ArrowRight") setI((x) => Math.min(STEPS.length - 1, x + 1)); else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1)); else if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const pad = 6;
  return <>
    {rect && <div className="spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}>
      <div className="spot-cap" style={rect.bottom + 90 < innerHeight ? { top: "calc(100% + 8px)" } : { bottom: "calc(100% + 8px)" }}><b>{i + 1}. {s.title}</b></div></div>}
    <aside className="presenter" role="dialog" aria-label="Guided tour">
      <header><Presentation size={14} /><b>Guided tour</b><span className="mu m">{i + 1}/{STEPS.length}</span><button className="btn icon ghost sm" onClick={onClose} aria-label="Close tour"><X size={14} /></button></header>
      <div className="pr-body"><h4>{s.title}</h4><p>{s.text}</p><span className="mu pr-role">Viewing as {ROLES.find(([r]) => r === s.role)?.[1]}</span></div>
      <ol className="pr-steps">{STEPS.map((x, n) => <li key={n} className={n === i ? "on" : n < i ? "done" : ""} onClick={() => setI(n)}>{x.title}</li>)}</ol>
      <footer><button className="btn sm" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={14} />Back</button><span className="mu kb">← → keys</span>
        {i < STEPS.length - 1 ? <button className="btn sm pri" onClick={() => setI(i + 1)}>Next<ChevronRight size={14} /></button> : <button className="btn sm pri" onClick={onClose}>Finish</button>}</footer>
    </aside>
  </>;
}
