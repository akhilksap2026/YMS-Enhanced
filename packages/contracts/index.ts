// YMSNow shared contracts. Versioned: breaking changes add a new version, v1 stays.
export const CONTRACTS_VERSION = "v1";

export type Status = "ok" | "warn" | "hold" | "quarantine" | "empty";
export type Role = "yard_manager" | "gate_guard" | "dock_supervisor" | "spotter" | "carrier" | "finance";

export interface Carrier { id: string; name: string; scac: string }
export interface Zone { id: string; name: string; kind: "row" | "hold" | "waiting" | "reefer"; slots: Slot[] }
export interface Slot { id: string; zoneId: string; label: string; unitId?: string }
export interface Door { id: string; label: string; state: "free" | "occupied" | "blocked"; unitId?: string; since?: string }
export interface Unit {
  id: string; number: string; kind: "trailer" | "container"; carrierId: string;
  status: Status; location: string; gateInAt?: string; load: "empty" | "loaded"; reefer?: boolean; hazmat?: string;
}
export type AppointmentSource = "native" | "sap" | "otm";
export interface Appointment {
  id: string; ref: string; carrierId: string; slotStart: string; slotEnd: string; door?: string;
  direction: "inbound" | "outbound"; status: "booked" | "arrived" | "late" | "no_show" | "cancelled";
  source: AppointmentSource; plate?: string; unitNumber?: string;
}
export interface Task {
  id: string; version: number; type: "spot" | "pull" | "move" | "hook"; unitId: string; from: string; to: string;
  priority: 1 | 2 | 3; status: "open" | "assigned" | "in_progress" | "done"; assignee?: string; createdAt: string;
}
export type ChargeState = "indicative" | "under_review" | "approved" | "adjusted" | "rejected" | "exported";
export interface Charge {
  id: string; visitRef: string; carrierId: string; unitId: string; kind: "detention" | "demurrage";
  freeHours: number; billableHours: number; rate: number; currency: string; amount: number; state: ChargeState;
  history: { at: string; by: string; action: string; reason?: string; amount?: number }[];
}
export interface ExceptionItem { id: string; severity: "high" | "med" | "low"; text: string; unitId?: string; at: string }

// Canonical events (v1). Every event: eventId for idempotency, tenant/site scope, aggregate version.
export interface EventEnvelope<T extends string, P> {
  eventId: string; type: T; version: "v1"; tenantId: string; siteId: string; aggregateId: string; aggregateVersion: number; at: string; payload: P;
}
export type YardEvent =
  | EventEnvelope<"GateIn", { unitId: string; decision: "pass" | "hold" | "quarantine" }>
  | EventEnvelope<"DoorOccupied", { doorId: string; unitId: string }>
  | EventEnvelope<"DoorReleased", { doorId: string }>
  | EventEnvelope<"TaskCompleted", { taskId: string }>
  | EventEnvelope<"ChargeStateChanged", { chargeId: string; state: ChargeState }>;
