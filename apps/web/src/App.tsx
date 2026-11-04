import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get } from "./api";
import { AppCtx, type Data } from "./store";
import ControlTower from "./screens/ControlTower";
import Gate from "./screens/Gate";
import Dock from "./screens/Dock";
import Spotter from "./screens/Spotter";
import Carrier from "./screens/Carrier";
import Detention from "./screens/Detention";

const SCREENS = [
  { id: "tower", label: "Control tower", role: "Yard manager", key: "1", C: ControlTower },
  { id: "gate", label: "Gate console", role: "Gate guard", key: "2", C: Gate },
  { id: "dock", label: "Door board", role: "Dock supervisor", key: "3", C: Dock },
  { id: "spotter", label: "My moves", role: "Spotter", key: "4", C: Spotter },
  { id: "carrier", label: "Appointments", role: "Carrier", key: "5", C: Carrier },
  { id: "detention", label: "Detention review", role: "Finance", key: "6", C: Detention },
] as const;
type ScreenId = (typeof SCREENS)[number]["id"];
const ROLES = ["Yard manager", "Gate guard", "Dock supervisor", "Spotter", "Carrier", "Finance"];
const ROLE_ACCESS: Record<string, ScreenId[]> = {
  "Yard manager": ["tower", "gate", "dock", "spotter", "carrier", "detention"], "Gate guard": ["gate", "tower"], "Dock supervisor": ["dock", "tower"],
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

  const reload = useCallback(async () => {
    const [units, zones, doors, appointments, tasks, charges, exceptions, carriers] = await Promise.all([
      get<Data["units"]>("/yard/units"), get<Data["zones"]>("/yard/zones"), get<Data["doors"]>("/dock/doors"), get<Data["appointments"]>("/appointments"),
      get<Data["tasks"]>("/tasks"), get<Data["charges"]>("/detention/charges"), get<Data["exceptions"]>("/yard/exceptions"), get<Data["carriers"]>("/yard/carriers")]);
    setD({ units, zones, doors, appointments, tasks, charges, exceptions, carriers }); setLoaded(true);
  }, []);
  useEffect(() => { reload().catch(() => setToast({ m: "Core service unreachable on :4000", err: true })); const t = setInterval(() => reload().catch(() => {}), 15000); return () => clearInterval(t); }, [reload]);
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
      const s = SCREENS.find((x) => x.key === e.key && e.altKey); if (s && allowed.includes(s.id)) { e.preventDefault(); setScreen(s.id); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [allowed]);

  const carrier = useCallback((id: string) => d.carriers.find((c) => c.id === id)?.name.replace("Demo ", "") ?? id, [d.carriers]);
  const unit = useCallback((id?: string) => d.units.find((u) => u.id === id), [d.units]);
  const ctx = useMemo(() => ({ d, reload, toast, run, query, carrier, unit }), [d, reload, toast, run, query, carrier, unit]);
  const Cur = SCREENS.find((s) => s.id === screen)!.C;
  const counts: Partial<Record<ScreenId, number>> = {
    tower: d.exceptions.filter((e) => e.severity === "high").length, gate: d.appointments.filter((a) => a.status === "booked" || a.status === "late").length,
    spotter: d.tasks.filter((t) => t.status !== "done").length, detention: d.charges.filter((c) => c.state === "indicative" || c.state === "under_review").length,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <nav className="nav" aria-label="Main">
          <div className="brand">YMSNow<small>demo build</small></div>
          <div className="nav-sec">
            <div className="nav-h">Operations</div>
            {SCREENS.filter((s) => allowed.includes(s.id)).map((s) => (
              <a key={s.id} className={s.id === screen ? "on" : ""} onClick={() => setScreen(s.id)} aria-current={s.id === screen ? "page" : undefined}>
                <span>{s.label}{counts[s.id] ? <span style={{ color: "#8a929b" }}> · {counts[s.id]}</span> : null}</span><kbd>Alt {s.key}</kbd>
              </a>))}
          </div>
          <div className="nav-foot">Ctrl K commands · / search<br />Fictitious demo data</div>
        </nav>
        <header className="topbar">
          <div className="ctx">
            <select className="ctl" aria-label="Site"><option>Riverside DC (demo)</option><option>North Cross-dock (demo)</option></select>
            <span className="hide-sm">Shift A · {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</span>
          </div>
          <div className="sp" />
          <input ref={searchRef} className="ctl" style={{ width: 260 }} placeholder="Find unit, plate, appointment  ( / )" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
          <select className="ctl" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Demo role">{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        </header>
        <main className="main">{loaded ? <Cur /> : <div className="empty-note">Loading site data…</div>}</main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} go={(s) => { setScreen(s); setPalette(false); }} setRole={setRole} allowed={allowed} />}
      {toastMsg && <div className={"toast" + (toastMsg.err ? " err" : "")} role="status">{toastMsg.m}</div>}
    </AppCtx.Provider>
  );

  function Palette({ onClose, go, setRole, allowed }: { onClose: () => void; go: (s: ScreenId) => void; setRole: (r: string) => void; allowed: ScreenId[] }) {
    const [q, setQ] = useState(""); const [i, setI] = useState(0);
    const items = [
      ...SCREENS.filter((s) => allowed.includes(s.id)).map((s) => ({ label: "Go to " + s.label, hint: "Alt " + s.key, act: () => go(s.id) })),
      ...ROLES.map((r) => ({ label: "Switch role: " + r, hint: "demo", act: () => { setRole(r); onClose(); } })),
      ...d.units.map((u) => ({ label: u.number, hint: `${u.location || "—"} · ${u.status}`, act: () => { setQuery(u.number); go("tower"); } })),
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
