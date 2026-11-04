import { DrawerButton, Staging } from "../features/V12";
import { Layers } from "lucide-react";
import { useState } from "react";
import { DoorOpen, Timer, ArrowDownToLine, ArrowUpFromLine, Ban, Route, GanttChart } from "lucide-react";
import { useApp } from "../store";
import { fmtDur, fmtTime, hoursSince, post } from "../api";

export default function Dock() {
  const { d, run, carrier, unit, query } = useApp();
  const [over, setOver] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const candidates = d.units.filter((u) => u.location && !u.location.startsWith("D") && u.status !== "quarantine" && !u.location.startsWith("H"))
    .filter((u) => !query || u.number.includes(query.toUpperCase()))
    .sort((a, b) => (a.status === "hold" ? 1 : 0) - (b.status === "hold" ? 1 : 0) || hoursSince(b.gateInAt) - hoursSince(a.gateInAt));
  const assign = (doorId: string, unitId: string) => { setPick(null); return run(() => post(`/dock/doors/${doorId}/assign`, { unitId }), `${unit(unitId)?.number} → ${d.doors.find((x) => x.id === doorId)?.label}`); };
  const free = d.doors.filter((x) => x.state === "free");

  const occ = d.doors.filter((x) => x.state === "occupied"); const usable = d.doors.filter((x) => x.state !== "blocked").length;
  const avgTurn = occ.reduce((a, x) => a + hoursSince(x.since), 0) / Math.max(1, occ.length);
  const queued = d.tasks.filter((t) => t.status !== "done" && /^D\d/.test(t.to));
  const EST = 2; // planned door time (h) per queued move until real turn-time history is available
  const now = Date.now(), w0 = now - 5 * 3600e3, w1 = now + 4 * 3600e3, xp = (t: number) => Math.max(0, Math.min(100, ((t - w0) / (w1 - w0)) * 100));
  const ticks = Array.from({ length: 10 }, (_, i) => w0 + i * 3600e3);
  return (<div className="dock2">
    <div className="ph" style={{ gridColumn: "1 / -1" }}><h1>Door board</h1><span className="meta">{d.doors.filter((x) => x.state === "occupied").length} occupied · {free.length} free · drag a unit onto a free door, or select a unit then click a door</span><div className="act"><DrawerButton icon={<Layers size={14} />} label="Staging queue">{() => <Staging />}</DrawerButton></div></div>
      <section className="panel dock-doors" data-tour="dock"><header>Doors</header>
        <div className="body doors">{d.doors.map((x) => { const u = unit(x.unitId); const h = hoursSince(x.since); return (
          <div key={x.id} className={`door ${x.state} ${over === x.id ? "over" : ""}`}
            onDragOver={(e) => { if (x.state === "free") { e.preventDefault(); setOver(x.id); } }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { setOver(null); assign(x.id, e.dataTransfer.getData("text/unit")); }}
            onClick={() => { if (pick && x.state === "free") assign(x.id, pick); }} style={{ cursor: pick && x.state === "free" ? "pointer" : undefined }}>
            <div className="dh"><span className="mono">{x.label}</span><span className={`pill s-${x.state === "occupied" ? (h > 3 ? "warn" : "info") : x.state === "blocked" ? "bad" : "idle"}`}>{x.state === "occupied" && h > 3 ? "long" : x.state}</span></div>
            {u ? <><span className="mono">{u.number}</span><span style={{ color: "var(--text-3)", fontSize: 11 }}>{carrier(u.carrierId)} · {u.load} · {fmtDur(h)}</span>
              <button className="btn sm" style={{ marginTop: "auto" }} onClick={(e) => { e.stopPropagation(); run(() => post(`/dock/doors/${x.id}/release`), `${x.label} released`); }}>Release</button></>
              : x.state === "blocked" ? <span style={{ fontSize: 11 }}>Maintenance</span> : <span style={{ color: "var(--text-3)", fontSize: 11 }}>{pick ? "Click to assign" : "Drop unit here"}</span>}
          </div>); })}</div>
      </section>
      <section className="w dock-gantt"><h3><GanttChart size={14} />Door timeline · −5 h to +4 h<span className="r"><span className="lg2"><i className="a" />at door</span><span className="lg2"><i className="l" />over 3 h</span><span className="lg2"><i className="p" />planned (est. {EST} h)</span></span></h3>
        <div className="dgantt">
          <div className="dg-axis"><span />{ticks.map((t) => <span key={t} className="m" style={{ left: xp(t) + "%" }}>{fmtTime(new Date(t).toISOString())}</span>)}</div>
          {d.doors.map((x) => { const u = unit(x.unitId); const st = x.since ? Date.parse(x.since) : 0; const long = hoursSince(x.since) > 3; const plans = queued.filter((t) => t.to === x.label);
            return <div key={x.id} className="dg-row"><b className="m">{x.label}</b><div className="dg-lane">
              {x.state === "blocked" && <span className="dg-bar blocked" style={{ left: 0, width: "100%" }}>maintenance</span>}
              {u && <span className={"dg-bar " + (long ? "long" : "act")} title={`${u.number} since ${fmtTime(x.since)}`} style={{ left: xp(st) + "%", width: xp(now) - xp(st) + "%" }}>{u.number} · {u.load === "loaded" ? "unload" : "load"}</span>}
              {plans.map((t, i) => { const s0 = Math.max(now, u ? now + 0.5 * 3600e3 : now) + i * EST * 3600e3; return <span key={t.id} className="dg-bar plan" style={{ left: xp(s0) + "%", width: xp(s0 + EST * 3600e3) - xp(s0) + "%" }}>{unit(t.unitId)?.number ?? t.unitId} · {t.status.replace("_", " ")}</span>; })}
            </div></div>; })}
          <div className="dg-now" style={{ left: `calc(44px + (100% - 44px) * ${xp(now) / 100})` }} />
        </div>
        <p className="hint" style={{ padding: "0 12px 8px" }}>Bars to the left of the line are actual time at the door. Planned bars come from queued moves using a fixed {EST} h estimate until turn-time history is collected.</p>
      </section>
      <aside className="dock-side">
        <div className="kgrid">
          <Kp I={DoorOpen} l="Door utilisation" v={Math.round((occ.length / Math.max(1, usable)) * 100) + "%"} s={`${occ.length}/${usable} usable`} />
          <Kp I={Timer} l="Avg time at door" v={fmtDur(avgTurn)} s={`${occ.filter((x) => hoursSince(x.since) > 3).length} over 3 h`} bad={avgTurn > 3} />
          <Kp I={ArrowDownToLine} l="Unloading" v={String(occ.filter((x) => unit(x.unitId)?.load === "loaded").length)} s="loaded units at doors" />
          <Kp I={ArrowUpFromLine} l="Loading" v={String(occ.filter((x) => unit(x.unitId)?.load === "empty").length)} s="empties at doors" />
          <Kp I={Route} l="Moves to doors" v={String(queued.length)} s={`${queued.filter((t) => !t.assignee).length} unassigned`} />
          <Kp I={Ban} l="Blocked" v={String(d.doors.filter((x) => x.state === "blocked").length)} s={d.doors.filter((x) => x.state === "blocked").map((x) => x.label).join(", ") || "none"} bad={d.doors.some((x) => x.state === "blocked")} />
        </div>
      <section className="panel dock-wait"><header>Waiting for a door <span className="meta">{candidates.length} · longest dwell first</span></header>
        <div className="scroll">
          <table className="t"><thead><tr><th>Unit</th><th>Carrier</th><th>At</th><th className="num">Dwell</th><th /></tr></thead>
            <tbody>{candidates.map((u) => { const blocked = u.status === "hold"; return (
              <tr key={u.id} className={pick === u.id ? "sel" : ""} draggable={!blocked} onDragStart={(e) => e.dataTransfer.setData("text/unit", u.id)} style={{ opacity: blocked ? 0.55 : 1 }}>
                <td className={`mono ${blocked ? "" : "drag"}`}>{u.number}{u.reefer ? " R" : ""}{u.hazmat ? " HZ" : ""}</td><td>{carrier(u.carrierId)}</td><td className="mono">{u.location}</td>
                <td className="num mono">{fmtDur(hoursSince(u.gateInAt))}</td>
                <td className="actions">{blocked ? <span className="pill s-hold">hold</span> :
                  <><button className="btn sm" onClick={() => setPick(pick === u.id ? null : u.id)}>{pick === u.id ? "Cancel" : "Select"}</button>
                    <button className="btn sm" disabled={!free.length} onClick={() => assign(free[0].id, u.id)} title="Assign to first free door">{free[0] ? "→ " + free[0].label : "No door"}</button></>}</td></tr>); })}</tbody></table>
        </div>
      </section></aside>
  </div>);
}
function Kp({ I, l, v, s, bad }: { I: typeof Timer; l: string; v: string; s: string; bad?: boolean }) {
  return <div className="w kp"><span className="l"><I size={13} />{l}</span><b className={bad ? "dn" : ""}>{v}</b><small className="mu ell">{s}</small></div>;
}
