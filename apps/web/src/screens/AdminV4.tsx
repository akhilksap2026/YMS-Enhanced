import { useEffect, useState } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { useApp } from "../store";
import { del, get, patch, post, put, type Site } from "../api";

export function SitesTab() {
  const { run, tenant } = useApp(); const [list, setList] = useState<Site[]>([]);
  const [f, setF] = useState({ code: "", name: "", tz: "Africa/Bujumbura", address: "", doors: 6, rows: 12, waiting: 6 });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const load = () => get<Site[]>("/admin/sites").then(setList); useEffect(() => { void load(); }, []);
  const create = () => run(async () => { await post("/admin/sites", { code: f.code, name: f.name, tz: f.tz, address: f.address || undefined, doors: f.doors, zones: [{ name: "A", kind: "row", slots: f.rows }, { name: "W", kind: "waiting", slots: f.waiting }] }); setF({ ...f, code: "", name: "", address: "" }); await load(); }, `Site ${f.name} created`);
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
    <section className="panel"><header>Sites <span className="meta">each site has its own yard, doors, appointments, rules and reports; users and carriers are shared</span></header>
      <table className="t"><thead><tr><th>Code</th><th>Name</th><th>Time zone</th><th>Address</th><th>Status</th><th /></tr></thead><tbody>{list.map((s) => <tr key={s.id}>
        <td className="mono">{s.code}</td><td><input className="ctl sm" value={edit[s.id] ?? s.name} onChange={(e) => setEdit({ ...edit, [s.id]: e.target.value })} aria-label="Site name" />{tenant?.site?.id === s.id && <span className="pill s-ok" style={{ marginLeft: 6 }}>current</span>}</td>
        <td className="mono">{s.tz}</td><td className="mu ell" style={{ maxWidth: 180 }}>{s.address ?? "–"}</td><td><span className={`pill s-${s.active ? "ok" : "idle"}`}>{s.active ? "active" : "inactive"}</span></td>
        <td className="actions">{edit[s.id] && edit[s.id] !== s.name && <button className="btn sm pri" onClick={() => run(async () => { await patch(`/admin/sites/${s.id}`, { name: edit[s.id] }); setEdit({}); await load(); }, "Renamed")}>Save</button>}
          {s.id !== "s-rsr" && <><button className="btn sm" onClick={() => run(async () => { await patch(`/admin/sites/${s.id}`, { active: !s.active }); await load(); }, s.active ? "Deactivated" : "Activated")}>{s.active ? "Deactivate" : "Activate"}</button>
          <button className="btn sm icon ghost" aria-label="Delete site" title="Delete (only when the yard is empty)" onClick={() => confirm(`Delete ${s.name} and all its layout and history?`) && run(async () => { await del(`/admin/sites/${s.id}`); await load(); }, "Site deleted")}><Trash2 size={14} /></button></>}</td></tr>)}</tbody></table></section>
    <section className="panel"><header><Plus size={14} />New site</header><div className="body form">
      <div className="form two"><label>Code<input className="ctl mono" maxLength={6} placeholder="NTH" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></label>
        <label>Time zone<input className="ctl" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} /></label></div>
      <label>Name<input className="ctl" placeholder="North Depot" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Address<input className="ctl" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <div className="form two"><label>Dock doors<input className="ctl" type="number" min={1} max={40} value={f.doors} onChange={(e) => setF({ ...f, doors: +e.target.value })} /></label>
        <label>Parking slots (row A)<input className="ctl" type="number" min={1} max={40} value={f.rows} onChange={(e) => setF({ ...f, rows: +e.target.value })} /></label>
        <label>Waiting slots (W)<input className="ctl" type="number" min={1} max={40} value={f.waiting} onChange={(e) => setF({ ...f, waiting: +e.target.value })} /></label></div>
      <button className="btn pri" disabled={f.code.length < 2 || f.name.trim().length < 2} onClick={create}>Create site</button>
      <p className="hint">Switch between sites with the site selector in the top bar. More zones can be added under Yard layout after switching.</p></div></section>
  </div>;
}

type W = { days: number[]; from: string; to: string; capacity: number; label?: string };
type CR = { carrierId: string; blocked: boolean; maxPerDay?: number; directions?: ("inbound" | "outbound")[]; from?: string; to?: string; note?: string };
interface R { slotMinutes: number; perDoorPerSlot: number; windows: W[]; minLeadMinutes: number; horizonDays: number; graceMinutes: number; noShowAfterMinutes: number; reschedule: { maxCount: number; minNoticeMinutes: number; allowAfterNoShow: boolean }; carriers: CR[] }
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function ApptRulesTab() {
  const { run, d, tenant } = useApp(); const [r, setR] = useState<R | null>(null);
  useEffect(() => { void get<R>("/appointments/rules").then(setR); }, []);
  if (!r) return null; const set = (p: Partial<R>) => setR({ ...r, ...p });
  const num = (l: string, v: number, f: (n: number) => void, hint?: string) => <label>{l}<input className="ctl" type="number" value={v} onChange={(e) => f(+e.target.value)} />{hint && <small className="mu">{hint}</small>}</label>;
  const save = () => run(async () => setR(await put<R>("/appointments/rules", r)), "Appointment rules saved");
  const cw = (i: number, p: Partial<W>) => set({ windows: r.windows.map((w, k) => (k === i ? { ...w, ...p } : w)) });
  const cc = (i: number, p: Partial<CR>) => set({ carriers: r.carriers.map((w, k) => (k === i ? { ...w, ...p } : w)) });
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
    <section className="panel"><header>Capacity &amp; booking <span className="meta">{tenant?.site?.name}</span></header><div className="body form two">
      <label>Slot length<select className="ctl" value={r.slotMinutes} onChange={(e) => set({ slotMinutes: +e.target.value })}>{[15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
      {num("Bookings per door per slot", r.perDoorPerSlot, (n) => set({ perDoorPerSlot: n }), `${d.doors.filter((x) => x.state !== "blocked").length} bookable doors`)}
      {num("Minimum lead time (min)", r.minLeadMinutes, (n) => set({ minLeadMinutes: n }))}{num("Booking horizon (days)", r.horizonDays, (n) => set({ horizonDays: n }))}
      {num("Grace period (min)", r.graceMinutes, (n) => set({ graceMinutes: n }), "then marked late")}{num("No-show after (min)", r.noShowAfterMinutes, (n) => set({ noShowAfterMinutes: n }), "slot released")}
      {num("Max reschedules", r.reschedule.maxCount, (n) => set({ reschedule: { ...r.reschedule, maxCount: n } }))}{num("Reschedule notice (min)", r.reschedule.minNoticeMinutes, (n) => set({ reschedule: { ...r.reschedule, minNoticeMinutes: n } }))}
      <label className="radio"><input type="checkbox" checked={r.reschedule.allowAfterNoShow} onChange={(e) => set({ reschedule: { ...r.reschedule, allowAfterNoShow: e.target.checked } })} /><span>Allow rebooking a no-show</span></label>
      <button className="btn pri" onClick={save}>Save rules</button></div></section>
    <section className="panel"><header>Receiving windows <span className="meta">capacity = max bookings in one slot</span><span className="sp" /><button className="btn sm" onClick={() => set({ windows: [...r.windows, { days: [1, 2, 3, 4, 5], from: "08:00", to: "17:00", capacity: 4, label: "New window" }] })}><Plus size={13} />Window</button></header>
      <table className="t"><thead><tr><th>Label</th><th>Days</th><th>From</th><th>To</th><th>Cap.</th><th /></tr></thead><tbody>{r.windows.map((w, i) => <tr key={i}>
        <td><input className="ctl sm" value={w.label ?? ""} onChange={(e) => cw(i, { label: e.target.value })} /></td>
        <td><div className="seg">{DAY.map((dn, k) => <button key={k} className={w.days.includes(k) ? "on" : ""} onClick={() => cw(i, { days: w.days.includes(k) ? w.days.filter((x) => x !== k) : [...w.days, k].sort() })}>{dn[0]}</button>)}</div></td>
        <td><input className="ctl sm" type="time" value={w.from} onChange={(e) => cw(i, { from: e.target.value })} /></td><td><input className="ctl sm" type="time" value={w.to} onChange={(e) => cw(i, { to: e.target.value })} /></td>
        <td><input className="ctl sm" type="number" style={{ width: 56 }} value={w.capacity} onChange={(e) => cw(i, { capacity: +e.target.value })} /></td>
        <td><button className="btn sm icon ghost" aria-label="Remove window" onClick={() => set({ windows: r.windows.filter((_, k) => k !== i) })}><Trash2 size={13} /></button></td></tr>)}</tbody></table></section>
    <section className="panel" style={{ gridColumn: "1 / -1" }}><header>Carrier rules <span className="meta">override the defaults for one carrier</span><span className="sp" />
      <button className="btn sm" onClick={() => set({ carriers: [...r.carriers, { carrierId: d.carriers.find((c) => !r.carriers.some((x) => x.carrierId === c.id))?.id ?? d.carriers[0].id, blocked: false }] })}><Plus size={13} />Carrier rule</button></header>
      <table className="t"><thead><tr><th>Carrier</th><th>Blocked</th><th>Max / day</th><th>Directions</th><th>Own window</th><th>Note</th><th /></tr></thead><tbody>{r.carriers.length === 0 && <tr><td colSpan={7} className="mu">No carrier-specific rules. All carriers follow the site rules.</td></tr>}{r.carriers.map((c, i) => <tr key={i}>
        <td><select className="ctl sm" value={c.carrierId} onChange={(e) => cc(i, { carrierId: e.target.value })}>{d.carriers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
        <td><input type="checkbox" checked={c.blocked} onChange={(e) => cc(i, { blocked: e.target.checked })} aria-label="Blocked" /></td>
        <td><input className="ctl sm" type="number" style={{ width: 64 }} placeholder="–" value={c.maxPerDay ?? ""} onChange={(e) => cc(i, { maxPerDay: e.target.value === "" ? undefined : +e.target.value })} /></td>
        <td><select className="ctl sm" value={c.directions?.join(",") ?? ""} onChange={(e) => cc(i, { directions: e.target.value ? (e.target.value.split(",") as CR["directions"]) : undefined })}><option value="">Both</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select></td>
        <td><input className="ctl sm" type="time" value={c.from ?? ""} onChange={(e) => cc(i, { from: e.target.value || undefined })} /> – <input className="ctl sm" type="time" value={c.to ?? ""} onChange={(e) => cc(i, { to: e.target.value || undefined })} /></td>
        <td><input className="ctl sm" value={c.note ?? ""} onChange={(e) => cc(i, { note: e.target.value || undefined })} /></td>
        <td><button className="btn sm icon ghost" aria-label="Remove rule" onClick={() => set({ carriers: r.carriers.filter((_, k) => k !== i) })}><Trash2 size={13} /></button></td></tr>)}</tbody></table>
      <div className="body"><button className="btn pri sm" onClick={save}>Save rules</button> <span className="hint">Managers can override a refused booking from the booking screen; overrides are written to the appointment history and the audit log.</span></div></section>
  </div>;
}

interface A { id: string; at: string; userId: string; name: string; role: string; method: string; path: string; status: number; siteId: string; detail?: string }
export function AuditTab() {
  const [rows, setRows] = useState<A[]>([]); const [q, setQ] = useState(""); const [user, setUser] = useState(""); const [from, setFrom] = useState("");
  useEffect(() => { const t = setTimeout(() => { const p = new URLSearchParams({ ...(q ? { q } : {}), ...(user ? { user } : {}), ...(from ? { from: from + "T00:00:00Z" } : {}) }); void get<A[]>("/admin/audit?" + p).then(setRows); }, 250); return () => clearTimeout(t); }, [q, user, from]);
  return <section className="panel"><header>Audit log <span className="meta">every change, who made it, where · {rows.length} shown</span></header>
    <div className="body" style={{ display: "flex", gap: 6 }}><label className="search" style={{ flex: 1 }}><Search size={14} /><input placeholder="Filter by action / path" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <input className="ctl sm" placeholder="User" value={user} onChange={(e) => setUser(e.target.value)} /><input className="ctl sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /></div>
    <div className="scroll" style={{ maxHeight: 560 }}><table className="t"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Site</th><th>Result</th></tr></thead><tbody>{rows.map((a) =>
      <tr key={a.id}><td className="mono">{new Date(a.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td><td>{a.name}</td><td className="mu">{a.role.replace("_", " ")}</td>
        <td><span className="mono"><b>{a.method}</b> {a.path}</span>{a.detail && <span className="mu"> · {a.detail}</span>}</td><td className="mono">{a.siteId}</td><td><span className="pill s-ok">{a.status}</span></td></tr>)}</tbody></table></div></section>;
}
