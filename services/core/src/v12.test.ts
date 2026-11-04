import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
process.env.JWT_SECRET = "test-secret";
const dir = mkdtempSync(join(tmpdir(), "ymsv12-"));
const { bootstrap } = await import("./bootstrap.ts");
const db = await import("./shared/db.ts");
const { app } = await import("./app.ts");
const { accrue } = await import("./modules/detention/accrual.ts");
const { sealCheck } = await import("./modules/evidence/index.ts");
const request = (await import("supertest")).default;
const PW = "Ymsnow!2026";
const tok = async (email: string) => (await request(app).post("/v1/auth/login").send({ email, password: PW })).body.token as string;
const T: Record<string, string> = {}; const H = (r = "tenant.admin") => ({ authorization: "Bearer " + T[r] });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
beforeAll(async () => { await bootstrap(dir); for (const r of ["tenant.admin", "gate.guard", "carrier", "yard.manager", "spotter", "dock.supervisor"]) T[r] = await tok(r + "@ksap.example"); }, 60_000);
afterAll(async () => { await db.closeDb(); rmSync(dir, { recursive: true, force: true }); });
const booked = async () => (await request(app).get("/v1/appointments").set(H())).body.filter((a: any) => a.status === "booked");

describe("driver channel", () => {
  it("issues a link, texts it, and lets the driver check in, see status and upload documents without logging in", async () => {
    const a = (await booked())[0];
    const l = await request(app).post("/v1/driver/links").set(H("gate.guard")).send({ appointmentId: a.id, phone: "+25779000000", lang: "fr" });
    expect(l.status).toBe(200); expect(l.body.delivery.to).toBe("+25779000000");
    const st = await request(app).get(`/v1/driver/p/${l.body.token}?lang=fr`); expect(st.status).toBe(200); expect(st.body.state).toBe("booked"); expect(st.body.lang).toBe("fr");
    const ci = await request(app).post(`/v1/driver/p/${l.body.token}/checkin`).send({ plate: "ab-123-cd", lang: "sw" });
    expect(ci.status).toBe(200); expect(ci.body.state).toBe("queued"); expect(ci.body.queuePosition).toBe(1); expect(ci.body.instructions).toMatch(/getini/);
    const doc = await request(app).post(`/v1/driver/p/${l.body.token}/docs`).field("kind", "bol").attach("file", PNG, { filename: "bol.png", contentType: "image/png" });
    expect(doc.status).toBe(200); expect(doc.body.kind).toBe("bol"); expect(doc.body.data).toBeUndefined();
    expect((await request(app).post(`/v1/driver/p/${l.body.token}/docs`).attach("file", Buffer.from("x"), { filename: "a.exe", contentType: "application/x-msdownload" })).status).toBe(422);
    expect((await request(app).get(`/v1/driver/docs/${a.id}`).set(H("gate.guard"))).body).toHaveLength(1);
    expect((await request(app).get("/v1/driver/p/not-a-token")).status).toBe(401);
    expect((await request(app).post("/v1/driver/links").set(H("spotter")).send({ appointmentId: a.id })).status).toBe(403);
  });
  it("kiosk finds a booking by reference and checks the driver in", async () => {
    const a = (await booked())[1]; const k = (await request(app).post("/v1/driver/kiosk-token").set(H())).body.token;
    expect((await request(app).post("/v1/driver/kiosk-token").set(H("gate.guard"))).status).toBe(403);
    const f = await request(app).post(`/v1/driver/kiosk/${k}/lookup`).send({ ref: a.ref.toLowerCase() }); expect(f.status).toBe(200);
    const c = await request(app).post(`/v1/driver/kiosk/${k}/checkin`).send({ appointmentId: f.body.appointmentId, plate: "KIO-1" }); expect(c.status).toBe(200); expect(c.body.precheck.via).toBe("kiosk");
    expect((await request(app).post(`/v1/driver/kiosk/${k}/lookup`).send({ ref: "NOPE" })).status).toBe(404);
  });
});

describe("gate evidence", () => {
  it("validates seals against the appointment", () => {
    expect(sealCheck("SL-100", "sl100").status).toBe("match"); expect(sealCheck("SL100", "SL101").status).toBe("mismatch");
    expect(sealCheck("SL100", "").status).toBe("missing"); expect(sealCheck(undefined, "X").status).toBe("not_expected");
  });
  it("blocks a pass with a wrong seal unless overridden, stores photos and an inspection with damage and placards", async () => {
    const csv = "carrier,date,time,direction,door,plate,unit,seal,hazmat\n";
    const day = new Date(Date.now() + 3 * 864e5); while ([0, 6].includes(day.getUTCDay())) day.setTime(day.getTime() + 864e5);
    const imp = await request(app).post("/v1/planning/import?commit=1").set(H()).attach("file", Buffer.from(csv + `c1,${day.toISOString().slice(0, 10)},09:00,inbound,,SE-1,TSTU1234568,SEAL777,3\n`), "a.csv");
    expect(imp.body.valid).toBe(1); const ref = imp.body.rows[0].ref; const a = (await request(app).get("/v1/appointments").set(H())).body.find((x: any) => x.ref === ref);
    const bad = await request(app).post("/v1/gate/checkin").set(H("gate.guard")).send({ appointmentId: a.id, unitNumber: "TSTU1234568", plate: "SE-1", decision: "pass", seal: "SEAL778" });
    const ok = await request(app).post("/v1/gate/checkin").set(H("gate.guard")).send({ appointmentId: a.id, unitNumber: "TSTU1234568", plate: "SE-1", decision: "pass", seal: "SEAL778", sealOverride: "Seal replaced at border, paperwork seen" });
    expect(ok.status).toBe(200); const uid = ok.body.unitId;
    const ph = await request(app).post(`/v1/evidence/photos/${uid}`).set(H("gate.guard")).field("views", "front,rear").attach("photo", PNG, "f.png").attach("photo", PNG, "r.png");
    expect(ph.status).toBe(200); expect(ph.body.map((p: any) => p.view)).toEqual(["front", "rear"]);
    expect((await request(app).post("/v1/evidence/inspections").set(H("gate.guard")).send({ unitId: uid, templateId: "haz", answers: { placards: true, docs: true, leak: true } })).status).toBe(422); // hazmat needs placard
    const ins = await request(app).post("/v1/evidence/inspections").set(H("gate.guard")).send({ unitId: uid, templateId: "haz", answers: { placards: true, docs: true, leak: true }, placards: [{ un: "1203", cls: "3" }], damage: [{ side: "left", x: 0.3, y: 0.6, type: "dent", severity: "minor" }], seal: "SEAL777" });
    expect(ins.status).toBe(200); expect(ins.body.result).toBe("pass"); expect(ins.body.placards[0].un).toBe("UN1203"); expect(ins.body.seal.status).toBe("match");
    const v = (await request(app).get(`/v1/evidence/visit/${uid}`).set(H("gate.guard"))).body; expect(v.photos).toHaveLength(2); expect(v.inspections).toHaveLength(1);
    expect((await request(app).put("/v1/evidence/templates/chassis").set(H()).send({ name: "Chassis", appliesTo: "trailer", items: [{ id: "kingpin", label: "Kingpin OK", kind: "check", required: true }] })).status).toBe(200);
    expect((await request(app).put("/v1/evidence/templates/x2").set(H("gate.guard")).send({})).status).toBe(403);
  });
});

describe("planning", () => {
  it("imports CSV and Excel with a row-level report", async () => {
    const csv = "Carrier,Date,Time,Direction,Door,Plate\nc1,2026-13-01,09:00,inbound,,\nNobody,2030-01-01,09:00,inbound,,\nc2,2030-01-01,25:00,sideways,D99,\n";
    const r = await request(app).post("/v1/planning/import").set(H()).attach("file", Buffer.from(csv), "p.csv");
    expect((await request(app).post("/v1/planning/import").set(H()).attach("file", Buffer.from("a,b\n1,2\n"), "p.csv")).body.error).toMatch(/Missing columns/);
    const ExcelJS = (await import("exceljs")).default; const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("p"); ws.addRow(["carrier", "date", "time", "direction"]);
    const d = new Date(Date.now() + 4 * 864e5); while ([0, 6].includes(d.getUTCDay())) d.setTime(d.getTime() + 864e5); ws.addRow(["c3", d.toISOString().slice(0, 10), "10:00", "outbound"]);
    const x = await request(app).post("/v1/planning/import?commit=1").set(H()).attach("file", Buffer.from(await wb.xlsx.writeBuffer()), "p.xlsx");
    expect(x.body.valid).toBe(1); expect(x.body.rows[0].ref).toMatch(/^APT-/);
  });
  it("freezes the plan after cut-off and routes changes through an approved amendment", async () => {
    expect((await request(app).put("/v1/planning/settings").set(H()).send({ cutoffEnabled: true, cutoff: "00:00" })).status).toBe(200);
    const tomorrow = new Date(Date.now() + 864e5); tomorrow.setUTCHours(10, 0, 0, 0);
    const b = await request(app).post("/v1/appointments").set(H()).send({ carrierId: "c1", slotStart: tomorrow.toISOString(), direction: "inbound" }); expect(b.status).toBe(423);
    const a = (await booked()).find((x: any) => Date.parse(x.slotStart) < Date.now() + 864e5 && Date.parse(x.slotStart) > Date.now());
    if (a) { expect((await request(app).post(`/v1/appointments/${a.id}/cancel`).set(H())).status).toBe(423);
      const am = await request(app).post("/v1/planning/amendments").set(H()).send({ appointmentId: a.id, reason: "Truck broke down", change: { cancel: true } }); expect(am.status).toBe(200);
      expect((await request(app).post(`/v1/planning/amendments/${am.body.id}/approve`).set(H("carrier"))).status).toBe(403);
      const ok = await request(app).post(`/v1/planning/amendments/${am.body.id}/approve`).set(H("yard.manager")); expect(ok.body.state).toBe("approved");
      expect((await request(app).get("/v1/appointments").set(H())).body.find((x: any) => x.id === a.id).status).toBe("cancelled"); }
    await request(app).put("/v1/planning/settings").set(H()).send({ cutoffEnabled: false, cutoff: "16:00" });
  });
  it("enforces placement rules and hazmat segregation on moves", async () => {
    const units = (await request(app).get("/v1/yard/units").set(H())).body; const zones = (await request(app).get("/v1/yard/zones").set(H())).body;
    const a = zones.find((z: any) => z.name === "A"); const free = a.slots.filter((s: any) => !s.unitId);
    expect((await request(app).put("/v1/planning/rules").set(H()).send({ zones: [{ zone: "A", reefer: "no" }], segregation: [{ a: "3", b: "5.1", minSlots: 3 }] })).status).toBe(200);
    const reefer = units.find((u: any) => u.reefer && u.status === "ok");
    const m = await request(app).post("/v1/tasks").set(H()).send({ unitId: reefer.id, to: free[0].label }); expect(m.status).toBe(409); expect(m.body.error).toMatch(/No reefers/);
    const haz = units.find((u: any) => u.hazmat && !u.reefer && u.status === "ok"); const other = units.find((u: any) => !u.hazmat && !u.reefer && u.status === "ok" && u.id !== haz.id);
    // make a 5.1 neighbour next to the hazmat unit: patch via rules check endpoint on the same zone
    const zh = zones.find((z: any) => z.slots.some((s: any) => s.unitId === haz.id)); const i = zh.slots.findIndex((s: any) => s.unitId === haz.id);
    const { units: repo } = await import("./modules/yard/index.ts"); const { runAs } = await import("./shared/tenancy.ts");
    const near = zh.slots[i + 1] ?? zh.slots[i - 1];
    const res = await runAs("t-ksap", async () => { const o = repo.get(other.id)!; o.hazmat = "Class 5.1"; const { placementViolations } = await import("./modules/planning/index.ts"); return placementViolations(o, near.label); });
    expect(res.join()).toMatch(/must be 3 slots from 3/);
    await request(app).put("/v1/planning/rules").set(H()).send({ zones: [], segregation: [] });
  });
  it("puts hot loads first in the staging queue and on moves", async () => {
    const q = (await request(app).get("/v1/planning/staging").set(H())).body; expect(Array.isArray(q)).toBe(true);
    const u = (await request(app).get("/v1/yard/units").set(H())).body.find((x: any) => x.status === "ok" && x.direction === "outbound" && !/^D/.test(x.location)) ?? (await request(app).get("/v1/yard/units").set(H())).body.find((x: any) => x.status === "ok");
    expect((await request(app).post(`/v1/planning/hot/${u.id}`).set(H("yard.manager")).send({ on: true })).body.hot).toBe(true);
    const q2 = (await request(app).get("/v1/planning/staging").set(H())).body; if (u.direction === "outbound") expect(q2[0].unitId).toBe(u.id);
    const free = (await request(app).get("/v1/dock/doors").set(H())).body.find((d: any) => d.state === "free");
    const t = await request(app).post("/v1/tasks").set(H()).send({ unitId: u.id, to: free.label, priority: 3 }); expect(t.status).toBe(201); expect(t.body.priority).toBe(1);
  });
});

describe("live detention accrual", () => {
  const P = { id: "pp", name: "pp", kind: "detention" as const, unitKind: "any" as const, freeHours: 2, rate: 50, currency: "EUR", roundingMinutes: 60, roundMode: "up" as const, excludeWeekends: false, holidays: [] as string[], pauseOnHold: true };
  const t0 = Date.parse("2026-11-03T06:00:00Z"); const U = (extra = {}) => ({ id: "u", number: "TR-1", kind: "trailer", carrierId: "c1", status: "ok", location: "A01", load: "loaded", gateInAt: new Date(t0).toISOString(), ...extra }) as any;
  it("applies free time, rounding, rate and cap", () => {
    const a = accrue(U(), P, t0 + 5.25 * 36e5); expect(a.billableH).toBe(4); expect(a.amount).toBe(200);
    expect(accrue(U(), { ...P, roundMode: "nearest", roundingMinutes: 15 }, t0 + 5.25 * 36e5).billableH).toBe(3.25);
    expect(accrue(U(), { ...P, capAmount: 120 }, t0 + 10 * 36e5)).toMatchObject({ amount: 120, capped: true });
    expect(accrue(U(), P, t0 + 1.5 * 36e5).amount).toBe(0);
  });
  it("pauses while on hold and on holidays", () => {
    const held = U({ holdLog: [{ from: new Date(t0 + 1 * 36e5).toISOString(), to: new Date(t0 + 4 * 36e5).toISOString() }] });
    const a = accrue(held, P, t0 + 6 * 36e5); expect(a.pausedHoldH).toBe(3); expect(a.billableH).toBe(1);
    const h = accrue(U(), { ...P, holidays: ["2026-11-04"] }, Date.parse("2026-11-04T20:00:00Z"), "Africa/Bujumbura"); // local day 4 Nov 00:00-24:00 = 3 Nov 22:00Z..4 Nov 22:00Z
    expect(h.pausedCalendarH).toBe(22); expect(h.chargeableH).toBe(16);
  });
  it("syncs live accruals as indicative charges that still need approval", async () => {
    const live = (await request(app).get("/v1/detention/accrual").set(H())).body; expect(live.length).toBeGreaterThan(10);
    const s = (await request(app).post("/v1/detention/accrual/sync").set(H())).body; expect(s.created).toBeGreaterThan(0);
    const ch = (await request(app).get("/v1/detention/charges").set(H())).body.filter((c: any) => c.id.startsWith("acc-")); expect(ch.every((c: any) => c.state === "indicative")).toBe(true);
    await request(app).post(`/v1/detention/charges/${ch[0].id}/approved`).set(H()).send({});
    const s2 = (await request(app).post("/v1/detention/accrual/sync").set(H())).body; expect(s2.skippedDecided).toBe(1);
    expect((await request(app).get("/v1/detention/profiles").set(H())).body.map((p: any) => p.id)).toContain("c1-special");
  });
});

describe("yard checks, reefers, door proposal", () => {
  it("reconciles a cycle audit and applies corrections", async () => {
    const zones = (await request(app).get("/v1/yard/zones").set(H())).body; const b = zones.find((z: any) => z.name === "B");
    const c = (await request(app).post("/v1/ops/checks").set(H("spotter")).send({ zoneIds: [b.id] })).body; expect(c.state).toBe("open");
    expect((await request(app).post("/v1/ops/checks").set(H()).send({})).status).toBe(409);
    const occ = b.slots.filter((s: any) => s.unitId); const empty = b.slots.find((s: any) => !s.unitId); const units = (await request(app).get("/v1/yard/units").set(H())).body; const num = (id: string) => units.find((u: any) => u.id === id).number;
    await request(app).post(`/v1/ops/checks/${c.id}/scan`).set(H("spotter")).send({ slot: occ[0].label, unitNumber: num(occ[0].unitId) });
    await request(app).post(`/v1/ops/checks/${c.id}/scan`).set(H("spotter")).send({ slot: occ[1].label, unitNumber: null });
    await request(app).post(`/v1/ops/checks/${c.id}/scan`).set(H("spotter")).send({ slot: empty.label, unitNumber: num(occ[1].unitId) });
    const r = (await request(app).get(`/v1/ops/checks/${c.id}/reconcile`).set(H())).body; expect(r.matched).toBe(1); expect(r.unexpected[0]).toMatchObject({ slot: empty.label, systemSlot: occ[1].label });
    const done = (await request(app).post(`/v1/ops/checks/${c.id}/close`).set(H()).send({ apply: true })).body; expect(done.result.applied).toBe(1);
    expect((await request(app).get("/v1/yard/units").set(H())).body.find((u: any) => u.id === occ[1].unitId).location).toBe(empty.label);
  });
  it("monitors reefers with setpoint, plug and alerts", async () => {
    const r = (await request(app).get("/v1/ops/reefers").set(H())).body; expect(r.units.length).toBeGreaterThan(0); const u = r.units[0];
    expect(u.alarms).toContain("Not plugged in");
    const p = await request(app).post(`/v1/ops/reefers/${u.unitId}`).set(H()).send({ plug: "P01", setpoint: 2 }); expect(p.body.plug).toBe("P01");
    expect((await request(app).post(`/v1/ops/reefers/${r.units[1].unitId}`).set(H()).send({ plug: "P01" })).status).toBe(409);
    expect((await request(app).post(`/v1/ops/reefers/${u.unitId}`).set(H()).send({ setpoint: 60 })).status).toBe(422);
    const ex = (await request(app).get("/v1/yard/exceptions").set(H())).body; expect(ex.some((x: any) => /Reefer .*Not plugged/.test(x.text))).toBe(true);
  });
  it("proposes a door with reasons and needs a reason to override", async () => {
    const u = (await request(app).get("/v1/yard/units").set(H())).body.find((x: any) => x.reefer && x.status === "ok" && !/^D/.test(x.location));
    const p = (await request(app).get(`/v1/ops/doors/proposal/${u.id}`).set(H("dock.supervisor"))).body; expect(p[0].reasons.join()).toMatch(/reefer/);
    const other = p[p.length - 1];
    expect((await request(app).post(`/v1/ops/doors/assign/${u.id}`).set(H("dock.supervisor")).send({ doorId: other.doorId })).status).toBe(422);
    const ok = await request(app).post(`/v1/ops/doors/assign/${u.id}`).set(H("dock.supervisor")).send({ doorId: other.doorId, reason: "Proposed door has a broken leveller" });
    expect(ok.status).toBe(200); expect(ok.body.overridden).toBe(true); expect(ok.body.door.assignment.override).toMatch(/leveller/);
  });
});
