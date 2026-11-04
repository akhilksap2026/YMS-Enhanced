import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { fmtTime, get, post, type Appointment } from "../api";

type V = { valid: boolean; reason?: string; normalized: string } | null;
export default function Gate() {
  const { d, run, query, carrier } = useApp();
  const queue = useMemo(() => d.appointments.filter((a) => ["booked", "late"].includes(a.status)).sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    .filter((a) => !query || (a.ref + a.plate + a.unitNumber).toUpperCase().includes(query.toUpperCase())), [d.appointments, query]);
  const [selId, setSel] = useState<string | undefined>(queue[0]?.id);
  const sel: Appointment | undefined = queue.find((a) => a.id === selId) ?? queue[0];
  const [plate, setPlate] = useState(""); const [unitNo, setUnit] = useState(""); const [seal, setSeal] = useState(""); const [v, setV] = useState<V>(null);
  const plateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (sel) { setPlate(sel.plate ?? ""); setUnit(sel.unitNumber ?? ""); setSeal(""); plateRef.current?.focus(); } }, [sel?.id]); // eslint-disable-line
  useEffect(() => { const n = unitNo.trim(); if (!/^[A-Za-z]{4}/.test(n)) { setV(n ? { valid: true, normalized: n.toUpperCase() } : null); return; }
    const t = setTimeout(() => get<V>(`/gate/validate/${encodeURIComponent(n)}`).then(setV).catch(() => {}), 150); return () => clearTimeout(t); }, [unitNo]);
  const plateMatch = sel && plate.trim().toUpperCase() === (sel.plate ?? "").toUpperCase();
  const norm = (x: string) => x.trim().toUpperCase().replace(/[\s-]/g, "");
  const unitMatch = sel && norm(unitNo) === norm(sel.unitNumber ?? "");
  const decide = (decision: "pass" | "hold" | "quarantine") => sel && run(() => post("/gate/checkin", { appointmentId: sel.id, plate, unitNumber: unitNo, decision, seal }), `${sel.ref}: ${decision.toUpperCase()} recorded, driver notified`);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (!e.altKey) return; if (e.key === "p") { e.preventDefault(); if (v?.valid) decide("pass"); } if (e.key === "h") { e.preventDefault(); decide("hold"); } if (e.key === "q") { e.preventDefault(); decide("quarantine"); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  return (<>
    <div className="ph"><h1>Gate console</h1><span className="meta">Gate 1 inbound · {queue.length} expected · camera: manual entry (OCR stub)</span></div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 380px" }}>
      <section className="panel">
        <header>Arrival queue <span className="meta">sorted by slot · ↑↓ to move</span></header>
        <div className="scroll" style={{ maxHeight: "calc(100vh - 140px)" }} tabIndex={0}
          onKeyDown={(e) => { const i = queue.findIndex((a) => a.id === sel?.id); if (e.key === "ArrowDown") setSel(queue[Math.min(i + 1, queue.length - 1)]?.id); if (e.key === "ArrowUp") setSel(queue[Math.max(i - 1, 0)]?.id); }}>
          <table className="t"><thead><tr><th>Slot</th><th>Appointment</th><th>Carrier</th><th>Plate</th><th>Unit</th><th>Dir</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>{queue.map((a) => (<tr key={a.id} className={a.id === sel?.id ? "sel" : ""} onClick={() => setSel(a.id)} style={{ cursor: "pointer" }}>
              <td className="mono">{fmtTime(a.slotStart)}</td><td className="mono">{a.ref}</td><td>{carrier(a.carrierId)}</td><td className="mono">{a.plate}</td><td className="mono">{a.unitNumber}</td>
              <td>{a.direction === "inbound" ? "In" : "Out"}</td><td>{a.source.toUpperCase()}</td><td><span className={`pill s-${a.status === "late" ? "warn" : "idle"}`}>{a.status}</span></td></tr>))}</tbody></table>
          {!queue.length && <div className="empty-note" style={{ padding: 12 }}>No expected arrivals match.</div>}
        </div>
      </section>
      {sel && <section className="panel">
        <header>Check-in <span className="meta mono">{sel.ref}</span><div className="r"><span className={`pill s-${sel.status === "late" ? "warn" : "idle"}`}>{sel.status}</span></div></header>
        <div className="body grid" style={{ gap: 12 }}>
          <dl className="dl"><dt>Carrier</dt><dd>{carrier(sel.carrierId)}</dd><dt>Slot</dt><dd className="mono">{fmtTime(sel.slotStart)}–{fmtTime(sel.slotEnd)}</dd><dt>Direction</dt><dd>{sel.direction}</dd><dt>Expected</dt><dd className="mono">{sel.plate} · {sel.unitNumber}</dd></dl>
          <div className="fld"><label htmlFor="pl">Plate</label><input id="pl" ref={plateRef} className="ctl mono" value={plate} onChange={(e) => setPlate(e.target.value)} />
            {plate && (plateMatch ? <span className="okm">Matches appointment</span> : <span className="err">Does not match expected {sel.plate}</span>)}</div>
          <div className="fld"><label htmlFor="un">Unit / container number</label><input id="un" className="ctl mono" value={unitNo} onChange={(e) => setUnit(e.target.value)} />
            {v && (v.valid ? <span className="okm">{/^[A-Z]{4}/.test(v.normalized) ? "ISO 6346 valid" : "Trailer ID"}{unitMatch ? " · matches appointment" : " · differs from appointment"}</span> : <span className="err">ISO 6346: {v.reason}</span>)}</div>
          <div className="fld"><label htmlFor="se">Seal number</label><input id="se" className="ctl mono" value={seal} onChange={(e) => setSeal(e.target.value)} placeholder="optional" /></div>
          <div className="row">
            <button className="btn ok" style={{ flex: 1 }} disabled={!v?.valid} onClick={() => decide("pass")}>Pass<kbd>Alt P</kbd></button>
            <button className="btn hold" style={{ flex: 1 }} onClick={() => decide("hold")}>Hold<kbd>Alt H</kbd></button>
            <button className="btn bad" style={{ flex: 1 }} onClick={() => decide("quarantine")}>Quarantine<kbd>Alt Q</kbd></button>
          </div>
          <div className="fld"><span className="hint">Pass opens the barrier and creates the spot task. Hold and quarantine keep the barrier closed and alert the control tower.</span></div>
        </div>
      </section>}
    </div>
  </>);
}
