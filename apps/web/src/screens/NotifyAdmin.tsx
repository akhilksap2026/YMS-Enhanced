import { useEffect, useState } from "react";
import { Send, Inbox } from "lucide-react";
import { useApp } from "../store";
import { get, post, put, fmtTime } from "../api";
type Lang = "en" | "fr" | "sw";
interface Cfg { language: Lang; email: { provider: string; host: string; port: number; secure: boolean; user: string; pass: string; from: string }; sms: { provider: string; url: string; token: string; from: string };
  routing: Record<string, { email?: string; sms?: string; language?: Lang }>; templates: Partial<Record<Lang, Record<string, { subject?: string; text: string }>>> }
interface Resp { config: Cfg; defaults: Record<Lang, Record<string, { subject: string; text: string }>>; kinds: string[]; languages: Lang[] }
interface Dl { id: string; at: string; channel: string; to: string; subject?: string; text: string; kind: string; lang: string; provider: string; status: string; error?: string }
const LN: Record<Lang, string> = { en: "English", fr: "Français", sw: "Kiswahili" };

export default function NotifyAdmin() {
  const { run } = useApp(); const [r, setR] = useState<Resp | null>(null); const [c, setC] = useState<Cfg | null>(null); const [dl, setDl] = useState<Dl[]>([]); const [tl, setTl] = useState<Lang>("en");
  const [test, setTest] = useState({ channel: "email", to: "ops@ksap.example", kind: "appointment" });
  const load = async () => { const x = await get<Resp>("/notifications/config"); setR(x); setC(structuredClone(x.config)); setDl(await get<Dl[]>("/notifications/deliveries")); };
  useEffect(() => { void load(); const t = setInterval(() => get<Dl[]>("/notifications/deliveries").then(setDl), 4000); return () => clearInterval(t); }, []);
  if (!r || !c) return null;
  const save = (m: string) => run(async () => { await put("/notifications/config", c); await load(); }, m);
  const tpl = (k: string) => c.templates[tl]?.[k]; const setTpl = (k: string, v: { subject?: string; text: string } | undefined) => { const t = { ...c.templates, [tl]: { ...(c.templates[tl] ?? {}) } }; if (v) t[tl]![k] = v; else delete t[tl]![k]; setC({ ...c, templates: t }); };
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
    <section className="panel"><header>Providers</header><div className="body form two">
      <label>E-mail provider<select className="ctl" value={c.email.provider} onChange={(e) => setC({ ...c, email: { ...c.email, provider: e.target.value } })}><option value="capture">Local mailbox (no external send)</option><option value="smtp">SMTP server</option></select></label>
      <label>Default language<select className="ctl" value={c.language} onChange={(e) => setC({ ...c, language: e.target.value as Lang })}>{r.languages.map((l) => <option key={l} value={l}>{LN[l]}</option>)}</select></label>
      {c.email.provider === "smtp" && <>{(["host", "port", "user", "pass", "from"] as const).map((k) => <label key={k}>SMTP {k}<input className="ctl" type={k === "pass" ? "password" : k === "port" ? "number" : "text"} value={String(c.email[k])} onChange={(e) => setC({ ...c, email: { ...c.email, [k]: k === "port" ? Number(e.target.value) : e.target.value } })} /></label>)}
        <label className="radio"><input type="checkbox" checked={c.email.secure} onChange={(e) => setC({ ...c, email: { ...c.email, secure: e.target.checked } })} /><span>TLS (port 465)</span></label></>}
      <label>SMS provider<select className="ctl" value={c.sms.provider} onChange={(e) => setC({ ...c, sms: { ...c.sms, provider: e.target.value } })}><option value="capture">Local mailbox</option><option value="console">Console log</option><option value="http">HTTP SMS gateway</option></select></label>
      {c.sms.provider === "http" ? <><label>Gateway URL<input className="ctl" value={c.sms.url} onChange={(e) => setC({ ...c, sms: { ...c.sms, url: e.target.value } })} /></label><label>API token<input className="ctl" type="password" value={c.sms.token} onChange={(e) => setC({ ...c, sms: { ...c.sms, token: e.target.value } })} /></label></> : <span />}
      <button className="btn pri" onClick={() => save("Providers saved")}>Save providers</button></div></section>
    <section className="panel"><header>Who gets what</header><table className="t"><thead><tr><th>Event</th><th>E-mail to</th><th>SMS to</th><th>Language</th></tr></thead><tbody>{r.kinds.filter((k) => k !== "password_reset").map((k) => { const v = c.routing[k] ?? {}; const set = (p: object) => setC({ ...c, routing: { ...c.routing, [k]: { ...v, ...p } } });
      return <tr key={k}><td className="mono">{k}</td><td><input className="ctl sm" value={v.email ?? ""} placeholder="none" onChange={(e) => set({ email: e.target.value || undefined })} /></td><td><input className="ctl sm" value={v.sms ?? ""} placeholder="none" onChange={(e) => set({ sms: e.target.value || undefined })} /></td>
        <td><select className="ctl sm" value={v.language ?? ""} onChange={(e) => set({ language: e.target.value || undefined })}><option value="">default</option>{r.languages.map((l) => <option key={l} value={l}>{l}</option>)}</select></td></tr>; })}</tbody></table>
      <div className="body"><button className="btn sm pri" onClick={() => save("Routing saved")}>Save routing</button></div></section>
    <section className="panel"><header>Templates <span className="sp" /><div className="seg">{r.languages.map((l) => <button key={l} className={tl === l ? "on" : ""} onClick={() => setTl(l)}>{LN[l]}</button>)}</div></header><div className="body form">
      {r.kinds.map((k) => { const d = r.defaults[tl][k]; const o = tpl(k); return <div key={k} className="tpl"><b className="mono">{k}</b>{o && <button className="btn sm ghost" onClick={() => setTpl(k, undefined)}>Reset to default</button>}
        <input className="ctl sm" placeholder={d.subject} value={o?.subject ?? ""} onChange={(e) => setTpl(k, { text: o?.text ?? d.text, subject: e.target.value || undefined })} />
        <textarea className="ctl" rows={2} placeholder={d.text} value={o?.text ?? ""} onChange={(e) => e.target.value ? setTpl(k, { ...o, text: e.target.value }) : setTpl(k, undefined)} /></div>; })}
      <p className="hint">Leave a field empty to use the built-in text (shown greyed). Placeholders: {"{{unit}} {{door}} {{ref}} {{site}} {{status}} {{time}} {{charge}} {{state}}"}.</p>
      <button className="btn pri" onClick={() => save("Templates saved")}>Save templates</button></div></section>
    <section className="panel"><header><Inbox size={14} />Local mailbox &amp; delivery log <span className="meta">{dl.length}</span></header>
      <div className="body row" style={{ display: "flex", gap: 6 }}><select className="ctl sm" value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value, to: e.target.value === "sms" ? "+25779000001" : "ops@ksap.example" })}><option value="email">E-mail</option><option value="sms">SMS</option></select>
        <input className="ctl sm" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} /><select className="ctl sm" value={test.kind} onChange={(e) => setTest({ ...test, kind: e.target.value })}>{r.kinds.map((k) => <option key={k}>{k}</option>)}</select>
        <button className="btn sm" onClick={() => run(async () => { const x = await post<Dl>("/notifications/test", test); setDl([x, ...dl]); if (x.status !== "sent") throw new Error(x.error ?? "failed"); }, "Test message sent")}><Send size={13} />Send test</button></div>
      <div className="scroll" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>Time</th><th>Ch.</th><th>To</th><th>Message</th><th>Via</th><th>Status</th></tr></thead><tbody>{dl.map((x) =>
        <tr key={x.id}><td className="mono">{fmtTime(x.at)}</td><td>{x.channel}</td><td className="mono ell" style={{ maxWidth: 150 }}>{x.to}</td><td className="ell" style={{ maxWidth: 280 }} title={x.text}>{x.subject ? <b>{x.subject} · </b> : null}{x.text}</td><td className="mu">{x.provider} · {x.lang}</td>
          <td><span className={`pill s-${x.status === "sent" ? "ok" : "bad"}`} title={x.error}>{x.status}</span></td></tr>)}</tbody></table></div></section>
  </div>;
}
