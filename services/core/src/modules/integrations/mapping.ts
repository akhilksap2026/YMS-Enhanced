/** Message mappings. OTM uses GLog XML (Transmission → TransmissionBody → GLogXMLElement), the shape OTM's
 *  integration servlet accepts and emits. SAP uses OData v2 JSON ({ d: { results } }) and an IDoc-style JSON envelope. */
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { Appointment, YardEvent } from "../../../../../packages/contracts/index.ts";
const xb = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true });
const xp = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: (n) => ["GLogXMLElement", "Shipment", "Appointment", "ShipmentStop"].includes(n) });
const gid = (domain: string, xid: string) => ({ Gid: { DomainName: domain, Xid: xid } });
const otmTime = (iso: string) => iso.replace(/[-:]/g, "").slice(0, 15).replace("T", ""); // YYYYMMDDHHMMSS (UTC)
const fromOtmTime = (s: string) => /^\d{14}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z` : new Date(s).toISOString();
const EVENT_CODE: Record<string, string> = { GateIn: "X3", DoorOccupied: "X1", DoorReleased: "AF", TaskCompleted: "YM", GateOut: "AG" }; // X12-214 style status codes as used in OTM ShipmentStatus

export interface InboundAppt { externalRef: string; carrierCode: string; slotStart: string; slotEnd?: string; direction: Appointment["direction"]; unitNumber?: string; plate?: string; door?: string; cancelled?: boolean }

export const otm = {
  contentType: "application/xml",
  /** Outbound yard event → ShipmentStatus inside a Transmission. */
  event(e: YardEvent, domain: string, ctx: { unitNumber?: string; shipmentRef?: string; door?: string }) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xb.build({ Transmission: { "@_xmlns": "http://xmlns.oracle.com/apps/otm/transmission/v6.4",
      TransmissionHeader: { SenderTransmissionNo: e.eventId, SenderSystemId: "YMSNOW" },
      TransmissionBody: { GLogXMLElement: [{ ShipmentStatus: { ServiceProviderAlias: { ServiceProviderAliasQualifierGid: gid("PUBLIC", "GLOG"), ServiceProviderAliasValue: "YMSNOW" },
        IntSavedQuery: undefined, ShipmentRefnum: ctx.shipmentRef ? { ShipmentRefnumQualifierGid: gid("PUBLIC", "YMS_REF"), ShipmentRefnumValue: ctx.shipmentRef } : undefined,
        StatusLevel: "SHIPMENT", StatusCodeGid: gid("PUBLIC", EVENT_CODE[e.type] ?? "NS"), EventDt: { GLogDate: otmTime(e.at), TZId: "UTC" },
        SSStop: ctx.door ? { SSStopSequenceNum: 1, SSLocation: { LocationRefnumQualifierGid: gid("PUBLIC", "DOOR"), LocationID: ctx.door } } : undefined,
        SSEquipment: ctx.unitNumber ? { EquipmentIdentificationNum: ctx.unitNumber } : undefined, ResponsiblePartyGid: gid(domain, "YARD"), StatusReasonCodeGid: gid("PUBLIC", "NS"), Remark: { RemarkText: e.type } } }] } } });
  },
  appointment(a: Appointment, domain: string) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xb.build({ Transmission: { "@_xmlns": "http://xmlns.oracle.com/apps/otm/transmission/v6.4",
      TransmissionHeader: { SenderTransmissionNo: "APPT-" + a.id + "-" + a.status, SenderSystemId: "YMSNOW" },
      TransmissionBody: { GLogXMLElement: [{ Appointment: [{ AppointmentGid: gid(domain, a.ref), ObjectType: "S", ObjectGid: gid(domain, a.ref),
        LocationResourceGid: gid(domain, a.door ?? "DOCK"), StartTime: { GLogDate: otmTime(a.slotStart), TZId: "UTC" }, EndTime: { GLogDate: otmTime(a.slotEnd), TZId: "UTC" },
        IsCancelled: a.status === "cancelled" ? "Y" : "N", Status: a.status.toUpperCase() }] }] } } });
  },
  /** Inbound Transmission with Shipment and/or Appointment elements. Returns transmission number for idempotency. */
  parse(xml: string): { transmissionNo: string; appts: InboundAppt[] } {
    const doc = xp.parse(xml); const t = doc.Transmission; if (!t) throw Object.assign(new Error("Not an OTM Transmission"), { status: 422 });
    const no = String(t.TransmissionHeader?.SenderTransmissionNo ?? t.TransmissionHeader?.ReferenceTransmissionNo ?? ""); if (!no) throw Object.assign(new Error("SenderTransmissionNo required"), { status: 422 });
    const appts: InboundAppt[] = [];
    for (const el of t.TransmissionBody?.GLogXMLElement ?? []) {
      for (const s of el.Shipment ?? []) { const h = s.ShipmentHeader ?? {}; const stop = (s.ShipmentStop ?? [])[0] ?? {};
        const start = stop.AppointmentPickup?.GLogDate ?? stop.AppointmentDelivery?.GLogDate ?? stop.ArrivalTime?.EventTime?.PlannedTime?.GLogDate; if (!start) continue;
        appts.push({ externalRef: h.ShipmentGid?.Gid?.Xid, carrierCode: h.ServiceProviderGid?.Gid?.Xid ?? "", slotStart: fromOtmTime(start), direction: stop.StopType === "P" ? "outbound" : "inbound",
          unitNumber: s.ShipmentEquipment?.EquipmentInitialNumber ?? s.SEquipment?.EquipmentNumber, plate: s.ShipmentHeader2?.LicensePlate, cancelled: h.IsCancelled === "Y" || h.ShipmentStatus?.StatusValueGid?.Gid?.Xid === "CANCELLED" }); }
      for (const a of el.Appointment ?? []) appts.push({ externalRef: a.ObjectGid?.Gid?.Xid ?? a.AppointmentGid?.Gid?.Xid, carrierCode: a.ServiceProviderGid?.Gid?.Xid ?? "", slotStart: fromOtmTime(a.StartTime?.GLogDate), slotEnd: a.EndTime?.GLogDate ? fromOtmTime(a.EndTime.GLogDate) : undefined,
        direction: a.ObjectType === "P" ? "outbound" : "inbound", door: a.LocationResourceGid?.Gid?.Xid, cancelled: a.IsCancelled === "Y" });
    }
    for (const a of appts) if (!a.externalRef || !a.slotStart || a.slotStart === "Invalid Date") throw Object.assign(new Error("Shipment/Appointment missing Gid or time"), { status: 422 });
    return { transmissionNo: no, appts };
  },
};

const sapDate = (iso: string) => `/Date(${Date.parse(iso)})/`;
const fromSapDate = (v: string) => { const m = /\/Date\((\d+)/.exec(v); return new Date(m ? Number(m[1]) : v).toISOString(); };
export const sap = {
  contentType: "application/json",
  /** Outbound yard event as an OData entity (EventSet) of a custom YMS service. */
  event(e: YardEvent, ctx: { unitNumber?: string; shipmentRef?: string; door?: string }) {
    return JSON.stringify({ EventId: e.eventId, EventCode: e.type, EventTime: sapDate(e.at), TorId: ctx.shipmentRef ?? "", ContainerId: ctx.unitNumber ?? "", DoorId: ctx.door ?? "", YardNo: "YMSNOW", Site: e.siteId });
  },
  appointment(a: Appointment) { return JSON.stringify({ TorId: a.ref, AppointmentStatus: a.status.toUpperCase(), PlannedStart: sapDate(a.slotStart), PlannedEnd: sapDate(a.slotEnd), DoorId: a.door ?? "", Direction: a.direction === "inbound" ? "I" : "O" }); },
  /** Inbound: OData { d: { results: [...] } } of freight orders, or IDoc-style { IDOC: { EDI_DC40: { DOCNUM }, E1TORH: [...] } }. */
  parse(body: any): { transmissionNo: string; appts: InboundAppt[] } {
    if (body?.IDOC) { const no = String(body.IDOC.EDI_DC40?.DOCNUM ?? ""); if (!no) throw Object.assign(new Error("EDI_DC40.DOCNUM required"), { status: 422 });
      const rows = [].concat(body.IDOC.E1TORH ?? []) as any[];
      return { transmissionNo: "IDOC-" + no, appts: rows.map((r) => ({ externalRef: r.TOR_ID, carrierCode: r.TSP_ID ?? "", slotStart: new Date(r.PLAN_START_UTC ?? r.START).toISOString(), direction: r.DIRECTION === "O" ? "outbound" : "inbound", unitNumber: r.E1TORITEM?.CONTAINER_ID, plate: r.LICENSE_PLATE, cancelled: r.LIFECYCLE === "10" })) }; }
    const rows = body?.d?.results ?? (body?.d ? [body.d] : null); if (!rows) throw Object.assign(new Error("Expected OData { d: { results } } or IDOC envelope"), { status: 422 });
    const no = String(body.BatchId ?? rows.map((r: any) => r.TorId + ":" + (r.ChangedAt ?? r.PlannedStart)).join("|"));
    return { transmissionNo: "ODATA-" + no, appts: rows.map((r: any) => ({ externalRef: r.TorId, carrierCode: r.CarrierId ?? "", slotStart: fromSapDate(r.PlannedStart), slotEnd: r.PlannedEnd ? fromSapDate(r.PlannedEnd) : undefined, direction: r.Direction === "O" ? "outbound" : "inbound", unitNumber: r.ContainerId, plate: r.LicensePlate, door: r.DoorId || undefined, cancelled: r.Status === "CANCELLED" })) };
  },
};
export const toCsv = (rows: Record<string, unknown>[]) => { if (!rows.length) return ""; const h = Object.keys(rows[0]); const q = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [h.join(","), ...rows.map((r) => h.map((k) => q(r[k])).join(","))].join("\n") + "\n"; };
