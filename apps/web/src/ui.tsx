import { UnitExtras, Evidence, DrawerButton } from "./features/V12";
import { Camera } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { X, Snowflake, Flame, Lock, LockOpen, DoorOpen, Move, Container, Truck, TriangleAlert, Radar } from "lucide-react";
import { fmtDur, hoursSince, post, type Unit } from "./api";
import { useApp } from "./store";

export type ThemePref = "system" | "light" | "dark";
const osTheme = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
/** Theme: stored preference wins; "system" follows OS live. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem("yms.theme") as ThemePref) || "system");
  const [resolved, setResolved] = useState<"light" | "dark">(() => (pref === "system" ? osTheme() : pref));
  useEffect(() => {
    const apply = () => { const r = pref === "system" ? osTheme() : pref; setResolved(r); document.documentElement.dataset.theme = r; };
    apply(); if (pref === "system") localStorage.removeItem("yms.theme"); else localStorage.setItem("yms.theme", pref);
    const mq = matchMedia("(prefers-color-scheme: light)"); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply);
  }, [pref]);
  return { pref, setPref, resolved };
}
export function useReducedMotion() {
  const [r, setR] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const mq = matchMedia("(prefers-reduced-motion: reduce)"); const f = () => setR(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  return r;
}
export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (<><div className="drawer-scrim" onClick={onClose} /><aside className="drawer" role="dialog" aria-label={typeof title === "string" ? title : "Details"}>
    <header>{title}<span className="sp" /><button className="btn icon ghost" onClick={onClose} aria-label="Close"><X size={16} /></button></header><div className="db">{children}</div></aside></>);
}
export function Spark({ data, color = "var(--c-ok)", h = 20 }: { data: number[]; color?: string; h?: number }) {
  const mn = Math.min(...data), mx = Math.max(...data), W = 200;
  const p = data.map((v, i) => `${(i * W) / (data.length - 1)},${h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)}`).join(" ");
  return (<svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden>
    <polyline points={`0,${h} ${p} ${W},${h}`} fill={color} opacity=".12" /><polyline points={p} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>);
}

/** Single source of truth for unit colouring. Reefer stays blue even when the unit is late/warn. */
export type Tone = "reefer" | "haz" | "hold" | "quarantine" | "late" | "empty" | "ok";
export function unitTone(u: Unit): Tone {
  if (u.status === "quarantine") return "quarantine";
  if (u.status === "hold") return "hold";
  if (u.reefer) return "reefer";
  if (u.hazmat) return "haz";
  if (u.status === "warn") return "late";
  if (u.load === "empty") return "empty";
  return "ok";
}
export const TONE_LABEL: Record<Tone, string> = { reefer: "Reefer", haz: "Hazmat", hold: "Hold", quarantine: "Quarantine", late: "Late / over free", empty: "Empty", ok: "Loaded" };
export const TONE_VAR: Record<Tone, string> = { reefer: "var(--c-reefer)", haz: "var(--c-haz)", hold: "var(--c-hold)", quarantine: "var(--c-bad)", late: "var(--c-late)", empty: "var(--map-empty)", ok: "var(--map-unit)" };
export const TONE_TAG: Record<Tone, string> = { reefer: "t-reefer", haz: "t-haz", hold: "t-hold", quarantine: "t-bad", late: "t-late", empty: "t-idle", ok: "t-ok" };
const FREE_HOURS = 2;

export function UnitDetail({ u, onMove, onAssign, compact }: { u: Unit; onMove?: () => void; onAssign?: (doorId: string) => void; compact?: boolean }) {
  const { d, run, carrier } = useApp();
  const tone = unitTone(u); const dwell = hoursSince(u.gateInAt); const left = FREE_HOURS - dwell;
  const free = d.doors.filter((x) => x.state === "free");
  const suggest = free[0];
  const pending = d.tasks.find((t) => t.unitId === u.id && t.status !== "done");
  const appt = d.appointments.find((a) => a.unitNumber === u.number);
  const Icon = u.reefer ? Snowflake : u.hazmat ? Flame : u.status === "hold" ? Lock : u.kind === "container" ? Container : Truck;
  const blocked = u.status === "hold" || u.status === "quarantine";
  const assign = (doorId: string) => onAssign ? onAssign(doorId) : run(() => post("/tasks", { unitId: u.id, to: d.doors.find((x) => x.id === doorId)!.label, priority: 1 }), `Move to ${d.doors.find((x) => x.id === doorId)!.label} queued`);
  return (<div className="ud">
    <div className="hd"><div className="ico" style={{ color: TONE_VAR[tone] }}><Icon size={19} /></div><div style={{ flex: 1, minWidth: 0 }}>
      <div className="id">{u.number}</div><div className="mu" style={{ marginTop: 2, fontSize: 11.5 }}>{u.kind === "container" ? "Container" : "Trailer"} · {carrier(u.carrierId)} · {u.load}</div>
      <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}><span className={"tag " + TONE_TAG[tone]}>{TONE_LABEL[tone]}</span>{u.reefer && u.status === "warn" && <span className="tag t-late">over free time</span>}{u.hazmat && <span className="tag t-haz">{u.hazmat}</span>}{pending && <span className="tag t-live">move pending</span>}</div></div></div>
    <div className="kv"><div><span>Location</span><b>{u.location || "—"}</b></div><div><span>Dwell</span><b>{fmtDur(dwell)}</b></div>
      <div><span>Appointment</span><b>{appt?.ref ?? "—"}</b></div><div><span>Free time left</span><b style={{ color: left < 0.5 ? "var(--bad)" : undefined }}>{left > 0 ? fmtDur(left) : "over " + fmtDur(-left)}</b></div>
      {!compact && <><div><span>Gate in</span><b>{u.gateInAt ? new Date(u.gateInAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</b></div><div><span>Pending move</span><b>{pending ? `${pending.from} → ${pending.to}` : "none"}</b></div></>}</div>
    <div className="acts">
      <button className="btn pri" disabled={blocked || !suggest || !!pending || u.location.startsWith("D")} onClick={() => suggest && assign(suggest.id)}><DoorOpen size={15} />Assign {suggest?.label ?? "door"}<kbd>D</kbd></button>
      <button className="btn" disabled={u.status === "quarantine" || !!pending} onClick={onMove}><Move size={15} />Move<kbd>M</kbd></button>
      <button className="btn hold" disabled={blocked} onClick={() => run(() => post(`/yard/units/${u.id}/hold`, { reason: "set from yard" }), `${u.number} on hold`)}><Lock size={15} />Hold<kbd>H</kbd></button>
      <button className="btn ok" disabled={u.status !== "hold"} onClick={() => run(() => post(`/yard/units/${u.id}/release`), `${u.number} released`)}><LockOpen size={15} />Release<kbd>R</kbd></button>
    </div>
    {!compact && <div className="v12-ux"><UnitExtras u={u} />
    <DrawerButton cls="btn sm" icon={<Camera size={13} />} label="Gate evidence" title={`Gate evidence · ${u.number}`}>{() => <Evidence u={u} />}</DrawerButton></div>}
    {u.status === "quarantine" ? <div className="hint-line"><TriangleAlert size={14} color="var(--c-bad)" /><span>Quarantined at gate. Lifting it needs the inspection workflow, not a yard action.</span></div>
      : suggest && !blocked && !pending ? <div className="hint-line"><Radar size={14} color="var(--c-live)" /><span>Suggested <b className="m">{suggest.label}</b>: first free door. {free.length} doors free now.</span></div> : null}
  </div>);
}
