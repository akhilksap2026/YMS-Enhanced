import { DrawerButton, Planning, DriverLink } from "../features/V12";
import { FileSpreadsheet, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../store";
import { fmtTime, get, post } from "../api";

// carrier sees own appointments (server filters by the signed-in carrier)
export default function Carrier() {
  const { d, run, carrier, user } = useApp(); const ME = user.carrierId ?? "c2";
  const mine = d.appointments.filter((a) => a.carrierId === ME).sort((a, b) => b.slotStart.localeCompare(a.slotStart));
  const [dir, setDir] = useState<"inbound" | "outbound">("inbound");
  const [unitNo, setUnit] = useState(""); const [plate, setPlate] = useState("");
  const { reload, user: u } = useApp(); const mgr = u.role === "tenant_admin" || u.role === "yard_manager";
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)); const [slots, setSlots] = useState<{ start: string; free: number; reasons: string[] }[]>([]); const [slotMin, setSlotMin] = useState(60);
  const [moving, setMoving] = useState<string | null>(null); const [refusal, setRefusal] = useState<{ start: string; msgs: string[] } | null>(null);
  const loadSlots = () => get<{ slots: typeof slots; slotMinutes: number }>(`/appointments/availability?date=${date}&direction=${dir}&carrierId=${ME}`).then((r) => { setSlots(r.slots); setSlotMin(r.slotMinutes); });
  useEffect(() => { void loadSlots(); }, [date, dir, d.appointments.length]);
  const max = Math.max(1, ...slots.map((s) => s.free));
  const book = async (iso: string, override = false) => { setRefusal(null);
    const ok = await run(async () => { try { if (moving) await post(`/appointments/${moving}/reschedule`, { slotStart: iso, override }); else await post("/appointments", { carrierId: ME, slotStart: iso, direction: dir, unitNumber: unitNo || undefined, plate: plate || undefined, override }); }
      catch (e: any) { if (e.violations) setRefusal({ start: iso, msgs: e.violations.map((v: { message: string }) => v.message) }); throw e; } }, moving ? `Moved to ${fmtTime(iso)}` : `Booked ${fmtTime(iso)}`);
    if (ok) { setMoving(null); await reload(); await loadSlots(); } };

  return (<>
    <div className="ph"><h1>Appointments</h1><span className="meta">{carrier(ME)} · slots of {slotMin} min · capacity and carrier rules applied</span><div className="act"><DrawerButton icon={<FileSpreadsheet size={14} />} label="Plan & amendments">{() => <Planning />}</DrawerButton>{u.role !== "carrier" && <DrawerButton icon={<Send size={14} />} label="Driver link">{() => <DriverLink />}</DrawerButton>}</div></div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 460px) minmax(0, 1fr)" }}>
      <section className="panel"><header>{moving ? "Pick a new slot" : "Book a slot"} <span className="meta">{moving ? <button className="btn sm ghost" onClick={() => setMoving(null)}>Cancel move</button> : "one click per slot"}</span></header>
        <div className="body grid" style={{ gap: 12 }}>
          <div className="row">
            <select className="ctl" value={dir} onChange={(e) => setDir(e.target.value as "inbound" | "outbound")} aria-label="Direction"><option value="inbound">Inbound delivery</option><option value="outbound">Outbound pickup</option></select>
            <input className="ctl mono" style={{ flex: 1, minWidth: 0 }} placeholder="Unit no." value={unitNo} onChange={(e) => setUnit(e.target.value)} aria-label="Unit number" />
            <input className="ctl mono" style={{ width: 96, flex: "none" }} placeholder="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Plate" />
          </div>
          <div className="row"><input className="ctl sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /><span className="mu">{slots.filter((s) => s.free > 0).length} of {slots.length} slots open</span></div>
          {refusal && <div className="panel" style={{ padding: 8 }}><b>Not allowed at {fmtTime(refusal.start)}</b><ul className="viol">{refusal.msgs.map((m) => <li key={m}>{m}</li>)}</ul>
            {mgr && <button className="btn sm" onClick={() => book(refusal.start, true)}>Override as manager</button>}</div>}
          <div className="scroll" style={{ maxHeight: 440 }}><table className="t"><thead><tr><th>Slot</th><th>Free</th><th /></tr></thead><tbody>{slots.length === 0 && <tr><td colSpan={3} className="mu">No receiving hours on this day.</td></tr>}{slots.map((s) => { const past = Date.parse(s.start) < Date.now(); return (
            <tr key={s.start} className={past ? "mu" : undefined}><td className="mono">{fmtTime(s.start)}–{fmtTime(new Date(Date.parse(s.start) + slotMin * 60e3).toISOString())}</td>
              <td style={{ width: 130 }} title={s.reasons.join("; ")}><div className="row"><div className="bar" style={{ flex: 1 }}><i style={{ width: `${(s.free / max) * 100}%`, background: s.free === 0 ? "var(--bad)" : s.free <= 1 ? "var(--warn)" : undefined }} /></div><span className="mono">{s.free}</span></div></td>
              <td className="actions"><button className="btn sm" disabled={past || (s.free === 0 && !mgr)} title={s.reasons[0]} onClick={() => book(s.start)}>{s.free === 0 ? (s.reasons[0] ? "Not allowed" : "Full") : moving ? "Move here" : "Book"}</button></td></tr>); })}</tbody></table></div>
        </div>
      </section>
      <section className="panel"><header>My appointments <span className="meta">{mine.length}</span></header>
        <table className="t"><thead><tr><th>Ref</th><th>Slot</th><th>Dir</th><th>Unit</th><th>Plate</th><th>Status</th><th /></tr></thead>
          <tbody>{mine.map((a) => (<tr key={a.id}><td className="mono">{a.ref}</td><td className="mono">{fmtTime(a.slotStart)}</td><td>{a.direction === "inbound" ? "In" : "Out"}</td><td className="mono">{a.unitNumber ?? "–"}</td><td className="mono">{a.plate ?? "–"}</td>
            <td><span className={`pill s-${a.status === "arrived" ? "ok" : a.status === "late" ? "warn" : a.status === "no_show" || a.status === "cancelled" ? "bad" : "idle"}`}>{a.status.replace("_", " ")}</span></td>
            <td className="actions">{(a.status === "booked" || a.status === "late") && <><button className="btn sm" onClick={() => { setMoving(a.id); setDate(a.slotStart.slice(0, 10)); }}>Reschedule</button><button className="btn sm ghost" onClick={() => run(() => post(`/appointments/${a.id}/cancel`), `${a.ref} cancelled`)}>Cancel</button></>}</td></tr>))}</tbody></table>
      </section>
    </div>
  </>);
}
