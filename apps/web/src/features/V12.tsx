// v1.2 feature panels. Each opens in a drawer from a button in an existing screen header, so layouts and menus stay as they were.
import { useEffect, useState, type ReactNode } from "react";
import { Camera, ClipboardCheck, Flame, DoorOpen, Snowflake, Upload, FileSpreadsheet, ScanSearch, Timer, Send, Layers } from "lucide-react";
import { useApp } from "../store";
import { get, post, put, upload, fmtTime, money, fmtDur, type Unit } from "../api";
import { Drawer } from "../ui";

export function DrawerButton({ icon, label, title, children, cls = "btn" }: { icon: ReactNode; label: string; title?: string; children: (close: () => void) => ReactNode; cls?: string }) {
  const [open, setOpen] = useState(false);
  return <>{<button className={cls} onClick={() => setOpen(true)}>{icon}{label}</button>}{open && <Drawer title={title ?? label} onClose={() => setOpen(false)}>{children(() => setOpen(false))}</Drawer>}</>;
}
const Sec = ({ t, children, right }: { t: string; children: ReactNode; right?: ReactNode }) => <div className="v12-sec"><div className="v12-h"><b>{t}</b>{right}</div>{children}</div>;

// ---------------- gate evidence (photos, inspection, damage, placards, seal) ----------------
type Tpl = { id: string; name: string; appliesTo: string; items: { id: string; label: string; kind: "check" | "damage" | "text"; required?: boolean }[] };
type Dmg = { side: string; x: number; y: number; type: string; severity: "minor" | "major" };
const SIDES = ["left", "right", "front", "rear", "top", "floor"];
export function Evidence({ u }: { u: Unit }) {
  const { run, toast } = useApp();
  const [tpls, setTpls] = useState<Tpl[]>([]); const [visit, setVisit] = useState<{ photos: { id: string; view: string; at: string }[]; inspections: { id: string; result: string; at: string; seal: { status: string }; damage: Dmg[]; placards: { un: string; cls: string }[] }[] }>({ photos: [], inspections: [] });
  const def = u.hazmat ? "haz" : u.reefer ? "reefer" : "std"; const [tid, setTid] = useState(def); const [ans, setAns] = useState<Record<string, string | boolean>>({});
  const [dmg, setDmg] = useState<Dmg[]>([]); const [side, setSide] = useState("left"); const [dtype, setDtype] = useState("dent"); const [sev, setSev] = useState<"minor" | "major">("minor");
  const [pl, setPl] = useState<{ un: string; cls: string }[]>([]); const [seal, setSeal] = useState(""); const [sealRes, setSealRes] = useState<string>("");
  const load = () => get<typeof visit>(`/evidence/visit/${u.id}`).then(setVisit).catch(() => {});
  useEffect(() => { void get<Tpl[]>("/evidence/templates").then(setTpls).catch(() => {}); void load(); }, [u.id]); // eslint-disable-line
  const t = tpls.find((x) => x.id === tid);
  const photo = async (fs: FileList | null) => { if (!fs?.length) return; const f = new FormData(); [...fs].forEach((x) => f.append("photo", x)); f.append("views", [...fs].map(() => side).join(","));
    if (await run(() => upload(`/evidence/photos/${u.id}`, f), `${fs.length} photo${fs.length > 1 ? "s" : ""} stored for ${u.number}`)) void load(); };
  const checkSeal = async () => { const r = await get<{ status: string; expected?: string }>(`/evidence/seal/${u.id}?observed=${encodeURIComponent(seal)}`); setSealRes(r.status === "match" ? "Matches appointment" : r.status === "mismatch" ? `Does not match ${r.expected}` : r.status === "missing" ? `Expected ${r.expected}` : "No seal on the appointment"); };
  const submit = async () => { if (await run(() => post("/evidence/inspections", { unitId: u.id, templateId: tid, answers: ans, damage: dmg, placards: pl.filter((p) => p.un), seal: seal || undefined }), "Inspection saved")) { setAns({}); setDmg([]); void load(); } else toast("Check the required items", true); };
  return <div className="v12">
    <Sec t="Photos" right={<span className="mu">{visit.photos.length} stored</span>}>
      <div className="row"><select className="ctl" value={side} onChange={(e) => setSide(e.target.value)} aria-label="View">{["general", ...SIDES, "seal", "plate", "placard"].map((s) => <option key={s}>{s}</option>)}</select>
        <label className="btn"><Camera size={14} />Add photos<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void photo(e.target.files)} /></label></div>
      <div className="v12-thumbs">{visit.photos.map((p) => <a key={p.id} href={`/v1/evidence/photos/${p.id}?token=${localStorage.getItem("yms.token")}`} target="_blank" rel="noreferrer"><img alt={p.view} src={`/v1/evidence/photos/${p.id}?token=${localStorage.getItem("yms.token")}`} /><small>{p.view}</small></a>)}</div>
    </Sec>
    <Sec t="Inspection" right={<select className="ctl" value={tid} onChange={(e) => setTid(e.target.value)} aria-label="Template">{tpls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}>
      {t?.items.map((i) => i.kind === "check" ? <label key={i.id} className="v12-chk"><span>{i.label}{i.required && " *"}</span><span className="seg"><button className={ans[i.id] === true ? "on" : ""} onClick={() => setAns({ ...ans, [i.id]: true })}>OK</button><button className={ans[i.id] === false ? "on bad" : ""} onClick={() => setAns({ ...ans, [i.id]: false })}>Fail</button></span></label>
        : i.kind === "text" ? <label key={i.id} className="v12-chk"><span>{i.label}{i.required && " *"}</span><input className="ctl" value={String(ans[i.id] ?? "")} onChange={(e) => setAns({ ...ans, [i.id]: e.target.value })} /></label>
        : <div key={i.id}><div className="row"><span className="mu">{i.label}: click the diagram</span><select className="ctl" value={dtype} onChange={(e) => setDtype(e.target.value)} aria-label="Damage type">{["dent", "hole", "scratch", "rust", "leak", "other"].map((x) => <option key={x}>{x}</option>)}</select>
            <select className="ctl" value={sev} onChange={(e) => setSev(e.target.value as "minor")} aria-label="Severity"><option>minor</option><option>major</option></select></div>
          <div className="v12-sides">{SIDES.map((s) => <svg key={s} viewBox="0 0 100 40" className={side === s ? "on" : ""} onClick={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setSide(s); setDmg([...dmg, { side: s, x: +((e.clientX - r.left) / r.width).toFixed(2), y: +((e.clientY - r.top) / r.height).toFixed(2), type: dtype, severity: sev }]); }}>
            <rect x="2" y="2" width="96" height="36" rx="3" /><text x="50" y="23" textAnchor="middle">{s}</text>{dmg.filter((d) => d.side === s).map((d, k) => <circle key={k} cx={d.x * 100} cy={d.y * 40} r="3.5" className={d.severity} />)}</svg>)}</div>
          {dmg.length > 0 && <div className="mu">{dmg.length} marked · <button className="btn sm ghost" onClick={() => setDmg([])}>clear</button></div>}</div>)}
      {(u.hazmat || pl.length > 0 || tid === "haz") && <div className="row">{[...pl, { un: "", cls: "" }].slice(0, 4).map((p, k) => <span key={k} className="row"><input className="ctl m" style={{ width: 80 }} placeholder="UN1203" value={p.un} onChange={(e) => { const n = [...pl]; n[k] = { ...(n[k] ?? { cls: "" }), un: e.target.value }; setPl(n); }} aria-label="UN number" />
        <input className="ctl m" style={{ width: 48 }} placeholder="3" value={p.cls} onChange={(e) => { const n = [...pl]; n[k] = { ...(n[k] ?? { un: "" }), cls: e.target.value }; setPl(n); }} aria-label="Class" /></span>)}<span className="mu">hazmat placards</span></div>}
      <div className="row"><input className="ctl m" placeholder="Seal read at gate" value={seal} onChange={(e) => { setSeal(e.target.value); setSealRes(""); }} aria-label="Seal" /><button className="btn sm" onClick={() => void checkSeal()}>Check seal</button><span className="mu">{sealRes}</span></div>
      <button className="btn pri" onClick={() => void submit()}><ClipboardCheck size={14} />Save inspection</button>
    </Sec>
    {visit.inspections.length > 0 && <Sec t="History">{visit.inspections.map((i) => <div key={i.id} className="row"><span className={"tag " + (i.result === "pass" ? "t-ok" : "t-bad")}>{i.result}</span><span className="m">{fmtTime(i.at)}</span><span className="mu">seal {i.seal.status.replace("_", " ")} · {i.damage.length} damage · {i.placards.map((p) => p.un + "/" + p.cls).join(", ") || "no placards"}</span></div>)}</Sec>}
  </div>;
}

// ---------------- unit extras: hot load, door proposal, reefer ----------------
export function UnitExtras({ u }: { u: Unit & { hot?: boolean } }) {
  const { run, reload, can } = useApp();
  const [prop, setProp] = useState<{ doorId: string; label: string; score: number; reasons: string[] }[] | null>(null); const [pick, setPick] = useState(""); const [why, setWhy] = useState("");
  const [rf, setRf] = useState<{ setpoint: number; plug: string | null; temp: number; deviation: number; alarms: string[] } | null>(null); const [plugs, setPlugs] = useState<string[]>([]);
  useEffect(() => { if (u.reefer) void get<{ plugs: string[]; units: (typeof rf & { unitId: string })[] }>("/ops/reefers").then((r) => { setPlugs(r.plugs); setRf(r.units.find((x) => x!.unitId === u.id) ?? null); }).catch(() => {}); }, [u.id, u.reefer]); // eslint-disable-line
  const act = (f: () => Promise<unknown>, m: string) => run(async () => { await f(); await reload(); }, m);
  return <div className="v12">
    <div className="row">{can("yard:write") && <button className={"btn sm" + (u.hot ? " hold" : "")} onClick={() => act(() => post(`/planning/hot/${u.id}`, { on: !u.hot }), u.hot ? "Hot flag removed" : `${u.number} is a hot load`)}><Flame size={13} />{u.hot ? "Hot load: on" : "Mark hot"}</button>}
      {can("dock:write") && !u.location.startsWith("D") && <button className="btn sm" onClick={() => void get<NonNullable<typeof prop>>(`/ops/doors/proposal/${u.id}`).then((p) => { setProp(p); setPick(p[0]?.doorId ?? ""); })}><DoorOpen size={13} />Propose door</button>}</div>
    {prop && <Sec t="Door proposal" right={<span className="mu">rule-based; you can override</span>}>
      {prop.slice(0, 5).map((p, i) => <label key={p.doorId} className="v12-chk"><span><input type="radio" checked={pick === p.doorId} onChange={() => setPick(p.doorId)} /> <b className="m">{p.label}</b> {i === 0 && <span className="tag t-ok">proposed</span>}</span><span className="mu">{p.reasons.join(" · ")}</span></label>)}
      {pick && pick !== prop[0]?.doorId && <input className="ctl" placeholder="Reason for override (required)" value={why} onChange={(e) => setWhy(e.target.value)} />}
      <button className="btn pri sm" disabled={!pick || (pick !== prop[0]?.doorId && !why.trim())} onClick={() => act(() => post(`/ops/doors/assign/${u.id}`, { doorId: pick, reason: why || undefined }), "Door assigned").then(() => setProp(null))}>Assign</button></Sec>}
    {u.reefer && rf && <Sec t="Reefer" right={<span className={"tag " + (rf.alarms.length ? "t-bad" : "t-ok")}>{rf.temp}°C ({rf.deviation > 0 ? "+" : ""}{rf.deviation})</span>}>
      <div className="row"><label className="row">Setpoint <input className="ctl m" style={{ width: 64 }} type="number" defaultValue={rf.setpoint} onBlur={(e) => +e.target.value !== rf.setpoint && act(() => post(`/ops/reefers/${u.id}`, { setpoint: +e.target.value }), "Setpoint saved")} /></label>
        <select className="ctl" value={rf.plug ?? ""} onChange={(e) => act(() => post(`/ops/reefers/${u.id}`, { plug: e.target.value || null }), e.target.value ? "Plugged into " + e.target.value : "Unplugged")} aria-label="Plug"><option value="">not plugged</option>{plugs.map((p) => <option key={p}>{p}</option>)}</select></div>
      {rf.alarms.length > 0 && <div className="mu" style={{ color: "var(--bad)" }}>{rf.alarms.join(" · ")}</div>}</Sec>}
  </div>;
}

// ---------------- reefer monitor (yard manager home) ----------------
export function ReeferMonitor() {
  const { openUnit } = useApp(); const [r, setR] = useState<{ unitId: string; number: string; location: string; setpoint: number; plug: string | null; temp: number; deviation: number; alarms: string[] }[]>([]);
  useEffect(() => { const f = () => get<{ units: typeof r }>("/ops/reefers").then((x) => setR(x.units)).catch(() => {}); void f(); const t = setInterval(f, 30000); return () => clearInterval(t); }, []);
  if (!r.length) return null; const bad = r.filter((x) => x.alarms.length);
  return <section className="panel"><header><Snowflake size={14} />Reefers <span className="meta">{r.length} on site · {bad.length} alarms · simulated telemetry feed</span></header>
    <div className="v12-reefers">{r.map((x) => <button key={x.unitId} className={"rf" + (x.alarms.length ? " bad" : "")} onClick={() => openUnit(x.unitId)} title={x.alarms.join(", ")}><span className="m">{x.number}</span><b>{x.temp}°</b><small>set {x.setpoint}° · {x.plug ?? "no plug"}</small></button>)}</div></section>;
}

// ---------------- staging queue (dock) ----------------
export function Staging() {
  const { d, run, reload } = useApp(); const [q, setQ] = useState<{ unitId: string; number: string; location: string; hot: boolean; slot: string | null; apptRef: string | null; pending: boolean }[]>([]);
  const load = () => get<typeof q>("/planning/staging").then(setQ).catch(() => {}); useEffect(() => { void load(); }, [d.tasks.length]); // eslint-disable-line
  const free = d.doors.filter((x) => x.state === "free");
  return <div className="v12"><p className="mu">Outbound units waiting in the yard. Hot loads first, then by appointment slot.</p>
    <table className="t"><tbody>{q.map((x) => <tr key={x.unitId}><td>{x.hot && <span className="tag t-late">HOT</span>}</td><td className="m">{x.number}</td><td className="m">{x.location}</td><td className="m">{x.slot ? fmtTime(x.slot) : "–"}</td>
      <td className="actions">{x.pending ? <span className="mu">move queued</span> : free[0] && <button className="btn sm" onClick={() => run(async () => { await post(`/planning/staging/${x.unitId}`, { to: free[0].label }); await reload(); await load(); }, `${x.number} staged to ${free[0].label}`)}>Stage to {free[0].label}</button>}</td></tr>)}</tbody></table>
    {!q.length && <div className="empty-note">No outbound units waiting.</div>}</div>;
}

// ---------------- planning (carrier screen): import, cut-off, amendments, driver link ----------------
type Rep = { file: string; committed: boolean; total: number; valid: number; invalid: number; rows: { row: number; ok: boolean; ref?: string; errors: string[]; data: Record<string, string> }[] };
type Am = { id: string; ref: string; change: Record<string, unknown>; reason: string; state: string; by: string; at: string };
export function Planning() {
  const { d, run, reload, user, can } = useApp(); const mgr = can("yard:write");
  const [file, setFile] = useState<File | null>(null); const [rep, setRep] = useState<Rep | null>(null); const [am, setAm] = useState<Am[]>([]); const [st, setSt] = useState<{ cutoffEnabled: boolean; cutoff: string; frozenTomorrow: boolean } | null>(null);
  const [form, setForm] = useState({ appointmentId: "", reason: "", slotStart: "", cancel: false });
  const load = () => { void get<Am[]>("/planning/amendments").then(setAm).catch(() => {}); void get<typeof st>("/planning/settings").then(setSt).catch(() => {}); }; useEffect(load, []);
  const send = async (commit: boolean) => { if (!file) return; const f = new FormData(); f.append("file", file); const r = await upload<Rep>(`/planning/import${commit ? "?commit=1" : ""}`, f).catch((e) => { alert(e.message); return null; }); if (r) { setRep(r); if (commit) await reload(); } };
  const mine = d.appointments.filter((a) => (user.role !== "carrier" || a.carrierId === user.carrierId) && (a.status === "booked" || a.status === "late"));
  return <div className="v12">
    {st && <div className={"v12-cut" + (st.frozenTomorrow ? " on" : "")}><Timer size={14} />{st.cutoffEnabled ? <>Daily cut-off {st.cutoff}. {st.frozenTomorrow ? "Tomorrow's plan is frozen: changes need an amendment." : "Tomorrow's plan is still open."}</> : "No daily cut-off set for this site."}</div>}
    {can("appt:write") && user.role !== "carrier" && <Sec t="Import appointments" right={<a className="btn sm ghost" href={`/v1/planning/template.csv?token=${localStorage.getItem("yms.token")}`}>Template</a>}>
      <div className="row"><label className="btn"><FileSpreadsheet size={14} />{file ? file.name : "Choose CSV or Excel"}<input type="file" accept=".csv,.xlsx" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRep(null); }} /></label>
        <button className="btn" disabled={!file} onClick={() => void send(false)}><Upload size={14} />Validate</button><button className="btn pri" disabled={!file || !rep || rep.committed || !rep.valid} onClick={() => void send(true)}>Book {rep?.valid ?? 0} valid rows</button></div>
      {rep && <><div className="mu">{rep.total} rows · <b style={{ color: "var(--ok)" }}>{rep.valid} valid</b> · <b style={{ color: rep.invalid ? "var(--bad)" : undefined }}>{rep.invalid} with errors</b>{rep.committed && " · booked"}</div>
        <div className="scroll" style={{ maxHeight: 260 }}><table className="t"><thead><tr><th>Row</th><th>Carrier</th><th>Date</th><th>Time</th><th>Result</th></tr></thead><tbody>{rep.rows.map((r) => <tr key={r.row}><td className="m">{r.row}</td><td>{r.data.carrier}</td><td className="m">{r.data.date}</td><td className="m">{r.data.time}</td>
          <td>{r.ok ? <span className="tag t-ok">{r.ref ?? "ok"}</span> : <span style={{ color: "var(--bad)" }}>{r.errors.join("; ")}</span>}</td></tr>)}</tbody></table></div></>}
    </Sec>}
    <Sec t="Request an amendment" right={<span className="mu">for appointments inside the cut-off</span>}>
      <div className="form two"><label>Appointment<select className="ctl" value={form.appointmentId} onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}><option value="">Pick…</option>{mine.map((a) => <option key={a.id} value={a.id}>{a.ref} · {fmtTime(a.slotStart)}</option>)}</select></label>
        <label>New time<input className="ctl" type="datetime-local" disabled={form.cancel} value={form.slotStart} onChange={(e) => setForm({ ...form, slotStart: e.target.value })} /></label>
        <label>Reason<input className="ctl" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label><label className="row"><input type="checkbox" checked={form.cancel} onChange={(e) => setForm({ ...form, cancel: e.target.checked })} />Cancel instead</label></div>
      <button className="btn" disabled={!form.appointmentId || form.reason.trim().length < 3 || (!form.cancel && !form.slotStart)} onClick={() => run(async () => { await post("/planning/amendments", { appointmentId: form.appointmentId, reason: form.reason, change: form.cancel ? { cancel: true } : { slotStart: new Date(form.slotStart).toISOString() } }); setForm({ appointmentId: "", reason: "", slotStart: "", cancel: false }); load(); }, "Amendment requested")}>Request</button>
    </Sec>
    <Sec t="Amendments" right={<span className="mu">{am.filter((a) => a.state === "pending").length} pending</span>}>
      <table className="t"><tbody>{am.map((a) => <tr key={a.id}><td className="m">{a.ref}</td><td>{a.change.cancel ? "cancel" : a.change.slotStart ? "move to " + fmtTime(String(a.change.slotStart)) : JSON.stringify(a.change)}</td><td className="mu">{a.reason}</td><td><span className={"tag " + (a.state === "approved" ? "t-ok" : a.state === "rejected" ? "t-bad" : "t-late")}>{a.state}</span></td>
        <td className="actions">{mgr && a.state === "pending" && <><button className="btn sm ok" onClick={() => run(async () => { await post(`/planning/amendments/${a.id}/approve`); await reload(); load(); }, "Amendment approved")}>Approve</button><button className="btn sm" onClick={() => run(async () => { await post(`/planning/amendments/${a.id}/reject`); load(); }, "Amendment rejected")}>Reject</button></>}</td></tr>)}</tbody></table>
      {!am.length && <div className="empty-note">None yet.</div>}</Sec>
  </div>;
}
export function DriverLink({ apptId }: { apptId?: string }) {
  const { d, run } = useApp(); const [id, setId] = useState(apptId ?? ""); const [phone, setPhone] = useState(""); const [lang, setLang] = useState("en"); const [url, setUrl] = useState("");
  const [docs, setDocs] = useState<{ id: string; kind: string; name: string; status: string }[]>([]);
  useEffect(() => { if (id) void get<typeof docs>(`/driver/docs/${id}`).then(setDocs).catch(() => setDocs([])); }, [id]);
  const open = d.appointments.filter((a) => a.status === "booked" || a.status === "late");
  return <div className="v12"><p className="mu">Drivers need no app: the link opens a status page with queue position, door and instructions in their language, and takes BOL, ID and permit uploads.</p>
    <div className="form two"><label>Appointment<select className="ctl" value={id} onChange={(e) => setId(e.target.value)}><option value="">Pick…</option>{open.map((a) => <option key={a.id} value={a.id}>{a.ref} · {fmtTime(a.slotStart)}{(a as { precheck?: unknown }).precheck ? " · checked in" : ""}</option>)}</select></label>
      <label>Language<select className="ctl" value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="fr">Français</option><option value="sw">Kiswahili</option></select></label>
      <label>Driver mobile (SMS)<input className="ctl m" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+257…" /></label></div>
    <button className="btn pri" disabled={!id} onClick={() => run(async () => { const r = await post<{ url: string }>("/driver/links", { appointmentId: id, phone: phone || undefined, lang, base: location.origin }); setUrl(location.origin + r.url + "?lang=" + lang); }, phone ? "Link sent by SMS" : "Link created")}><Send size={14} />{phone ? "Send SMS link" : "Create link"}</button>
    {url && <div className="v12-url"><a href={url} target="_blank" rel="noreferrer">{url.slice(0, 64)}…</a><button className="btn sm" onClick={() => void navigator.clipboard?.writeText(url)}>Copy</button></div>}
    {docs.length > 0 && <Sec t="Driver documents">{docs.map((x) => <div key={x.id} className="row"><span className="tag t-idle">{x.kind}</span><a href={`/v1/driver/docs/${id}/${x.id}/file?token=${localStorage.getItem("yms.token")}`} target="_blank" rel="noreferrer">{x.name}</a><span className="mu">{x.status}</span>
      {x.status === "received" && <><button className="btn sm ok" onClick={() => run(async () => { await post(`/driver/docs/${id}/${x.id}/accepted`); setDocs(docs.map((y) => y.id === x.id ? { ...y, status: "accepted" } : y)); }, "Accepted")}>Accept</button><button className="btn sm" onClick={() => run(async () => { await post(`/driver/docs/${id}/${x.id}/rejected`); setDocs(docs.map((y) => y.id === x.id ? { ...y, status: "rejected" } : y)); }, "Rejected")}>Reject</button></>}</div>)}</Sec>}
  </div>;
}

// ---------------- live accrual (detention) ----------------
type Acc = { unitId: string; number: string; carrierId: string; profileId: string; kind: string; elapsedH: number; pausedHoldH: number; pausedCalendarH: number; chargeableH: number; freeHours: number; billableH: number; rate: number; currency: string; amount: number; capped: boolean };
export function Accrual() {
  const { run, reload, carrier, can } = useApp(); const [a, setA] = useState<Acc[]>([]); const [p, setP] = useState<{ id: string; name: string; kind: string; freeHours: number; rate: number; roundingMinutes: number; roundMode: string; holidays: string[]; pauseOnHold: boolean; excludeWeekends: boolean; carrierId?: string; capAmount?: number }[]>([]);
  const load = () => { void get<Acc[]>("/detention/accrual").then(setA); void get<typeof p>("/detention/profiles").then(setP); }; useEffect(load, []);
  const bill = a.filter((x) => x.amount > 0).sort((x, y) => y.amount - x.amount);
  return <div className="v12"><p className="mu">Calculated live from dwell with the charge profiles below. Holds and holidays pause the clock. Writing them creates <b>indicative</b> charges only; each still needs approval.</p>
    <div className="row"><b>{bill.length} accruing · {money(bill.reduce((s, x) => s + x.amount, 0))}</b>{can("detention:decide") && <button className="btn pri sm" onClick={() => run(async () => { const r = await post<{ created: number; updated: number; skippedDecided: number }>("/detention/accrual/sync"); await reload(); load(); return r; }, "Indicative charges updated")}>Write as indicative charges</button>}</div>
    <div className="scroll" style={{ maxHeight: 320 }}><table className="t"><thead><tr><th>Unit</th><th>Carrier</th><th>Profile</th><th className="num">Dwell</th><th className="num">Paused</th><th className="num">Free</th><th className="num">Billable</th><th className="num">Amount</th></tr></thead>
      <tbody>{bill.map((x) => <tr key={x.unitId}><td className="m">{x.number}</td><td>{carrier(x.carrierId)}</td><td className="mu">{x.profileId}</td><td className="num m">{fmtDur(x.elapsedH)}</td><td className="num m">{x.pausedHoldH + x.pausedCalendarH ? fmtDur(x.pausedHoldH + x.pausedCalendarH) : "–"}</td><td className="num m">{x.freeHours}h</td><td className="num m">{x.billableH}h</td><td className="num m"><b>{money(x.amount)}</b>{x.capped && " (cap)"}</td></tr>)}</tbody></table></div>
    <Sec t="Charge profiles">{p.map((x) => <div key={x.id} className="v12-chk"><span><b>{x.name}</b> <span className="mu">{x.kind}{x.carrierId ? " · " + carrier(x.carrierId) : ""}</span></span><span className="mu m">{x.freeHours}h free · {x.rate}/h · round {x.roundMode} {x.roundingMinutes}m{x.capAmount != null ? " · cap " + x.capAmount : ""} · {x.holidays.length} holidays{x.pauseOnHold ? " · pause on hold" : ""}{x.excludeWeekends ? " · no weekends" : ""}</span></div>)}</Sec>
  </div>;
}

// ---------------- yard check (spotter) ----------------
type YC = { id: string; zoneIds: string[]; state: string; expected: Record<string, string | null>; observed: Record<string, string | null>; result?: { matched: number; missing: { slot: string; expected: string }[]; unexpected: { slot: string; observed: string; systemSlot?: string }[]; applied?: number } };
export function YardCheck() {
  const { d, run, reload } = useApp(); const [c, setC] = useState<YC | null>(null); const [zone, setZone] = useState(d.zones[0]?.id ?? ""); const [val, setVal] = useState<Record<string, string>>({});
  const load = () => get<YC[]>("/ops/checks").then((x) => setC(x.find((y) => y.state === "open") ?? x[0] ?? null)).catch(() => {}); useEffect(() => { void load(); }, []);
  const open = c?.state === "open";
  const scan = (slot: string, v: string | null) => run(async () => setC(await post<YC>(`/ops/checks/${c!.id}/scan`, { slot, unitNumber: v })), `${slot} recorded`);
  return <div className="v12">
    {!open && <div className="row"><select className="ctl" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">{d.zones.map((z) => <option key={z.id} value={z.id}>Zone {z.name}</option>)}</select><button className="btn pri" onClick={() => run(async () => setC(await post<YC>("/ops/checks", { zoneIds: [zone] })), "Yard check started")}><ScanSearch size={14} />Start yard check</button></div>}
    {c?.result && !open && <Sec t="Last check"><div className="mu">{c.result.matched} matched · {c.result.missing.length} missing · {c.result.unexpected.length} unexpected · {c.result.applied ?? 0} corrected</div>
      {c.result.missing.map((m) => <div key={m.slot} className="mu">Missing: {m.expected} at {m.slot}</div>)}{c.result.unexpected.map((m) => <div key={m.slot} className="mu">Seen {m.observed} at {m.slot}{m.systemSlot ? ` (system: ${m.systemSlot})` : ""}</div>)}</Sec>}
    {open && c && <><div className="mu">Walk the row. Confirm what is in each slot, type what you see, or mark it empty.</div>
      <div className="v12-check">{Object.entries(c.expected).map(([slot, exp]) => { const seen = slot in c.observed; const obs = c.observed[slot]; const ok = seen && obs === exp;
        return <div key={slot} className={"yc" + (seen ? (ok ? " ok" : " diff") : "")}><b className="m">{slot}</b><span className="m mu">{exp ?? "empty"}</span>
          {seen ? <span className="m">{obs ?? "empty"}</span> : <span className="row"><button className="btn sm ok" onClick={() => void scan(slot, exp)}>✓</button><input className="ctl m" style={{ width: 84 }} placeholder="seen…" value={val[slot] ?? ""} onChange={(e) => setVal({ ...val, [slot]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && void scan(slot, val[slot] || null)} /><button className="btn sm" onClick={() => void scan(slot, val[slot] || null)}>{val[slot] ? "Save" : "Empty"}</button></span>}</div>; })}</div>
      <div className="row"><button className="btn pri" onClick={() => run(async () => { setC(await post<YC>(`/ops/checks/${c.id}/close`, { apply: true })); await reload(); }, "Yard check reconciled")}>Close and apply corrections</button><button className="btn" onClick={() => run(async () => setC(await post<YC>(`/ops/checks/${c.id}/close`, { apply: false })), "Yard check closed")}>Close, report only</button></div></>}
  </div>;
}

// ---------------- admin settings: cut-off, placement, kiosk, templates ----------------
export function PlanningAdmin() {
  const { run } = useApp(); const [s, setS] = useState<{ cutoffEnabled: boolean; cutoff: string } | null>(null); const [rules, setRules] = useState<{ zones: { zone: string; reefer?: string; hazmat?: string; maxUnits?: number }[]; segregation: { a: string; b: string; minSlots: number }[]; hotPriority: boolean } | null>(null);
  const [kiosk, setKiosk] = useState(""); const [tpls, setTpls] = useState<Tpl[]>([]);
  useEffect(() => { void get<typeof s>("/planning/settings").then(setS); void get<typeof rules>("/planning/rules").then(setRules); void get<Tpl[]>("/evidence/templates").then(setTpls); }, []);
  if (!s || !rules) return null;
  return <div className="v12">
    <Sec t="Daily cut-off"><div className="row"><label className="row"><input type="checkbox" checked={s.cutoffEnabled} onChange={(e) => setS({ ...s, cutoffEnabled: e.target.checked })} />Freeze tomorrow's plan at</label><input className="ctl m" type="time" value={s.cutoff} onChange={(e) => setS({ ...s, cutoff: e.target.value })} /><button className="btn sm pri" onClick={() => run(() => put("/planning/settings", s), "Cut-off saved")}>Save</button></div></Sec>
    <Sec t="Placement rules" right={<button className="btn sm" onClick={() => setRules({ ...rules, zones: [...rules.zones, { zone: "" }] })}>Add zone rule</button>}>
      {rules.zones.map((z, i) => { const set = (p: object) => setRules({ ...rules, zones: rules.zones.map((x, k) => k === i ? { ...x, ...p } : x) }); return <div key={i} className="row"><input className="ctl" style={{ width: 70 }} placeholder="Zone" value={z.zone} onChange={(e) => set({ zone: e.target.value })} />
        <select className="ctl" value={z.reefer ?? ""} onChange={(e) => set({ reefer: e.target.value || undefined })}><option value="">reefer: any</option><option value="only">reefer only</option><option value="no">no reefers</option></select>
        <select className="ctl" value={z.hazmat ?? ""} onChange={(e) => set({ hazmat: e.target.value || undefined })}><option value="">hazmat: any</option><option value="only">hazmat only</option><option value="no">no hazmat</option></select>
        <input className="ctl" style={{ width: 70 }} type="number" placeholder="max" value={z.maxUnits ?? ""} onChange={(e) => set({ maxUnits: e.target.value ? +e.target.value : undefined })} /><button className="btn sm ghost" onClick={() => setRules({ ...rules, zones: rules.zones.filter((_, k) => k !== i) })}>Remove</button></div>; })}
      <div className="mu">Hazmat segregation (same zone, minimum slots apart): {rules.segregation.map((g) => `${g.a}↔${g.b} ${g.minSlots}`).join(" · ")}</div>
      <label className="row"><input type="checkbox" checked={rules.hotPriority} onChange={(e) => setRules({ ...rules, hotPriority: e.target.checked })} />Hot loads jump to priority 1</label>
      <button className="btn sm pri" onClick={() => run(async () => setRules(await put("/planning/rules", { ...rules, zones: rules.zones.filter((z) => z.zone) })), "Placement rules saved")}><Layers size={13} />Save rules</button></Sec>
    <Sec t="Gate kiosk"><div className="mu">Open this on the gatehouse tablet. Drivers check in with booking reference and plate; no staff login on the device.</div>
      <button className="btn sm" onClick={() => run(async () => { const r = await post<{ token: string }>("/driver/kiosk-token"); setKiosk(location.origin + "/?kiosk=" + r.token); }, "Kiosk link created")}>Create kiosk link</button>{kiosk && <div className="v12-url"><a href={kiosk} target="_blank" rel="noreferrer">{kiosk.slice(0, 60)}…</a></div>}</Sec>
    <Sec t="Inspection templates">{tpls.map((t) => <div key={t.id} className="v12-chk"><span><b>{t.name}</b> <span className="mu">{t.appliesTo}</span></span><span className="mu">{t.items.map((i) => i.label + (i.required ? "*" : "")).join(" · ")}</span></div>)}</Sec>
  </div>;
}
