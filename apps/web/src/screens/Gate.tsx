import { Camera, CheckCircle2, CircleAlert, ShieldAlert, Pause, DoorOpen, Clock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store";
import { fmtTime, get, post, upload, type Appointment } from "../api";
import { Upload, Sparkles } from "lucide-react";

type V = { valid: boolean; reason?: string; normalized: string } | null;
export default function Gate() {
  const { d, run, query, carrier } = useApp();
  const queue = useMemo(() => d.appointments.filter((a) => ["booked", "late"].includes(a.status)).sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    .filter((a) => !query || (a.ref + a.plate + a.unitNumber).toUpperCase().includes(query.toUpperCase())), [d.appointments, query]);
  const [selId, setSel] = useState<string | undefined>(queue[0]?.id);
  const sel: Appointment | undefined = queue.find((a) => a.id === selId) ?? queue[0];
  const [plate, setPlate] = useState(""); const [unitNo, setUnit] = useState(""); const [seal, setSeal] = useState(""); const [v, setV] = useState<V>(null);
  const plateRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Partial<Record<Kind, Shot>>>({});
  useEffect(() => { setShots({}); }, [sel?.id]);
  const runOcr = async (kind: Kind, blob: Blob) => {
    const url = URL.createObjectURL(blob); setShots((x) => ({ ...x, [kind]: { url, busy: true } }));
    const f = new FormData(); f.append("image", blob, "gate.jpg"); f.append("kind", kind === "plate" ? "plate" : "container");
    try { const r = await upload<OcrResult>("/gate/ocr", f); setShots((x) => ({ ...x, [kind]: { url, res: r } }));
      if (kind === "plate" && r.plate) setPlate(r.plate.plate); if (kind === "box" && r.container) setUnit(r.container.number);
    } catch (e) { setShots((x) => ({ ...x, [kind]: { url, err: (e as Error).message } })); }
  };
  useEffect(() => { if (sel) { setPlate(sel.plate ?? ""); setUnit(sel.unitNumber ?? ""); setSeal(""); plateRef.current?.focus(); } }, [sel?.id]); // eslint-disable-line
  useEffect(() => { const n = unitNo.trim(); if (!/^[A-Za-z]{4}/.test(n)) { setV(n ? { valid: true, normalized: n.toUpperCase() } : null); return; }
    const t = setTimeout(() => get<V>(`/gate/validate/${encodeURIComponent(n)}`).then(setV).catch(() => {}), 150); return () => clearTimeout(t); }, [unitNo]);
  const plateMatch = sel && plate.trim().toUpperCase() === (sel.plate ?? "").toUpperCase();
  const norm = (x: string) => x.trim().toUpperCase().replace(/[\s-]/g, "");
  const unitMatch = sel && norm(unitNo) === norm(sel.unitNumber ?? "");
  const decide = (decision: "pass" | "hold" | "quarantine") => sel && run(async () => { try { return await post("/gate/checkin", { appointmentId: sel.id, plate, unitNumber: unitNo, decision, seal }); } catch (e) { const m = (e as Error).message; if (/^Seal /.test(m)) { const why = prompt(m + "\n\nOverride reason (leave empty to stop):"); if (why?.trim()) return post("/gate/checkin", { appointmentId: sel.id, plate, unitNumber: unitNo, decision, seal, sealOverride: why }); } throw e; } }, `${sel.ref}: ${decision.toUpperCase()} recorded, driver notified`);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (!e.altKey) return; if (e.key === "p") { e.preventDefault(); if (v?.valid) decide("pass"); } if (e.key === "h") { e.preventDefault(); decide("hold"); } if (e.key === "q") { e.preventDefault(); decide("quarantine"); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });

  const late = sel ? Math.max(0, Math.round((Date.now() - Date.parse(sel.slotStart)) / 60000)) : 0;
  const checks: [string, boolean | null, string][] = sel ? [
    ["Appointment found", true, sel.ref + " · " + sel.source.toUpperCase()],
    ["Plate matches", plate ? !!plateMatch : null, plate ? (plateMatch ? sel.plate ?? "" : "expected " + sel.plate) : "waiting for read"],
    ["Unit number valid", v ? v.valid : null, v ? (v.valid ? (/^[A-Z]{4}/.test(v.normalized) ? "ISO 6346 check digit OK" : "trailer ID") : v.reason ?? "invalid") : "waiting for read"],
    ["Unit matches appointment", unitNo ? !!unitMatch : null, unitNo ? (unitMatch ? "matches" : "expected " + sel.unitNumber) : "—"],
    ["Within slot window", sel.status !== "late", sel.status === "late" ? `${late} min late` : "on time"],
    ["Seal recorded", seal ? true : null, seal || "optional"],
  ] : [];
  const free = d.doors.filter((x) => x.state === "free").length;
  return (<div className="gate2">
    <section className="w gq"><h3><Clock size={14} />Arrivals<span className="r">{queue.length} expected · ↑↓</span></h3>
      <div className="scroll" tabIndex={0} onKeyDown={(e) => { const i = queue.findIndex((a) => a.id === sel?.id); if (e.key === "ArrowDown") setSel(queue[Math.min(i + 1, queue.length - 1)]?.id); if (e.key === "ArrowUp") setSel(queue[Math.max(i - 1, 0)]?.id); }}>
        {queue.map((a) => <button key={a.id} className={"arr" + (a.id === sel?.id ? " on" : "")} onClick={() => setSel(a.id)}>
          <span className="m t">{fmtTime(a.slotStart)}</span><span className="ell"><b className="m">{a.unitNumber}</b><small className="mu ell">{carrier(a.carrierId)} · {a.plate} · {a.direction === "inbound" ? "In" : "Out"}</small></span>
          <span className={"tag " + (a.status === "late" ? "t-late" : "t-idle")}>{a.status}</span></button>)}
        {!queue.length && <div className="empty-note">No expected arrivals match.</div>}</div></section>
    {sel ? <>
      <section className="w gcam"><h3><Camera size={14} />Lane 1 · inbound<span className="r"><span className="tag t-live">OCR · PP-OCR + ISO 6346</span></span></h3>
        <div className="cams">
          <Cam label="CAM-1 · plate" text={sel.plate ?? "—"} kind="plate" shot={shots.plate} onImage={(b) => runOcr("plate", b)} />
          <Cam label="CAM-2 · container" text={sel.unitNumber ?? "—"} kind="box" shot={shots.box} onImage={(b) => runOcr("box", b)} />
        </div>
        <div className="reads">
          <div className="fld"><label htmlFor="pl">Plate read</label><input id="pl" ref={plateRef} className="ctl m big" value={plate} onChange={(e) => setPlate(e.target.value)} /></div>
          <div className="fld"><label htmlFor="un">Unit / container read</label><input id="un" className="ctl m big" value={unitNo} onChange={(e) => setUnit(e.target.value)} /></div>
          <div className="fld"><label htmlFor="se">Seal</label><input id="se" className="ctl m big" value={seal} onChange={(e) => setSeal(e.target.value)} placeholder="optional" /></div>
        </div>
        <p className="hint" style={{ padding: "0 12px 10px" }}>Upload or capture a photo per camera (or try a sample) and the OCR service reads it. Until an image is read, fields show the appointment's expected values. Edit any field to correct a read; ISO 6346 validation runs live.</p></section>
      <section className="w gchk"><h3><ShieldAlert size={14} />Checks<span className="r m">{sel.ref}</span></h3>
        <div className="checks">{checks.map(([l, ok, s]) => <div key={l} className={"ck " + (ok === null ? "na" : ok ? "ok" : "bad")}>
          {ok === false ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}<span>{l}<small className="ell">{s}</small></span></div>)}</div>
        <div className="kvs"><span className="mu">Carrier</span><b>{carrier(sel.carrierId)}</b><span className="mu">Slot</span><b className="m">{fmtTime(sel.slotStart)}–{fmtTime(sel.slotEnd)}</b><span className="mu">Doors free</span><b className="m">{free}</b></div>
        <div className="gacts">
          <button className="btn ok lg" disabled={!v?.valid} onClick={() => decide("pass")}><DoorOpen size={16} />Admit<kbd>Alt P</kbd></button>
          <div className="row" style={{ gap: 6 }}><button className="btn hold" style={{ flex: 1 }} onClick={() => decide("hold")}><Pause size={14} />Hold<kbd>Alt H</kbd></button>
            <button className="btn bad" style={{ flex: 1 }} onClick={() => decide("quarantine")}><ShieldAlert size={14} />Quarantine<kbd>Alt Q</kbd></button></div>
          <span className="hint">Admit opens the barrier and creates the spot task. Hold and quarantine keep it closed and alert the control tower.</span></div></section>
    </> : <section className="w" style={{ gridColumn: "2 / 4" }}><div className="empty-note">No arrival selected.</div></section>}
  </div>);
}
type Kind = "plate" | "box";
type OcrResult = { container: null | { number: string; valid: boolean; confidence: number; suggested: string | null }; plate: null | { plate: string; confidence: number }; confidence: number; route: string; engine: string; tokens: { text: string; score: number; box: number[][] }[]; size: [number, number] };
type Shot = { url: string; busy?: boolean; res?: OcrResult; err?: string };
const SAMPLES: Record<Kind, [string, string][]> = { plate: [["plate_day.jpg", "Day"], ["plate_night_tilted.jpg", "Night, tilted"]], box: [["container_clean.jpg", "Clean"], ["container_noisy_tilted.jpg", "Noisy, tilted"], ["container_bad_check.jpg", "Bad check digit"]] };
function Cam({ label, text, kind, shot, onImage }: { label: string; text: string; kind: Kind; shot?: Shot; onImage: (b: Blob) => void }) {
  const file = useRef<HTMLInputElement>(null); const [menu, setMenu] = useState(false);
  const sample = async (n: string) => { setMenu(false); onImage(await (await fetch("/ocr-samples/" + n)).blob()); };
  const r = shot?.res; const read = r ? (kind === "plate" ? r.plate && { t: r.plate.plate, c: r.plate.confidence, ok: true } : r.container && { t: r.container.number, c: r.container.confidence, ok: r.container.valid }) : null;
  return <div className="cam-wrap" data-tour={kind === "box" ? "ocr" : undefined}>
    <div className="cam">{shot ? <>
      <img src={shot.url} alt={label} />
      {r && <svg className="ocr-boxes" viewBox={`0 0 ${r.size[0]} ${r.size[1]}`} preserveAspectRatio="xMidYMid slice">{r.tokens.map((t, i) => <polygon key={i} points={t.box.map((p) => p.join(",")).join(" ")} style={{ fill: "none", stroke: read && t.text.replace(/[\s-]/g, "").includes(read.t.slice(0, 4)) ? "#4ade80" : "#fbbf24", strokeWidth: Math.max(2, r.size[0] / 300) }} />)}</svg>}
      {shot.busy && <span className="cam-busy">Reading…</span>}</> : <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
    <rect width="320" height="180" fill="#1a1f26" /><path d="M0 150 L320 120 L320 180 L0 180Z" fill="#252b33" />
    {kind === "plate" ? <><rect x="70" y="40" width="180" height="100" rx="8" fill="#3a4350" /><rect x="90" y="56" width="140" height="40" rx="4" fill="#5b6675" />
      <rect x="110" y="108" width="100" height="24" rx="2" fill="#e9e4cf" /><text x="160" y="125" textAnchor="middle" style={{ font: "700 14px ui-monospace,monospace", fill: "#111" }}>{text}</text>
      <rect x="104" y="102" width="112" height="36" fill="none" stroke="#4ade80" strokeWidth="2" /></>
      : <><rect x="30" y="30" width="260" height="110" fill="#7a3d2e" />{Array.from({ length: 12 }, (_, i) => <rect key={i} x={36 + i * 21.5} y="34" width="14" height="102" fill="#6b3528" />)}
      <rect x="180" y="44" width="100" height="22" fill="#00000055" /><text x="230" y="60" textAnchor="middle" style={{ font: "700 11px ui-monospace,monospace", fill: "#f2f2f2" }}>{text}</text>
      <rect x="176" y="40" width="108" height="30" fill="none" stroke="#4ade80" strokeWidth="2" /></>}
  </svg>}<span className="cl m">{label}</span><span className="cr m">{shot ? "PHOTO" : "PREVIEW"}</span></div>
    <div className="cam-foot">
      {shot?.err ? <span className="err ell">{shot.err}</span> : read ? <span className={"ell " + (read.ok && read.c >= 0.85 ? "okm" : "warnm")}><Sparkles size={12} /> <b className="m">{read.t}</b> · {Math.round(read.c * 100)}%{!read.ok ? " · check digit fails" + (r?.container?.suggested ? `, likely ${r.container.suggested}` : "") : read.c < 0.85 ? " · confirm" : ""}</span>
        : r ? <span className="warnm">No {kind === "plate" ? "plate" : "container number"} found; type it in</span> : <span className="mu">No image read yet</span>}
      <span className="sp" />
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ""; }} />
      <button className="btn sm" onClick={() => file.current?.click()}><Upload size={13} />Upload / capture</button>
      <div className="pop-wrap"><button className="btn sm ghost" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Sample</button>
        {menu && <div className="pop">{SAMPLES[kind].map(([n, l]) => <button key={n} onClick={() => sample(n)}>{l}</button>)}</div>}</div>
    </div></div>;
}
