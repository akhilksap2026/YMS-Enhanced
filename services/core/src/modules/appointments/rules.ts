// Appointment rules engine. Pure evaluation over a config doc ("appt_rules" in settings) + current bookings.
// Rules: slot length, per-door capacity per slot, per-window capacity (by weekday + time), lead time / horizon,
// carrier rules (blocked, max per day, directions, own window), grace + no-show, reschedule policy.
import { z } from "zod";
export const Window = z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/), capacity: z.number().int().min(0).max(200), label: z.string().max(40).optional() });
export const CarrierRule = z.object({ carrierId: z.string().min(1), blocked: z.boolean().default(false), maxPerDay: z.number().int().min(0).max(500).optional(),
  directions: z.array(z.enum(["inbound", "outbound"])).optional(), from: z.string().regex(/^\d\d:\d\d$/).optional(), to: z.string().regex(/^\d\d:\d\d$/).optional(), note: z.string().max(120).optional() });
export const Rules = z.object({
  slotMinutes: z.number().int().refine((n) => [15, 20, 30, 45, 60, 90, 120].includes(n), "Slot must be 15/20/30/45/60/90/120 min").default(60),
  perDoorPerSlot: z.number().int().min(1).max(10).default(1),
  windows: z.array(Window).max(30).default([{ days: [1, 2, 3, 4, 5], from: "06:00", to: "22:00", capacity: 8, label: "Weekdays" }, { days: [6], from: "07:00", to: "14:00", capacity: 3, label: "Saturday" }]),
  minLeadMinutes: z.number().int().min(0).max(10080).default(60), horizonDays: z.number().int().min(1).max(180).default(30),
  graceMinutes: z.number().int().min(0).max(240).default(15), noShowAfterMinutes: z.number().int().min(5).max(1440).default(60),
  reschedule: z.object({ maxCount: z.number().int().min(0).max(10).default(2), minNoticeMinutes: z.number().int().min(0).max(10080).default(120), allowAfterNoShow: z.boolean().default(false) }).default({ maxCount: 2, minNoticeMinutes: 120, allowAfterNoShow: false }),
  carriers: z.array(CarrierRule).max(200).default([]),
});
export type RulesT = z.infer<typeof Rules>;
export const defaultRules = (): RulesT => Rules.parse({});
export interface Booking { id: string; carrierId: string; slotStart: string; slotEnd: string; door?: string; direction: "inbound" | "outbound"; status: string; reschedules?: number }
export interface Ctx { now: number; tz: string; doors: string[]; bookings: Booking[] }
export interface Violation { rule: string; message: string }
const mins = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);
/** Local weekday + minute-of-day of an instant in the site's zone. */
export function local(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), min: +p.hour * 60 + +p.minute, date: `${p.year}-${p.month}-${p.day}` };
}
const live = (b: Booking) => b.status !== "cancelled" && b.status !== "no_show";
const overlaps = (a0: number, a1: number, b: Booking) => Date.parse(b.slotStart) < a1 && Date.parse(b.slotEnd) > a0;
export function windowFor(r: RulesT, ms: number, tz: string) { const l = local(ms, tz); return r.windows.find((w) => w.days.includes(l.day) && l.min >= mins(w.from) && l.min < mins(w.to)); }
/** Evaluate a requested booking. Returns all violations (empty = allowed). */
export function evaluate(r: RulesT, ctx: Ctx, req: Omit<Booking, "id" | "status" | "slotEnd"> & { id?: string; slotEnd?: string }): Violation[] {
  const v: Violation[] = []; const s = Date.parse(req.slotStart); const e = req.slotEnd ? Date.parse(req.slotEnd) : s + r.slotMinutes * 60e3;
  if (!Number.isFinite(s)) return [{ rule: "time", message: "Invalid slot start" }];
  const others = ctx.bookings.filter((b) => b.id !== req.id && live(b));
  if (s < ctx.now + r.minLeadMinutes * 60e3) v.push({ rule: "lead", message: `Book at least ${r.minLeadMinutes} min ahead` });
  if (s > ctx.now + r.horizonDays * 864e5) v.push({ rule: "horizon", message: `Bookings open ${r.horizonDays} days ahead` });
  const w = windowFor(r, s, ctx.tz); const lEnd = local(e - 1, ctx.tz);
  if (!w || lEnd.min >= mins(w.to) || local(s, ctx.tz).date !== lEnd.date) v.push({ rule: "window", message: "Outside receiving hours" });
  else { const inWin = others.filter((b) => overlaps(s, e, b)).length; if (inWin >= w.capacity) v.push({ rule: "window_capacity", message: `${w.label ?? "Window"} full (${w.capacity} per slot)` }); }
  const doorCap = ctx.doors.length * r.perDoorPerSlot; const inSlot = others.filter((b) => overlaps(s, e, b));
  if (inSlot.length >= doorCap) v.push({ rule: "door_capacity", message: `All ${ctx.doors.length} doors booked for this slot` });
  if (req.door) { if (!ctx.doors.includes(req.door)) v.push({ rule: "door", message: `Door ${req.door} is not bookable` });
    else if (inSlot.filter((b) => b.door === req.door).length >= r.perDoorPerSlot) v.push({ rule: "door_capacity", message: `Door ${req.door} is taken for this slot` }); }
  const cr = r.carriers.find((c) => c.carrierId === req.carrierId);
  if (cr) { if (cr.blocked) v.push({ rule: "carrier_blocked", message: "Carrier is not allowed to book" + (cr.note ? `: ${cr.note}` : "") });
    if (cr.directions && !cr.directions.includes(req.direction)) v.push({ rule: "carrier_direction", message: `Carrier may only book ${cr.directions.join("/")}` });
    if (cr.from && cr.to) { const l = local(s, ctx.tz).min; if (l < mins(cr.from) || l >= mins(cr.to)) v.push({ rule: "carrier_window", message: `Carrier window is ${cr.from}–${cr.to}` }); }
    if (cr.maxPerDay !== undefined) { const d = local(s, ctx.tz).date; const n = others.filter((b) => b.carrierId === req.carrierId && local(Date.parse(b.slotStart), ctx.tz).date === d).length;
      if (n >= cr.maxPerDay) v.push({ rule: "carrier_daily", message: `Carrier limit of ${cr.maxPerDay} per day reached` }); } }
  return v;
}
/** Can an existing booking be moved? Checks policy first, then the new slot like a fresh booking. */
export function evaluateReschedule(r: RulesT, ctx: Ctx, b: Booking, newStart: string, door?: string): Violation[] {
  const v: Violation[] = [];
  if (b.status === "cancelled" || b.status === "arrived") v.push({ rule: "status", message: `Cannot reschedule a ${b.status} appointment` });
  if (b.status === "no_show" && !r.reschedule.allowAfterNoShow) v.push({ rule: "no_show", message: "No-shows must book a new appointment" });
  if ((b.reschedules ?? 0) >= r.reschedule.maxCount) v.push({ rule: "reschedule_count", message: `Already rescheduled ${b.reschedules} time(s); limit ${r.reschedule.maxCount}` });
  if (b.status !== "no_show" && Date.parse(b.slotStart) - ctx.now < r.reschedule.minNoticeMinutes * 60e3) v.push({ rule: "reschedule_notice", message: `Reschedule at least ${r.reschedule.minNoticeMinutes} min before the slot` });
  return [...v, ...evaluate(r, ctx, { ...b, slotStart: newStart, slotEnd: undefined, door: door ?? b.door })];
}
/** Status transitions by the clock: booked -> late after grace, -> no_show after the no-show threshold. */
export function sweep(r: RulesT, now: number, bookings: Booking[]) {
  const changed: { id: string; from: string; to: string }[] = [];
  for (const b of bookings) { const s = Date.parse(b.slotStart);
    if ((b.status === "booked" || b.status === "late") && now > s + r.noShowAfterMinutes * 60e3) { changed.push({ id: b.id, from: b.status, to: "no_show" }); b.status = "no_show"; }
    else if (b.status === "booked" && now > s + r.graceMinutes * 60e3) { changed.push({ id: b.id, from: b.status, to: "late" }); b.status = "late"; } }
  return changed;
}
/** Free capacity per slot for a day (for the booking grid). */
export function availability(r: RulesT, ctx: Ctx, date: string, carrierId?: string, direction: "inbound" | "outbound" = "inbound") {
  const out: { start: string; free: number; reasons: string[] }[] = [];
  const base = Date.parse(date + "T00:00:00Z"); // scan ±14h around UTC midnight to cover any zone
  for (let t = base - 14 * 3600e3; t < base + 38 * 3600e3; t += r.slotMinutes * 60e3) {
    if (local(t, ctx.tz).date !== date) continue; const w = windowFor(r, t, ctx.tz); if (!w) continue;
    const e = t + r.slotMinutes * 60e3; const used = ctx.bookings.filter((b) => live(b) && overlaps(t, e, b)).length;
    const free = Math.max(0, Math.min(w.capacity, ctx.doors.length * r.perDoorPerSlot) - used);
    const reasons = carrierId ? evaluate(r, ctx, { carrierId, direction, slotStart: new Date(t).toISOString() }).map((x) => x.message) : [];
    out.push({ start: new Date(t).toISOString(), free: reasons.length ? 0 : free, reasons });
  }
  return out;
}
