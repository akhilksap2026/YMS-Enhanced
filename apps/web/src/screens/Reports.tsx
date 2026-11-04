import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Timer, Repeat, DoorOpen, Receipt, Award } from "lucide-react";
import { useApp } from "../store";
import { get, download, money } from "../api";
type Kind = "dwell" | "turn" | "doors" | "detention" | "carriers";
type Row = Record<string, string | number>;
interface Rep { kpis: Record<string, number | string>; rows: Row[]; series?: Row[]; buckets?: Row[]; byCarrier?: Row[]; byState?: Row[]; hourly?: Row[] }
const TABS: [Kind, string, typeof Timer][] = [["dwell", "Dwell", Timer], ["turn", "Turn time", Repeat], ["doors", "Door utilisation", DoorOpen], ["detention", "Detention", Receipt], ["carriers", "Carrier scorecards", Award]];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS: [string, number][] = [["7 d", 7], ["30 d", 30], ["90 d", 90]];
const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/Pct$/, " %").replace(/^./, (c) => c.toUpperCase()).replace(/ %$/, " %");

/** Plain SVG bar chart; no chart library, follows theme tokens. */
function Bars({ data, x, y, unit = "", color = "var(--accent)", h = 150, max }: { data: Row[]; x: string; y: string; unit?: string; color?: string; h?: number; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => Number(d[y]) || 0)); const w = 100 / Math.max(1, data.length);
  return <div className="bars" style={{ height: h }}>
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h - 18} aria-hidden>{data.map((d, i) => { const v = Number(d[y]) || 0; const bh = (v / m) * (h - 26);
      return <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={h - 18 - bh} height={bh} fill={color} rx={0.6}><title>{`${d[x]}: ${v}${unit}`}</title></rect>; })}</svg>
    <div className="bx">{data.map((d, i) => <span key={i} style={{ width: w + "%" }}>{data.length > 16 && i % Math.ceil(data.length / 10) ? "" : String(d[x]).replace(/^\d{4}-/, "")}</span>)}</div></div>;
}
function Table({ rows, money: mcols = [] as string[], cur = "USD" }: { rows: Row[]; money?: string[]; cur?: string }) {
  const [sort, setSort] = useState<[string, 1 | -1] | null>(null); if (!rows.length) return <div className="empty-note">No data for this filter.</div>;
  const cols = Object.keys(rows[0]); const r = sort ? [...rows].sort((a, b) => (a[sort[0]] > b[sort[0]] ? 1 : -1) * sort[1]) : rows;
  return <div className="scroll" style={{ maxHeight: 420 }}><table className="t"><thead><tr>{cols.map((c) => <th key={c} onClick={() => setSort([c, sort?.[0] === c && sort[1] === 1 ? -1 : 1])} style={{ cursor: "pointer" }}>{label(c)}{sort?.[0] === c ? (sort[1] === 1 ? " ▲" : " ▼") : ""}</th>)}</tr></thead>
    <tbody>{r.slice(0, 500).map((x, i) => <tr key={i}>{cols.map((c) => { const v = x[c]; return <td key={c} className={typeof v === "number" ? "mono num" : c === "grade" ? "" : undefined}>
      {c === "grade" ? <span className={`pill s-${v === "A" ? "ok" : v === "B" ? "idle" : v === "C" ? "warn" : "bad"}`}>{v}</span> : mcols.includes(c) ? money(Number(v), cur) : /^\d{4}-\d\d-\d\dT/.test(String(v)) ? new Date(String(v)).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : String(v ?? "–")}</td>; })}</tr>)}</tbody></table></div>;
}
export default function Reports() {
  const { d, run, tenant } = useApp(); const [kind, setKind] = useState<Kind>(() => (new URLSearchParams(location.search).get("report") as Kind) || "turn");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 864e5))); const [to, setTo] = useState(iso(new Date())); const [carrierId, setCarrier] = useState(""); const [dir, setDir] = useState("");
  const [rep, setRep] = useState<Rep | null>(null); const [err, setErr] = useState("");
  const qs = useMemo(() => new URLSearchParams({ from, to, ...(carrierId ? { carrierId } : {}), ...(dir ? { direction: dir } : {}) }).toString(), [from, to, carrierId, dir]);
  useEffect(() => { let on = true; setErr(""); get<Rep>(`/reports/${kind}?${qs}`).then((r) => on && setRep(r)).catch((e) => on && (setErr(e.message), setRep(null))); return () => { on = false; }; }, [kind, qs]);
  const cur = String(rep?.kpis.currency ?? "USD"); const exp = (ext: "csv" | "xlsx") => run(() => download(`/reports/${kind}.${ext}?${qs}`, `yms-${kind}.${ext}`), `Exported ${ext.toUpperCase()}`);
  const k = rep?.kpis ?? {};
  const kpis: [string, string][] = kind === "dwell" ? [["On yard", String(k.onYard)], ["Average", k.avg + " h"], ["Median", k.median + " h"], ["90th pct", k.p90 + " h"], ["> 24 h now", String(k.over24)]]
    : kind === "turn" ? [["Visits", String(k.n)], ["Average", k.avg + " h"], ["Median", k.median + " h"], ["90th pct", k.p90 + " h"], ["Longest", k.max + " h"]]
    : kind === "doors" ? [["Doors", `${k.usable}/${k.doors} usable`], ["Avg utilisation", k.avgUtilisationPct + "%"], ["Door visits", String(k.visits)]]
    : kind === "detention" ? [["Charges", String(k.charges)], ["Indicative", money(Number(k.indicative ?? 0), cur)], ["Approved", money(Number(k.approved ?? 0), cur)]]
    : [["Carriers", String(k.carriers)], ["Appointments", String(k.appointments)], ["Avg on-time", k.avgOnTimePct + "%"]];
  return <div className="reports">
    <div className="ph"><h1>Reports</h1><span className="meta">{tenant?.site?.name ?? tenant?.siteConfig.siteName} · computed live from yard events</span><span className="sp" />
      <button className="btn sm" onClick={() => exp("csv")}><FileText size={14} />CSV</button><button className="btn sm pri" onClick={() => exp("xlsx")}><FileSpreadsheet size={14} />Excel</button></div>
    <div className="row filters">
      <div className="seg">{TABS.map(([id, l, I]) => <button key={id} className={kind === id ? "on" : ""} onClick={() => setKind(id)}><I size={14} />{l}</button>)}</div><span className="sp" />
      <div className="seg">{PRESETS.map(([l, n]) => <button key={l} className={from === iso(new Date(Date.now() - n * 864e5)) && to === iso(new Date()) ? "on" : ""} onClick={() => { setFrom(iso(new Date(Date.now() - n * 864e5))); setTo(iso(new Date())); }}>{l}</button>)}</div>
      <input className="ctl sm" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><span className="mu">–</span><input className="ctl sm" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      <select className="ctl sm" value={carrierId} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier"><option value="">All carriers</option>{d.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {kind !== "doors" && kind !== "detention" && <select className="ctl sm" value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Direction"><option value="">In + out</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select>}
    </div>
    {err && <div className="panel"><div className="body dn">{err}</div></div>}
    {rep && <>
      <div className="kpis2" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0,1fr))` }}>{kpis.map(([l, v]) => <div key={l} className="panel kpi2"><span className="l">{l}</span><span className="v">{v}</span></div>)}</div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", marginTop: 8 }}>
        {kind === "dwell" && <><section className="panel"><header>Dwell distribution <span className="meta">units on yard now</span></header><div className="body"><Bars data={rep.buckets!} x="label" y="onYard" color="var(--c-late)" /></div></section>
          <section className="panel"><header>Average dwell by carrier</header><div className="body"><Bars data={rep.byCarrier!.map((c) => ({ ...c, carrier: String(c.carrier).split(" ")[0] }))} x="carrier" y="avg" unit=" h" /></div></section></>}
        {kind === "turn" && <><section className="panel"><header>Average turn time per day <span className="meta">gate-in → gate-out, hours</span></header><div className="body"><Bars data={rep.series!} x="day" y="avg" unit=" h" /></div></section>
          <section className="panel"><header>Completed visits per day</header><div className="body"><Bars data={rep.series!} x="day" y="visits" color="var(--c-ok)" /></div></section></>}
        {kind === "doors" && <><section className="panel"><header>Utilisation per door <span className="meta">% of time occupied</span></header><div className="body"><Bars data={rep.rows} x="door" y="utilisationPct" unit="%" max={100} /></div></section>
          <section className="panel"><header>Busy hours <span className="meta">door-hours by hour of day</span></header><div className="body"><Bars data={rep.hourly!} x="hour" y="occupiedHours" unit=" h" color="var(--c-reefer)" /></div></section></>}
        {kind === "detention" && <><section className="panel"><header>Indicative amount by carrier <span className="meta">decision stays with you</span></header><div className="body"><Bars data={rep.byCarrier!.map((c) => ({ ...c, carrier: String(c.carrier).split(" ")[0] }))} x="carrier" y="amount" color="var(--c-late)" /></div></section>
          <section className="panel"><header>By review state</header><div className="body"><Bars data={rep.byState!} x="state" y="amount" /></div></section></>}
        {kind === "carriers" && <><section className="panel"><header>Score by carrier <span className="meta">60% on-time · 25% no-show · 15% turn</span></header><div className="body"><Bars data={rep.rows.map((c) => ({ ...c, carrier: String(c.carrier).split(" ")[0] }))} x="carrier" y="score" max={100} /></div></section>
          <section className="panel"><header>On-time vs no-show</header><div className="body"><Bars data={rep.rows.map((c) => ({ ...c, carrier: String(c.carrier).split(" ")[0] }))} x="carrier" y="noShowPct" unit="%" color="var(--c-bad)" /></div></section></>}
      </div>
      <section className="panel" style={{ marginTop: 8 }}><header>{kind === "carriers" ? "Scorecards" : kind === "detention" ? "Charges" : kind === "doors" ? "Doors" : kind === "dwell" ? "Units on yard (longest first)" : "Completed visits"} <span className="meta">{rep.rows.length} rows · click a header to sort</span></header>
        <Table rows={rep.rows} money={kind === "detention" ? ["amount", "rate"] : kind === "carriers" ? ["detention"] : []} cur={cur} /></section>
      {kind === "detention" && <p className="hint" style={{ marginTop: 6 }}>{String(k.note)}</p>}
    </>}
  </div>;
}
