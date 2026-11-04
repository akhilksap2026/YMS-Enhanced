import { useMemo, useState } from "react";
import { Route, Truck, Timer, DoorOpen, ClipboardList, Move, TriangleAlert, Snowflake, Flame, Lock, Layers, SlidersHorizontal, Check, Map as MapIcon } from "lucide-react";
import { useApp } from "../store";
import { fmtDur, fmtTime, hoursSince, money, post } from "../api";
import { Drawer, Spark, unitTone, TONE_TAG, TONE_LABEL } from "../ui";

const WIDGETS = ["flow", "kpis", "doors", "decide", "appts", "zones", "moves", "detention"] as const;
type W = (typeof WIDGETS)[number];
const WLABEL: Record<W, string> = { flow: "Site flow", kpis: "Key numbers", doors: "Doors", decide: "Needs a decision", appts: "Appointments", zones: "Zone occupancy", moves: "Move queue", detention: "Detention clock" };
const SRC: Record<string, string> = { sap: "SAP TM", otm: "Oracle OTM", native: "Native" };
const perHour = (isos: (string | undefined)[], hours = 12) => { const now = Date.now(); const b = Array(hours).fill(0); for (const x of isos) { if (!x) continue; const h = Math.floor((now - Date.parse(x)) / 3600e3); if (h >= 0 && h < hours) b[hours - 1 - h]++; } return b; };

export default function ControlTower() {
  const { d, run, carrier, unit, openUnit, go } = useApp();
  const [hidden, setHidden] = useState<W[]>(() => JSON.parse(localStorage.getItem("yms.tower.hidden") ?? "[]"));
  const [custom, setCustom] = useState(false);
  const show = (w: W) => !hidden.includes(w);
  const toggle = (w: W) => { const n = hidden.includes(w) ? hidden.filter((x) => x !== w) : [...hidden, w]; setHidden(n); localStorage.setItem("yms.tower.hidden", JSON.stringify(n)); };

  const m = useMemo(() => {
    const at = (re: RegExp) => d.units.filter((u) => re.test(u.location));
    const gate = d.units.filter((u) => u.location && !/^[ABCRH]\d|^D\d/.test(u.location));
    const yard = at(/^[ABCRH]\d/), dock = at(/^D\d/);
    const soon = Date.now() + 3600e3;
    const out = d.appointments.filter((a) => a.direction === "outbound" && ["booked", "late"].includes(a.status) && Date.parse(a.slotStart) < soon);
    const open = d.tasks.filter((t) => t.status !== "done");
    const link = (f: (from: string, to: string) => boolean) => open.filter((t) => f(t.from, t.to)).length;
    const onYard = d.units.filter((u) => u.location);
    const dwell = onYard.reduce((s, u) => s + hoursSince(u.gateInAt), 0) / Math.max(1, onYard.length);
    const usable = d.doors.filter((x) => x.state !== "blocked").length;
    const decided = d.appointments.filter((a) => ["arrived", "late", "no_show"].includes(a.status));
    const onTime = decided.length ? Math.round((decided.filter((a) => a.status === "arrived").length / decided.length) * 100) : 100;
    const exposure = d.charges.filter((c) => c.state === "indicative" || c.state === "under_review").reduce((s, c) => s + c.amount, 0);
    return { gate, yard, dock, out, open, dwell, usable, onTime, exposure, onYard,
      links: [link((f) => !/^[ABCRHD]\d/.test(f)), link((f, t) => /^[ABCRH]\d/.test(f) && /^D/.test(t)), link((f) => /^D/.test(f))],
      arrivals: perHour(d.units.map((u) => u.gateInAt)), doorSince: perHour(d.doors.map((x) => x.since), 8) };
  }, [d]);

  const stages = [
    { k: "GATE-IN", v: m.gate.length, u: "at gate / waiting", c: "var(--c-live)", sub: `${d.appointments.filter((a) => a.status === "booked" && Date.parse(a.slotStart) < Date.now() + 3600e3).length} due in 60 min`, chips: [["W", m.gate.length]] },
    { k: "YARD", v: m.yard.length, u: "parked", c: "var(--c-reefer)", sub: "avg dwell " + fmtDur(m.dwell), chips: ["A", "B", "C", "R", "H"].map((z) => [z, m.yard.filter((u) => u.location.startsWith(z)).length]) },
    { k: "DOCK", v: m.dock.length, u: "at doors", c: "var(--c-ok)", sub: `${m.usable - m.dock.length} doors free`, chips: [["In", m.dock.filter((u) => u.load === "loaded").length], ["Out", m.dock.filter((u) => u.load === "empty").length]] },
    { k: "GATE-OUT", v: m.out.length, u: "due in 60 min", c: "var(--c-acc)", sub: `${d.appointments.filter((a) => a.direction === "outbound" && a.status === "late").length} late`, chips: [["L4", m.out.length]] },
  ];
  const now = Date.now(), w0 = now - 3600e3, w1 = now + 4 * 3600e3; const xp = (t: number) => Math.max(0, Math.min(100, ((t - w0) / (w1 - w0)) * 100));
  const appts = d.appointments.filter((a) => a.status !== "cancelled" && Date.parse(a.slotEnd) > w0 && Date.parse(a.slotStart) < w1);
  const apptColor = (s: string) => s === "late" ? "var(--c-late)" : s === "no_show" ? "var(--c-bad)" : s === "arrived" ? "var(--c-ok)" : "var(--text-3)";
  const zoneStats = d.zones.map((z) => ({ n: z.name, used: z.slots.filter((s) => s.unitId).length + (z.kind === "waiting" ? m.gate.length : 0), cap: z.slots.length }));
  const det = Object.entries(d.charges.filter((c) => c.state === "indicative" || c.state === "under_review").reduce<Record<string, { n: number; h: number; a: number }>>((acc, c) => { const x = (acc[c.carrierId] ??= { n: 0, h: 0, a: 0 }); x.n++; x.h += c.billableHours; x.a += c.amount; return acc; }, {})).sort((a, b) => b[1].a - a[1].a);
  const sevIcon = (u?: ReturnType<typeof unit>) => u?.reefer ? Snowflake : u?.hazmat ? Flame : u?.status === "hold" || u?.status === "quarantine" ? Lock : TriangleAlert;

  return (<div className="tower">
    <div className="tower-bar"><span className="chip on">Ops lead view</span><span className="chip">Day shift · 06:00–14:00</span><span className="sp" />
      <button className="chip" onClick={() => go("map")}><MapIcon size={14} />Open yard map</button><button className="chip" onClick={() => setCustom(true)}><SlidersHorizontal size={14} />Customise</button></div>
    <div className="tg">
      {show("flow") && <section className="w flow enter"><h3><Route size={14} />Site flow · live<span className="r">counts from core · links show open moves</span></h3>
        <div className="flowrow">{stages.map((s, i) => <div className="fstage-wrap" key={s.k}>
          <div className="fstage" style={{ ["--c" as string]: s.c }}><div className="fk">{s.k}<span className="m" style={{ color: s.c }}>{s.sub}</span></div>
            <div className="fv"><b>{s.v}</b><span>{s.u}</span></div><div className="fchips">{s.chips.map(([l, n]) => <span key={l} className="m">{l} {n}</span>)}</div></div>
          {i < 3 && <div className="flink" style={{ ["--c" as string]: s.c }}><span className="m">{m.links[i]} moves</span><div className="track">{Array.from({ length: Math.max(1, Math.min(4, m.links[i])) }, (_, k) => <i key={k} style={{ animationDelay: `${-k * 0.7}s`, opacity: m.links[i] ? 1 : .25 }} />)}</div></div>}
        </div>)}</div></section>}
      {show("kpis") && <div className="kpis2">
        <Kpi I={Truck} l="On site" v={String(m.onYard.length)} s={`${m.arrivals.reduce((a, b) => a + b, 0)} gate-ins / 12 h`} data={m.arrivals} />
        <Kpi I={Timer} l="Avg dwell" v={fmtDur(m.dwell)} s="target < 24 h" bad={m.dwell > 24} data={m.arrivals.map((_, i) => m.dwell * (0.9 + (i % 3) * .04))} c="var(--c-late)" />
        <Kpi I={DoorOpen} l="Door utilisation" v={Math.round((m.dock.length / m.usable) * 100) + "%"} s={`${m.dock.length}/${m.usable} usable`} data={m.doorSince} />
        <Kpi I={ClipboardList} l="On-time arrivals" v={m.onTime + "%"} s={`${d.appointments.filter((a) => a.status === "late").length} late now`} bad={m.onTime < 85} data={perHour(d.appointments.filter((a) => a.status === "arrived").map((a) => a.slotStart))} c="var(--c-late)" />
        <Kpi I={Move} l="Open moves" v={String(m.open.length)} s={`${m.open.filter((t) => !t.assignee).length} unassigned`} data={perHour(m.open.map((t) => t.createdAt))} c="var(--c-live)" />
        <Kpi I={TriangleAlert} l="Detention exposure" v={money(m.exposure)} s="indicative · needs approval" data={det.map((x) => x[1].a).reverse().concat([m.exposure / 4])} c="var(--c-hold)" />
      </div>}
      {show("doors") && <section className="w wd-doors"><h3><DoorOpen size={14} />Doors<span className="r"><span className="tag t-ok">{m.dock.length} busy</span><span className="tag t-idle">{m.usable - m.dock.length} free</span><span className="tag t-bad">{d.doors.filter((x) => x.state === "blocked").length} blocked</span></span></h3>
        <div className="dg">{d.doors.map((x) => { const u = unit(x.unitId); const h = hoursSince(x.since); const long = x.state === "occupied" && h > 3; return (
          <button key={x.id} className={"dt " + x.state + (long ? " long" : "")} onClick={() => u && openUnit(u.id)} disabled={!u} title={u ? `${u.number} · ${fmtDur(h)}` : x.state}>
            <b className="m">{x.label}</b><span className="m">{u ? u.number.replace(/^TR-/, "").replace(/^[A-Z]{4}\s?\d{2}(\d{4}).*$/, "…$1") : x.state === "blocked" ? "fault" : "free"}</span>
            {u && <i style={{ width: Math.min(100, (h / 4) * 100) + "%" }} />}</button>); })}</div></section>}
      {show("decide") && <section className="w wd-decide"><h3><TriangleAlert size={14} />Needs a decision<span className="r">{d.exceptions.length} open</span></h3>
        <div className="scroll">{d.exceptions.slice(0, 8).map((x) => { const u = unit(x.unitId); const I = sevIcon(u); return (
          <div key={x.id} className="ex"><span style={{ color: x.severity === "high" ? "var(--c-bad)" : x.severity === "med" ? "var(--c-late)" : "var(--text-3)" }}><I size={15} /></span>
            <div style={{ minWidth: 0 }}><div className="ell">{x.text}</div><div className="mu ell" style={{ fontSize: 11 }}>{u ? `${u.location || "—"} · ${carrier(u.carrierId)} · ` : ""}{fmtTime(x.at)}</div></div>
            <span className="row" style={{ gap: 4 }}>{u && <button className="btn sm" onClick={() => openUnit(u.id)}>Open</button>}<button className="btn sm ghost" onClick={() => run(() => post(`/yard/exceptions/${x.id}/ack`), "Acknowledged")} aria-label="Acknowledge"><Check size={14} /></button></span></div>); })}
          {!d.exceptions.length && <div className="empty-note">Nothing needs a decision.</div>}</div></section>}
      {show("appts") && <section className="w wd-appts"><h3><ClipboardList size={14} />Appointments · −1 h to +4 h<span className="r">by source · {appts.length} in window</span></h3>
        <div className="gantt">{(["sap", "otm", "native"] as const).map((src) => { const rows = appts.filter((a) => a.source === src); return (
          <div key={src} className="gr"><span className="mu">{SRC[src]}</span><div className="lane">{rows.map((a, i) => { const l = xp(Date.parse(a.slotStart)), r = xp(Date.parse(a.slotEnd));
            return <span key={a.id} className="gb" title={`${a.ref} · ${carrier(a.carrierId)} · ${a.status}`} style={{ left: l + "%", width: Math.max(2, r - l) + "%", top: (i % 3) * 13, background: apptColor(a.status) }}>{a.ref.replace("APT-", "")}</span>; })}</div></div>); })}
          <div className="gr"><span /><div className="gaxis m mu">{[0, 1, 2, 3, 4, 5].map((k) => <span key={k}>{fmtTime(new Date(w0 + k * 3600e3).toISOString())}</span>)}</div></div>
          <div className="now" style={{ left: `calc(72px + (100% - 82px) * ${xp(now) / 100})` }}><span className="m">{fmtTime(new Date().toISOString())}</span></div>
          <div className="gleg">{[["booked", "var(--text-3)"], ["arrived", "var(--c-ok)"], ["late", "var(--c-late)"], ["no-show", "var(--c-bad)"]].map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div></div></section>}
      {show("zones") && <section className="w wd-zones"><h3><Layers size={14} />Zone occupancy</h3>
        <div style={{ paddingTop: 4 }}>{zoneStats.map((z) => { const p = Math.min(1, z.used / z.cap); const c = z.used > z.cap ? "var(--c-bad)" : p > .85 ? "var(--c-late)" : "var(--c-ok)"; return (
          <div key={z.n} className="zb"><b className="m">{z.n}</b><div className="tr"><span style={{ width: p * 100 + "%", background: c }} /></div><span className="m" style={{ textAlign: "right", color: z.used > z.cap ? "var(--bad)" : undefined }}>{z.used}/{z.cap}</span></div>); })}</div></section>}
      {show("moves") && <section className="w wd-moves"><h3><Route size={14} />Move queue<span className="r"><span className="tag t-live">{m.open.length} open</span></span></h3>
        <div className="scroll"><table><thead><tr><th>Unit</th><th>From → To</th><th>Spotter</th><th>Type</th><th className="r">Status</th></tr></thead><tbody>
          {m.open.slice().sort((a, b) => a.priority - b.priority).slice(0, 8).map((t) => { const u = unit(t.unitId); return (
            <tr key={t.id} className="click" onClick={() => u && openUnit(u.id)}><td className="m">{u?.number}</td><td className="m">{t.from} → {t.to}</td><td className={t.assignee ? "" : "mu"}>{t.assignee ?? "unassigned"}</td>
              <td>{u && <span className={"tag " + TONE_TAG[unitTone(u)]}>{u.reefer ? "reefer" : t.type}</span>}</td><td className="r m mu">{t.status.replace("_", " ")}</td></tr>); })}</tbody></table>
          {!m.open.length && <div className="empty-note">No open moves.</div>}</div></section>}
      {show("detention") && <section className="w wd-det"><h3><Timer size={14} />Detention clock · indicative<span className="r">approval required</span></h3>
        <div className="scroll"><table><thead><tr><th>Carrier</th><th>Charges</th><th>Billable</th><th className="r">Est.</th></tr></thead><tbody>
          {det.slice(0, 6).map(([cid, x]) => <tr key={cid} className="click" onClick={() => go("detention")}><td>{carrier(cid)}</td><td className="m">{x.n}</td><td className="m">{fmtDur(x.h)}</td><td className="r m">{money(x.a)}</td></tr>)}</tbody></table>
          {!det.length && <div className="empty-note">No charges awaiting review.</div>}</div></section>}
    </div>
    {custom && <Drawer title="Customise control tower" onClose={() => setCustom(false)}>
      <div style={{ padding: 12 }} className="grid"><span className="mu">Saved on this device for your view. Hidden widgets free up space for the rest.</span>
        {WIDGETS.map((w) => <label key={w} className="row chk2"><input type="checkbox" checked={show(w)} onChange={() => toggle(w)} />{WLABEL[w]}</label>)}</div></Drawer>}
  </div>);
}
function Kpi({ I, l, v, s, data, c, bad }: { I: typeof Truck; l: string; v: string; s: string; data: number[]; c?: string; bad?: boolean }) {
  return <div className="w kpi2"><div className="l"><I size={13} />{l}</div><div className="v">{v}<small className={bad ? "dn" : ""}>{s}</small></div><Spark data={data.length > 1 ? data : [0, 0]} color={c} /></div>;
}
export { TONE_LABEL };
