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
import { publishAppointment } from "../integrations/index.ts";
// SAP TM/EWM and Oracle OTM: bookings and changes are queued to the integration hub (retry, DLQ). Inbound changes arrive
// through /v1/integrations/inbound/:tenant/:system and are applied by integrations/wire.ts.
const viaHub = (kind: "sap" | "otm"): AppointmentSourceAdapter => ({ kind, publish: async (a) => { const m = publishAppointment(a); return { ok: true, externalRef: m?.id }; }, pull: async () => [] });
export const sapSource = viaHub("sap"); export const otmSource = viaHub("otm");
export const sources: Record<AppointmentSource, AppointmentSourceAdapter> = { native: nativeSource, sap: sapSource, otm: otmSource };
