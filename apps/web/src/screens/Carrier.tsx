import { useMemo, useState } from "react";
import { useApp } from "../store";
import { fmtTime, post } from "../api";

const ME = "c2"; // demo carrier login
export default function Carrier() {
  const { d, run, carrier } = useApp();
  const mine = d.appointments.filter((a) => a.carrierId === ME).sort((a, b) => b.slotStart.localeCompare(a.slotStart));
  const [dir, setDir] = useState<"inbound" | "outbound">("inbound");
  const [unitNo, setUnit] = useState(""); const [plate, setPlate] = useState("");
  const hours = useMemo(() => { const base = new Date(); base.setMinutes(0, 0, 0); return Array.from({ length: 12 }, (_, i) => new Date(base.getTime() + (i + 1) * 3600e3)); }, []);
  const load = (t: Date) => d.appointments.filter((a) => a.status !== "cancelled" && Math.abs(Date.parse(a.slotStart) - t.getTime()) < 3600e3).length;
  const book = (t: Date) => run(() => post("/appointments", { carrierId: ME, slotStart: t.toISOString(), direction: dir, unitNumber: unitNo || undefined, plate: plate || undefined }), `Booked ${fmtTime(t.toISOString())}`);

  return (<>
    <div className="ph"><h1>Appointments</h1><span className="meta">{carrier(ME)} · Riverside DC · capacity 4 per hour</span></div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 460px) minmax(0, 1fr)" }}>
      <section className="panel"><header>Book a slot <span className="meta">one click per slot</span></header>
        <div className="body grid" style={{ gap: 12 }}>
          <div className="row">
            <select className="ctl" value={dir} onChange={(e) => setDir(e.target.value as "inbound" | "outbound")} aria-label="Direction"><option value="inbound">Inbound delivery</option><option value="outbound">Outbound pickup</option></select>
            <input className="ctl mono" style={{ flex: 1, minWidth: 0 }} placeholder="Unit no." value={unitNo} onChange={(e) => setUnit(e.target.value)} aria-label="Unit number" />
            <input className="ctl mono" style={{ width: 96, flex: "none" }} placeholder="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Plate" />
          </div>
          <table className="t"><thead><tr><th>Today</th><th>Load</th><th /></tr></thead><tbody>{hours.map((t) => { const n = load(t); const full = n >= 4; return (
            <tr key={t.toISOString()}><td className="mono">{fmtTime(t.toISOString())}–{fmtTime(new Date(t.getTime() + 3600e3).toISOString())}</td>
              <td style={{ width: 120 }}><div className="row"><div className="bar" style={{ flex: 1 }}><i style={{ width: `${(n / 4) * 100}%`, background: full ? "var(--bad)" : n >= 3 ? "var(--warn)" : undefined }} /></div><span className="mono">{n}/4</span></div></td>
              <td className="actions"><button className="btn sm" disabled={full} onClick={() => book(t)}>{full ? "Full" : "Book"}</button></td></tr>); })}</tbody></table>
        </div>
      </section>
      <section className="panel"><header>My appointments <span className="meta">{mine.length}</span></header>
        <table className="t"><thead><tr><th>Ref</th><th>Slot</th><th>Dir</th><th>Unit</th><th>Plate</th><th>Status</th><th /></tr></thead>
          <tbody>{mine.map((a) => (<tr key={a.id}><td className="mono">{a.ref}</td><td className="mono">{fmtTime(a.slotStart)}</td><td>{a.direction === "inbound" ? "In" : "Out"}</td><td className="mono">{a.unitNumber ?? "–"}</td><td className="mono">{a.plate ?? "–"}</td>
            <td><span className={`pill s-${a.status === "arrived" ? "ok" : a.status === "late" ? "warn" : a.status === "no_show" || a.status === "cancelled" ? "bad" : "idle"}`}>{a.status.replace("_", " ")}</span></td>
            <td className="actions">{a.status === "booked" && <button className="btn sm" onClick={() => run(() => post(`/appointments/${a.id}/cancel`), `${a.ref} cancelled`)}>Cancel</button>}</td></tr>))}</tbody></table>
      </section>
    </div>
  </>);
}
