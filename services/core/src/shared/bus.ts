import type { YardEvent } from "../../../../packages/contracts/index.ts";
import { tid, sid } from "./tenancy.ts";
import { randomUUID } from "node:crypto";
type Handler = (e: YardEvent) => void;
const handlers: Handler[] = [];
export const log: YardEvent[] = [];
const seen = new Set<string>();
export function publish<E extends YardEvent>(e: Omit<E, "eventId" | "version" | "at" | "tenantId" | "siteId"> & { eventId?: string }) {
  const full = { eventId: e.eventId ?? randomUUID(), version: "v1", at: new Date().toISOString(), tenantId: tid(), siteId: sid(), ...e } as YardEvent;
  if (seen.has(full.eventId)) return; // idempotent
  seen.add(full.eventId); log.push(full); handlers.forEach((h) => h(full));
}
export const subscribe = (h: Handler) => handlers.push(h);
