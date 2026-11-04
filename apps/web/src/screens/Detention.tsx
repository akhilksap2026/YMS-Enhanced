import { DrawerButton, Accrual } from "../features/V12";
import { Timer } from "lucide-react";
import { Fragment, useState } from "react";
import { useApp } from "../store";
import { download, money, post, type Charge } from "../api";

const REASONS = ["Site-caused delay", "Carrier dispute accepted", "Free-time extension agreed", "Data error", "Other"];
export default function Detention() {
  const { d, run, carrier, unit, can, reload } = useApp();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [edit, setEdit] = useState<{ id: string; mode: "adjusted" | "rejected"; amount: string; reason: string; note: string } | null>(null);
  const rows = d.charges.filter((c) => filter === "all" || ["indicative", "under_review", "adjusted"].includes(c.state));
  const pend = d.charges.filter((c) => c.state === "indicative" || c.state === "under_review");
  const act = (c: Charge, action: string, body: object = {}) => run(() => post(`/detention/charges/${c.id}/${action}`, { by: "finance.demo", ...body }), `${c.visitRef}: ${action}`);
  const tone: Record<string, string> = { indicative: "warn", under_review: "info", approved: "ok", adjusted: "info", rejected: "bad", exported: "idle" };

  return (<>
    <div className="ph"><h1>Detention review</h1><span className="meta">{pend.length} indicative · {money(pend.reduce((s, c) => s + c.amount, 0))} pending decision · nothing exports to ERP until approved</span>
      <div className="act"><DrawerButton icon={<Timer size={14} />} label="Live accrual" title="Live accrual from dwell">{() => <Accrual />}</DrawerButton><select className="ctl" value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")} aria-label="Filter"><option value="pending">Needs decision</option><option value="all">All charges</option></select>
        <button className="btn" disabled={!d.charges.some((c) => c.state === "approved") || !can("detention:decide")} onClick={() => run(async () => { await download("/integrations/erp/export", "detention-export.csv", { mode: "csv" }); await reload(); }, "Approved charges exported to CSV")}>Export CSV</button>
        <button className="btn" disabled={!d.charges.some((c) => c.state === "approved") || !can("detention:decide")} title="Queue approved charges to the ERP endpoint (Integrations)" onClick={() => run(async () => { const x = await post<{ queued: number; batch: string }>("/integrations/erp/export", { mode: "push" }); await reload(); return x; }, "Approved charges queued to ERP")}>Push to ERP</button></div></div>
    <section className="panel">
      <table className="t"><thead><tr><th>Visit</th><th>Carrier</th><th>Unit</th><th>Type</th><th className="num">Free h</th><th className="num">Billable h</th><th className="num">Rate</th><th className="num">Amount</th><th>State</th><th>Last action</th><th /></tr></thead>
        <tbody>{rows.map((c) => { const last = c.history[c.history.length - 1]; const open = ["indicative", "under_review", "adjusted"].includes(c.state); const e = edit?.id === c.id ? edit : null; return (<Fragment key={c.id}>
          <tr className={e ? "sel" : ""}><td className="mono">{c.visitRef}</td><td>{carrier(c.carrierId)}</td><td className="mono">{unit(c.unitId)?.number}</td><td>{c.kind}</td>
            <td className="num mono">{c.freeHours}</td><td className="num mono">{c.billableHours}</td><td className="num mono">{c.rate.toFixed(2)}/h</td><td className="num mono"><b>{money(c.amount)}</b></td>
            <td><span className={`pill s-${tone[c.state]}`}>{c.state.replace("_", " ")}</span></td>
            <td style={{ color: "var(--text-3)" }}>{last.action}{last.reason ? ` · ${last.reason}` : ""}</td>
            <td className="actions">{open && <>
              <button className="btn sm ok" onClick={() => act(c, "approved")}>Approve</button>
              <button className="btn sm" onClick={() => setEdit({ id: c.id, mode: "adjusted", amount: String(c.amount), reason: REASONS[0], note: "" })}>Adjust</button>
              <button className="btn sm" onClick={() => setEdit({ id: c.id, mode: "rejected", amount: "0", reason: REASONS[1], note: "" })}>Reject</button></>}</td></tr>
          {e && <tr key={c.id + "e"} className="sel"><td colSpan={11}>
            <div className="row" style={{ padding: "6px 0" }}>
              <b style={{ fontSize: 12 }}>{e.mode === "adjusted" ? "Adjust to" : "Reject"}</b>
              {e.mode === "adjusted" && <input autoFocus className="ctl mono" style={{ width: 96 }} value={e.amount} onChange={(x) => setEdit({ ...e, amount: x.target.value })} aria-label="New amount" />}
              <select className="ctl" value={e.reason} onChange={(x) => setEdit({ ...e, reason: x.target.value })} aria-label="Reason">{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              <input className="ctl" style={{ flex: 1 }} placeholder="Comment (required for audit)" value={e.note} onChange={(x) => setEdit({ ...e, note: x.target.value })} aria-label="Comment"
                onKeyDown={(x) => { if (x.key === "Enter" && e.note.trim()) (document.getElementById("save-" + c.id) as HTMLButtonElement)?.click(); if (x.key === "Escape") setEdit(null); }} />
              <button id={"save-" + c.id} className="btn sm pri" disabled={!e.note.trim()} onClick={async () => { if (await act(c, e.mode, { reason: `${e.reason}: ${e.note}`, amount: Number(e.amount) })) setEdit(null); }}>Save</button>
              <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
            </div></td></tr>}
        </Fragment>); })}</tbody></table>
      {!rows.length && <div className="empty-note" style={{ padding: 12 }}>All charges decided.</div>}
    </section>
  </>);
}
