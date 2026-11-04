import { useEffect, useState } from "react";
import { Building2, Grid3x3, Users, Scale, Palette, Plus, Trash2, Bell } from "lucide-react";
import NotifyAdmin from "./NotifyAdmin";
import { useApp } from "../store";
import { del, get, patch, post, put, type Role, type SiteConfig } from "../api";

type U = { id: string; email: string; name: string; role: Role; active: boolean; carrier_id?: string; carrierId?: string };
const ROLE_L: Record<Role, string> = { tenant_admin: "Tenant admin", yard_manager: "Yard manager", gate_guard: "Gate guard", dock_supervisor: "Dock supervisor", spotter: "Spotter", carrier: "Carrier", detention_approver: "Detention approver" };
const TABS = [["site", "Sites", Building2], ["yard", "Yard layout", Grid3x3], ["users", "Users", Users], ["rules", "Rules & integrations", Scale], ["notify", "Notifications", Bell], ["brand", "Branding", Palette]] as const;

export default function Admin() {
  const { tenant } = useApp(); const [tab, setTab] = useState<(typeof TABS)[number][0]>(() => (new URLSearchParams(location.search).get("tab") as never) || "yard");
  if (!tenant) return null;
  return <div className="adm">
    <div className="ph"><h1>Tenant admin</h1><span className="meta">{tenant.tenant.name} · changes apply immediately and are audited</span></div>
    <div className="seg adm-tabs">{TABS.map(([id, l, I]) => <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}><I size={14} />{l}</button>)}</div>
    {tab === "site" && <Site />}{tab === "yard" && <Yard />}{tab === "users" && <UsersTab />}{tab === "rules" && <Rules />}{tab === "notify" && <NotifyAdmin />}{tab === "brand" && <Brand />}
  </div>;
}
function useCfg() { const { tenant, run, reload } = useApp(); const save = (p: Partial<SiteConfig>, msg: string) => run(async () => { await patch("/tenant/config", p); await reload(); }, msg); return { c: tenant!.siteConfig, save }; }

function Site() {
  const { tenant } = useApp(); const { c, save } = useCfg(); const [name, setName] = useState(c.siteName);
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
    <section className="panel"><header>Sites</header><table className="t"><thead><tr><th>Site</th><th>Time zone</th><th>Appointments from</th><th>Data residency</th></tr></thead>
      <tbody>{tenant!.sites.map((s) => <tr key={s.id}><td><b>{s.name}</b> <span className="mu m">{s.id}</span></td><td className="mono">Africa/Bujumbura</td><td>{SRC[c.appointmentSource]}</td><td>Ksap cloud</td></tr>)}</tbody></table></section>
    <section className="panel"><header>Edit site</header><div className="body form">
      <label>Site name<input className="ctl" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="btn pri" disabled={!name.trim() || name === c.siteName} onClick={() => save({ siteName: name.trim() }, "Site renamed")}>Save</button>
      <p className="hint">This build runs one site per tenant. More sites are added by provisioning, so each site's data stays separate.</p></div></section>
  </div>;
}

function Yard() {
  const { d, run, reload } = useApp(); const [nz, setNz] = useState({ name: "", slots: 10, kind: "row" as const as string });
  const act = (f: () => Promise<unknown>, m: string) => run(async () => { await f(); await reload(); }, m);
  const zones = [...d.zones].sort((a, b) => a.name.localeCompare(b.name)); const doors = [...d.doors].sort((a, b) => a.label.localeCompare(b.label));
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
    <section className="panel"><header>Zones and slots <span className="meta">{zones.reduce((a, z) => a + z.slots.length, 0)} slots · occupied slots cannot be removed</span></header>
      <div className="body adm-zones">{zones.map((z) => { const used = z.slots.filter((s) => s.unitId).length; return <div key={z.id} className="w adm-zone">
        <div className="zh"><b className="m">{z.name}</b><span className={`tag t-${z.kind === "reefer" ? "reefer" : z.kind === "hold" ? "haz" : "idle"}`}>{z.kind}</span><span className="mu">{used}/{z.slots.length} used</span>
          <span className="sp" /><button className="btn icon ghost sm" title="Remove one slot" disabled={z.slots.length <= 1} onClick={() => act(() => put(`/admin/zones/${z.name}`, { slots: z.slots.length - 1 }), `${z.name}: ${z.slots.length - 1} slots`)}>−</button>
          <b className="m">{z.slots.length}</b><button className="btn icon ghost sm" title="Add one slot" onClick={() => act(() => put(`/admin/zones/${z.name}`, { slots: z.slots.length + 1 }), `${z.name}: ${z.slots.length + 1} slots`)}>+</button>
          <button className="btn icon ghost sm" title="Delete zone" disabled={used > 0} onClick={() => confirm(`Delete zone ${z.name}?`) && act(() => del(`/admin/zones/${z.name}`), `Zone ${z.name} deleted`)}><Trash2 size={13} /></button></div>
        <div className="slots">{z.slots.map((s) => <i key={s.id} className={s.unitId ? "u" : ""} title={s.label + (s.unitId ? " · occupied" : "")} />)}</div></div>; })}
        <div className="w adm-zone add"><b><Plus size={13} /> New zone</b>
          <input className="ctl sm m" maxLength={1} placeholder="Letter" style={{ width: 64 }} value={nz.name} onChange={(e) => setNz({ ...nz, name: e.target.value.toUpperCase() })} />
          <select className="ctl sm" value={nz.kind} onChange={(e) => setNz({ ...nz, kind: e.target.value })}>{["row", "reefer", "hold", "waiting"].map((k) => <option key={k}>{k}</option>)}</select>
          <input className="ctl sm" type="number" min={1} max={40} style={{ width: 64 }} value={nz.slots} onChange={(e) => setNz({ ...nz, slots: Number(e.target.value) })} />
          <button className="btn sm pri" disabled={!/^[A-Z]$/.test(nz.name) || zones.some((z) => z.name === nz.name)} onClick={() => act(() => put(`/admin/zones/${nz.name}`, nz), `Zone ${nz.name} added`).then(() => setNz({ ...nz, name: "" }))}>Add</button></div>
      </div></section>
    <section className="panel"><header>Dock doors <span className="meta">{doors.length}</span>
      <span className="sp" /><button className="btn sm" onClick={() => act(() => put("/admin/doors", { count: doors.length - 1 }), "Door removed")}>−</button><button className="btn sm" onClick={() => act(() => put("/admin/doors", { count: doors.length + 1 }), "Door added")}>+</button></header>
      <div className="body adm-doors">{doors.map((x) => <div key={x.id} className={`adm-door ${x.state}`}><b className="m">{x.label}</b><span className="mu">{x.state}</span>
        {x.state !== "occupied" && <button className="btn sm ghost" onClick={() => act(() => post(`/admin/doors/${x.id}/state`, { state: x.state === "blocked" ? "free" : "blocked" }), `${x.label} ${x.state === "blocked" ? "back in service" : "blocked"}`)}>{x.state === "blocked" ? "Unblock" : "Block"}</button>}</div>)}</div></section>
  </div>;
}

function UsersTab() {
  const { run, d } = useApp(); const [users, setUsers] = useState<U[]>([]); const [f, setF] = useState({ name: "", email: "", role: "spotter" as Role, password: "", carrierId: "" });
  const load = () => get<U[]>("/admin/users").then(setUsers); useEffect(() => { void load(); }, []);
  return <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 320px" }}>
    <section className="panel"><header>Users <span className="meta">{users.length}</span></header><div className="scroll"><table className="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
      <tbody>{users.map((u) => <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}><td>{u.name}</td><td className="mono">{u.email}</td>
        <td><select className="ctl sm" value={u.role} onChange={(e) => run(async () => { await patch(`/admin/users/${u.id}`, { role: e.target.value }); await load(); }, `${u.name}: role changed`)}>{(Object.keys(ROLE_L) as Role[]).map((r) => <option key={r} value={r}>{ROLE_L[r]}</option>)}</select></td>
        <td><button className="btn sm ghost" onClick={() => run(async () => { await patch(`/admin/users/${u.id}`, { active: !u.active }); await load(); }, u.active ? `${u.name} deactivated` : `${u.name} reactivated`)}>{u.active ? "Active" : "Disabled"}</button></td></tr>)}</tbody></table></div></section>
    <section className="panel"><header>Add user</header><div className="body form">
      <label>Name<input className="ctl" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label>Email<input className="ctl" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Role<select className="ctl" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_L) as Role[]).map((r) => <option key={r} value={r}>{ROLE_L[r]}</option>)}</select></label>
      {f.role === "carrier" && <label>Carrier<select className="ctl" value={f.carrierId} onChange={(e) => setF({ ...f, carrierId: e.target.value })}><option value="">Choose…</option>{d.carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label>Temporary password<input className="ctl" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      <button className="btn pri" disabled={!f.name || !f.email.includes("@") || f.password.length < 8 || (f.role === "carrier" && !f.carrierId)}
        onClick={() => run(async () => { await post("/admin/users", { ...f, carrierId: f.carrierId || undefined }); setF({ ...f, name: "", email: "", password: "" }); await load(); }, "User added")}>Add user</button>
      <p className="hint">At least 8 characters. Ask the user to change it at first sign-in.</p></div></section>
  </div>;
}

const SRC = { native: "Native scheduling (YMSNow)", sap: "SAP TM / EWM adapter", otm: "Oracle OTM adapter" } as const;
function Rules() {
  const { c, save } = useCfg(); const [r, setR] = useState(c.rates); const [src, setSrc] = useState(c.appointmentSource);
  const num = (k: keyof typeof r, l: string, u: string) => <label>{l}<span className="inunit"><input className="ctl m" type="number" min={0} step="0.5" value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /><em>{u}</em></span></label>;
  return <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
    <section className="panel"><header>Detention and demurrage rates</header><div className="body form two">
      {num("freeHoursDetention", "Detention free time", "h")}{num("detention", "Detention rate", "USD/h")}{num("freeHoursDemurrage", "Demurrage free time", "h")}{num("demurrage", "Demurrage rate", "USD/h")}
      <button className="btn pri" disabled={JSON.stringify(r) === JSON.stringify(c.rates)} onClick={() => save({ rates: r }, "Rates saved")}>Save rates</button>
      <p className="hint" style={{ gridColumn: "1/-1" }}>Charges calculated with these rates are indicative. An approver decides each one before export.</p></div></section>
    <section className="panel"><header>Appointment source for {c.siteName}</header><div className="body form">
      {(Object.keys(SRC) as (keyof typeof SRC)[]).map((k) => <label key={k} className="radio"><input type="radio" checked={src === k} onChange={() => setSrc(k)} /><span><b>{SRC[k]}</b><br /><small className="mu">{k === "native" ? "Carriers and staff book slots in YMSNow." : `Appointments sync from ${k === "sap" ? "SAP" : "OTM"}. Booking in YMSNow becomes read-only.`}</small></span></label>)}
      <button className="btn pri" disabled={src === c.appointmentSource} onClick={() => save({ appointmentSource: src }, "Appointment source changed")}>Apply</button>
      {src !== "native" && <p className="hint">This build includes the adapter interface. The connection itself is set up per customer, with their endpoints and credentials.</p>}</div></section>
  </div>;
}

function Brand() {
  const { c, save } = useCfg(); const [name, setName] = useState(c.brandName); const [logo, setLogo] = useState(c.brandLogo);
  const pick = (f?: File) => { if (!f) return; if (f.size > 150_000) return alert("Logo must be under 150 KB"); const rd = new FileReader(); rd.onload = () => setLogo(String(rd.result)); rd.readAsDataURL(f); };
  return <section className="panel" style={{ maxWidth: 560 }}><header>Client branding</header><div className="body form">
    <label>Product name shown in the top-left<input className="ctl" value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>Logo (PNG/SVG, square, max 150 KB)<input type="file" accept="image/png,image/svg+xml,image/jpeg" onChange={(e) => pick(e.target.files?.[0])} /></label>
    <div className="brand-prev">{logo ? <img src={logo} alt="" /> : <b>{(name || "Y").slice(0, 1)}</b>}<span>{name || "YMSNow"}</span>{logo && <button className="btn sm ghost" onClick={() => setLogo("")}>Remove logo</button>}</div>
    <button className="btn pri" disabled={name === c.brandName && logo === c.brandLogo} onClick={() => save({ brandName: name, brandLogo: logo }, "Branding saved")}>Save branding</button></div></section>;
}
