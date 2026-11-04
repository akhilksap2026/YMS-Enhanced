// Yard checks (cycle audit with reconcile), reefer monitoring (setpoint, plug, simulated telemetry, alerts),
// and a rule-based door proposal that the user can override.
import { Router } from "express";
import { z } from "zod";
import { tenantRepo } from "../../shared/repo.ts";
import { currentUser } from "../../shared/tenancy.ts";
import { units, zones, slotByLabel, vacate, raise, exceptions } from "../yard/index.ts";
import { doors, assign } from "../dock/index.ts";
import { appointments } from "../appointments/index.ts";
import type { Unit } from "../../../../../packages/contracts/index.ts";

const err = (m: string, status = 400) => Object.assign(new Error(m), { status });
const nid = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const who = () => currentUser()?.name ?? "user";

// ---------- yard checks ----------
export interface YardCheck { id: string; zoneIds: string[]; state: "open" | "closed"; startedAt: string; by: string; expected: Record<string, string | null>; observed: Record<string, string | null>; closedAt?: string; result?: Reconcile }
export interface Reconcile { matched: number; missing: { slot: string; expected: string }[]; unexpected: { slot: string; observed: string; systemSlot?: string }[]; emptyOk: number; applied?: number }
export const checks = tenantRepo<YardCheck>("yard_checks", () => [], { site: true });
const numOf = (id?: string) => (id ? units.get(id)?.number ?? null : null);
export function startCheck(zoneIds?: string[]) {
  const zs = zones.all().filter((z) => !zoneIds?.length || zoneIds.includes(z.id)); if (!zs.length) throw err("No zones", 422);
  if (checks.all().some((c) => c.state === "open")) throw err("A yard check is already open", 409);
  const expected: Record<string, string | null> = {}; for (const z of zs) for (const s of z.slots) expected[s.label] = numOf(s.unitId);
  return checks.put({ id: nid("yc"), zoneIds: zs.map((z) => z.id), state: "open", startedAt: new Date().toISOString(), by: who(), expected, observed: {} });
}
export function scan(id: string, slot: string, unitNumber: string | null) {
  const c = checks.get(id); if (!c || c.state !== "open") throw err("No open check", 404); const s = slot.toUpperCase();
  if (!(s in c.expected)) throw err(`${s} is not part of this check`, 422); c.observed[s] = unitNumber ? unitNumber.trim().toUpperCase() : null; return c;
}
export function reconcile(c: YardCheck): Reconcile {
  const r: Reconcile = { matched: 0, missing: [], unexpected: [], emptyOk: 0 }; const where = new Map(Object.entries(c.expected).filter(([, v]) => v).map(([k, v]) => [v!, k]));
  for (const [slot, exp] of Object.entries(c.expected)) { if (!(slot in c.observed)) { if (exp) r.missing.push({ slot, expected: exp }); continue; } const obs = c.observed[slot];
    if (obs === exp) { exp ? r.matched++ : r.emptyOk++; continue; } if (exp && !Object.values(c.observed).includes(exp)) r.missing.push({ slot, expected: exp }); if (obs) r.unexpected.push({ slot, observed: obs, systemSlot: where.get(obs) }); }
  return r;
}
/** Close; with apply=true move units the system had elsewhere to where they were seen, and raise exceptions for the rest. */
export function closeCheck(id: string, apply: boolean) {
  const c = checks.get(id); if (!c || c.state !== "open") throw err("No open check", 404); const r = reconcile(c); let applied = 0;
  if (apply) for (const x of r.unexpected) { const u = units.all().find((v) => v.number === x.observed); const s = slotByLabel(x.slot);
    if (u && s && !s.unitId) { vacate(u.id); s.unitId = u.id; u.location = x.slot; applied++; } else if (s?.unitId && !u) { /* unknown unit seen: leave for gate */ } }
  for (const m of r.missing) { const u = units.all().find((v) => v.number === m.expected); if (u && !r.unexpected.some((x) => x.observed === m.expected)) raise({ severity: "med", text: `Yard check: ${m.expected} not found at ${m.slot}`, unitId: u.id }); }
  for (const x of r.unexpected) if (!units.all().some((v) => v.number === x.observed)) raise({ severity: "high", text: `Yard check: unknown unit ${x.observed} at ${x.slot}` });
  r.applied = applied; Object.assign(c, { state: "closed", closedAt: new Date().toISOString(), result: r }); return c;
}

// ---------- reefer ----------
export interface ReeferState { id: string; setpoint: number; plug?: string; pluggedAt?: string; unpluggedAt?: string; alertAt?: string }
export const reeferState = tenantRepo<ReeferState>("reefer_state", () => [], { site: true });
export const PLUGS = Array.from({ length: 12 }, (_, i) => "P" + String(i + 1).padStart(2, "0"));
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Simulated telemetry feed: deterministic per unit and time; a few units drift and unplugged units warm up. */
export function reading(u: Unit, st: ReeferState, now = Date.now()) {
  const h = hash(u.id); const noise = Math.sin(now / 9e5 + h) * 0.6 + Math.sin(now / 2.3e5 + h * 3) * 0.3;
  const drift = h % 5 === 0 ? 3.4 : 0; const off = !st.plug ? Math.min(12, (now - Date.parse(st.unpluggedAt ?? u.gateInAt ?? new Date(now).toISOString())) / 36e5 * 2.5) : 0;
  const temp = Math.round((st.setpoint + noise + drift + off) * 10) / 10; const dev = Math.round((temp - st.setpoint) * 10) / 10;
  return { temp, deviation: dev, at: new Date(now).toISOString(), power: st.plug ? "on" : "off" };
}
const stateOf = (u: Unit): ReeferState => reeferState.get(u.id) ?? { id: u.id, setpoint: hash(u.id) % 3 === 0 ? -18 : 4 };
export function reefers(now = Date.now(), raiseAlerts = true) {
  return units.all().filter((u) => u.reefer).map((u) => { const st = stateOf(u); const r = reading(u, st, now); const alarms: string[] = [];
    if (Math.abs(r.deviation) > 2.5) alarms.push(`Deviation ${r.deviation > 0 ? "+" : ""}${r.deviation}°C`); if (!st.plug) alarms.push("Not plugged in");
    if (alarms.length && raiseAlerts && (!st.alertAt || now - Date.parse(st.alertAt) > 3600e3)) { st.alertAt = new Date(now).toISOString(); reeferState.put(st);
      if (!exceptions.all().some((x) => x.unitId === u.id && /Reefer/.test(x.text) && now - Date.parse(x.at) < 3600e3)) raise({ severity: "high", text: `Reefer ${u.number}: ${alarms.join(", ")}`, unitId: u.id }); }
    return { unitId: u.id, number: u.number, location: u.location, setpoint: st.setpoint, plug: st.plug ?? null, ...r, alarms }; });
}
export function setReefer(unitId: string, b: { setpoint?: number; plug?: string | null }) {
  const u = units.get(unitId); if (!u?.reefer) throw err("Not a reefer unit", 404); const st = stateOf(u);
  if (b.setpoint != null) { if (b.setpoint < -30 || b.setpoint > 25) throw err("Setpoint must be between -30 and 25 °C", 422); st.setpoint = b.setpoint; }
  if (b.plug !== undefined) { if (b.plug === null) { st.plug = undefined; st.unpluggedAt = new Date().toISOString(); }
    else { const p = b.plug.toUpperCase(); if (!PLUGS.includes(p)) throw err("Unknown plug " + p, 422); const other = reeferState.all().find((x) => x.plug === p && x.id !== u.id); if (other) throw err(`${p} is in use by ${numOf(other.id) ?? other.id}`, 409); st.plug = p; st.pluggedAt = new Date().toISOString(); } }
  return reeferState.put(st);
}

// ---------- door proposal ----------
export interface DoorConfig { reeferDoors: string[]; hazmatDoors: string[]; inboundDoors: string[]; outboundDoors: string[] }
export const doorConfig = (): DoorConfig => ({ reeferDoors: ["D01", "D02"], hazmatDoors: ["D14"], inboundDoors: ["D01", "D02", "D03", "D04", "D05", "D06", "D07"], outboundDoors: ["D08", "D09", "D10", "D11", "D12", "D13", "D14"] });
/** Score every free door for a unit; higher is better. Reasons are shown so the user can see why. */
export function propose(unitId: string) {
  const u = units.get(unitId) as Unit & { hot?: boolean }; if (!u) throw err("Unit not found", 404); const cfg = doorConfig();
  const a = appointments.all().find((x) => x.ref === u.apptRef); const zoneRow = (u.location ?? "").charCodeAt(0) - 65;
  return doors.all().filter((d) => d.state === "free").map((d) => { const reasons: string[] = []; let score = 50; const n = +d.label.replace(/\D/g, "");
    if (a?.door === d.label) { score += 40; reasons.push("door on the appointment"); }
    const dirList = u.direction === "outbound" ? cfg.outboundDoors : cfg.inboundDoors; if (dirList.includes(d.label)) { score += 15; reasons.push(`${u.direction ?? "inbound"} door`); } else { score -= 10; reasons.push("other direction's door"); }
    if (u.reefer) { if (cfg.reeferDoors.includes(d.label)) { score += 25; reasons.push("reefer plug at door"); } else { score -= 30; reasons.push("no reefer power"); } }
    if (u.hazmat) { if (cfg.hazmatDoors.includes(d.label)) { score += 25; reasons.push("hazmat door"); } else { score -= 40; reasons.push("not a hazmat door"); } }
    if (zoneRow >= 0 && zoneRow < 26) { const dist = Math.abs(n - (zoneRow * 5 + 3)); score -= Math.min(15, dist); reasons.push(`${dist} doors from ${u.location}`); }
    return { doorId: d.id, label: d.label, score, reasons }; }).sort((x, y) => y.score - x.score);
}
export function assignProposed(unitId: string, doorId?: string, overrideReason?: string) {
  const p = propose(unitId); if (!p.length) throw err("No free door", 409); const top = p[0]; const pick = doorId ? p.find((x) => x.doorId === doorId) : top;
  if (!pick) throw err("That door is not free", 409); if (pick.doorId !== top.doorId && !overrideReason?.trim()) throw err(`Proposal is ${top.label}; give a reason to override`, 422);
  const d = assign(pick.doorId, unitId) as any; d.assignment = { proposed: top.label, chosen: pick.label, override: pick.doorId !== top.doorId ? overrideReason : undefined, by: who(), at: new Date().toISOString() }; return { door: d, proposal: top, overridden: pick.doorId !== top.doorId };
}

const wrap = (f: (q: any) => unknown) => async (q: any, r: any) => { try { r.json(await f(q)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } };
export const router = Router()
  .get("/checks", wrap(() => checks.all().sort((a, b) => b.startedAt.localeCompare(a.startedAt))))
  .post("/checks", wrap((q) => startCheck(q.body?.zoneIds)))
  .post("/checks/:id/scan", wrap((q) => scan(String(q.params.id), String(q.body?.slot ?? ""), q.body?.unitNumber ? String(q.body.unitNumber).slice(0, 15) : null)))
  .get("/checks/:id/reconcile", wrap((q) => { const c = checks.get(String(q.params.id)); if (!c) throw err("Not found", 404); return reconcile(c); }))
  .post("/checks/:id/close", wrap((q) => closeCheck(String(q.params.id), q.body?.apply === true)))
  .get("/reefers", wrap(() => ({ plugs: PLUGS, units: reefers() })))
  .post("/reefers/:unitId", wrap((q) => setReefer(String(q.params.unitId), z.object({ setpoint: z.number().optional(), plug: z.string().max(5).nullable().optional() }).parse(q.body ?? {}))))
  .get("/doors/proposal/:unitId", wrap((q) => propose(String(q.params.unitId))))
  .post("/doors/assign/:unitId", wrap((q) => assignProposed(String(q.params.unitId), q.body?.doorId, q.body?.reason)));
