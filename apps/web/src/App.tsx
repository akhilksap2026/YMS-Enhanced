import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post, setToken, getToken, setSite, type SessionUser, type Role, type TenantInfo, type Note } from "./api";
import { AppCtx, type Data } from "./store";
import { LayoutDashboard, Map as MapIcon, ScanLine, Warehouse, Route, ClipboardList, Timer, Command, ChevronsLeft, ChevronsRight, Search, Sun, Moon, Monitor, TriangleAlert, CheckCircle2, Settings, Sparkles, Bell, LogOut , Plug, BarChart3 } from "lucide-react";
import Login from "./screens/Login";
import Admin from "./screens/Admin";
import AiPreview from "./screens/AiPreview";
import Integrations from "./screens/Integrations";
import { Notifications } from "./screens/Notifications";
import { DemoBadge, Tour, DemoRoleSwitch } from "./demo/Demo";
import { Drawer, UnitDetail, useTheme } from "./ui";
import YardMap from "./screens/YardMap";
import ControlTower from "./screens/ControlTower";
import Gate from "./screens/Gate";
import Dock from "./screens/Dock";
import Spotter from "./screens/Spotter";
import Carrier from "./screens/Carrier";
import Detention from "./screens/Detention";
import Reports from "./screens/Reports";
import Account from "./screens/Account";

const GROUPS = ["Operate", "Partners & money", "Configure"] as const;
const SCREENS = [
  { id: "tower", label: "Control tower", role: "Yard manager", key: "1", C: ControlTower, I: LayoutDashboard, group: "Operate" },
  { id: "map", label: "Yard map", role: "Yard manager", key: "2", C: YardMap, I: MapIcon, group: "Operate" },
  { id: "gate", label: "Gate console", role: "Gate guard", key: "3", C: Gate, I: ScanLine, group: "Operate" },
  { id: "dock", label: "Door board", role: "Dock supervisor", key: "4", C: Dock, I: Warehouse, group: "Operate" },
  { id: "spotter", label: "My moves", role: "Spotter", key: "5", C: Spotter, I: Route, group: "Operate" },
  { id: "carrier", label: "Appointments", role: "Carrier", key: "6", C: Carrier, I: ClipboardList, group: "Partners & money" },
  { id: "detention", label: "Detention review", role: "Finance", key: "7", C: Detention, I: Timer, group: "Partners & money" },
  { id: "reports", label: "Reports", role: "Yard manager", key: "r", C: Reports, I: BarChart3, group: "Partners & money" },
  { id: "ai", label: "AI insights (preview)", role: "Tenant admin", key: "8", C: AiPreview, I: Sparkles, group: "Configure" },
  { id: "integrations", label: "Integrations", role: "Tenant admin", key: "0", C: Integrations, I: Plug, group: "Configure" },
  { id: "admin", label: "Tenant admin", role: "Tenant admin", key: "9", C: Admin, I: Settings, group: "Configure" },
] as const;
export type ScreenId = (typeof SCREENS)[number]["id"];
/** Navigation filter per role. The server enforces the same rules independently (shared/authz.ts). */
export const ROLE_ACCESS: Record<Role, ScreenId[]> = {
  tenant_admin: ["tower", "map", "gate", "dock", "spotter", "carrier", "detention", "reports", "ai", "integrations", "admin"],
  yard_manager: ["tower", "map", "gate", "dock", "spotter", "carrier", "reports", "ai"], gate_guard: ["gate", "tower", "map"], dock_supervisor: ["dock", "map", "tower", "reports"],
  spotter: ["spotter"], carrier: ["carrier"], detention_approver: ["detention", "reports", "tower"],
};
const empty: Data = { units: [], zones: [], doors: [], appointments: [], tasks: [], charges: [], exceptions: [], carriers: [] };

export default function Root() {
  const [user, setUser] = useState<SessionUser | null | undefined>(getToken() ? undefined : null);
  useEffect(() => { if (getToken()) get<SessionUser>("/auth/me").then(setUser).catch(() => { setToken(); setUser(null); }); }, []);
  useEffect(() => { const f = () => { setToken(); setUser(null); }; window.addEventListener("yms:signed-out", f); return () => window.removeEventListener("yms:signed-out", f); }, []);
  if (user === undefined) return <div className="empty-note" style={{ padding: 40 }}>Restoring session…</div>;
  if (!user) return <Login onIn={setUser} />;
  return <App key={user.userId + user.role} user={user} setUser={setUser} />;
}

function App({ user, setUser }: { user: SessionUser; setUser: (u: SessionUser | null) => void }) {
  const initial = (new URLSearchParams(location.search).get("s") as ScreenId) || "tower";
  const [screen, setScreen] = useState<ScreenId>(initial);
  const role = user.role; const can = useCallback((p: string) => user.perms.includes(p), [user.perms]);
  const [tenant, setTenant] = useState<TenantInfo | undefined>(); const [notes, setNotes] = useState<Note[]>([]); const [notesOpen, setNotesOpen] = useState(false); const [acct, setAcct] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => user.demo === true && new URLSearchParams(location.search).get("tour") !== "0" && !sessionStorage.getItem("yms.tour.seen"));
  const signOut = useCallback(() => { setToken(); setUser(null); }, [setUser]);
  const switchRole = useCallback(async (r: Role) => { const x = await post<{ token: string; user: SessionUser }>("/auth/demo/role", { role: r }); setToken(x.token); setUser(x.user); }, [setUser]);
  const [d, setD] = useState<Data>(empty);
  const [loaded, setLoaded] = useState(false);
  const [toastMsg, setToast] = useState<{ m: string; err?: boolean } | null>(null);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [wide, setWide] = useState(() => localStorage.getItem("yms.rail") === "wide");
  useEffect(() => { localStorage.setItem("yms.rail", wide ? "wide" : "narrow"); }, [wide]);
  const theme = useTheme();
  const [online, setOnline] = useState(true);
  const [focusUnit, setFocusUnit] = useState<string | undefined>(new URLSearchParams(location.search).get("unit") ?? undefined);
  const [drawerUnit, setDrawerUnit] = useState<string | undefined>();
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString("en-GB"));
  useEffect(() => { const t = setInterval(() => setClock(new Date().toLocaleTimeString("en-GB")), 1000); return () => clearInterval(t); }, []);

  const reload = useCallback(async () => {
    // Fetch only what this role may read; the server would refuse the rest anyway.
    const opt = <T,>(ok: boolean, p: string) => (ok ? get<T>(p) : Promise.resolve([] as unknown as T));
    const ops = can("ops:read");
    const [units, zones, doors, appointments, tasks, charges, exceptions, carriers, nts, ten] = await Promise.all([
      opt<Data["units"]>(ops, "/yard/units"), opt<Data["zones"]>(ops, "/yard/zones"), opt<Data["doors"]>(ops, "/dock/doors"), opt<Data["appointments"]>(can("carrier:read"), "/appointments"),
      opt<Data["tasks"]>(ops, "/tasks"), opt<Data["charges"]>(can("detention:read"), "/detention/charges"), opt<Data["exceptions"]>(ops, "/yard/exceptions"), opt<Data["carriers"]>(can("carrier:read"), "/yard/carriers"),
      opt<Note[]>(can("notes:read"), "/notifications/outbox"), get<TenantInfo>("/tenant")]);
    setD({ units, zones, doors, appointments, tasks, charges, exceptions, carriers }); setNotes(nts); setTenant(ten); setLoaded(true); setOnline(true);
  }, []);
  useEffect(() => { reload().catch(() => { setOnline(false); setToast({ m: "Core service unreachable on :4000", err: true }); }); const t = setInterval(() => reload().catch(() => setOnline(false)), user.demo ? 4000 : 10000); return () => clearInterval(t); }, [reload]);
  const toast = useCallback((m: string, err?: boolean) => { setToast({ m, err }); setTimeout(() => setToast(null), 2600); }, []);
  const run = useCallback(async (f: () => Promise<unknown>, okMsg: string) => { try { await f(); await reload(); toast(okMsg); return true; } catch (e) { toast((e as Error).message, true); return false; } }, [reload, toast]);
  const allowed = ROLE_ACCESS[role];
  useEffect(() => { if (!allowed.includes(screen)) setScreen(allowed[0]); }, [role]); // eslint-disable-line

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).matches("input,textarea,select");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === "Escape") setPalette(false);
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      const s = SCREENS.find((x) => x.key === e.key && e.altKey); if (s && allowed.includes(s.id)) { e.preventDefault(); go(s.id); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [allowed]);

  const carrier = useCallback((id: string) => d.carriers.find((c) => c.id === id)?.name.replace("Demo ", "") ?? id, [d.carriers]);
  const unit = useCallback((id?: string) => d.units.find((u) => u.id === id), [d.units]);
  const go = useCallback((s: string, u?: string) => { setScreen(s as ScreenId); setFocusUnit(u); const q = new URLSearchParams(location.search); q.set("s", s); if (u) q.set("unit", u); else q.delete("unit"); history.replaceState(null, "", "?" + q); }, []);
  const openUnit = useCallback((id: string) => setDrawerUnit(id), []);
  const ctx = useMemo(() => ({ d, reload, toast, run, query, carrier, unit, go, openUnit, online, focusUnit, user, can, tenant, screen }), [d, reload, toast, run, query, carrier, unit, go, openUnit, online, focusUnit, user, can, tenant, screen]);
  const Cur = SCREENS.find((s) => s.id === screen)!.C;
  const counts: Partial<Record<ScreenId, number>> = {
    tower: d.exceptions.filter((e) => e.severity === "high").length, gate: d.appointments.filter((a) => a.status === "booked" || a.status === "late").length,
    spotter: d.tasks.filter((t) => t.status !== "done").length, detention: d.charges.filter((c) => c.state === "indicative" || c.state === "under_review").length,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <nav className={"rail" + (wide ? " wide" : "")} aria-label="Main">
          <div className="logo">{tenant?.siteConfig.brandLogo ? <img src={tenant.siteConfig.brandLogo} alt="" className="brand-logo" /> : <b>{(tenant?.siteConfig.brandName || "Y").slice(0, 1)}</b>}<span className="lbl">{tenant?.siteConfig.brandName || "YMSNow"}</span></div>
          {GROUPS.filter((g) => SCREENS.some((s) => s.group === g && allowed.includes(s.id))).map((g) => <div key={g}>
            <div className="sec">{g}</div>
            {SCREENS.filter((s) => s.group === g && allowed.includes(s.id)).map((s) => (
              <button key={s.id} className={"nv" + (s.id === screen ? " on" : "")} onClick={() => go(s.id)} aria-current={s.id === screen ? "page" : undefined} data-tip={`${s.label}  Alt ${s.key}`} aria-label={s.label}>
                <s.I size={18} /><span className="lbl">{s.label}</span>{counts[s.id] ? <em className="badge">{counts[s.id]}</em> : null}
              </button>))}
          </div>)}
          <div className="foot">
            <button className="nv" onClick={() => setPalette(true)} data-tip="Commands  Ctrl K" aria-label="Commands"><Command size={18} /><span className="lbl">Commands</span></button>
            <button className="nv" onClick={() => setWide((w) => !w)} data-tip={wide ? "Collapse" : "Expand"} aria-label={wide ? "Collapse sidebar" : "Expand sidebar"} aria-expanded={wide}>
              {wide ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}<span className="lbl">Collapse</span></button>
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            {user.demo && <DemoBadge onTour={() => setTourOpen(true)} />}{tenant && tenant.sites.length > 1
              ? <label className="site-wrap" data-tour="site" title="Switch site: every screen shows only this site's data"><Warehouse size={15} /><select className="site-pick" aria-label="Site" value={tenant.site?.id ?? ""} onChange={(e) => { setSite(e.target.value); location.reload(); }}>{tenant.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              : <span className="chip" data-tour="site"><Warehouse size={15} />{tenant?.site?.name ?? tenant?.sites[0]?.name ?? "Site"}</span>}
            <label className="search"><Search size={15} /><input ref={searchRef} placeholder="Unit, plate, appointment" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" /><kbd>/</kbd></label>
            {user.demo && <DemoRoleSwitch role={role} onSwitch={(r) => switchRole(r).catch((e) => toast(e.message, true))} />}
            <span className="sp" />
            <span className={"live" + (online ? "" : " off")}><i />{online ? "LIVE · " + clock : "OFFLINE · retrying"}</span>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {([["system", Monitor, "Match OS"], ["light", Sun, "Light"], ["dark", Moon, "Dark"]] as const).map(([k, I, l]) =>
                <button key={k} role="radio" aria-checked={theme.pref === k} className={theme.pref === k ? "on" : ""} onClick={() => theme.setPref(k)} title={l} aria-label={l}><I size={14} /></button>)}
            </div>
            <button className="btn icon ghost bell" data-tour="notifications" onClick={() => setNotesOpen(true)} aria-label={`Notifications, ${notes.filter((n) => !n.read).length} unread`}><Bell size={16} />{notes.some((n) => !n.read) && <em>{Math.min(99, notes.filter((n) => !n.read).length)}</em>}</button>
            <div className="who btnish" role="button" tabIndex={0} title="Account and password" onClick={() => setAcct(true)} onKeyDown={(e) => e.key === "Enter" && setAcct(true)}><div className="av" title={user.name}>{user.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div><span><b>{user.name}</b><small>{user.roleLabel}</small></span></div>
            <button className="btn icon ghost" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </header>
          <main className={"content" + (screen === "map" ? " flush" : "") + (screen === "spotter" && user.demo && role !== "spotter" ? " phone-host" : "")}>{loaded ? <Cur key={screen} /> : <div className="empty-note">Loading site data…</div>}</main>
        </div>
      </div>
      {acct && <Drawer title="Account" onClose={() => setAcct(false)}><Account user={user} toast={toast} /></Drawer>}
      {drawerUnit && unit(drawerUnit) && <Drawer title={<><span className="m">{unit(drawerUnit)!.number}</span><span className="mu" style={{ fontWeight: 400 }}>unit</span></>} onClose={() => setDrawerUnit(undefined)}>
        <UnitDetail u={unit(drawerUnit)!} onMove={() => { setDrawerUnit(undefined); go("map", drawerUnit); }} />
        {can("gate:write") && <div style={{ padding: "0 12px 12px" }}><button className="btn" onClick={() => { const id = drawerUnit; void run(async () => { await post("/gate/checkout", { unitId: id }); setDrawerUnit(undefined); }, "Gated out, visit recorded"); }}>Gate out</button></div>}
        <div style={{ padding: "0 12px 12px" }}><button className="btn" style={{ width: "100%" }} onClick={() => { const id = drawerUnit; setDrawerUnit(undefined); go("map", id); }}><MapIcon size={15} />Show on yard map</button></div>
      </Drawer>}
      {palette && <Palette onClose={() => setPalette(false)} go={(s) => { go(s); setPalette(false); }} allowed={allowed} />}
      {notesOpen && <Notifications notes={notes} onClose={() => setNotesOpen(false)} />}
      {tourOpen && <Tour onClose={() => { setTourOpen(false); sessionStorage.setItem("yms.tour.seen", "1"); }} switchRole={switchRole} go={go} role={role} />}
      {toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")} role="status">{toastMsg.err ? <TriangleAlert size={15} /> : <CheckCircle2 size={15} color="var(--c-ok)" />}{toastMsg.m}</div>}
    </AppCtx.Provider>
  );

  function Palette({ onClose, go, allowed }: { onClose: () => void; go: (s: ScreenId) => void; allowed: ScreenId[] }) {
    const [q, setQ] = useState(""); const [i, setI] = useState(0);
    const items = [
      ...SCREENS.filter((s) => allowed.includes(s.id)).map((s) => ({ label: "Go to " + s.label, hint: "Alt " + s.key, act: () => go(s.id) })),
      ...(["system", "light", "dark"] as const).map((t) => ({ label: "Theme: " + t, hint: "appearance", act: () => { theme.setPref(t); onClose(); } })),
      { label: (wide ? "Collapse" : "Expand") + " sidebar", hint: "layout", act: () => { setWide((w) => !w); onClose(); } },
      ...(user.demo ? (Object.keys(ROLE_ACCESS) as Role[]).map((r) => ({ label: "Switch role: " + r.replace("_", " "), hint: "demo", act: () => { onClose(); void switchRole(r); } })) : []),
      ...(user.demo ? [{ label: "Start guided tour", hint: "demo", act: () => { onClose(); setTourOpen(true); } }] : []),
      { label: "Sign out", hint: "account", act: signOut },
      ...d.units.map((u) => ({ label: u.number, hint: `${u.location || "—"} · ${u.status}`, act: () => { onClose(); setDrawerUnit(u.id); } })),
      ...d.appointments.map((a) => ({ label: a.ref, hint: `${a.plate} · ${a.status}`, act: () => { setQuery(a.ref); go("gate"); } })),
    ].filter((x) => (x.label + x.hint).toLowerCase().includes(q.toLowerCase())).slice(0, 12);
    return (
      <div className="scrim" onClick={onClose}>
        <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
          <input autoFocus value={q} placeholder="Type a command, unit or appointment" onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => { if (e.key === "ArrowDown") setI((x) => Math.min(x + 1, items.length - 1)); if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0)); if (e.key === "Enter") items[i]?.act(); }} />
          <ul>{items.map((x, k) => <li key={x.label + k} className={k === i ? "on" : ""} onMouseEnter={() => setI(k)} onClick={x.act}><span>{x.label}</span><small>{x.hint}</small></li>)}</ul>
        </div>
      </div>);
  }
}
