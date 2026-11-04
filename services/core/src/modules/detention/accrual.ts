// Live detention/demurrage accrual from dwell, using charge profiles. Results are indicative: they create or update
// charges in state "indicative" only and never touch a charge someone has already decided.
import { z } from "zod";
import { tenantRepo } from "../../shared/repo.ts";
import { sid } from "../../shared/tenancy.ts";
import { units } from "../yard/index.ts";
import { sites } from "../tenant/sites.ts";
import { siteConfig } from "../tenant/index.ts";
import { charges } from "./index.ts";
import type { Unit, Charge } from "../../../../../packages/contracts/index.ts";

export const Profile = z.object({ id: z.string().regex(/^[a-z0-9-]{2,30}$/), name: z.string().min(2).max(60), kind: z.enum(["detention", "demurrage"]),
  carrierId: z.string().max(40).optional(), unitKind: z.enum(["trailer", "container", "any"]).default("any"),
  freeHours: z.number().min(0).max(720), rate: z.number().min(0).max(10000), currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  roundingMinutes: z.number().int().refine((n) => [1, 15, 30, 60].includes(n), "Rounding 1, 15, 30 or 60 min").default(60), roundMode: z.enum(["up", "nearest", "down"]).default("up"),
  capAmount: z.number().min(0).max(1e6).optional(), excludeWeekends: z.boolean().default(false), holidays: z.array(z.string().regex(/^\d{4}-\d\d-\d\d$/)).max(100).default([]),
  pauseOnHold: z.boolean().default(true) });
export type ChargeProfile = z.infer<typeof Profile>;
export const profiles = tenantRepo<ChargeProfile>("charge_profiles", () => [], { site: true });
const BUJ_HOLIDAYS = ["2026-01-01", "2026-02-05", "2026-04-06", "2026-05-01", "2026-05-14", "2026-07-01", "2026-08-15", "2026-10-13", "2026-10-21", "2026-12-25"];
export function allProfiles(): ChargeProfile[] {
  const r = siteConfig()?.rates ?? { detention: 45, demurrage: 60, freeHoursDetention: 2, freeHoursDemurrage: 48 }; const own = profiles.all();
  const base: ChargeProfile[] = [
    Profile.parse({ id: "std-detention", name: "Standard detention (trailers)", kind: "detention", unitKind: "trailer", freeHours: r.freeHoursDetention, rate: r.detention, holidays: BUJ_HOLIDAYS }),
    Profile.parse({ id: "std-demurrage", name: "Standard demurrage (containers)", kind: "demurrage", unitKind: "container", freeHours: r.freeHoursDemurrage, rate: r.demurrage, holidays: BUJ_HOLIDAYS }) ];
  return [...own, ...base.filter((b) => !own.some((o) => o.id === b.id))];
}
/** Most specific profile wins: carrier + unit kind, then carrier, then unit kind, then any. */
export const profileFor = (u: Unit, list = allProfiles()) => list.map((p) => ({ p, score: (p.carrierId ? (p.carrierId === u.carrierId ? 2 : -99) : 0) + (p.unitKind === "any" ? 0 : p.unitKind === u.kind ? 1 : -99) })).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score)[0]?.p;

type Interval = [number, number];
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
function offset(zone: string, at: number) { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at / 60e3) * 60e3; }
/** Local-day intervals in [from,to) that are not chargeable (holidays, optionally weekends). */
function excluded(p: ChargeProfile, from: number, to: number, zone: string): Interval[] {
  const out: Interval[] = []; const hs = new Set(p.holidays);
  for (let t = from - 864e5; t < to + 864e5; t += 864e5) { const off = offset(zone, t); const ymd = new Date(t + off).toISOString().slice(0, 10); const dow = new Date(ymd + "T12:00:00Z").getUTCDay();
    if (hs.has(ymd) || (p.excludeWeekends && (dow === 0 || dow === 6))) { const s = Date.parse(ymd + "T00:00:00Z") - off; out.push([s, s + 864e5]); } }
  return out.filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i);
}
export interface Accrual { unitId: string; number: string; carrierId: string; profileId: string; kind: "detention" | "demurrage"; since: string; elapsedH: number; pausedHoldH: number; pausedCalendarH: number; chargeableH: number; freeHours: number; billableH: number; rate: number; currency: string; amount: number; capped: boolean }
const round = (h: number, p: ChargeProfile) => { const m = h * 60, step = p.roundingMinutes; const f = p.roundMode === "up" ? Math.ceil : p.roundMode === "down" ? Math.floor : Math.round; return (f(m / step - 1e-9) * step) / 60; };
/** Pure calculation; holds and calendar exclusions pause the clock, free time is consumed first, then rounding, rate, cap. */
export function accrue(u: Unit & { holdLog?: { from: string; to?: string }[] }, p: ChargeProfile, now = Date.now(), zone = "Africa/Bujumbura"): Accrual {
  const start = Date.parse(u.gateInAt ?? new Date(now).toISOString()); const span: Interval = [start, Math.max(start, now)];
  const holds: Interval[] = p.pauseOnHold ? (u.holdLog ?? []).map((h) => [Date.parse(h.from), h.to ? Date.parse(h.to) : now] as Interval) : [];
  const cal = excluded(p, start, now, zone);
  const holdMs = holds.reduce((s, h) => s + overlap(span, h), 0);
  // calendar time that is not already paused by a hold
  const calMs = cal.reduce((s, c) => s + overlap(span, c) - holds.reduce((x, h) => x + Math.max(0, Math.min(c[1], h[1], span[1]) - Math.max(c[0], h[0], span[0])), 0), 0);
  const elapsedH = (span[1] - span[0]) / 36e5, chargeableH = Math.max(0, elapsedH - holdMs / 36e5 - calMs / 36e5);
  const billableH = Math.max(0, round(Math.max(0, chargeableH - p.freeHours), p)); let amount = Math.round(billableH * p.rate * 100) / 100; let capped = false;
  if (p.capAmount != null && amount > p.capAmount) { amount = p.capAmount; capped = true; }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { unitId: u.id, number: u.number, carrierId: u.carrierId, profileId: p.id, kind: p.kind, since: new Date(start).toISOString(), elapsedH: r2(elapsedH), pausedHoldH: r2(holdMs / 36e5), pausedCalendarH: r2(calMs / 36e5), chargeableH: r2(chargeableH), freeHours: p.freeHours, billableH, rate: p.rate, currency: p.currency, amount, capped };
}
export function liveAccruals(now = Date.now()) {
  const zone = sites.get(sid())?.tz ?? "Africa/Bujumbura"; const list = allProfiles();
  return units.all().filter((u) => u.gateInAt).map((u) => { const p = profileFor(u, list); return p ? accrue(u as any, p, now, zone) : null; }).filter((x): x is Accrual => !!x);
}
/** Write billable accruals as indicative charges (create or refresh). Decided charges are left alone. */
export function syncCharges(now = Date.now()) {
  let created = 0, updated = 0, skipped = 0;
  for (const a of liveAccruals(now)) { if (a.amount <= 0) continue; const id = "acc-" + a.unitId; const c = charges.get(id);
    if (c && c.state !== "indicative") { skipped++; continue; }
    const row: Charge = { id, visitRef: "VIS-" + a.number, carrierId: a.carrierId, unitId: a.unitId, kind: a.kind, freeHours: a.freeHours, billableHours: a.billableH, rate: a.rate, currency: a.currency, amount: a.amount, state: "indicative",
      history: c?.history ?? [{ at: new Date(now).toISOString(), by: "accrual", action: "indicative" }] };
    (row as any).profileId = a.profileId; (row as any).accrual = a; charges.put(row); c ? updated++ : created++; }
  return { created, updated, skippedDecided: skipped };
}
