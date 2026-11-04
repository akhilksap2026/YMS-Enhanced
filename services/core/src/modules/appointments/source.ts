import type { Appointment, AppointmentSource } from "../../../../../packages/contracts/index.ts";
// Pluggable appointment source. Same domain model; source of truth is per tenant/site config.
export interface AppointmentSourceAdapter {
  readonly kind: AppointmentSource;
  /** Push a booking made in YMSNow to the system of record (no-op for native). */
  publish(a: Appointment): Promise<{ ok: boolean; externalRef?: string }>;
  /** Pull changes from the system of record. */
  pull(since: string): Promise<Appointment[]>;
}
export const nativeSource: AppointmentSourceAdapter = { kind: "native", publish: async () => ({ ok: true }), pull: async () => [] };
// Stubs: real implementations call SAP TM/EWM (OData/IDoc) and Oracle OTM (REST/XML) via the integration hub.
export const sapSource: AppointmentSourceAdapter = { kind: "sap", publish: async (a) => ({ ok: true, externalRef: "SAP-STUB-" + a.ref }), pull: async () => [] };
export const otmSource: AppointmentSourceAdapter = { kind: "otm", publish: async (a) => ({ ok: true, externalRef: "OTM-STUB-" + a.ref }), pull: async () => [] };
export const sources: Record<AppointmentSource, AppointmentSourceAdapter> = { native: nativeSource, sap: sapSource, otm: otmSource };
