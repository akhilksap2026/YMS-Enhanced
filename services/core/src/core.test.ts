import { describe, it, expect } from "vitest";
import { validateContainer, withCheck } from "./shared/iso6346.ts";
import { decide, charges } from "./modules/detention/index.ts";
import { assign, doors } from "./modules/dock/index.ts";
import { transition, tasks } from "./modules/tasks/index.ts";
import { units } from "./modules/yard/index.ts";
import { checkIn } from "./modules/gate/index.ts";
import { appointments } from "./modules/appointments/index.ts";
describe("iso6346", () => {
  it("validates known number", () => expect(validateContainer("CSQU3054383").valid).toBe(true));
  it("rejects bad digit", () => expect(validateContainer("CSQU3054384").valid).toBe(false));
  it("withCheck round trips", () => expect(validateContainer(withCheck("DMOU123456")).valid).toBe(true));
});
describe("detention approval", () => {
  const c = () => charges.all().find((x) => x.state === "indicative")!;
  it("adjust requires reason", () => expect(() => decide(c().id, "adjusted", "u", "", 10)).toThrow(/Reason/));
  it("cannot export indicative", () => expect(() => decide(c().id, "exported", "u")).toThrow());
  it("approve then export keeps audit", () => { const id = c().id; decide(id, "approved", "u"); const r = decide(id, "exported", "u"); expect(r.history.length).toBe(3); });
});
describe("dock", () => {
  it("refuses held unit", () => { const u = units.all().find((x) => x.status === "hold")!; const d = doors.all().find((x) => x.state === "free")!; expect(() => assign(d.id, u.id)).toThrow(/hold/); });
});
describe("tasks offline conflict", () => {
  it("accepts superseded completion and flags conflict", () => { const t = tasks.all()[0]; expect(transition(t.id, "done", 0).conflict).toBe(true); });
  it("rejects stale non-completion", () => { const t = tasks.all()[1]; expect(() => transition(t.id, "in_progress", 0)).toThrow(); });
});
describe("gate", () => {
  it("blocks pass with invalid container", () => { const a = appointments.all()[5]; expect(() => checkIn({ appointmentId: a.id, plate: "XX", unitNumber: "CSQU3054384", decision: "pass" })).toThrow(/invalid/); });
  it("allows quarantine with invalid number for guard review", () => { const a = appointments.all()[6]; expect(checkIn({ appointmentId: a.id, plate: "XX", unitNumber: "CSQU3054384", decision: "quarantine" }).unitId).toBeTruthy(); });
});
import { setHold, zones } from "./modules/yard/index.ts";
import { createMove } from "./modules/tasks/index.ts";
describe("yard actions v2", () => {
  it("hold then release round trip", () => { const u = units.all().find((x) => x.status === "ok" && !x.location.startsWith("D"))!; setHold(u.id, true, "test"); expect(u.status).toBe("hold"); setHold(u.id, false); expect(u.status).toBe("ok"); });
  it("cannot release quarantine", () => { const u = units.all().find((x) => x.status === "quarantine")!; expect(() => setHold(u.id, false)).toThrow(/quarantined/); });
  it("move to free slot completes and relocates", () => {
    const u = units.all().find((x) => x.status === "ok" && /^[ABC]\d/.test(x.location) && !tasks.all().some((t) => t.unitId === x.id && t.status !== "done"))!;
    const free = zones.all().find((z) => z.name === "C")!.slots.find((s) => !s.unitId)!;
    const t = createMove({ unitId: u.id, to: free.label }); transition(t.id, "done", t.version);
    expect(u.location).toBe(free.label); expect(free.unitId).toBe(u.id);
  });
  it("refuses occupied slot and blocked door", () => {
    const u = units.all().find((x) => x.status === "ok" && /^[ABC]\d/.test(x.location))!;
    const occ = zones.all().flatMap((z) => z.slots).find((s) => s.unitId && s.unitId !== u.id)!;
    expect(() => createMove({ unitId: u.id, to: occ.label })).toThrow(/occupied/);
    expect(() => createMove({ unitId: u.id, to: "D13" })).toThrow(/blocked/);
  });
});
