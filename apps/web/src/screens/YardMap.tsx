import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { BellRing, Snowflake, Flame, Lock, Timer, DoorOpen, Layers, Filter, Map as MapIcon, LayoutGrid, Activity, Plus, Minus, LocateFixed, Route, Truck, ClipboardList, Move, ChevronDown, ChevronUp, X, TriangleAlert } from "lucide-react";
import { useApp } from "../store";
import { post, hoursSince, type Unit } from "../api";
import { UnitDetail, unitTone, TONE_VAR, TONE_LABEL, useReducedMotion, type Tone } from "../ui";
import { BUILDING, LANES, WORLD, along, bounds, center, doorRect, doorX, locRect, project, routeFor, slotRect, targetAt, unproject, zoneRect, type Mode, type Rect } from "../yard/geo";

type Cam = { k: number; x: number; y: number };
type Drag = { unitId: string; sx: number; sy: number; px: number; py: number; active: boolean; target?: string };
const FILTERS: (Tone | "all")[] = ["all", "reefer", "haz", "hold", "quarantine", "late", "empty"];
const CARD_W = 330, HUD_TOP = 84, HUD_BOTTOM = 190;
const heat = (h: number) => (h < 4 ? "var(--c-ok)" : h < 12 ? "var(--c-late)" : h < 36 ? "var(--c-hold)" : "var(--c-bad)");
const mix = (c: string, k: number) => `color-mix(in srgb, ${c} ${k}%, black)`;

export default function YardMap() {
  const { d, run, query, focusUnit, carrier } = useApp();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>("iso");
  const [sel, setSel] = useState<string | undefined>(focusUnit);
  const [filter, setFilter] = useState<Tone | "all">("all");
  const [cam, setCam] = useState<Cam>({ k: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 1384, h: 856 });
  const [cardMin, setCardMin] = useState(false);
  const [pick, setPick] = useState(false);
  const [hover, setHover] = useState<string | undefined>();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [t, setT] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const P = useMemo(() => project(mode), [mode]);
  const U = useMemo(() => unproject(mode), [mode]);
  const selU = d.units.find((u) => u.id === sel);
  const cardOpen = !!selU && !cardMin;

  // resize + fit: world fits the area NOT covered by HUD and the selected card, so doors D12–D14 stay visible
  useEffect(() => { const el = stage.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); return () => ro.disconnect(); }, []);
  const fit = useCallback(() => {
    const b = bounds(mode); const availW = size.w - 16 - CARD_W - 16, availH = size.h - HUD_TOP - HUD_BOTTOM + 60;
    const k = Math.min(availW / b.w, availH / b.h); setCam({ k, x: 8 + (availW - b.w * k) / 2 - b.x * k, y: HUD_TOP + (availH - b.h * k) / 2 - b.y * k });
  }, [mode, size]);
  useEffect(() => { fit(); }, [fit]);
  // animation clock for spotters
  useEffect(() => { if (reduced) { setT(0.5); return; } let raf = 0; const s = performance.now(); const tick = (n: number) => { setT(((n - s) / 9000) % 1); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [reduced]);

  const toScreen = (wx: number, wy: number, z = 0) => { const [x, y] = P(wx, wy, z); return [x * cam.k + cam.x, y * cam.k + cam.y] as const; };
  const toWorld = (sx: number, sy: number) => U((sx - cam.x) / cam.k, (sy - cam.y) / cam.k);
  const local = (e: { clientX: number; clientY: number }) => { const r = stage.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };

  // placement: unknown locations ("W-zone", "Gate 1") queue in the inbound lanes
  const placed = useMemo(() => { let o = 0; return d.units.filter((u) => u.location).map((u) => ({ u, r: slotRect(u.location) || doorRect(u.location) ? locRect(u.location) : locRect(u.location, o++) })); }, [d.units]);
  const counts = useMemo(() => { const c: Record<string, number> = { all: d.units.length }; for (const u of d.units) c[unitTone(u)] = (c[unitTone(u)] ?? 0) + 1; return c; }, [d.units]);
  const q = query.trim().toUpperCase();
  const dim = (u: Unit) => (filter !== "all" && unitTone(u) !== filter) || (q && !u.number.includes(q));
  const active = d.tasks.filter((x) => x.status !== "done");
  const occupiedTargets = new Set([...d.zones.flatMap((z) => z.slots.filter((s) => s.unitId).map((s) => s.label)), ...d.doors.filter((x) => x.state !== "free").map((x) => x.label), ...active.map((x) => x.to)]);
  const validTarget = (label?: string) => !!label && !occupiedTargets.has(label);

  const createMove = (unitId: string, to: string) => run(() => post("/tasks", { unitId, to, priority: to.startsWith("D") ? 1 : 2 }), `Move ${d.units.find((u) => u.id === unitId)?.number} → ${to} queued`);

  // keyboard: D assign, M move, H hold, R release, Esc cancel, +/- zoom
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select") || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "Escape") { if (pick) setPick(false); else setSel(undefined); }
      if (e.key === "+" || e.key === "=") zoom(1.2); if (e.key === "-") zoom(1 / 1.2); if (e.key === "0") fit();
      if (!selU) return; const key = e.key.toLowerCase();
      if (key === "m") setPick(true);
      if (key === "h" && selU.status !== "hold" && selU.status !== "quarantine") run(() => post(`/yard/units/${selU.id}/hold`, {}), `${selU.number} on hold`);
      if (key === "r" && selU.status === "hold") run(() => post(`/yard/units/${selU.id}/release`), `${selU.number} released`);
      if (key === "d") { const f = d.doors.find((x) => x.state === "free" && !occupiedTargets.has(x.label)); if (f) createMove(selU.id, f.label); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const zoom = (f: number, cx = size.w / 2 - CARD_W / 2, cy = size.h / 2) => setCam((c) => { const k = Math.max(0.4, Math.min(4, c.k * f)); const r = k / c.k; return { k, x: cx - (cx - c.x) * r, y: cy - (cy - c.y) * r }; });
  const onWheel = (e: React.WheelEvent) => { const [x, y] = local(e); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, x, y); };
  useEffect(() => { const el = stage.current; if (!el) return; const f = (e: WheelEvent) => e.preventDefault(); el.addEventListener("wheel", f, { passive: false }); return () => el.removeEventListener("wheel", f); }, []);

  const onBgDown = (e: RPE) => { if ((e.target as Element).closest("[data-unit],[data-target],.hud")) return; panRef.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  const onMove = (e: RPE) => {
    if (panRef.current) { const p = panRef.current; setCam((c) => ({ ...c, x: p.cx + e.clientX - p.x, y: p.cy + e.clientY - p.y })); return; }
    const [sx, sy] = local(e);
    if (drag) { const moved = drag.active || Math.hypot(sx - drag.sx, sy - drag.sy) > 6; const [wx, wy] = toWorld(sx, sy); setDrag({ ...drag, px: sx, py: sy, active: moved, target: moved ? targetAt(wx, wy, d.zones, d.doors) : undefined }); return; }
    if (pick) { const [wx, wy] = toWorld(sx, sy); setHover(targetAt(wx, wy, d.zones, d.doors)); }
  };
  const onUp = () => {
    panRef.current = null;
    if (drag) { if (drag.active && drag.target && validTarget(drag.target)) createMove(drag.unitId, drag.target); else if (!drag.active) { setSel(drag.unitId); setCardMin(false); setPick(false); } setDrag(null); return; }
    if (pick && selU && hover) { if (validTarget(hover)) { createMove(selU.id, hover); setPick(false); } }
  };
  const onUnitDown = (e: RPE, u: Unit) => { e.stopPropagation(); if (pick) return; const [sx, sy] = local(e); stage.current?.setPointerCapture(e.pointerId); setDrag({ unitId: u.id, sx, sy, px: sx, py: sy, active: false }); };

  // ---- drawing helpers (world -> svg in base projection space; camera applied on <g>) ----
  const pts = (a: [number, number][]) => a.map((p) => p.join(",")).join(" ");
  const quad = (r: Rect, z = 0) => pts([P(r.x, r.y, z), P(r.x + r.w, r.y, z), P(r.x + r.w, r.y + r.l, z), P(r.x, r.y + r.l, z)]);
  const box = (r: Rect, h: number, col: string, key: string, extra: { stroke?: string; sw?: number; op?: number } = {}) => mode === "plan"
    ? <polygon key={key} points={quad(r)} style={{ fill: col, stroke: extra.stroke ?? mix(col, 70), opacity: extra.op }} strokeWidth={extra.sw ?? 0.8} />
    : <g key={key} style={{ opacity: extra.op }}>
      <polygon points={pts([P(r.x, r.y + r.l), P(r.x + r.w, r.y + r.l), P(r.x + r.w, r.y + r.l, h), P(r.x, r.y + r.l, h)])} style={{ fill: mix(col, 55) }} />
      <polygon points={pts([P(r.x + r.w, r.y), P(r.x + r.w, r.y + r.l), P(r.x + r.w, r.y + r.l, h), P(r.x + r.w, r.y, h)])} style={{ fill: mix(col, 75) }} />
      <polygon points={quad(r, h)} style={{ fill: col, stroke: extra.stroke ?? `color-mix(in srgb, ${col} 80%, white)` }} strokeWidth={extra.sw ?? 0.5} /></g>;
  const H = mode === "plan" ? 0 : 1;

  const ground = useMemo(() => {
    const g: React.ReactNode[] = [];
    g.push(<polygon key="gp" points={quad({ x: WORLD.x0, y: WORLD.y0, w: WORLD.x1 - WORLD.x0, l: WORLD.y1 - WORLD.y0 })} style={{ fill: "var(--map-ground)", stroke: "var(--line)" }} />);
    for (let i = 0; i <= 52; i += 2) { const a = P(WORLD.x0 + i, WORLD.y0), b = P(WORLD.x0 + i, WORLD.y1); g.push(<line key={"gl" + i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ stroke: "var(--map-grid)" }} strokeWidth={0.6} />); }
    [{ x: 2, y: 5, w: 38, l: 1.6 }, { x: 2, y: 22.3, w: 38, l: 1.2 }, { x: 38.4, y: 5, w: 1.6, l: 31 }, { x: 2, y: 5, w: 1.6, l: 31 }].forEach((r, i) => g.push(<polygon key={"rd" + i} points={quad(r)} style={{ fill: "var(--map-road)" }} />));
    for (const z of d.zones) {
      const r = zoneRect(z), tint = z.kind === "reefer" ? "var(--c-reefer)" : z.kind === "hold" ? "var(--c-hold)" : "var(--map-slot)";
      g.push(<polygon key={"z" + z.id} points={quad({ x: r.x - .3, y: r.y - .3, w: r.w + .4, l: r.l + .6 })} style={{ fill: "transparent", stroke: tint }} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.8} />);
      z.slots.forEach((s) => { const sr = slotRect(s.label)!; g.push(<polygon key={s.id} points={quad(sr)} style={{ fill: "none", stroke: "var(--map-slot)" }} strokeWidth={0.6} />); });
      const lp = P(r.x - 1.2, r.y + r.l / 2); g.push(<text key={"zl" + z.id} x={lp[0]} y={lp[1] + 4} textAnchor="middle" style={{ fill: "var(--map-label)", font: "700 12px var(--font)" }}>{z.name}</text>);
    }
    LANES.forEach((l, i) => { g.push(<polygon key={"ln" + i} points={quad(l)} style={{ fill: "var(--map-road)", stroke: "var(--line-strong)" }} strokeWidth={0.7} />);
      const a = P(l.x, 20), b = P(l.x + l.w, 20); g.push(<line key={"lb" + i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ stroke: l.inbound ? "var(--c-live)" : "var(--c-acc)" }} strokeWidth={2} />);
      const lp = P(l.x + .9, 37.2); g.push(<text key={"lt" + i} x={lp[0]} y={lp[1] + 10} textAnchor="middle" style={{ fill: "var(--map-label)", font: "9.5px var(--mono)" }}>{l.label}</text>); });
    return g;
  }, [d.zones, P]); // eslint-disable-line

  // depth-sorted solids
  const solids: { k: number; n: React.ReactNode }[] = [];
  solids.push({ k: -100, n: <g key="bldg">{box(BUILDING, mode === "plan" ? 0 : 3.2, "var(--map-bldg)", "b")}</g> });
  for (const { u, r } of placed) {
    const tone = unitTone(u); const col = mode === "heat" ? heat(hoursSince(u.gateInAt)) : TONE_VAR[tone];
    const isSel = u.id === sel; const h = u.load === "empty" ? 1.1 : 1.35; const ur = { x: r.x + .05, y: r.y + .2, w: 1.75, l: Math.min(3.8, r.l - .2) };
    const [cx, cy] = center(ur); const top = P(cx, cy, h * H);
    solids.push({ k: ur.x + ur.y + ur.w / 2 + ur.l, n: <g key={u.id} data-unit={u.id} style={{ cursor: pick ? "crosshair" : "grab" }} onPointerDown={(e) => onUnitDown(e, u)}>
      <title>{`${u.number} · ${TONE_LABEL[tone]} · ${u.location} · ${carrier(u.carrierId)}`}</title>
      {box(ur, h * H, col, "bx", { stroke: isSel ? "var(--c-acc)" : undefined, sw: isSel ? 2 : undefined, op: dim(u) ? 0.18 : 1 })}
      {mode !== "heat" && tone === "haz" && <polygon points={`${top[0]},${top[1] - 5} ${top[0] + 5},${top[1]} ${top[0]},${top[1] + 5} ${top[0] - 5},${top[1]}`} fill="#1a1500" opacity={dim(u) ? .2 : 1} />}
      {mode !== "heat" && (tone === "hold" || tone === "quarantine") && <g opacity={dim(u) ? .2 : 1} stroke={tone === "hold" ? "#3a1a05" : "#3a0508"} strokeWidth={1.4}><line x1={top[0] - 4} y1={top[1] - 4} x2={top[0] + 4} y2={top[1] + 4} /><line x1={top[0] + 4} y1={top[1] - 4} x2={top[0] - 4} y2={top[1] + 4} /></g>}
      {mode !== "heat" && tone === "reefer" && <rect x={top[0] - 4} y={top[1] - 2} width={8} height={4} fill="#0b2a3a" opacity={dim(u) ? .2 : 1} />}
      {mode !== "heat" && u.reefer && u.status === "warn" && <circle cx={top[0] + 7} cy={top[1] - 6} r={3} fill="var(--c-bad)" stroke="var(--map-ground)" />}
    </g> });
  }
  // spotters: one per active assigned/in-progress task, animated along road route
  const spotters = active.filter((x) => x.status !== "open").slice(0, 6).map((x, i) => {
    const route = routeFor(x.from, x.to, i); const prog = x.status === "in_progress" ? (t + i * 0.27) % 1 : 0.02;
    const [wx, wy] = along(route, prog); const col = i === 0 ? "var(--c-acc)" : "var(--c-live)";
    solids.push({ k: wx + wy + 1, n: <g key={"sp" + x.id}>{box({ x: wx - .6, y: wy - .6, w: 1.2, l: 1.2 }, H, col, "s")}</g> });
    return { x, route, wx, wy, col, label: x.assignee ?? "Spotter" };
  });
  solids.sort((a, b) => a.k - b.k);

  // dock doors (drawn on the building face, above solids)
  const doorEls = d.doors.map((x, i) => {
    const n = i + 1, xx = doorX(n); const busy = active.some((tk) => tk.to === x.label);
    const c = x.state === "blocked" ? "var(--c-bad)" : x.state === "occupied" ? "var(--c-ok)" : busy ? "var(--c-acc)" : "var(--map-label)";
    const a = P(xx, 3.6, .15 * H), b = P(xx + 1.5, 3.6, .15 * H), a2 = P(xx, 3.6, 1.9 * H), b2 = P(xx + 1.5, 3.6, 1.9 * H), lp = P(xx + .75, 3.8, 2.2 * H);
    const pf = mode === "plan" ? pts([P(xx, 3.1), P(xx + 1.5, 3.1), P(xx + 1.5, 3.6), P(xx, 3.6)]) : pts([a, b, b2, a2]);
    return <g key={x.id} data-target={x.label}><polygon points={pf} style={{ fill: x.state === "free" ? "var(--bg)" : `color-mix(in srgb, ${c} 35%, transparent)`, stroke: c }} strokeWidth={1} />
      <text x={lp[0]} y={lp[1] - 4} textAnchor="middle" style={{ fill: c, font: "600 8.5px var(--mono)" }}>{x.label}</text></g>;
  });
  const targetLabel = drag?.target ?? (pick ? hover : undefined);
  const targetR = targetLabel ? (slotRect(targetLabel) ?? doorRect(targetLabel)) : undefined;
  const targetOk = validTarget(targetLabel);

  // card placement: right by default; flip to left if the selected unit would sit under it
  const selScreen = selU ? (() => { const p = placed.find((x) => x.u.id === selU.id); if (!p) return undefined; const [cx, cy] = center(p.r); return toScreen(cx, cy, 1.4 * H); })() : undefined;
  const cardLeft = !!selScreen && selScreen[0] > size.w - CARD_W - 40;
  const dragFrom = drag?.active ? (() => { const p = placed.find((x) => x.u.id === drag.unitId); if (!p) return; const [cx, cy] = center(p.r); return toScreen(cx, cy, 1.4 * H); })() : undefined;

  // minimap (plan projection, independent scale)
  const mm = { w: 220, h: 150, s: 220 / (WORLD.x1 - WORLD.x0 + 2) };
  const mp = (x: number, y: number) => [4 + (x - WORLD.x0) * mm.s, 4 + (y - WORLD.y0) * mm.s * 0.98] as const;
  const corners = [toWorld(0, HUD_TOP), toWorld(size.w, HUD_TOP), toWorld(size.w, size.h), toWorld(0, size.h)].map(([x, y]) => mp(x, y));
  const centerOn = (wx: number, wy: number) => { const [x, y] = P(wx, wy); setCam((c) => ({ ...c, x: (size.w - CARD_W) / 2 - x * c.k, y: size.h / 2 - y * c.k })); };

  return (<div className="ymap2" ref={stage} onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} style={{ cursor: panRef.current ? "grabbing" : pick ? "crosshair" : "default" }}>
    <svg className="world" width={size.w} height={size.h} role="img" aria-label="Yard map">
      <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
        {ground}
        {d.zones.flatMap((z) => z.slots).filter((s) => !s.unitId).map((s) => { const r = slotRect(s.label)!; return <polygon key={"hit" + s.id} data-target={s.label} points={quad(r)} fill="transparent" />; })}
        {spotters.map((s) => { const sp = s.route.map(([x, y]) => P(x, y, .05)); const e = sp[sp.length - 1]; return <g key={"rt" + s.x.id}>
          <polyline points={pts(sp)} fill="none" style={{ stroke: s.col }} strokeOpacity={.22} strokeWidth={7} strokeLinejoin="round" />
          <polyline points={pts(sp)} fill="none" style={{ stroke: s.col, animation: reduced ? undefined : "dash 1s linear infinite" }} strokeWidth={1.6} strokeDasharray="5 4" strokeLinejoin="round" />
          <circle cx={e[0]} cy={e[1]} r={5} fill="none" style={{ stroke: s.col }} strokeWidth={1.5} /></g>; })}
        {active.filter((x) => x.status === "open").map((x) => { const a = center(locRect(x.from)), b = center(locRect(x.to)); const pa = P(a[0], a[1], 1.4 * H), pb = P(b[0], b[1]); return <line key={"op" + x.id} x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} style={{ stroke: "var(--text-3)" }} strokeDasharray="2 4" strokeWidth={1.2} />; })}
        {solids.map((s) => s.n)}
        {doorEls}
        {targetR && <polygon points={quad(targetR)} style={{ fill: targetOk ? "color-mix(in srgb, var(--c-acc) 22%, transparent)" : "color-mix(in srgb, var(--c-bad) 22%, transparent)", stroke: targetOk ? "var(--c-acc)" : "var(--c-bad)" }} strokeWidth={1.6} strokeDasharray="4 3" />}
        {spotters.map((s) => { const lp = P(s.wx, s.wy, 2.4 * H); return <g key={"sl" + s.x.id} pointerEvents="none"><rect x={lp[0] - 40} y={lp[1] - 16} width={80} height={15} rx={3} style={{ fill: "var(--bg)", stroke: s.col }} strokeOpacity={.7} />
          <text x={lp[0]} y={lp[1] - 5} textAnchor="middle" style={{ fill: s.col, font: "9.5px var(--mono)" }}>{s.label}</text></g>; })}
        {selU && (() => { const p = placed.find((x) => x.u.id === selU.id); if (!p) return null; const [cx, cy] = center(p.r); const sl = P(cx, cy, 2.4 * H); const w = selU.number.length * 6.6 + 14;
          return <g pointerEvents="none"><line x1={sl[0]} y1={sl[1]} x2={sl[0]} y2={sl[1] - 18} style={{ stroke: "var(--c-acc)" }} /><rect x={sl[0] - w / 2} y={sl[1] - 36} width={w} height={18} rx={3} style={{ fill: "var(--c-acc)" }} />
            <text x={sl[0]} y={sl[1] - 23} textAnchor="middle" style={{ fill: "#14100a", font: "700 10.5px var(--mono)" }}>{selU.number}</text></g>; })()}
      </g>
      {dragFrom && drag && <path d={`M${dragFrom[0]},${dragFrom[1]} Q${(dragFrom[0] + drag.px) / 2 + 30},${Math.min(dragFrom[1], drag.py) - 40} ${drag.px},${drag.py}`} fill="none" style={{ stroke: "var(--c-acc)" }} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" />}
    </svg>

    {drag?.active && <div className="hud panel dragtip" style={{ left: drag.px + 16, top: drag.py - 14, borderColor: targetOk ? "var(--c-acc)" : "var(--c-bad)" }}><Move size={14} />
      {drag.target ? (targetOk ? <span>Drop on <b className="m">{drag.target}</b> · {drag.target.startsWith("D") ? "assign door" : "move"}</span> : <span style={{ color: "var(--bad)" }}><b className="m">{drag.target}</b> occupied or pending</span>) : <span className="mu">Drag onto a free slot or door</span>}</div>}

    <div className="hud panel ticker"><span className="lab"><BellRing size={14} />ALERTS</span>
      {d.exceptions.slice(0, 7).map((x) => { const u = d.units.find((y) => y.id === x.unitId); const I = u?.reefer ? Snowflake : u?.hazmat ? Flame : u?.status === "hold" ? Lock : x.severity === "high" ? TriangleAlert : Timer;
        return <button key={x.id} className="it" style={{ color: x.severity === "high" ? "var(--bad)" : x.severity === "med" ? "var(--warn)" : "var(--text-2)" }} onClick={() => { if (u) { setSel(u.id); setCardMin(false); const p = placed.find((y) => y.u.id === u.id); if (p) centerOn(...center(p.r)); } }}>
          <I size={13} /><span>{x.text}</span><span className="mu m">{Math.max(1, Math.round(hoursSince(x.at) * 60))}m</span></button>; })}
      {!d.exceptions.length && <span className="it mu">No open alerts</span>}
    </div>
    <div className="hud filters">
      {FILTERS.map((f) => <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={() => setFilter(f)} aria-pressed={filter === f}>
        {f === "all" ? <Layers size={14} /> : <span className="dot" style={{ background: TONE_VAR[f] }} />}{f === "all" ? "All units" : TONE_LABEL[f]}<span className="n">{counts[f] ?? 0}</span></button>)}
      {q && <span className="chip on"><Filter size={14} />“{query}”</span>}
    </div>
    <div className="hud panel mode seg" style={{ right: cardOpen && !cardLeft ? CARD_W + 16 : 8 }} role="radiogroup" aria-label="Map mode">
      {([["iso", MapIcon, "2.5D"], ["plan", LayoutGrid, "Plan"], ["heat", Activity, "Heat"]] as const).map(([k, I, l]) => <button key={k} role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}><I size={14} />{l}</button>)}
    </div>
    {mode === "heat" && <div className="hud panel heatleg"><span className="mu">Dwell</span>{[["< 4 h", "var(--c-ok)"], ["4–12 h", "var(--c-late)"], ["12–36 h", "var(--c-hold)"], ["> 36 h", "var(--c-bad)"]].map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>}

    {selU && <div className={"hud panel ycard" + (cardMin ? " min" : "") + (cardLeft ? " left" : "")} aria-label="Selected unit">
      <div className="ycard-bar"><span className="m">{cardMin ? selU.number : "Selected"}</span>{pick && <span className="tag t-live">pick a target</span>}<span className="sp" />
        <button className="btn icon ghost sm" onClick={() => setCardMin((m) => !m)} aria-label={cardMin ? "Expand card" : "Collapse card"}>{cardMin ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
        <button className="btn icon ghost sm" onClick={() => { setSel(undefined); setPick(false); }} aria-label="Close"><X size={15} /></button></div>
      {!cardMin && <UnitDetail u={selU} compact onMove={() => setPick((p) => !p)} onAssign={(doorId) => { const l = d.doors.find((x) => x.id === doorId)!.label; createMove(selU.id, l); }} />}
      {pick && !cardMin && <div className="hint-line"><Move size={14} color="var(--c-acc)" /><span>Click a free slot or door on the map. <kbd>Esc</kbd> cancels.</span></div>}
    </div>}

    <div className="hud panel zoom"><button onClick={() => zoom(1.2)} aria-label="Zoom in"><Plus size={16} /></button><button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out"><Minus size={16} /></button><button onClick={fit} aria-label="Fit yard"><LocateFixed size={16} /></button></div>
    <div className="hud panel mini" aria-label="Minimap">
      <svg viewBox={`0 0 ${mm.w} ${mm.h}`} onPointerDown={(e) => { e.stopPropagation(); const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = (e.clientX - r.left) * mm.w / r.width, y = (e.clientY - r.top) * mm.h / r.height; centerOn(WORLD.x0 + (x - 4) / mm.s, WORLD.y0 + (y - 4) / (mm.s * .98)); }}>
        <rect x={1} y={1} width={mm.w - 2} height={mm.h - 2} rx={4} style={{ fill: "var(--bg)", stroke: "var(--line-strong)" }} />
        <rect x={mp(BUILDING.x, BUILDING.y)[0]} y={mp(BUILDING.x, BUILDING.y)[1]} width={BUILDING.w * mm.s} height={BUILDING.l * mm.s} style={{ fill: "var(--map-bldg)" }} />
        {d.zones.map((z) => { const r = zoneRect(z); return <rect key={z.id} x={mp(r.x, r.y)[0]} y={mp(r.x, r.y)[1]} width={r.w * mm.s} height={r.l * mm.s} style={{ fill: z.kind === "reefer" ? "color-mix(in srgb, var(--c-reefer) 35%, transparent)" : z.kind === "hold" ? "color-mix(in srgb, var(--c-hold) 35%, transparent)" : "var(--surface-2)" }} />; })}
        {LANES.map((l, i) => <rect key={i} x={mp(l.x, l.y)[0]} y={mp(l.x, l.y)[1]} width={l.w * mm.s} height={l.l * mm.s} style={{ fill: "var(--surface-2)" }} />)}
        {placed.filter(({ u }) => unitTone(u) !== "ok" && unitTone(u) !== "empty").map(({ u, r }) => { const [x, y] = mp(...center(r)); return <circle key={u.id} cx={x} cy={y} r={1.8} style={{ fill: TONE_VAR[unitTone(u)] }} />; })}
        {spotters.map((s) => { const [x, y] = mp(s.wx, s.wy); return <circle key={s.x.id} cx={x} cy={y} r={2.6} style={{ fill: s.col }} />; })}
        <polygon points={corners.map((c) => c.join(",")).join(" ")} fill="none" style={{ stroke: "var(--c-acc)" }} strokeWidth={1.2} />
      </svg>
    </div>
    <div className="hud panel queue">
      <div className="qh"><Route size={14} />Task queue<span className="tag t-live">{active.length} open</span><span className="sp" /><span className="mu" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>drag a unit onto a door or slot to create a move</span></div>
      {active.slice().sort((a, b) => a.priority - b.priority).slice(0, 4).map((x) => { const u = d.units.find((y) => y.id === x.unitId); const pr = x.status === "in_progress" ? Math.round(((t + 0.3) % 1) * 100) : x.status === "assigned" ? 12 : 0;
        return <button key={x.id} className="row q" onClick={() => { if (u) { setSel(u.id); setCardMin(false); } }}>
          <span style={{ color: x.status === "open" ? "var(--text-3)" : "var(--c-live)" }}>{x.status === "open" ? <ClipboardList size={14} /> : <Truck size={14} />}</span>
          <b className="m">{u?.number ?? x.unitId}</b><span className="m">{x.from} → {x.to}</span>
          {x.status === "open" ? <span className="mu">queued · P{x.priority}</span> : <div className="prog"><span style={{ width: pr + "%" }} /></div>}
          <span className={x.assignee ? "" : "mu"}>{x.assignee ?? "unassigned"}</span><span className="m mu" style={{ textAlign: "right" }}>{x.status.replace("_", " ")}</span></button>; })}
      {!active.length && <div className="empty-note">No open moves.</div>}
    </div>
    <div className="hud legend2"><DoorOpen size={13} />{d.doors.filter((x) => x.state === "free").length} doors free · {d.doors.filter((x) => x.state === "blocked").map((x) => x.label).join(", ") || "none"} blocked</div>
  </div>);
}
