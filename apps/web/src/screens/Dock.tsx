import { useState } from "react";
import { useApp } from "../store";
import { fmtDur, hoursSince, post } from "../api";

export default function Dock() {
  const { d, run, carrier, unit, query } = useApp();
  const [over, setOver] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const candidates = d.units.filter((u) => u.location && !u.location.startsWith("D") && u.status !== "quarantine" && !u.location.startsWith("H"))
    .filter((u) => !query || u.number.includes(query.toUpperCase()))
    .sort((a, b) => (a.status === "hold" ? 1 : 0) - (b.status === "hold" ? 1 : 0) || hoursSince(b.gateInAt) - hoursSince(a.gateInAt));
  const assign = (doorId: string, unitId: string) => { setPick(null); return run(() => post(`/dock/doors/${doorId}/assign`, { unitId }), `${unit(unitId)?.number} → ${d.doors.find((x) => x.id === doorId)?.label}`); };
  const free = d.doors.filter((x) => x.state === "free");

  return (<>
    <div className="ph"><h1>Door board</h1><span className="meta">{d.doors.filter((x) => x.state === "occupied").length} occupied · {free.length} free · drag a unit onto a free door, or select a unit then click a door</span></div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 360px" }}>
      <section className="panel"><header>Doors</header>
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
      <section className="panel"><header>Waiting for a door <span className="meta">{candidates.length} · longest dwell first</span></header>
        <div className="scroll" style={{ maxHeight: "calc(100vh - 140px)" }}>
          <table className="t"><thead><tr><th>Unit</th><th>Carrier</th><th>At</th><th className="num">Dwell</th><th /></tr></thead>
            <tbody>{candidates.map((u) => { const blocked = u.status === "hold"; return (
              <tr key={u.id} className={pick === u.id ? "sel" : ""} draggable={!blocked} onDragStart={(e) => e.dataTransfer.setData("text/unit", u.id)} style={{ opacity: blocked ? 0.55 : 1 }}>
                <td className={`mono ${blocked ? "" : "drag"}`}>{u.number}{u.reefer ? " R" : ""}{u.hazmat ? " HZ" : ""}</td><td>{carrier(u.carrierId)}</td><td className="mono">{u.location}</td>
                <td className="num mono">{fmtDur(hoursSince(u.gateInAt))}</td>
                <td className="actions">{blocked ? <span className="pill s-hold">hold</span> :
                  <><button className="btn sm" onClick={() => setPick(pick === u.id ? null : u.id)}>{pick === u.id ? "Cancel" : "Select"}</button>
                    <button className="btn sm" disabled={!free.length} onClick={() => assign(free[0].id, u.id)} title="Assign to first free door">{free[0] ? "→ " + free[0].label : "No door"}</button></>}</td></tr>); })}</tbody></table>
        </div>
      </section>
    </div>
  </>);
}
