// Public driver pages: no login, no app. /driver/<token> is the status page from the SMS link; /?kiosk=<token> is the gate kiosk.
import { useEffect, useState } from "react";
import { Truck, Upload, CheckCircle2, MapPin } from "lucide-react";

type St = { ref: string; slotStart: string; direction: string; state: string; queuePosition: number | null; queueLength: number; door: string | null; instructions: string; docsHint: string; lang: string; docs: { id: string; kind: string; name: string; status: string }[]; precheck: { plate: string } | null; appointmentId?: string; token?: string };
const L: Record<string, Record<string, string>> = {
  en: { title: "Driver check-in", plate: "Truck plate", unit: "Trailer / container (optional)", check: "I am here: check in", queue: "Queue position", door: "Door", docs: "Documents", up: "Upload", ref: "Booking reference", find: "Find my booking", again: "Next driver", slot: "Slot", kinds: "BOL,ID,Permit,Other" },
  fr: { title: "Enregistrement chauffeur", plate: "Plaque du camion", unit: "Remorque / conteneur (facultatif)", check: "Je suis arrivé : m'enregistrer", queue: "Position dans la file", door: "Quai", docs: "Documents", up: "Téléverser", ref: "Référence de réservation", find: "Trouver ma réservation", again: "Chauffeur suivant", slot: "Créneau", kinds: "Lettre de voiture,Identité,Permis,Autre" },
  sw: { title: "Usajili wa dereva", plate: "Namba ya lori", unit: "Trela / kontena (hiari)", check: "Nimefika: jisajili", queue: "Nafasi kwenye foleni", door: "Mlango", docs: "Nyaraka", up: "Pakia", ref: "Namba ya miadi", find: "Tafuta miadi yangu", again: "Dereva anayefuata", slot: "Muda", kinds: "BOL,Kitambulisho,Kibali,Nyingine" },
};
const KINDS = ["bol", "id", "permit", "other"];
async function call<T>(path: string, init?: RequestInit): Promise<T> { const r = await fetch("/v1" + path, init); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? r.statusText); return j as T; }
const json = (b: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const time = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Langs({ lang, set }: { lang: string; set: (l: string) => void }) { return <div className="seg">{["en", "fr", "sw"].map((l) => <button key={l} className={lang === l ? "on" : ""} onClick={() => set(l)}>{l.toUpperCase()}</button>)}</div>; }
function Status({ s, t, token, onChange }: { s: St; t: Record<string, string>; token: string; onChange: (s: St) => void }) {
  const [plate, setPlate] = useState(s.precheck?.plate ?? ""); const [unit, setUnit] = useState(""); const [kind, setKind] = useState("bol"); const [err, setErr] = useState("");
  const check = () => call<St>(`/driver/p/${token}/checkin`, json({ plate, unitNumber: unit || undefined, lang: s.lang })).then(onChange).catch((e) => setErr(e.message));
  const up = async (f?: File) => { if (!f) return; const fd = new FormData(); fd.append("kind", kind); fd.append("file", f); try { await call(`/driver/p/${token}/docs`, { method: "POST", body: fd }); onChange(await call<St>(`/driver/p/${token}?lang=${s.lang}`)); } catch (e) { setErr((e as Error).message); } };
  return <>
    <div className="drv-card"><small>{s.ref} · {t.slot} {time(s.slotStart)}</small><h2 className={"drv-state " + s.state}>{s.instructions || s.state}</h2>
      <div className="drv-kv">{s.queuePosition && <div><span>{t.queue}</span><b>{s.queuePosition} / {s.queueLength}</b></div>}{s.door && <div><span>{t.door}</span><b><MapPin size={16} />{s.door}</b></div>}</div></div>
    {s.state === "booked" || (s.state === "queued" && !s.precheck) ? <div className="drv-card"><label>{t.plate}<input className="ctl big m" value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" /></label>
      <label>{t.unit}<input className="ctl big m" value={unit} onChange={(e) => setUnit(e.target.value)} autoCapitalize="characters" /></label>
      <button className="btn pri xl" disabled={plate.trim().length < 2} onClick={() => void check()}><CheckCircle2 size={20} />{t.check}</button></div> : null}
    <div className="drv-card"><b>{t.docs}</b><small className="mu">{s.docsHint}</small>
      <div className="seg">{KINDS.map((k, i) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{t.kinds.split(",")[i]}</button>)}</div>
      <label className="btn xl"><Upload size={18} />{t.up}<input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => void up(e.target.files?.[0])} /></label>
      {s.docs.map((d) => <div key={d.id} className="row"><span className="tag t-idle">{d.kind}</span><span>{d.name}</span><span className="mu">{d.status}</span></div>)}</div>
    {err && <div className="drv-err">{err}</div>}</>;
}
export function DriverPage({ token }: { token: string }) {
  const [lang, setLang] = useState(new URLSearchParams(location.search).get("lang") ?? "en"); const [s, setS] = useState<St | null>(null); const [err, setErr] = useState("");
  useEffect(() => { const f = () => call<St>(`/driver/p/${token}?lang=${lang}`).then(setS).catch((e) => setErr(e.message)); void f(); const i = setInterval(f, 20000); return () => clearInterval(i); }, [token, lang]);
  const t = L[lang] ?? L.en;
  return <div className="drv"><header><Truck size={20} /><b>{t.title}</b><span className="sp" /><Langs lang={lang} set={setLang} /></header>{err ? <div className="drv-err">{err}</div> : s ? <Status s={s} t={t} token={token} onChange={setS} /> : null}</div>;
}
export function Kiosk({ token }: { token: string }) {
  const [lang, setLang] = useState("en"); const [ref, setRef] = useState(""); const [plate, setPlate] = useState(""); const [s, setS] = useState<St | null>(null); const [err, setErr] = useState("");
  const t = L[lang] ?? L.en;
  useEffect(() => { if (!s?.precheck) return; const i = setTimeout(() => { setS(null); setRef(""); setPlate(""); }, 45000); return () => clearTimeout(i); }, [s]);
  const find = () => { setErr(""); call<St>(`/driver/kiosk/${token}/lookup`, json({ ref, plate, lang })).then(setS).catch((e) => setErr(e.message)); };
  return <div className="drv kiosk"><header><Truck size={24} /><b>{t.title}</b><span className="sp" /><Langs lang={lang} set={setLang} /></header>
    {!s ? <div className="drv-card"><label>{t.ref}<input className="ctl big m" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="APT-71001" /></label>
      <label>{t.plate}<input className="ctl big m" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} /></label>
      <button className="btn pri xl" disabled={!ref} onClick={find}>{t.find}</button></div>
      : <>{s.token && <Status s={s} t={t} token={s.token} onChange={(x) => setS({ ...x, token: s.token })} />}<button className="btn xl" onClick={() => { setS(null); setRef(""); setPlate(""); }}>{t.again}</button></>}
    {err && <div className="drv-err">{err}</div>}</div>;
}
