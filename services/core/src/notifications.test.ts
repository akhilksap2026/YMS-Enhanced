import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { SMTPServer } from "smtp-server";
process.env.JWT_SECRET = "test-secret";
const dir = mkdtempSync(join(tmpdir(), "ymsnt-"));
const { bootstrap } = await import("./bootstrap.ts");
const db = await import("./shared/db.ts");
const { app } = await import("./app.ts");
const request = (await import("supertest")).default;
let h = {}; const mails: string[] = []; let smtp: SMTPServer; let port = 0;
beforeAll(async () => {
  await bootstrap(dir); h = { authorization: "Bearer " + (await request(app).post("/v1/auth/login").send({ email: "tenant.admin@ksap.example", password: "Ymsnow!2026" })).body.token };
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(s, _sess, cb) { let b = ""; s.on("data", (c) => (b += c)); s.on("end", () => { mails.push(b); cb(); }); } });
  await new Promise<void>((ok) => smtp.listen(0, "127.0.0.1", () => { port = (smtp.server.address() as any).port; ok(); }));
}, 60_000);
afterAll(async () => { smtp.close(); await db.closeDb(); rmSync(dir, { recursive: true, force: true }); });
describe("notifications", () => {
  it("default capture provider records rendered French template in the local mailbox", async () => {
    await request(app).put("/v1/notifications/config").set(h).send({ language: "fr" }).expect(200);
    const d = (await request(app).post("/v1/notifications/test").set(h).send({ channel: "email", to: "ops@ksap.example", kind: "dock" })).body;
    expect(d).toMatchObject({ status: "sent", provider: "capture", lang: "fr" }); expect(d.text).toBe("MSKU1234565 est au quai D01.");
  });
  it("tenant template override wins; validation rejects bad recipients", async () => {
    await request(app).put("/v1/notifications/config").set(h).send({ templates: { en: { gate: { text: "Hi {{unit}}" } } } }).expect(200);
    expect((await request(app).post("/v1/notifications/test").set(h).send({ channel: "sms", to: "+25779000001", kind: "gate", lang: "en" })).body.text).toBe("Hi MSKU1234565");
    expect((await request(app).post("/v1/notifications/test").set(h).send({ channel: "email", to: "nope" })).status).toBe(422);
    expect((await request(app).put("/v1/notifications/config").set(h).send({ routing: { gate: { email: "x" } } })).status).toBe(422);
  });
  it("SMTP provider delivers to a real SMTP server", async () => {
    await request(app).put("/v1/notifications/config").set(h).send({ language: "en", email: { provider: "smtp", host: "127.0.0.1", port, secure: false, from: "yms@localhost" } }).expect(200);
    const d = (await request(app).post("/v1/notifications/test").set(h).send({ channel: "email", to: "ops@ksap.example", kind: "appointment" })).body;
    expect(d.status).toBe("sent"); expect(d.provider).toBe("smtp"); expect(mails.at(-1)).toContain("Subject: Appointment APT-TEST confirmed");
  });
  it("events fan out to routed recipients; non-admins cannot read deliveries", async () => {
    const before = (await request(app).get("/v1/notifications/deliveries").set(h)).body.length;
    const doors = (await request(app).get("/v1/dock/doors").set(h)).body; const units = (await request(app).get("/v1/yard/units").set(h)).body;
    await request(app).post(`/v1/dock/doors/${doors.find((x: any) => x.state === "free").id}/assign`).set(h).send({ unitId: units.find((u: any) => /^[ABC]\d/.test(u.location) && u.status !== "hold").id }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    const after = (await request(app).get("/v1/notifications/deliveries").set(h)).body; expect(after.length).toBe(before + 1); expect(after[0]).toMatchObject({ kind: "dock", to: "dock.team@ksap.example" });
    const sp = (await request(app).post("/v1/auth/login").send({ email: "spotter@ksap.example", password: "Ymsnow!2026" })).body.token;
    expect((await request(app).get("/v1/notifications/deliveries").set({ authorization: "Bearer " + sp })).status).toBe(403);
  });
});
