import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get } from "./api";
import { AppCtx, type Data } from "./store";
import { LayoutDashboard, Map as MapIcon, ScanLine, Warehouse, Route, ClipboardList, Timer, Command, ChevronsLeft, ChevronsRight, Search, Sun, Moon, Monitor, TriangleAlert, CheckCircle2 } from "lucide-react";
import { Drawer, UnitDetail, useTheme } from "./ui";
import YardMap from "./screens/YardMap";
import ControlTower from "./screens/ControlTower";
import Gate from "./screens/Gate";
import Dock from "./screens/Dock";
import Spotter from "./screens/Spotter";
import Carrier from "./screens/Carrier";
import Detention from "./screens/Detention";

const GROUPS = ["Operate", "Partners & money"] as const;
const SCREENS = [
  { id: "tower", label: "Control tower", role: "Yard manager", key: "1", C: ControlTower, I: LayoutDashboard, group: "Operate" },
  { id: "map", label: "Yard map", role: "Yard manager", key: "2", C: YardMap, I: MapIcon, group: "Operate" },
  { id: "gate", label: "Gate console", role: "Gate guard", key: "3", C: Gate, I: ScanLine, group: "Operate" },
  { id: "dock", label: "Door board", role: "Dock supervisor", key: "4", C: Dock, I: Warehouse, group: "Operate" },
  { id: "spotter", label: "My moves", role: "Spotter", key: "5", C: Spotter, I: Route, group: "Operate" },
  { id: "carrier", label: "Appointments", role: "Carrier", key: "6", C: Carrier, I: ClipboardList, group: "Partners & money" },
  { id: "detention", label: "Detention review", role: "Finance", key: "7", C: Detention, I: Timer, group: "Partners & money" },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];
const ROLES = ["Yard manager", "Gate guard", "Dock supervisor", "Spotter", "Carrier", "Finance"];
const ROLE_ACCESS: Record<string, ScreenId[]> = {
  "Yard manager": ["tower", "map", "gate", "dock", "spotter", "carrier", "detention"], "Gate guard": ["gate", "tower", "map"], "Dock supervisor": ["dock", "map", "tower"],
  Spotter: ["spotter"], Carrier: ["carrier"], Finance: ["detention", "tower"],
};
const empty: Data = { units: [], zones: [], doors: [], appointments: [], tasks: [], charges: [], exceptions: [], carriers: [] };

export default function App() {
  const initial = (new URLSearchParams(location.search).get("s") as ScreenId) || "tower";
  const [screen, setScreen] = useState<ScreenId>(initial);
  const [role, setRole] = useState(new URLSearchParams(location.search).get("role") || "Yard manager");
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
    const [units, zones, doors, appointments, tasks, charges, exceptions, carriers] = await Promise.all([
      get<Data["units"]>("/yard/units"), get<Data["zones"]>("/yard/zones"), get<Data["doors"]>("/dock/doors"), get<Data["appointments"]>("/appointments"),
      get<Data["tasks"]>("/tasks"), get<Data["charges"]>("/detention/charges"), get<Data["exceptions"]>("/yard/exceptions"), get<Data["carriers"]>("/yard/carriers")]);
    setD({ units, zones, doors, appointments, tasks, charges, exceptions, carriers }); setLoaded(true); setOnline(true);
  }, []);
  useEffect(() => { reload().catch(() => { setOnline(false); setToast({ m: "Core service unreachable on :4000", err: true }); }); const t = setInterval(() => reload().catch(() => setOnline(false)), 10000); return () => clearInterval(t); }, [reload]);
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
  const ctx = useMemo(() => ({ d, reload, toast, run, query, carrier, unit, go, openUnit, online, focusUnit }), [d, reload, toast, run, query, carrier, unit, go, openUnit, online, focusUnit]);
  const Cur = SCREENS.find((s) => s.id === screen)!.C;
  const counts: Partial<Record<ScreenId, number>> = {
    tower: d.exceptions.filter((e) => e.severity === "high").length, gate: d.appointments.filter((a) => a.status === "booked" || a.status === "late").length,
    spotter: d.tasks.filter((t) => t.status !== "done").length, detention: d.charges.filter((c) => c.state === "indicative" || c.state === "under_review").length,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <nav className={"rail" + (wide ? " wide" : "")} aria-label="Main">
          <div className="logo"><b>Y</b><span className="lbl">YMSNow</span></div>
          {GROUPS.map((g) => <div key={g}>
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
            <span className="chip"><Warehouse size={15} />Riverside DC (demo)</span>
            <label className="search"><Search size={15} /><input ref={searchRef} placeholder="Unit, plate, appointment" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" /><kbd>/</kbd></label>
            <select className="ctl" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Demo role">{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <span className="sp" />
            <span className={"live" + (online ? "" : " off")}><i />{online ? "LIVE · " + clock : "OFFLINE · retrying"}</span>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {([["system", Monitor, "Match OS"], ["light", Sun, "Light"], ["dark", Moon, "Dark"]] as const).map(([k, I, l]) =>
                <button key={k} role="radio" aria-checked={theme.pref === k} className={theme.pref === k ? "on" : ""} onClick={() => theme.setPref(k)} title={l} aria-label={l}><I size={14} /></button>)}
            </div>
            <div className="av" title={role}>{role.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
          </header>
          <main className={"content" + (screen === "map" ? " flush" : "")}>{loaded ? <Cur key={screen} /> : <div className="empty-note">Loading site data…</div>}</main>
        </div>
      </div>
      {drawerUnit && unit(drawerUnit) && <Drawer title={<><span className="m">{unit(drawerUnit)!.number}</span><span className="mu" style={{ fontWeight: 400 }}>unit</span></>} onClose={() => setDrawerUnit(undefined)}>
        <UnitDetail u={unit(drawerUnit)!} onMove={() => { setDrawerUnit(undefined); go("map", drawerUnit); }} />
        <div style={{ padding: "0 12px 12px" }}><button className="btn" style={{ width: "100%" }} onClick={() => { const id = drawerUnit; setDrawerUnit(undefined); go("map", id); }}><MapIcon size={15} />Show on yard map</button></div>
      </Drawer>}
      {palette && <Palette onClose={() => setPalette(false)} go={(s) => { go(s); setPalette(false); }} setRole={setRole} allowed={allowed} />}
      {toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")} role="status">{toastMsg.err ? <TriangleAlert size={15} /> : <CheckCircle2 size={15} color="var(--c-ok)" />}{toastMsg.m}</div>}
    </AppCtx.Provider>
  );

  function Palette({ onClose, go, setRole, allowed }: { onClose: () => void; go: (s: ScreenId) => void; setRole: (r: string) => void; allowed: ScreenId[] }) {
    const [q, setQ] = useState(""); const [i, setI] = useState(0);
    const items = [
      ...SCREENS.filter((s) => allowed.includes(s.id)).map((s) => ({ label: "Go to " + s.label, hint: "Alt " + s.key, act: () => go(s.id) })),
      ...(["system", "light", "dark"] as const).map((t) => ({ label: "Theme: " + t, hint: "appearance", act: () => { theme.setPref(t); onClose(); } })),
      { label: (wide ? "Collapse" : "Expand") + " sidebar", hint: "layout", act: () => { setWide((w) => !w); onClose(); } },
      ...ROLES.map((r) => ({ label: "Switch role: " + r, hint: "demo", act: () => { setRole(r); onClose(); } })),
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
