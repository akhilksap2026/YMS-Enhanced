import { Fragment, useCallback, useEffect, useState } from "react";
import { Plug, RefreshCw, RotateCcw, Copy, KeyRound, CheckCircle2, XCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useApp } from "../store";
import { get, post, put, fmtTime } from "../api";

type Sys = "otm" | "sap" | "erp" | "wms";
interface Cfg { enabled: boolean; endpoint: string; username: string; password: string; inboundKey: string; domain: string; maxAttempts: number; retryBaseMs: number; timeoutMs: number }
interface SysInfo { system: Sys; config: Cfg; stats: { pending: number; sent: number; dead: number; received: number; rejected: number; lastOk?: string }; inboundUrl?: string }
interface Msg { id: string; system: Sys; direction: "in" | "out"; type: string; idemKey: string; status: string; attempts: number; nextAt: string; lastError?: string; httpStatus?: number; createdAt: string; doneAt?: string; ref?: string; body: string }
const NAMES: Record<Sys, [string, string]> = { otm: ["Oracle OTM", "GLog XML · shipments & appointments in, yard events out"], sap: ["SAP TM / EWM", "OData / IDoc JSON · freight orders in, yard events out"], erp: ["ERP billing", "Approved detention charges (REST push)"], wms: ["WMS", "Door occupied / released events"] };
const TONE: Record<string, string> = { sent: "ok", received: "ok", pending: "info", failed: "warn", dead: "bad", rejected: "bad", duplicate: "idle" };

export default function Integrations() {
  const { run } = useApp(); const [sys, setSys] = useState<SysInfo[]>([]); const [msgs, setMsgs] = useState<Msg[]>([]);
  const [f, setF] = useState<{ system: string; status: string }>({ system: "", status: "" }); const [open, setOpen] = useState<string | null>(null); const [edit, setEdit] = useState<Sys | null>(null);
  const load = useCallback(async () => { const [a, b] = await Promise.all([get<{ systems: SysInfo[] }>("/integrations"), get<Msg[]>(`/integrations/messages?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`)]); setSys(a.systems); setMsgs(b); }, [f]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [load]);
  const act = (fn: () => Promise<unknown>, m: string) => run(async () => { await fn(); await load(); }, m);
  return <div className="intg">
    <div className="ph"><h1><Plug size={18} /> Integrations</h1><span className="meta">Outbound queue retries with exponential backoff, then dead-letters · inbound transmissions are de-duplicated · runs locally</span>
      <span className="sp" /><button className="btn sm" onClick={() => act(() => post("/integrations/drain"), "Queue processed")}><RefreshCw size={13} />Process queue now</button></div>
    <div className="intg-cards">{sys.map((s) => <section key={s.system} className={"w intg-card" + (s.config.enabled ? " on" : "")}>
      <div className="ih"><b>{NAMES[s.system][0]}</b><span className={`pill s-${s.config.enabled ? "ok" : "idle"}`}>{s.config.enabled ? "enabled" : "off"}</span><span className="sp" />
        <button className="btn sm ghost" onClick={() => setEdit(edit === s.system ? null : s.system)}>{edit === s.system ? "Close" : "Configure"}</button></div>
      <small className="mu">{NAMES[s.system][1]}</small>
      <div className="ist"><span><em>{s.stats.pending}</em>queued</span><span><em>{s.stats.sent}</em>sent</span>{s.inboundUrl && <span><em>{s.stats.received}</em>received</span>}<span className={s.stats.dead ? "bad" : ""}><em>{s.stats.dead}</em>dead</span>{s.inboundUrl && <span className={s.stats.rejected ? "bad" : ""}><em>{s.stats.rejected}</em>rejected</span>}</div>
      <small className="mu m ell">{s.config.endpoint} · last OK {s.stats.lastOk ? fmtTime(s.stats.lastOk) : "never"}</small>
      {s.stats.dead > 0 && <button className="btn sm" onClick={() => act(() => post(`/integrations/retry-dead/${s.system}`), `Dead letters requeued for ${NAMES[s.system][0]}`)}><RotateCcw size={13} />Requeue {s.stats.dead} dead</button>}
      {edit === s.system && <CfgForm s={s} onSaved={load} />}
    </section>)}</div>
    <section className="panel"><header>Message log <span className="meta">{msgs.length} shown · newest first</span><span className="sp" />
      <select className="ctl sm" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })}><option value="">All systems</option>{(Object.keys(NAMES) as Sys[]).map((k) => <option key={k} value={k}>{NAMES[k][0]}</option>)}</select>
      <select className="ctl sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{Object.keys(TONE).map((k) => <option key={k}>{k}</option>)}</select></header>
      <div className="scroll"><table className="t"><thead><tr><th /><th>System</th><th>Type</th><th>Reference</th><th>Status</th><th className="num">Tries</th><th>Created</th><th>Next / done</th><th>Last error</th><th /></tr></thead>
        <tbody>{msgs.map((m) => <Fragment key={m.id}><tr className="click" onClick={() => setOpen(open === m.id ? null : m.id)}>
          <td>{m.direction === "in" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</td><td>{NAMES[m.system][0]}</td><td className="mono">{m.type}</td><td className="mono ell" style={{ maxWidth: 180 }}>{m.ref ?? m.idemKey}</td>
          <td><span className={`pill s-${TONE[m.status] ?? "idle"}`}>{m.status}</span></td><td className="num mono">{m.attempts}</td><td className="mono">{fmtTime(m.createdAt)}</td>
          <td className="mono">{m.doneAt ? fmtTime(m.doneAt) : m.status === "failed" ? "retry " + fmtTime(m.nextAt) : "–"}</td><td className="ell mu" style={{ maxWidth: 260 }}>{m.lastError}</td>
          <td className="actions">{m.direction === "out" && m.status !== "sent" && <button className="btn sm" onClick={(e) => { e.stopPropagation(); void act(() => post(`/integrations/messages/${m.id}/retry`), "Message requeued"); }}>Retry</button>}</td></tr>
          {open === m.id && <tr><td colSpan={10}><pre className="payload">{m.body}</pre></td></tr>}</Fragment>)}
          {!msgs.length && <tr><td colSpan={10} className="mu">No messages yet. Enable a system and its events will appear here.</td></tr>}</tbody></table></div></section>
  </div>;
}

function CfgForm({ s, onSaved }: { s: SysInfo; onSaved: () => Promise<void> }) {
  const { run, toast } = useApp(); const [c, setC] = useState(s.config); const [test, setTest] = useState<{ ok: boolean; status?: number; error?: string } | null>(null);
  const field = (k: keyof Cfg, l: string, type = "text") => <label>{l}<input className="ctl sm" type={type} value={String(c[k])} onChange={(e) => setC({ ...c, [k]: type === "number" ? Number(e.target.value) : e.target.value })} /></label>;
  return <div className="form intg-form">
    <label className="radio"><input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} /><span>Enabled</span></label>
    {field("endpoint", "Endpoint base URL")}<div className="two">{field("username", "Username")}{field("password", "Password", "password")}</div>
    {s.system === "otm" && field("domain", "OTM domain")}
    <div className="three">{field("maxAttempts", "Max attempts", "number")}{field("retryBaseMs", "Backoff base (ms)", "number")}{field("timeoutMs", "Timeout (ms)", "number")}</div>
    {s.inboundUrl && <div className="inb"><span className="mu">Inbound URL (POST, header <code>x-api-key</code>)</span>
      <code className="m">{location.origin + s.inboundUrl}</code>
      <span className="row"><code className="m ell">{c.inboundKey}</code><button className="btn icon ghost sm" title="Copy key" onClick={() => { void navigator.clipboard?.writeText(c.inboundKey); toast("Key copied"); }}><Copy size={13} /></button>
        <button className="btn sm ghost" onClick={() => run(async () => { const r = await post<{ inboundKey: string }>(`/integrations/config/${s.system}/rotate-key`); setC({ ...c, inboundKey: r.inboundKey }); }, "Inbound key rotated")}><KeyRound size={13} />Rotate</button></span></div>}
    <div className="row"><button className="btn sm pri" onClick={() => run(async () => { await put(`/integrations/config/${s.system}`, c); await onSaved(); }, "Integration saved")}>Save</button>
      <button className="btn sm" onClick={async () => setTest(await post(`/integrations/test/${s.system}`))}>Test connection</button>
      {test && (test.ok ? <span className="okm"><CheckCircle2 size={13} /> reachable ({test.status})</span> : <span className="warnm"><XCircle size={13} /> {test.error ?? "HTTP " + test.status}</span>)}</div>
  </div>;
}
