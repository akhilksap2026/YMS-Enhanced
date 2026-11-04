import { Sparkles, Clock, DoorOpen, AlertTriangle, FlaskConical } from "lucide-react";
import { useApp } from "../store";
import { fmtDur, hoursSince } from "../api";

/** AI tier preview. Output is computed from simple heuristics on live data and is labelled as illustrative. */
export default function AiPreview() {
  const { d, unit, go } = useApp();
  const dwell = d.units.filter((u) => u.location && u.gateInAt).map((u) => ({ u, h: hoursSince(u.gateInAt), p: Math.min(0.97, 0.35 + hoursSince(u.gateInAt) / 120 + (u.reefer ? 0.15 : 0)) })).sort((a, b) => b.p - a.p).slice(0, 8);
  const free = d.doors.filter((x) => x.state === "free");
  const sugg = d.units.filter((u) => /^[ABC]\d/.test(u.location) && u.load === "loaded" && u.status !== "hold").sort((a, b) => hoursSince(b.gateInAt) - hoursSince(a.gateInAt)).slice(0, free.length).map((u, i) => ({ u, door: free[i] }));
  const anomalies = d.units.filter((u) => u.location && ((u.reefer && u.status === "hold") || hoursSince(u.gateInAt) > 48)).sort((a, b) => hoursSince(b.gateInAt) - hoursSince(a.gateInAt)).slice(0, 8);
  return <div className="ai-prev">
    <div className="ph"><h1><Sparkles size={18} /> AI insights</h1><span className="tag t-live preview-tag"><FlaskConical size={12} />PREVIEW · illustrative output, not live models</span></div>
    <p className="hint">The AI tier is an optional add-on that plugs into the same event stream. Nothing here changes data on its own: every suggestion needs a person to accept it.</p>
    <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      <section className="panel"><header><Clock size={14} />Detention risk (next 24 h)</header><table className="t"><tbody>{dwell.map(({ u, h, p }) =>
        <tr key={u.id} className="click" onClick={() => go("map", u.id)}><td className="mono">{u.number}</td><td className="num mono">{fmtDur(h)}</td><td className="num"><span className="bar"><i style={{ width: p * 100 + "%" }} /></span></td><td className="num mono">{Math.round(p * 100)}%</td></tr>)}</tbody></table></section>
      <section className="panel"><header><DoorOpen size={14} />Suggested door assignments</header><table className="t"><tbody>{sugg.length ? sugg.map(({ u, door }) =>
        <tr key={u.id}><td className="mono">{u.number}</td><td>→ <b className="mono">{door.label}</b></td><td className="mu">longest wait, loaded</td><td className="actions"><button className="btn sm" onClick={() => go("dock")}>Review</button></td></tr>) : <tr><td className="mu">No free doors right now.</td></tr>}</tbody></table></section>
      <section className="panel"><header><AlertTriangle size={14} />Anomalies</header><table className="t"><tbody>{anomalies.map((u, n) =>
        <tr key={u.id + n}><td className="mono">{unit(u.id)?.number}</td><td className="mu">{u.reefer && u.status === "hold" ? "Reefer held: temperature risk" : `Dwell ${fmtDur(hoursSince(u.gateInAt))}, well above site median`}</td></tr>)}</tbody></table></section>
    </div>
  </div>;
}
