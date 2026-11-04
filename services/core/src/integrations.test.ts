import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import type { AddressInfo } from "node:net";
process.env.JWT_SECRET = "test-secret";
const dir = mkdtempSync(join(tmpdir(), "ymsint-"));
const { bootstrap } = await import("./bootstrap.ts");
const db = await import("./shared/db.ts");
const { app } = await import("./app.ts");
const mock = await import("./mocks/server.ts");
const hub = await import("./modules/integrations/index.ts");
const { otm, sap } = await import("./modules/integrations/mapping.ts");
const { runAs } = await import("./shared/tenancy.ts");
const request = (await import("supertest")).default;
let base = ""; let srv: any; let admin = "";
const auth = () => ({ authorization: "Bearer " + admin });
const drain = () => runAs("t-ksap", () => hub.drain());
beforeAll(async () => {
  await bootstrap(dir); srv = mock.app.listen(0); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  admin = (await request(app).post("/v1/auth/login").send({ email: "tenant.admin@ksap.example", password: "Ymsnow!2026" })).body.token;
  for (const s of ["otm", "sap", "erp", "wms"]) await request(app).put(`/v1/integrations/config/${s}`).set(auth()).send({ enabled: true, endpoint: `${base}/${s}`, password: "pw", retryBaseMs: 100, maxAttempts: 3 }).expect(200);
}, 60_000);
afterAll(async () => { srv?.close(); await db.closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("OTM contract", () => {
  it("outbound ShipmentStatus XML matches the GLog shape and carries auth + idempotency key", async () => {
    const xml = otm.event({ eventId: "e1", type: "GateIn", at: "2026-11-04T10:00:00Z", tenantId: "t", siteId: "s", version: "v1", aggregateId: "u", aggregateVersion: 1, payload: {} } as any, "KSAP", { unitNumber: "MSKU1234565", door: "D01", shipmentRef: "SH-1" });
    expect(xml).toMatch(/<Transmission xmlns="http:\/\/xmlns.oracle.com\/apps\/otm\/transmission\/v6.4">/);
    for (const t of ["<SenderTransmissionNo>e1</SenderTransmissionNo>", "<Xid>X3</Xid>", "<GLogDate>20261104100000</GLogDate>", "<EquipmentIdentificationNum>MSKU1234565</EquipmentIdentificationNum>", "<ShipmentRefnumValue>SH-1</ShipmentRefnumValue>"]) expect(xml).toContain(t);
  });
  it("gate-in event is delivered to the mock OTM servlet once, even if published twice", async () => {
    await runAs("t-ksap", () => { const e = { eventId: "dup-1", type: "GateIn", aggregateId: "u1", aggregateVersion: 1, payload: { unitId: "u1" } } as any; hub.enqueue("otm", "event", "<Transmission><TransmissionHeader>t</TransmissionHeader></Transmission>", "evt-x"); hub.enqueue("otm", "event", "<Transmission><TransmissionHeader>t</TransmissionHeader></Transmission>", "evt-x"); return e; });
    await drain(); const got = mock.received.filter((r) => r.system === "otm" && r.idemKey === "evt-x");
    expect(got).toHaveLength(1); expect(got[0].auth).toBe("basic"); expect(got[0].path).toBe("/otm/GC3/glog.integration.servlets.WMServlet");
  });
  it("retries with backoff on 503, then dead-letters after maxAttempts; manual retry recovers", async () => {
    await request(base).post("/_control").send({ system: "otm", failNext: 10, status: 503 });
    const m = await runAs("t-ksap", () => hub.enqueue("otm", "event", "<Transmission><TransmissionHeader>t</TransmissionHeader></Transmission>", "evt-retry"))!;
    await drain(); expect(m!.status).toBe("failed"); expect(m!.attempts).toBe(1);
    const gap = Date.parse(m!.nextAt) - Date.now(); expect(gap).toBeGreaterThan(0); expect(gap).toBeLessThanOrEqual(100);
    for (let i = 0; i < 2; i++) { m!.nextAt = new Date(0).toISOString(); await drain(); }
    expect(m!.status).toBe("dead"); expect(m!.lastError).toMatch(/503/);
    await request(base).post("/_control").send({ system: "otm", failNext: 0 });
    await request(app).post(`/v1/integrations/messages/${m!.id}/retry`).set(auth()).expect(200); await drain(); expect(m!.status).toBe("sent");
  });
  it("4xx is not retried (dead immediately)", async () => {
    const m = await runAs("t-ksap", () => hub.enqueue("otm", "event", "not xml <", "evt-bad"))!; await drain(); expect(m!.status).toBe("dead"); expect(m!.httpStatus).toBe(400);
  });
  it("inbound Shipment transmission creates appointments; replay is a no-op; bad key 401; malformed 422 logged", async () => {
    const key = (await request(app).get("/v1/integrations").set(auth())).body.systems.find((s: any) => s.system === "otm").config.inboundKey;
    const xml = mock.sampleOtm(2, 777);
    expect((await request(app).post("/v1/integrations/inbound/t-ksap/otm").set("content-type", "application/xml").set("x-api-key", "wrong").send(xml)).status).toBe(401);
    const r1 = await request(app).post("/v1/integrations/inbound/t-ksap/otm").set("content-type", "application/xml").set("x-api-key", key).send(xml);
    expect(r1.status).toBe(202); expect(r1.body.results.map((x: any) => x.created)).toEqual([true, true]);
    const r2 = await request(app).post("/v1/integrations/inbound/t-ksap/otm").set("content-type", "application/xml").set("x-api-key", key).send(xml);
    expect(r2.body.duplicate).toBe(true);
    const appts = (await request(app).get("/v1/appointments").set(auth())).body.filter((a: any) => a.ref.startsWith("SH-777-"));
    expect(appts).toHaveLength(2); expect(appts[0].source).toBe("otm"); expect(appts[0].unitNumber).toMatch(/^MSKU/);
    const bad = await request(app).post("/v1/integrations/inbound/t-ksap/otm").set("content-type", "application/xml").set("x-api-key", key).send("<Foo/>");
    expect(bad.status).toBe(422); const rej = (await request(app).get("/v1/integrations/messages?status=rejected").set(auth())).body; expect(rej.length).toBeGreaterThan(0);
  });
});
describe("SAP contract", () => {
  it("OData and IDoc payloads map to appointments", () => {
    const o = sap.parse(mock.sampleSap(1, 5)); expect(o.appts[0]).toMatchObject({ carrierCode: "ATLS", direction: "inbound" }); expect(o.appts[0].slotStart).toMatch(/Z$/);
    const i = sap.parse({ IDOC: { EDI_DC40: { DOCNUM: "42" }, E1TORH: [{ TOR_ID: "6100001", TSP_ID: "PNCR", PLAN_START_UTC: "2026-11-05T08:00:00Z", DIRECTION: "O" }] } });
    expect(i.transmissionNo).toBe("IDOC-42"); expect(i.appts[0]).toMatchObject({ externalRef: "6100001", direction: "outbound" });
  });
  it("outbound EventSet entity accepted by the mock gateway", async () => {
    await runAs("t-ksap", () => hub.enqueue("sap", "event", sap.event({ eventId: "s1", type: "DoorOccupied", at: new Date().toISOString(), siteId: "s" } as any, { door: "D01" }), "evt-s1")); await drain();
    const g = mock.received.find((r) => r.system === "sap" && r.idemKey === "evt-s1")!; expect(JSON.parse(g.body)).toMatchObject({ EventId: "s1", EventCode: "DoorOccupied", DoorId: "D01" });
  });
  it("inbound OData via HTTP", async () => {
    const key = (await request(app).get("/v1/integrations").set(auth())).body.systems.find((s: any) => s.system === "sap").config.inboundKey;
    const r = await request(app).post("/v1/integrations/inbound/t-ksap/sap").set("x-api-key", key).send(mock.sampleSap(2, 9)); expect(r.status).toBe(202); expect(r.body.results).toHaveLength(2);
  });
});
describe("WMS + ERP", () => {
  it("door assignment emits a WMS door event", async () => {
    const units = (await request(app).get("/v1/yard/units").set(auth())).body; const doors = (await request(app).get("/v1/dock/doors").set(auth())).body;
    const free = doors.find((d: any) => d.state === "free"); const u = units.find((x: any) => /^[ABC]\d/.test(x.location) && x.status !== "hold");
    await request(app).post(`/v1/dock/doors/${free.id}/assign`).set(auth()).send({ unitId: u.id }).expect(200); await drain();
    const w = mock.received.filter((r) => r.system === "wms").map((r) => JSON.parse(r.body)); expect(w.some((x) => x.type === "door.occupied" && x.door === free.label && x.unit === u.number)).toBe(true);
  });
  it("ERP export takes approved charges only, as CSV and as REST push", async () => {
    const ap = (await request(app).post("/v1/auth/login").send({ email: "detention.approver@ksap.example", password: "Ymsnow!2026" })).body.token; const h = { authorization: "Bearer " + ap };
    const all = (await request(app).get("/v1/detention/charges").set(h)).body; const ind = all.filter((c: any) => c.state === "indicative").slice(0, 3);
    for (const c of ind) await request(app).post(`/v1/detention/charges/${c.id}/approved`).set(h).send({}).expect(200);
    const approvedNow = (await request(app).get("/v1/detention/charges").set(h)).body.filter((c: any) => c.state === "approved").length;
    const csv = await request(app).post("/v1/integrations/erp/export").set(h).send({ mode: "csv" }); expect(csv.status).toBe(200);
    expect(csv.text.trim().split("\n")).toHaveLength(approvedNow + 1); expect(csv.text.split("\n")[0]).toContain("chargeId,visitRef");
    expect((await request(app).post("/v1/integrations/erp/export").set(h).send({ mode: "push" })).status).toBe(409); // nothing approved left
    await request(app).post(`/v1/detention/charges/${all.find((c: any) => c.state === "indicative" && !ind.includes(c))?.id ?? ind[0].id}/approved`).set(h).send({});
    const p = await request(app).post("/v1/integrations/erp/export").set(h).send({ mode: "push" }); expect(p.status).toBe(200); await drain();
    const e = mock.received.filter((r) => r.system === "erp").map((r) => JSON.parse(r.body)); expect(e.at(-1).lines.length).toBe(p.body.queued);
    expect((await request(app).post("/v1/integrations/erp/export").set({ authorization: "Bearer " + (await request(app).post("/v1/auth/login").send({ email: "spotter@ksap.example", password: "Ymsnow!2026" })).body.token }).send({})).status).toBe(403);
  });
});
