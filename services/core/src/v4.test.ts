import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
process.env.JWT_SECRET = "test-secret";
const dir = mkdtempSync(join(tmpdir(), "ymsv4-"));
const { bootstrap } = await import("./bootstrap.ts");
const db = await import("./shared/db.ts");
const { app } = await import("./app.ts");
const request = (await import("supertest")).default;
const PW = "Ymsnow!2026";
const tok = async (email: string, pw = PW) => (await request(app).post("/v1/auth/login").send({ email, password: pw })).body.token as string;
let A = ""; const H = (site?: string) => ({ authorization: "Bearer " + A, ...(site ? { "x-site": site } : {}) });
beforeAll(async () => { await bootstrap(dir); A = await tok("tenant.admin@ksap.example"); }, 60_000);
afterAll(async () => { await db.closeDb(); rmSync(dir, { recursive: true, force: true }); });
const nextWeekday = (hourLocal: number, addDays = 2) => { const d = new Date(Date.now() + addDays * 864e5); while ([0, 6].includes(new Date(d.getTime() + 2 * 3600e3).getUTCDay())) d.setTime(d.getTime() + 864e5);
  const ymd = new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10); return new Date(Date.parse(ymd + "T00:00:00Z") + (hourLocal - 2) * 3600e3).toISOString(); };

describe("multi-site", () => {
  it("creates a site with its own layout and scopes every list to the selected site", async () => {
    const s = await request(app).post("/v1/admin/sites").set(H()).send({ code: "NTH", name: "North Depot", doors: 3, zones: [{ name: "A", kind: "row", slots: 5 }] });
    expect(s.status).toBe(200); expect(s.body.id).toBe("s-nth");
    expect((await request(app).post("/v1/admin/sites").set(H()).send({ code: "NTH", name: "Dup" })).status).toBe(409);
    expect((await request(app).post("/v1/admin/sites").set(H()).send({ code: "x", name: "" })).status).toBe(422);
    const mainDoors = (await request(app).get("/v1/dock/doors").set(H())).body, nDoors = (await request(app).get("/v1/dock/doors").set(H("s-nth"))).body;
    expect(mainDoors.length).toBe(14); expect(nDoors.map((d: any) => d.label)).toEqual(["D01", "D02", "D03"]);
    expect((await request(app).get("/v1/yard/units").set(H("s-nth"))).body).toEqual([]);
    expect((await request(app).get("/v1/yard/units").set(H())).body.length).toBeGreaterThan(30);
    const t = (await request(app).get("/v1/tenant").set(H("s-nth"))).body; expect(t.site.name).toBe("North Depot"); expect(t.sites.map((x: any) => x.id)).toContain("s-nth");
    expect((await request(app).get("/v1/yard/units").set(H("s-nope"))).status).toBe(404);
  });
  it("persists site-scoped rows without id collisions and deletes empty sites", async () => {
    await request(app).put("/v1/admin/doors").set(H("s-nth")).send({ count: 4 }).expect(200); await db.flush("t-ksap");
    const rows = (await db.getDb().query<{ id: string }>("SELECT id FROM doors WHERE tenant_id='t-ksap' ORDER BY id")).rows.map((r) => r.id);
    expect(rows).toContain("d1"); expect(rows).toContain("s-nth|d4");
    expect((await request(app).delete("/v1/admin/sites/s-rsr").set(H())).status).toBe(409);
    expect((await request(app).delete("/v1/admin/sites/s-nth").set(H())).status).toBe(200); await db.flush("t-ksap");
    expect((await db.getDb().query("SELECT id FROM doors WHERE id LIKE 's-nth|%'")).rows.length).toBe(0);
  });
});
describe("appointments via rules", () => {
  it("books inside rules, refuses violations with reasons, lets a manager override", async () => {
    const slot = nextWeekday(10); const c = await tok("carrier@ksap.example"); const C = { authorization: "Bearer " + c };
    const ok = await request(app).post("/v1/appointments").set(C).send({ slotStart: slot, direction: "inbound" }); expect(ok.status).toBe(201); expect(ok.body.carrierId).toBe("c2");
    const night = nextWeekday(23); const bad = await request(app).post("/v1/appointments").set(C).send({ slotStart: night, direction: "inbound", override: true });
    expect(bad.status).toBe(409); expect(bad.body.violations[0].rule).toBe("window");
    const ov = await request(app).post("/v1/appointments").set(H()).send({ carrierId: "c1", slotStart: night, direction: "inbound", override: true }); expect(ov.status).toBe(201); expect(ov.body.history[0].action).toMatch(/override/);
    expect((await request(app).post("/v1/appointments").set(C).send({ slotStart: "tomorrow" })).status).toBe(422);
    const rs = await request(app).post(`/v1/appointments/${ok.body.id}/reschedule`).set(C).send({ slotStart: nextWeekday(11) }); expect(rs.status).toBe(200); expect(rs.body.reschedules).toBe(1);
    await request(app).put("/v1/appointments/rules").set(H()).send({ reschedule: { maxCount: 1 } }).expect(200);
    const rs2 = await request(app).post(`/v1/appointments/${ok.body.id}/reschedule`).set(C).send({ slotStart: nextWeekday(12) }); expect(rs2.status).toBe(409); expect(rs2.body.violations[0].rule).toBe("reschedule_count");
    expect((await request(app).put("/v1/appointments/rules").set(C).send({})).status).toBe(403);
    const av = (await request(app).get("/v1/appointments/availability?date=" + slot.slice(0, 10)).set(C)).body; expect(av.slots.length).toBeGreaterThan(5);
    expect((await request(app).put("/v1/appointments/rules").set(H()).send({ slotMinutes: 7 })).status).toBe(422);
  });
});
describe("passwords and audit", () => {
  it("changes a password with the current one", async () => {
    const t = await tok("dock.supervisor@ksap.example"); const T = { authorization: "Bearer " + t };
    expect((await request(app).post("/v1/auth/password").set(T).send({ current: "wrong", next: "Newpass12345" })).status).toBe(422);
    expect((await request(app).post("/v1/auth/password").set(T).send({ current: PW, next: "short" })).status).toBe(422);
    expect((await request(app).post("/v1/auth/password").set(T).send({ current: PW, next: "Newpass12345" })).status).toBe(200);
    expect(await tok("dock.supervisor@ksap.example", "Newpass12345")).toBeTruthy();
  });
  it("resets by e-mailed code without revealing whether an account exists", async () => {
    const unknown = await request(app).post("/v1/auth/reset-request").send({ email: "nobody@x.example" }); const known = await request(app).post("/v1/auth/reset-request").send({ email: "spotter@ksap.example" });
    expect(unknown.body).toEqual(known.body);
    const mail = (await request(app).get("/v1/notifications/deliveries").set(H())).body.find((d: any) => d.kind === "password_reset" && d.to === "spotter@ksap.example");
    const code = mail.text.match(/\d{6}/)[0];
    expect((await request(app).post("/v1/auth/reset").send({ email: "spotter@ksap.example", code: "000000", password: "Reset123456" })).status).toBe(422);
    expect((await request(app).post("/v1/auth/reset").send({ email: "spotter@ksap.example", code, password: "Reset123456" })).status).toBe(200);
    expect((await request(app).post("/v1/auth/reset").send({ email: "spotter@ksap.example", code, password: "Reset123456" })).status).toBe(422); // single use
    expect(await tok("spotter@ksap.example", "Reset123456")).toBeTruthy();
  });
  it("records writes in the audit log, admin-only viewer with filters", async () => {
    const all = (await request(app).get("/v1/admin/audit").set(H())).body; expect(all.some((a: any) => a.path === "/admin/sites" && a.method === "POST")).toBe(true);
    expect(all.some((a: any) => a.detail === "password reset by code")).toBe(true);
    const f = (await request(app).get("/v1/admin/audit?q=reschedule").set(H())).body; expect(f.length).toBeGreaterThan(0); expect(f.every((a: any) => a.path.includes("reschedule"))).toBe(true);
    expect((await request(app).get("/v1/admin/audit").set({ authorization: "Bearer " + (await tok("yard.manager@ksap.example")) })).status).toBe(403);
  });
  it("validates admin input", async () => {
    expect((await request(app).post("/v1/admin/users").set(H()).send({ email: "bad", name: "X", role: "god", password: "1" })).status).toBe(422);
    expect((await request(app).put("/v1/admin/doors").set(H()).send({ count: 99 })).status).toBe(422);
    expect((await request(app).post("/v1/admin/doors/d1/state").set(H()).send({ state: "melted" })).status).toBe(422);
  });
});
describe("reports", () => {
  it("computes all five reports with filters and exports CSV and Excel", async () => {
    const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    for (const k of ["dwell", "turn", "doors", "detention", "carriers"]) { const r = await request(app).get(`/v1/reports/${k}?from=${from}`).set(H()); expect(r.status).toBe(200); expect(r.body.kpis).toBeTruthy(); expect(r.body.rows.length).toBeGreaterThan(0); }
    const t = (await request(app).get(`/v1/reports/turn?from=${from}`).set(H())).body; expect(t.series.length).toBeGreaterThanOrEqual(14); expect(t.kpis.avg).toBeGreaterThan(0);
    const c1 = (await request(app).get(`/v1/reports/carriers?from=${from}&carrierId=c1`).set(H())).body; expect(c1.rows.length).toBe(1); expect(c1.rows[0].grade).toMatch(/[A-D]/);
    const d = (await request(app).get(`/v1/reports/doors?from=${from}`).set(H())).body; expect(d.kpis.avgUtilisationPct).toBeGreaterThan(0); expect(d.rows.every((r: any) => r.utilisationPct <= 100)).toBe(true);
    const csv = await request(app).get(`/v1/reports/carriers.csv?from=${from}`).set(H()); expect(csv.status).toBe(200); expect(csv.headers["content-type"]).toMatch(/csv/); expect(csv.text).toMatch(/carrier,scac,appointments/);
    const x = await request(app).get(`/v1/reports/turn.xlsx?from=${from}`).set(H()).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on("data", (c: Buffer) => b.push(c)); res.on("end", () => cb(null, Buffer.concat(b))); });
    expect(x.status).toBe(200); expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const ExcelJS = (await import("exceljs")).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.body as any); expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["Summary", "Detail", "Series"]));
    expect((await request(app).get("/v1/reports/turn?from=2026-13-01").set(H())).status).toBe(422); expect((await request(app).get("/v1/reports/nope").set(H())).status).toBe(404);
    expect((await request(app).get("/v1/reports/dwell").set({ authorization: "Bearer " + (await tok("carrier@ksap.example")) })).status).toBe(403);
  });
  it("gate-out records a visit that appears in turn time", async () => {
    const u = (await request(app).get("/v1/yard/units").set(H())).body.find((x: any) => x.status === "ok");
    const out = await request(app).post("/v1/gate/checkout").set(H()).send({ unitId: u.id }); expect(out.status).toBe(200);
    expect((await request(app).get("/v1/yard/units").set(H())).body.some((x: any) => x.id === u.id)).toBe(false);
    expect((await request(app).get("/v1/reports/turn").set(H())).body.rows[0].unit).toBe(u.number);
  });
});
