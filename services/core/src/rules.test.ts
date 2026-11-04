import { describe, it, expect } from "vitest";
import { Rules, evaluate, evaluateReschedule, sweep, availability, defaultRules, type Ctx, type Booking } from "./modules/appointments/rules.ts";
const TZ = "Africa/Bujumbura"; // UTC+2
const NOW = Date.parse("2026-11-02T06:00:00Z"); // Monday 08:00 local
const at = (iso: string) => new Date(Date.parse(iso)).toISOString();
const bk = (id: string, start: string, x: Partial<Booking> = {}): Booking => ({ id, carrierId: "c1", direction: "inbound", status: "booked", slotStart: at(start), slotEnd: new Date(Date.parse(start) + 3600e3).toISOString(), ...x });
const ctx = (bookings: Booking[] = [], doors = ["D01", "D02"]): Ctx => ({ now: NOW, tz: TZ, doors, bookings });
const rules = (o: object = {}) => Rules.parse(o);
const rulesOf = (v: { rule: string }[]) => v.map((x) => x.rule);
describe("appointment rules engine", () => {
  it("allows a valid slot and enforces lead time, horizon and receiving window", () => {
    const r = defaultRules();
    expect(evaluate(r, ctx(), { carrierId: "c1", direction: "inbound", slotStart: "2026-11-02T08:00:00Z" })).toEqual([]); // 10:00 local
    expect(rulesOf(evaluate(r, ctx(), { carrierId: "c1", direction: "inbound", slotStart: "2026-11-02T06:30:00Z" }))).toContain("lead");
    expect(rulesOf(evaluate(r, ctx(), { carrierId: "c1", direction: "inbound", slotStart: "2026-12-20T08:00:00Z" }))).toContain("horizon");
    expect(rulesOf(evaluate(r, ctx(), { carrierId: "c1", direction: "inbound", slotStart: "2026-11-02T21:00:00Z" }))).toContain("window"); // 23:00 local
    expect(rulesOf(evaluate(r, ctx(), { carrierId: "c1", direction: "inbound", slotStart: "2026-11-08T08:00:00Z" }))).toContain("window"); // Sunday
  });
  it("caps by door count × per-door capacity, per named door, and per window", () => {
    const r = rules({ perDoorPerSlot: 1 }); const two = [bk("1", "2026-11-02T08:00:00Z", { door: "D01" }), bk("2", "2026-11-02T08:00:00Z")];
    expect(rulesOf(evaluate(r, ctx(two), { carrierId: "c2", direction: "inbound", slotStart: "2026-11-02T08:00:00Z" }))).toContain("door_capacity");
    expect(rulesOf(evaluate(r, ctx(two.slice(0, 1)), { carrierId: "c2", direction: "inbound", slotStart: "2026-11-02T08:00:00Z", door: "D01" }))).toContain("door_capacity");
    expect(evaluate(r, ctx(two.slice(0, 1)), { carrierId: "c2", direction: "inbound", slotStart: "2026-11-02T08:00:00Z", door: "D02" })).toEqual([]);
    const w = rules({ windows: [{ days: [1], from: "06:00", to: "22:00", capacity: 1, label: "Mon" }] });
    expect(rulesOf(evaluate(w, ctx(two.slice(0, 1), ["D01", "D02", "D03"]), { carrierId: "c2", direction: "inbound", slotStart: "2026-11-02T08:30:00Z" }))).toContain("window_capacity");
    expect(evaluate(r, ctx([bk("x", "2026-11-02T08:00:00Z", { status: "cancelled" }), bk("y", "2026-11-02T08:00:00Z", { status: "no_show" })]), { carrierId: "c2", direction: "inbound", slotStart: "2026-11-02T08:00:00Z" })).toEqual([]);
  });
  it("applies carrier rules: blocked, directions, own window, daily maximum", () => {
    const r = rules({ carriers: [{ carrierId: "c9", blocked: true, note: "unpaid invoices" }, { carrierId: "c1", directions: ["outbound"], from: "12:00", to: "16:00", maxPerDay: 1 }] });
    expect(evaluate(r, ctx(), { carrierId: "c9", direction: "inbound", slotStart: "2026-11-02T08:00:00Z" })[0].message).toMatch(/unpaid/);
    const v = rulesOf(evaluate(r, ctx([bk("1", "2026-11-02T12:00:00Z")]), { carrierId: "c1", direction: "inbound", slotStart: "2026-11-02T08:00:00Z" }));
    expect(v).toEqual(expect.arrayContaining(["carrier_direction", "carrier_window", "carrier_daily"]));
    expect(evaluate(r, ctx(), { carrierId: "c1", direction: "outbound", slotStart: "2026-11-02T11:00:00Z" })).toEqual([]); // 13:00 local
  });
  it("grace then no-show sweep", () => {
    const r = rules({ graceMinutes: 15, noShowAfterMinutes: 60 }); const b = [bk("1", "2026-11-02T05:50:00Z"), bk("2", "2026-11-02T04:30:00Z"), bk("3", "2026-11-02T05:30:00Z", { status: "arrived" })];
    expect(sweep(r, NOW, b)).toEqual([{ id: "2", from: "booked", to: "no_show" }]);
    expect(b.map((x) => x.status)).toEqual(["booked", "no_show", "arrived"]); // 1 is only 10 min past: inside grace
    expect(sweep(r, NOW + 10 * 60e3, b)).toEqual([{ id: "1", from: "booked", to: "late" }]);
  });
  it("reschedule policy: count, notice, no-show", () => {
    const r = rules({ reschedule: { maxCount: 1, minNoticeMinutes: 120, allowAfterNoShow: false } });
    expect(evaluateReschedule(r, ctx(), bk("1", "2026-11-02T12:00:00Z"), "2026-11-02T13:00:00Z")).toEqual([]);
    expect(rulesOf(evaluateReschedule(r, ctx(), bk("1", "2026-11-02T12:00:00Z", { reschedules: 1 }), "2026-11-02T13:00:00Z"))).toContain("reschedule_count");
    expect(rulesOf(evaluateReschedule(r, ctx(), bk("1", "2026-11-02T07:00:00Z"), "2026-11-02T13:00:00Z"))).toContain("reschedule_notice");
    expect(rulesOf(evaluateReschedule(r, ctx(), bk("1", "2026-11-02T04:00:00Z", { status: "no_show" }), "2026-11-02T13:00:00Z"))).toContain("no_show");
  });
  it("availability lists local slots with free capacity and carrier reasons", () => {
    const a = availability(defaultRules(), ctx([bk("1", "2026-11-03T08:00:00Z")]), "2026-11-03");
    expect(a.length).toBe(16); expect(a[0].start).toBe("2026-11-03T04:00:00.000Z"); expect(a.find((s) => s.start === "2026-11-03T08:00:00.000Z")!.free).toBe(1);
    const c = availability(rules({ carriers: [{ carrierId: "c9", blocked: true }] }), ctx(), "2026-11-03", "c9"); expect(c.every((s) => s.free === 0 && s.reasons.length)).toBe(true);
  });
  it("rejects invalid config", () => { expect(Rules.safeParse({ slotMinutes: 7 }).success).toBe(false); expect(Rules.safeParse({ windows: [{ days: [9], from: "6", to: "x", capacity: 1 }] }).success).toBe(false); });
});
