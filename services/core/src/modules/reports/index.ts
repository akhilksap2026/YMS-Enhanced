// KPI & reports pack. All computed server-side for the current tenant + site over a date range, with CSV / Excel export.
import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { units, carriers } from "../yard/index.ts";
import { doors } from "../dock/index.ts";
import { charges } from "../detention/index.ts";
import { appointments } from "../appointments/index.ts";
import { sites } from "../tenant/sites.ts";
import { sid } from "../../shared/tenancy.ts";
import { yardVisits, doorVisits } from "./history.ts";
import { toCsv } from "../integrations/mapping.ts";
export const KINDS = ["dwell", "turn", "doors", "detention", "carriers"] as const;
type Kind = (typeof KINDS)[number];
const F = z.object({ from: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(), to: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(), carrierId: z.string().max(40).optional(), direction: z.enum(["inbound", "outbound"]).optional() });
export type Filter = { from: number; to: number; carrierId?: string; direction?: "inbound" | "outbound" };
export function filter(q: unknown): Filter { const p = F.safeParse(q ?? {}); if (!p.success) throw Object.assign(new Error("Filter: " + p.error.issues[0].path.join(".") + " " + p.error.issues[0].message), { status: 422 });
  const to = p.data.to ? Date.parse(p.data.to + "T23:59:59.999Z") : Date.now(); const from = p.data.from ? Date.parse(p.data.from + "T00:00:00Z") : to - 7 * 864e5;
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw Object.assign(new Error("Invalid date"), { status: 422 });
  if (from > to) throw Object.assign(new Error("From must be before To"), { status: 422 }); if (to - from > 400 * 864e5) throw Object.assign(new Error("Range max 400 days"), { status: 422 });
  return { from, to, carrierId: p.data.carrierId || undefined, direction: p.data.direction }; }
const H = 3600e3; const r1 = (x: number) => Math.round(x * 10) / 10;
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const q = (p: number) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  return { n: s.length, avg: s.length ? r1(s.reduce((a, b) => a + b, 0) / s.length) : 0, median: r1(q(0.5)), p90: r1(q(0.9)), max: r1(s.at(-1) ?? 0) }; };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const days = (f: Filter) => { const out: string[] = []; for (let t = Math.floor(f.from / 864e5) * 864e5; t <= f.to; t += 864e5) out.push(day(t)); return out; };
const cname = (id: string) => carriers.all().find((c) => c.id === id)?.name ?? id;
const okC = (f: Filter, c?: string) => !f.carrierId || c === f.carrierId; const okD = (f: Filter, d?: string) => !f.direction || !d || d === f.direction;
const done = (f: Filter) => yardVisits.all().filter((v) => v.outcome === "completed" && v.gateOut && Date.parse(v.gateOut) >= f.from && Date.parse(v.gateOut) <= f.to && okC(f, v.carrierId) && okD(f, v.direction));
const BUCKETS: [string, number][] = [["< 4 h", 4], ["4–12 h", 12], ["12–24 h", 24], ["24–48 h", 48], ["> 48 h", Infinity]];
export function dwell(f: Filter) {
  const now = Date.now(); const onYard = units.all().filter((u) => u.gateInAt && okC(f, u.carrierId) && okD(f, (u as any).direction)).map((u) => ({ unit: u.number, carrier: cname(u.carrierId), carrierId: u.carrierId, location: u.location, status: u.status, hours: r1((now - Date.parse(u.gateInAt!)) / H) }));
  const past = done(f).map((v) => ({ unit: v.unitNumber, carrier: cname(v.carrierId), carrierId: v.carrierId, hours: r1((Date.parse(v.gateOut!) - Date.parse(v.gateIn!)) / H) }));
  const all = [...onYard.map((x) => x.hours), ...past.map((x) => x.hours)];
  const buckets = BUCKETS.map(([label, max], i) => ({ label, onYard: onYard.filter((x) => x.hours < max && x.hours >= (BUCKETS[i - 1]?.[1] ?? 0)).length, completed: past.filter((x) => x.hours < max && x.hours >= (BUCKETS[i - 1]?.[1] ?? 0)).length }));
  const byCarrier = [...new Set([...onYard, ...past].map((x) => x.carrierId))].map((c) => ({ carrier: cname(c), ...stats([...onYard, ...past].filter((x) => x.carrierId === c).map((x) => x.hours)) })).sort((a, b) => b.avg - a.avg);
  return { kpis: { onYard: onYard.length, ...stats(all), over24: onYard.filter((x) => x.hours >= 24).length }, buckets, byCarrier, rows: onYard.sort((a, b) => b.hours - a.hours).map(({ carrierId: _c, ...x }) => x) };
}
export function turn(f: Filter) {
  const v = done(f).map((x) => ({ day: day(Date.parse(x.gateOut!)), unit: x.unitNumber, carrier: cname(x.carrierId), direction: x.direction, gateIn: x.gateIn!, gateOut: x.gateOut!, hours: r1((Date.parse(x.gateOut!) - Date.parse(x.gateIn!)) / H) }));
  const series = days(f).map((d) => { const s = stats(v.filter((x) => x.day === d).map((x) => x.hours)); return { day: d, visits: s.n, avg: s.avg, median: s.median }; });
  return { kpis: stats(v.map((x) => x.hours)), series, rows: v.sort((a, b) => b.gateOut.localeCompare(a.gateOut)) };
}
export function doorUtil(f: Filter) {
  const span = (Math.min(f.to, Date.now()) - f.from) / 60e3; const now = Date.now();
  const occ = (v: { start: string; end?: string }, a = f.from, b = Math.min(f.to, now)) => Math.max(0, Math.min(v.end ? Date.parse(v.end) : now, b) - Math.max(Date.parse(v.start), a)) / 60e3;
  const vis = doorVisits.all().filter((v) => okC(f, v.carrierId));
  const rows = doors.all().sort((a, b) => a.label.localeCompare(b.label)).map((d) => { const mine = vis.filter((v) => v.doorId === d.id || v.doorLabel === d.label); const m = mine.reduce((a, v) => a + occ(v), 0);
    return { door: d.label, state: d.state, visits: mine.filter((v) => occ(v) > 0).length, occupiedHours: r1(m / 60), utilisationPct: span > 0 ? Math.min(100, Math.round((m / span) * 100)) : 0, avgStintMin: mine.length ? Math.round(m / Math.max(1, mine.filter((v) => occ(v) > 0).length)) : 0 }; });
  const usable = rows.filter((r) => r.state !== "blocked");
  const series = days(f).map((d) => { const a = Date.parse(d + "T00:00:00Z"), b = Math.min(a + 864e5, now); const m = vis.reduce((s, v) => s + occ(v, a, b), 0);
    return { day: d, utilisationPct: b > a && usable.length ? Math.min(100, Math.round((m / ((b - a) / 60e3 * usable.length)) * 100)) : 0 }; });
  const hourly = Array.from({ length: 24 }, (_, h) => { let m = 0; for (const v of vis) { const s0 = Math.max(Date.parse(v.start), f.from), e0 = Math.min(v.end ? Date.parse(v.end) : now, f.to); for (let t = s0; t < e0; t += 15 * 60e3) if (new Date(t + 2 * H).getUTCHours() === h) m += 15; } return { hour: h, occupiedHours: r1(m / 60) }; });
  return { kpis: { doors: rows.length, usable: usable.length, avgUtilisationPct: usable.length ? Math.round(usable.reduce((a, r) => a + r.utilisationPct, 0) / usable.length) : 0, visits: rows.reduce((a, r) => a + r.visits, 0) }, series, hourly, rows };
}
export function detention(f: Filter) {
  const ch = charges.all().filter((c) => okC(f, c.carrierId)); const last = (c: typeof ch[number]) => Date.parse(c.history.at(-1)?.at ?? c.history[0]?.at ?? new Date().toISOString());
  const inR = ch.filter((c) => { const t = last(c); return t >= f.from && t <= f.to; }); const pick = inR.length ? inR : ch;
  const byState = [...new Set(pick.map((c) => c.state))].map((s) => ({ state: s, count: pick.filter((c) => c.state === s).length, amount: Math.round(pick.filter((c) => c.state === s).reduce((a, c) => a + c.amount, 0)) }));
  const byCarrier = [...new Set(pick.map((c) => c.carrierId))].map((id) => { const m = pick.filter((c) => c.carrierId === id); return { carrier: cname(id), charges: m.length, billableHours: r1(m.reduce((a, c) => a + c.billableHours, 0)), amount: Math.round(m.reduce((a, c) => a + c.amount, 0)), approved: Math.round(m.filter((c) => ["approved", "exported"].includes(c.state)).reduce((a, c) => a + c.amount, 0)) }; }).sort((a, b) => b.amount - a.amount);
  const cur = pick[0]?.currency ?? "USD";
  return { kpis: { charges: pick.length, indicative: Math.round(pick.reduce((a, c) => a + c.amount, 0)), approved: Math.round(pick.filter((c) => ["approved", "exported"].includes(c.state)).reduce((a, c) => a + c.amount, 0)), currency: cur, note: "Indicative amounts; billing decisions stay with the user." },
    byState, byCarrier, rows: pick.map((c) => ({ visit: c.visitRef, carrier: cname(c.carrierId), kind: c.kind, freeHours: c.freeHours, billableHours: c.billableHours, rate: c.rate, amount: c.amount, currency: c.currency, state: c.state })) };
}
export function scorecards(f: Filter) {
  const vis = yardVisits.all().filter((v) => { const t = Date.parse(v.slotStart ?? v.gateIn ?? ""); return t >= f.from && t <= f.to && okC(f, v.carrierId) && okD(f, v.direction); });
  const appts = appointments.all().filter((a) => { const t = Date.parse(a.slotStart); return t >= f.from && t <= f.to && okC(f, a.carrierId) && okD(f, a.direction); });
  const ch = detention(f).byCarrier;
  const rows = carriers.all().filter((c) => okC(f, c.id)).map((c) => {
    const v = vis.filter((x) => x.carrierId === c.id); const a = appts.filter((x) => x.carrierId === c.id && !["booked", "cancelled"].includes(x.status) && !v.some((y) => y.apptRef === x.ref));
    const arrived = [...v.filter((x) => x.outcome === "completed").map((x) => x.lateMin ?? 0), ...a.filter((x) => x.status === "arrived" || x.status === "late").map((x) => (x as any).lateMin ?? (x.status === "late" ? 30 : 0))];
    const noShow = v.filter((x) => x.outcome === "no_show").length + a.filter((x) => x.status === "no_show").length; const total = arrived.length + noShow;
    const onTime = arrived.filter((m) => m <= 15).length; const turns = v.filter((x) => x.gateOut && x.gateIn).map((x) => (Date.parse(x.gateOut!) - Date.parse(x.gateIn!)) / H);
    const onTimePct = total ? Math.round((onTime / total) * 100) : 0; const noShowPct = total ? Math.round((noShow / total) * 100) : 0; const avgTurn = turns.length ? r1(turns.reduce((p, q) => p + q, 0) / turns.length) : 0;
    const score = total ? Math.max(0, Math.round(onTimePct * 0.6 + (100 - noShowPct * 4) * 0.25 + Math.max(0, 100 - avgTurn * 4) * 0.15)) : 0;
    return { carrier: c.name, scac: c.scac, appointments: total, onTimePct, latePct: total ? 100 - onTimePct - noShowPct : 0, noShowPct, avgLateMin: arrived.length ? Math.round(arrived.filter((m) => m > 15).reduce((p, q) => p + q, 0) / Math.max(1, arrived.filter((m) => m > 15).length)) : 0, avgTurnHours: avgTurn, detention: ch.find((x) => x.carrier === c.name)?.amount ?? 0, score, grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D" };
  }).sort((a, b) => b.score - a.score);
  return { kpis: { carriers: rows.length, appointments: rows.reduce((a, r) => a + r.appointments, 0), avgOnTimePct: rows.length ? Math.round(rows.reduce((a, r) => a + r.onTimePct, 0) / rows.length) : 0 }, rows };
}
export function report(kind: Kind, f: Filter): { kpis: Record<string, unknown>; rows: Record<string, unknown>[]; [k: string]: unknown } {
  switch (kind) { case "dwell": return dwell(f); case "turn": return turn(f); case "doors": return doorUtil(f); case "detention": return detention(f); case "carriers": return scorecards(f); }
}
const TITLES: Record<Kind, string> = { dwell: "Dwell time", turn: "Turn time", doors: "Door utilisation", detention: "Detention (indicative)", carriers: "Carrier scorecards" };
async function xlsx(kind: Kind, f: Filter, data: ReturnType<typeof report>) {
  const wb = new ExcelJS.Workbook(); wb.creator = "YMS Enhanced"; wb.created = new Date();
  const info = wb.addWorksheet("Summary"); info.addRow([TITLES[kind]]).font = { bold: true, size: 14 }; info.addRow(["Site", sites.get(sid())?.name ?? sid()]); info.addRow(["From", day(f.from)]); info.addRow(["To", day(f.to)]);
  if (f.carrierId) info.addRow(["Carrier", cname(f.carrierId)]); info.addRow([]); for (const [k, v] of Object.entries(data.kpis)) info.addRow([k, v as any]); info.getColumn(1).width = 22; info.getColumn(2).width = 30;
  const sheet = (name: string, rows: Record<string, unknown>[]) => { if (!rows.length) return; const ws = wb.addWorksheet(name); const cols = Object.keys(rows[0]);
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2, ...rows.slice(0, 200).map((r) => String(r[c] ?? "").length + 1))) }));
    rows.forEach((r) => ws.addRow(r)); ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; };
  sheet("Detail", data.rows); for (const [k, v] of Object.entries(data)) if (k !== "rows" && Array.isArray(v)) sheet(k[0].toUpperCase() + k.slice(1), v as any);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const kindOf = (s: string): Kind => { if (!(KINDS as readonly string[]).includes(s)) throw Object.assign(new Error("Unknown report"), { status: 404 }); return s as Kind; };
const fail = (r: Response, e: any) => r.status(e.status ?? 400).json({ error: e.message });
export const router = Router()
  .get("/", (_q, r) => r.json(KINDS.map((k) => ({ id: k, title: TITLES[k] }))))
  .get("/:kind.csv", (q: Request, r: Response) => { try { const k = kindOf(String(q.params.kind)); const f = filter(q.query); const d = report(k, f);
    r.setHeader("content-type", "text/csv; charset=utf-8"); r.setHeader("content-disposition", `attachment; filename="yms-${k}-${day(f.from)}_${day(f.to)}.csv"`); r.send("\ufeff" + toCsv(d.rows as any)); } catch (e) { fail(r, e); } })
  .get("/:kind.xlsx", async (q: Request, r: Response) => { try { const k = kindOf(String(q.params.kind)); const f = filter(q.query);
    r.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); r.setHeader("content-disposition", `attachment; filename="yms-${k}-${day(f.from)}_${day(f.to)}.xlsx"`); r.send(await xlsx(k, f, report(k, f))); } catch (e) { fail(r, e); } })
  .get("/:kind", (q: Request, r: Response) => { try { r.json(report(kindOf(String(q.params.kind)), filter(q.query))); } catch (e) { fail(r, e); } });
