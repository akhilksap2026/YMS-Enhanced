import { useApp } from "../store";
import { fmtDur, fmtTime, hoursSince, money, post } from "../api";

export default function ControlTower() {
  const { d, run, query, carrier, unit } = useApp();
  const onYard = d.units.filter((u) => u.location);
  const dwell = onYard.reduce((s, u) => s + hoursSince(u.gateInAt), 0) / Math.max(1, onYard.length);
  const occ = d.doors.filter((x) => x.state === "occupied").length; const usable = d.doors.filter((x) => x.state !== "blocked").length;
  const holds = d.units.filter((u) => u.status === "hold" || u.status === "quarantine").length;
  const openTasks = d.tasks.filter((t) => t.status !== "done").length;
  const risk = d.charges.filter((c) => c.state !== "rejected").reduce((s, c) => s + c.amount, 0);
  const late = d.appointments.filter((a) => a.status === "late").length;
  const q = query.trim().toUpperCase();
  const slotsTotal = d.zones.reduce((s, z) => s + z.slots.length, 0); const slotsUsed = d.zones.reduce((s, z) => s + z.slots.filter((x) => x.unitId).length, 0);

  return (<>
    <div className="ph"><h1>Control tower</h1><span className="meta">Riverside DC · refreshed {fmtTime(new Date().toISOString())} · auto 15s</span></div>
    <div className="kpis">
      <K l="Units on yard" v={String(onYard.length)} dd={`${slotsUsed}/${slotsTotal} slots · ${Math.round((slotsUsed / slotsTotal) * 100)}%`} />
      <K l="Avg dwell" v={fmtDur(dwell)} dd="target < 24h" cls={dwell > 24 ? "down" : "up"} />
      <K l="Doors occupied" v={`${occ}/${usable}`} dd={`${Math.round((occ / usable) * 100)}% utilisation`} />
      <K l="Holds / quarantine" v={String(holds)} dd="blocked from dispatch" cls={holds ? "down" : ""} />
      <K l="Open moves" v={String(openTasks)} dd={`${d.tasks.filter((t) => t.status === "open").length} unassigned`} />
      <K l="Detention exposure" v={money(risk)} dd={`indicative · ${late} late arrivals`} />
    </div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
      <section className="panel">
        <header>Yard map <span className="meta">{q ? `highlighting "${query}"` : "hover a slot for detail"}</span>
          <div className="r legend"><span><i className="slot ok" />OK</span><span><i className="slot warn" />Dwell &gt; 48h</span><span><i className="slot hold" />Hold</span><span><i className="slot quarantine" />Quarantine</span><span><i />Empty</span></div></header>
        <div className="body ymap">
          {d.zones.map((z) => (
            <div className="zone" key={z.id}>
              <div className="zl"><b>Zone {z.name}</b>{z.kind} · {z.slots.filter((s) => s.unitId).length}/{z.slots.length}</div>
              <div className="slots">{z.slots.map((s) => {
                const u = unit(s.unitId);
                const st = u ? (u.status === "ok" && hoursSince(u.gateInAt) > 48 ? "warn" : u.status) : "";
                const hl = q && u && (u.number.includes(q) || s.label === q);
                return <div key={s.id} className={`slot ${st} ${hl ? "hl" : ""}`} title={u ? `${s.label} · ${u.number} · ${carrier(u.carrierId)} · ${u.load}${u.reefer ? " · reefer" : ""}${u.hazmat ? " · " + u.hazmat : ""} · dwell ${fmtDur(hoursSince(u.gateInAt))}` : `${s.label} · empty`}>
                  {s.label}<br />{u ? u.number.replace(/\D/g, "").slice(-4) : ""}</div>;
              })}</div>
            </div>))}
        </div>
        <header style={{ borderTop: "1px solid var(--line)" }}>Longest dwell <span className="meta">top 8 · detention clock running</span></header>
        <table className="t"><thead><tr><th>Unit</th><th>Carrier</th><th>At</th><th>Load</th><th>Status</th><th className="num">Dwell</th><th className="num">Indicative</th></tr></thead>
          <tbody>{[...onYard].sort((a, b) => hoursSince(b.gateInAt) - hoursSince(a.gateInAt)).slice(0, 8).map((u) => { const c = d.charges.find((x) => x.unitId === u.id); return (
            <tr key={u.id}><td className="mono">{u.number}</td><td>{carrier(u.carrierId)}</td><td className="mono">{u.location}</td><td>{u.load}</td>
              <td><span className={`pill s-${u.status}`}>{u.status}</span></td><td className="num mono">{fmtDur(hoursSince(u.gateInAt))}</td><td className="num mono">{c ? money(c.amount) : "–"}</td></tr>); })}</tbody></table>
      </section>
      <div className="grid" style={{ alignContent: "start" }}>
        <section className="panel">
          <header>Exceptions <span className="meta">{d.exceptions.length} open</span></header>
          <div className="scroll" style={{ maxHeight: 300 }}>
            <table className="t"><tbody>{[...d.exceptions].sort((a, b) => "hml".indexOf(a.severity[0]) - "hml".indexOf(b.severity[0])).map((e) => (
              <tr key={e.id}><td style={{ padding: 0, width: 3 }}><div className={`sev sev-${e.severity}`} style={{ height: 28 }} /></td>
                <td style={{ maxWidth: 0, width: "100%", overflow: "hidden", textOverflow: "ellipsis" }} title={e.text}>{e.text}</td><td className="mono">{fmtTime(e.at)}</td>
                <td className="actions"><button className="btn sm" onClick={() => run(() => post(`/yard/exceptions/${e.id}/ack`), "Acknowledged")}>Ack</button></td></tr>))}</tbody></table>
          </div>
        </section>
        <section className="panel">
          <header>Door utilisation <span className="meta">{occ} occupied · {usable - occ} free</span></header>
          <table className="t"><tbody>{d.doors.map((x) => { const u = unit(x.unitId); const h = hoursSince(x.since); return (
            <tr key={x.id}><td className="mono" style={{ width: 36 }}>{x.label}</td>
              <td><span className={`pill s-${x.state === "occupied" ? "info" : x.state === "blocked" ? "bad" : "idle"}`}>{x.state}</span></td>
              <td className="mono">{u?.number ?? ""}</td><td className="num mono">{x.since ? fmtDur(h) : ""}</td>
              <td style={{ width: 60 }}>{x.since && <div className="bar"><i style={{ width: `${Math.min(100, (h / 4) * 100)}%`, background: h > 3 ? "var(--warn)" : undefined }} /></div>}</td></tr>); })}</tbody></table>
        </section>
      </div>
    </div>
  </>);
}
function K({ l, v, dd, cls = "" }: { l: string; v: string; dd: string; cls?: string }) {
  return <div className="kpi"><div className="l">{l}</div><div className="v">{v}</div><div className={`d ${cls}`}>{dd}</div></div>;
}
