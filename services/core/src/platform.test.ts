import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
process.env.JWT_SECRET = "test-secret";
const dir = mkdtempSync(join(tmpdir(), "ymspg-"));
const { bootstrap } = await import("./bootstrap.ts");
const db = await import("./shared/db.ts");
const { stores } = await import("./shared/repo.ts");
const { app } = await import("./app.ts");
const request = (await import("supertest")).default;
const PW = "Ymsnow!2026";
const tok = async (email: string) => (await request(app).post("/v1/auth/login").send({ email, password: PW })).body.token as string;
beforeAll(async () => { await bootstrap(dir); }, 60_000);
afterAll(async () => { await db.closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("auth", () => {
  it("rejects anonymous", async () => expect((await request(app).get("/v1/yard/units")).status).toBe(401));
  it("rejects bad password", async () => expect((await request(app).post("/v1/auth/login").send({ email: "yard.manager@ksap.example", password: "nope" })).status).toBe(401));
  it("enforces role permissions server-side", async () => {
    const g = await tok("gate.guard@ksap.example");
    expect((await request(app).get("/v1/yard/units").set("Authorization", "Bearer " + g)).status).toBe(200);
    expect((await request(app).post("/v1/detention/charges/ch3/approved").set("Authorization", "Bearer " + g).send({})).status).toBe(403);
    expect((await request(app).patch("/v1/tenant/config").set("Authorization", "Bearer " + g).send({ brandName: "x" })).status).toBe(403);
    const c = await tok("carrier@ksap.example");
    expect((await request(app).get("/v1/yard/units").set("Authorization", "Bearer " + c)).status).toBe(403);
    const appts = (await request(app).get("/v1/appointments").set("Authorization", "Bearer " + c)).body as { carrierId: string }[];
    expect(appts.length).toBeGreaterThan(0); expect(appts.every((a) => a.carrierId === "c2")).toBe(true);
  });
  it("demo role switch only for demo sessions", async () => {
    const y = await tok("yard.manager@ksap.example");
    expect((await request(app).post("/v1/auth/demo/role").set("Authorization", "Bearer " + y).send({ role: "tenant_admin" })).status).toBe(403);
    const d = (await request(app).post("/v1/auth/demo")).body.token;
    const s = await request(app).post("/v1/auth/demo/role").set("Authorization", "Bearer " + d).send({ role: "spotter" });
    expect(s.body.user.role).toBe("spotter");
  });
});
describe("tenancy + persistence", () => {
  it("row-level security hides other tenants' rows", async () => {
    const own = await db.asTenant("t-ksap", async (tx) => (await tx.query("SELECT count(*)::int n FROM units")).rows[0].n);
    const cross = await db.asTenant("t-ksap", async (tx) => (await tx.query("SELECT count(*)::int n FROM units WHERE tenant_id='t-demo'")).rows[0].n);
    expect(own).toBeGreaterThan(0); expect(cross).toBe(0);
    await expect(db.asTenant("t-ksap", (tx) => tx.query("INSERT INTO units(tenant_id,id,data) VALUES ('t-demo','x','{}')"))).rejects.toThrow();
  });
  it("demo reset never touches the operations tenant", async () => {
    const y = await tok("yard.manager@ksap.example"); const H = { Authorization: "Bearer " + y };
    const u = (await request(app).get("/v1/yard/units").set(H)).body.find((x: any) => x.status === "ok" && /^[ABC]/.test(x.location));
    await request(app).post(`/v1/yard/units/${u.id}/hold`).set(H).send({ reason: "test" });
    const d = (await request(app).post("/v1/auth/demo")).body.token;
    expect((await request(app).post("/v1/demo/reset").set("Authorization", "Bearer " + d)).status).toBe(200);
    expect((await request(app).post("/v1/demo/reset").set(H)).status).toBe(403);
    const after = (await request(app).get("/v1/yard/units").set(H)).body.find((x: any) => x.id === u.id);
    expect(after.status).toBe("hold");
  });
  it("data survives a restart", async () => {
    const y = await tok("yard.manager@ksap.example"); const H = { Authorization: "Bearer " + y };
    const u = (await request(app).get("/v1/yard/units").set(H)).body.find((x: any) => x.status === "ok" && /^[ABC]/.test(x.location));
    await request(app).post(`/v1/yard/units/${u.id}/hold`).set(H).send({});
    await db.flush("t-ksap"); await db.closeDb(); for (const s of stores()) { s.reset("t-ksap"); s.reset("t-demo"); }
    await bootstrap(dir);
    const back = (await request(app).get("/v1/yard/units").set("Authorization", "Bearer " + (await tok("yard.manager@ksap.example")))).body.find((x: any) => x.id === u.id);
    expect(back.status).toBe("hold");
  }, 60_000);
});
describe("gate OCR adapter", () => {
  it("forwards uploads to the adapter and enforces role", async () => {
    const { setOcrAdapter } = await import("./modules/gate/ocr.ts");
    setOcrAdapter({ health: async () => true, read: async (_b, _m, kind) => ({ container: { number: "MSKU3072946", valid: true, raw: "MSKU3072946", confidence: 0.9, suggested: null, corrections: 0 }, plate: null, confidence: 0.9, route: "auto", engine: "fake:" + kind, tokens: [], size: [1, 1] }) });
    const g = await tok("gate.guard@ksap.example");
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const r = await request(app).post("/v1/gate/ocr").set("Authorization", "Bearer " + g).field("kind", "container").attach("image", png, { filename: "a.png", contentType: "image/png" });
    expect(r.status).toBe(200); expect(r.body.engine).toBe("fake:container");
    const s = await tok("spotter@ksap.example");
    expect((await request(app).post("/v1/gate/ocr").set("Authorization", "Bearer " + s).attach("image", png, { filename: "a.png", contentType: "image/png" })).status).toBe(403);
  });
});
