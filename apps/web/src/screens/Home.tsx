import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScanLine, Warehouse, Route, ClipboardList, Timer, Settings, ChevronsRight, CloudOff } from "lucide-react";
import { useApp } from "../store";
import { fmtDur, fmtTime, get, hoursSince, money, post } from "../api";
import ControlTower from "./ControlTower";

/** Role-specific home dashboards. Menus and other screens are unchanged; this is each role's landing screen. */
type T = { k: string; v: string | number; s?: string; bad?: boolean; go?: string };
function Tiles({ items }: { items: T[] }) {
  const { go } = useApp();
  return <div className="home-tiles">{items.map((t) => <button key={t.k} className={"home-tile" + (t.bad ? " bad" : "")} onClick={() => t.go && go(t.go)} disabled={!t.go}><small>{t.k}</small><b>{t.v}</b>{t.s && <span className="mu">{t.s}</span>}</button>)}</div>;
}
function Hero({ label, title, sub, action }: { label: string; title: string; sub?: string; action?: ReactNode }) {
  return <section className="home-hero"><div><small>{label}</small><h2>{title}</h2>{sub && <p className="mu">{sub}</p>}</div>{action}</section>;
}
const soon = (iso: string, min: number) => { const t = Date.parse(iso) - Date.now(); return t > -30 * 60e3 && t < min * 60e3; };

function YardManager() {
  const { d, openUnit, go } = useApp();
  const ex = [...d.exceptions].sort((a, b) => "hml".indexOf(a.severity[0]) - "hml".indexOf(b.severity[0]))[0];
  const onSite = d.units.filter((u) => u.location).length;
  return <div className="home"><Hero label="Units on site" title={`${onSite} units · ${d.exceptions.filter((e) => e.severity === "high").length} urgent exceptions`} sub={ex ? `Most urgent: ${ex.text}` : "No open exceptions"}
    action={ex?.unitId ? <button className="btn pri" onClick={() => openUnit(ex.unitId!)}>Open unit</button> : <button className="btn" onClick={() => go("map")}>Yard map</button>} /><ControlTower /></div>;
}

function GateGuard() {
  const { d, carrier, go, run } = useApp();
  const next = d.appointments.filter((a) => ["booked", "late"].includes(a.status) && soon(a.slotStart, 60)).sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  const waiting = d.units.filter((u) => /^W/.test(u.location)); const held = d.units.filter((u) => u.status === "hold" || u.status === "quarantine");
  const [ocr, setOcr] = useState<boolean | null>(null); useEffect(() => { get<{ ok: boolean }>("/gate/ocr/health").then((r) => setOcr(r.ok)).catch(() => setOcr(false)); }, []);
  const last = [...d.units].filter((u) => u.gateInAt).sort((a, b) => (b.gateInAt ?? "").localeCompare(a.gateInAt ?? "")).slice(0, 10);
  return <div className="home"><Hero label="Next 60 minutes" title={`${next.length} arrivals due`} sub={next[0] ? `First: ${next[0].ref} · ${carrier(next[0].carrierId)} · ${fmtTime(next[0].slotStart)}` : "Nothing due"} action={<button className="btn pri lg" onClick={() => go("gate")}><ScanLine size={18} />Start check-in</button>} />
    <Tiles items={[{ k: "Waiting lane", v: waiting.length, go: "map" }, { k: "On hold at gate", v: held.length, bad: held.length > 0, go: "map" }, { k: "OCR", v: ocr == null ? "…" : ocr ? "Online" : "Offline", bad: ocr === false }, { k: "Late now", v: d.appointments.filter((a) => a.status === "late").length }]} />
    <div className="home-2"><section className="panel"><header>Arrivals due <span className="meta">plate, slot</span></header><div className="scroll"><table className="t"><tbody>{next.map((a) => <tr key={a.id} className="click" onClick={() => go("gate")}><td className="m">{a.ref}</td><td>{carrier(a.carrierId)}</td><td className="m">{a.plate ?? "–"}</td><td className="m r">{fmtTime(a.slotStart)}</td><td><span className={"tag " + (a.status === "late" ? "t-late" : "t-idle")}>{a.status}</span></td></tr>)}</tbody></table></div></section>
    <section className="panel"><header>Last crossings</header><div className="scroll"><table className="t"><tbody>{last.map((u) => <tr key={u.id}><td className="m">{u.number}</td><td>{carrier(u.carrierId)}</td><td className="m">{u.location}</td><td className="m r">{fmtTime(u.gateInAt)}</td><td className="actions">{u.status === "ok" && <button className="btn sm" onClick={() => run(() => post("/gate/checkout", { unitId: u.id }), `${u.number} gated out`)}>Gate out</button>}</td></tr>)}</tbody></table></div></section></div></div>;
}

function DockSup() {
  const { d, unit, run, go } = useApp();
  const waiting = d.units.filter((u) => u.location && !/^D/.test(u.location) && u.status === "ok" && u.load === "loaded");
  const overTarget = d.doors.filter((x) => x.state === "occupied" && hoursSince(x.since) > 2);
  const free = d.doors.filter((x) => x.state === "free");
  return <div className="home"><Hero label="Doors" title={`${free.length} free · ${d.doors.filter((x) => x.state === "occupied").length} occupied · ${d.doors.filter((x) => x.state === "blocked").length} blocked`} sub={`${waiting.length} units waiting for a door, ${overTarget.length} over 2 h at door`} action={<button className="btn pri" onClick={() => go("dock")}><Warehouse size={16} />Door board</button>} />
    <div className="door-strip">{d.doors.map((x) => <div key={x.id} className={"ds " + x.state + (overTarget.includes(x) ? " over" : "")} title={x.unitId ? unit(x.unitId)?.number : x.state}><b>{x.label}</b><small>{x.state === "occupied" ? fmtDur(hoursSince(x.since)) : x.state}</small>
      {x.state === "occupied" ? <button className="btn sm" onClick={() => run(() => post(`/dock/doors/${x.id}/release`), `${x.label} released`)}>Release</button> : x.state === "free" && waiting[0] ? <button className="btn sm" onClick={() => run(() => post(`/dock/doors/${x.id}/assign`, { unitId: waiting[0].id }), `${waiting[0].number} to ${x.label}`)}>Assign next</button> : null}</div>)}</div>
    <section className="panel"><header>Waiting for a door</header><div className="scroll"><table className="t"><tbody>{waiting.slice(0, 12).map((u) => <tr key={u.id}><td className="m">{u.number}</td><td className="m">{u.location}</td><td className="r">{fmtDur(hoursSince(u.gateInAt))}</td><td className="actions">{free[0] && <button className="btn sm" onClick={() => run(() => post(`/dock/doors/${free[0].id}/assign`, { unitId: u.id }), `${u.number} to ${free[0].label}`)}>To {free[0].label}</button>}</td></tr>)}</tbody></table></div></section></div>;
}

function SpotterHome() {
  const { d, unit, go } = useApp();
  const mine = d.tasks.filter((t) => t.status !== "done").sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  const t = mine[0]; const u = t && unit(t.unitId);
  const done = d.tasks.filter((x) => x.status === "done").length;
  return <div className="home phone">
    {!navigator.onLine && <div className="pill-off"><CloudOff size={14} />Offline: moves are saved and sync later</div>}
    {t ? <section className="home-hero col"><small>My next move · P{t.priority}{t.priority === 1 ? " hot" : ""}</small><div className="sp-route m"><span>{t.from}</span><ChevronsRight size={26} /><span>{t.to}</span></div><p className="mu">{u?.number} {u?.reefer ? "· reefer" : ""} {u?.hazmat ? "· hazmat " + u.hazmat : ""}</p>
      <button className="btn pri lg" onClick={() => go("spotter")}><Route size={18} />Go to move</button></section> : <section className="home-hero col"><h2>No moves waiting</h2></section>}
    <Tiles items={[{ k: "In my queue", v: mine.length }, { k: "Done this shift", v: done }, { k: "Hot", v: mine.filter((x) => x.priority === 1).length, bad: mine.some((x) => x.priority === 1) }]} />
    <section className="panel"><header>Queue</header><div className="scroll"><table className="t"><tbody>{mine.slice(1, 10).map((x) => <tr key={x.id}><td className="m">P{x.priority}</td><td className="m">{unit(x.unitId)?.number}</td><td className="m">{x.from} → {x.to}</td></tr>)}</tbody></table></div></section></div>;
}

function CarrierHome() {
  const { d, user, go } = useApp();
  const mine = d.appointments.filter((a) => !user.carrierId || a.carrierId === user.carrierId);
  const next = mine.filter((a) => ["booked", "late"].includes(a.status)).sort((a, b) => a.slotStart.localeCompare(b.slotStart))[0];
  const late = mine.filter((a) => a.status === "late").length, ns = mine.filter((a) => a.status === "no_show").length;
  const det = d.charges.filter((c) => !user.carrierId || c.carrierId === user.carrierId);
  return <div className="home phone-ok"><Hero label="My next appointment" title={next ? `${next.ref} · ${new Date(next.slotStart).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${fmtTime(next.slotStart)}` : "No upcoming appointment"} sub={next ? `${next.direction} · ${next.status}${next.door ? " · door " + next.door : ""}` : undefined}
    action={<button className="btn pri lg" onClick={() => go("carrier")}><ClipboardList size={18} />{next ? "Book or reschedule" : "Book a slot"}</button>} />
    <Tiles items={[{ k: "Upcoming", v: mine.filter((a) => a.status === "booked").length, go: "carrier" }, { k: "Late", v: late, bad: late > 0 }, { k: "No-shows", v: ns, bad: ns > 0 }, { k: "Detention items", v: det.length, s: det.length ? money(det.reduce((s, c) => s + c.amount, 0)) : undefined }]} /></div>;
}

function Approver() {
  const { d, carrier, go } = useApp();
  const open = d.charges.filter((c) => c.state === "indicative" || c.state === "under_review");
  const total = open.reduce((s, c) => s + c.amount, 0);
  const by = useMemo(() => { const m = new Map<string, number>(); for (const c of open) m.set(c.carrierId, (m.get(c.carrierId) ?? 0) + c.amount); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6); }, [open]);
  const age = (c: (typeof open)[number]) => hoursSince(c.history[0]?.at) / 24;
  const lastExp = d.charges.filter((c) => c.state === "exported").flatMap((c) => c.history.filter((h) => h.action === "exported").map((h) => h.at)).sort().pop();
  return <div className="home"><Hero label="Waiting for a decision" title={`${open.length} charges · ${money(total)} indicative`} sub="Indicative only; nothing is billed until you approve and export." action={<button className="btn pri" onClick={() => go("detention")}><Timer size={16} />Review charges</button>} />
    <Tiles items={[{ k: "Over 7 days old", v: open.filter((c) => age(c) > 7).length, bad: open.some((c) => age(c) > 7) }, { k: "Under review", v: d.charges.filter((c) => c.state === "under_review").length }, { k: "Approved, not exported", v: d.charges.filter((c) => c.state === "approved").length }, { k: "Last ERP export", v: lastExp ? new Date(lastExp).toLocaleDateString("en-GB") : "Never" }]} />
    <section className="panel"><header>Top carriers by exposure</header><div className="body">{by.map(([c, v]) => <div key={c} className="hbar"><span>{carrier(c)}</span><i style={{ width: `${(v / (by[0]?.[1] || 1)) * 100}%` }} /><b className="m">{money(v)}</b></div>)}</div></section></div>;
}

function Admin() {
  const { go, tenant } = useApp();
  const [s, setS] = useState<{ msgs: { status: string; system: string }[]; dl: { status: string }[]; audit: { at: string; name: string; method: string; path: string }[] }>({ msgs: [], dl: [], audit: [] });
  useEffect(() => { Promise.all([get<{ status: string; system: string }[]>("/integrations/messages").catch(() => []), get<{ status: string }[]>("/notifications/deliveries").catch(() => []), get<{ at: string; name: string; method: string; path: string }[]>("/admin/audit").catch(() => [])]).then(([msgs, dl, audit]) => setS({ msgs, dl, audit })); }, []);
  const dead = s.msgs.filter((m) => m.status === "dead").length, failed = s.dl.filter((x) => x.status === "failed").length;
  return <div className="home"><Hero label="Tenant health" title={`${tenant?.sites?.length ?? 1} sites · ${dead} dead letters · ${failed} failed notifications`} sub={dead || failed ? "Something needs a retry." : "All integrations and notifications healthy."} action={<button className="btn pri" onClick={() => go(dead ? "integrations" : "admin")}><Settings size={16} />{dead ? "Open integrations" : "Tenant admin"}</button>} />
    <Tiles items={(tenant?.sites ?? []).map((x): T => ({ k: x.code, v: x.name, s: x.tz })).concat([{ k: "Integration messages", v: String(s.msgs.length), s: `${dead} dead`, go: "integrations" } as T, { k: "Notifications sent", v: String(s.dl.length), s: `${failed} failed`, go: "admin" } as T])} />
    <section className="panel"><header>Recent audit events</header><div className="scroll"><table className="t"><tbody>{s.audit.slice(0, 10).map((a, i) => <tr key={i}><td className="m">{fmtTime(a.at)}</td><td>{a.name}</td><td className="m">{a.method} {a.path}</td></tr>)}</tbody></table></div></section></div>;
}

export default function Home() {
  const { user } = useApp();
  switch (user.role) {
    case "gate_guard": return <GateGuard />;
    case "dock_supervisor": return <DockSup />;
    case "spotter": return <SpotterHome />;
    case "carrier": return <CarrierHome />;
    case "detention_approver": return <Approver />;
    case "tenant_admin": return <Admin />;
    default: return <YardManager />;
  }
}
