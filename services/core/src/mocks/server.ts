/** Local mock OTM / SAP / ERP / WMS endpoints for end-to-end testing. Run: npm run mocks (port 9100).
 *  - Records everything received: GET /_received?system=otm
 *  - Fault injection: POST /_control { system, failNext: 3, status: 503 }
 *  - Sends sample inbound traffic to YMSNow: POST /_push/:system { core, tenant, key, n } */
import express from "express";
import { XMLParser } from "fast-xml-parser";
type Rec = { system: string; path: string; at: string; idemKey?: string; auth?: string; contentType?: string; body: string; duplicate?: boolean };
export const received: Rec[] = []; const faults: Record<string, { left: number; status: number }> = {}; const seenKeys = new Set<string>();
const xp = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
const rec = (system: string) => (q: express.Request, r: express.Response) => {
  const f = faults[system]; if (f && f.left > 0) { f.left--; return r.status(f.status).send(`<Error>injected fault (${f.left} left)</Error>`); }
  const body = typeof q.body === "string" ? q.body : JSON.stringify(q.body);
  const key = q.headers["idempotency-key"] as string | undefined; const dup = !!key && seenKeys.has(system + key); if (key) seenKeys.add(system + key);
  if (system === "otm") { if (!q.headers.authorization?.startsWith("Basic ")) return r.status(401).send("<Error>Basic auth required</Error>");
    try { const d = xp.parse(body); if (!d.Transmission && !d.Ping) throw new Error("no Transmission"); } catch { return r.status(400).send("<Error>Malformed GLog XML</Error>"); } }
  if (system === "sap" && !(q.body?.EventId || q.body?.TorId)) return r.status(400).json({ error: { code: "/IWBEP/CM_MGW_RT/020", message: { value: "EventId or TorId required" } } });
  received.push({ system, path: q.path, at: new Date().toISOString(), idemKey: key, auth: q.headers.authorization ? "basic" : undefined, contentType: q.headers["content-type"], body, duplicate: dup });
  if (system === "otm") return r.type("application/xml").send(`<TransmissionAck><EchoedTransmissionHeader><TransmissionHeader><ReferenceTransmissionNo>${received.length}</ReferenceTransmissionNo></TransmissionHeader></EchoedTransmissionHeader><TransmissionAckStatus>PROCESSED</TransmissionAckStatus></TransmissionAck>`);
  if (system === "sap") return r.status(201).json({ d: { ...q.body, __metadata: { type: "ZYMS_YARD_SRV.Event" } } });
  r.status(202).json({ accepted: true, id: received.length });
};
const iso = (h: number) => new Date(Date.now() + h * 3600e3); const otmDate = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
export const sampleOtm = (n: number, seq = Date.now()) => `<?xml version="1.0" encoding="UTF-8"?>
<Transmission xmlns="http://xmlns.oracle.com/apps/otm/transmission/v6.4"><TransmissionHeader><SenderTransmissionNo>${seq}</SenderTransmissionNo><SenderSystemId>OTM-MOCK</SenderSystemId></TransmissionHeader>
<TransmissionBody>${Array.from({ length: n }, (_, i) => `<GLogXMLElement><Shipment><ShipmentHeader><ShipmentGid><Gid><DomainName>KSAP</DomainName><Xid>SH-${seq}-${i + 1}</Xid></Gid></ShipmentGid>
<ServiceProviderGid><Gid><DomainName>KSAP</DomainName><Xid>${["ATLS", "CSTL", "RDGW"][i % 3]}</Xid></Gid></ServiceProviderGid></ShipmentHeader>
<ShipmentStop><StopSequence>1</StopSequence><StopType>${i % 2 ? "P" : "D"}</StopType><AppointmentDelivery><GLogDate>${otmDate(iso(2 + i))}</GLogDate></AppointmentDelivery></ShipmentStop>
<ShipmentEquipment><EquipmentInitialNumber>MSKU${String(1000000 + i).slice(0, 6)}${i % 10}</EquipmentInitialNumber></ShipmentEquipment></Shipment></GLogXMLElement>`).join("")}</TransmissionBody></Transmission>`;
export const sampleSap = (n: number, seq = Date.now()) => ({ BatchId: String(seq), d: { results: Array.from({ length: n }, (_, i) => ({ TorId: `61000${seq % 100000}${i}`, CarrierId: ["ATLS", "PNCR"][i % 2], PlannedStart: `/Date(${Date.parse(iso(3 + i).toISOString())})/`, Direction: i % 2 ? "O" : "I", ContainerId: `TGHU45182${i}6` })) } });
export const app = express().use(express.text({ type: ["application/xml", "text/xml"], limit: "5mb" })).use(express.json({ limit: "5mb" }))
  .get("/_received", (q, r) => r.json(received.filter((x) => !q.query.system || x.system === q.query.system)))
  .delete("/_received", (_q, r) => { received.length = 0; seenKeys.clear(); r.json({ ok: true }); })
  .post("/_control", (q, r) => { faults[q.body.system] = { left: Number(q.body.failNext ?? 0), status: Number(q.body.status ?? 503) }; r.json(faults); })
  .post("/_push/:system", async (q, r) => { const { core = "http://127.0.0.1:8080", tenant = "t-ksap", key, n = 3, seq } = q.body ?? {}; const otm = q.params.system === "otm";
    const res = await fetch(`${core}/v1/integrations/inbound/${tenant}/${q.params.system}`, { method: "POST", headers: { "content-type": otm ? "application/xml" : "application/json", "x-api-key": key }, body: otm ? sampleOtm(n, seq) : JSON.stringify(sampleSap(n, seq)) });
    r.status(res.status).json(await res.json()); })
  .get("/:system/api/health", (_q, r) => r.json({ ok: true })).get("/sap/sap/opu/odata/sap/ZYMS_YARD_SRV/\\$metadata", (_q, r) => r.type("application/xml").send("<edmx:Edmx/>"))
  .post("/otm/*rest", rec("otm")).post("/sap/*rest", rec("sap")).post("/erp/*rest", rec("erp")).post("/wms/*rest", rec("wms"));
if (/mocks[\\/]server\.ts$/.test(process.argv[1] ?? "")) { const port = Number(process.env.MOCK_PORT ?? 9100); app.listen(port, "127.0.0.1", () => console.log(`mock OTM/SAP/ERP/WMS on http://127.0.0.1:${port}`)); }
