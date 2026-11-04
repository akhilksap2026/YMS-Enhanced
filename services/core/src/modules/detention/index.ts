import { DEFAULT_SITE } from "../../shared/tenancy.ts";
import { Router } from "express";
import type { Charge, ChargeState } from "../../../../../packages/contracts/index.ts";
import { tenantRepo } from "../../shared/repo.ts";
import { seedOf } from "../../seedcache.ts";
import { publish } from "../../shared/bus.ts";
import { body, id } from "../../shared/validate.js";
import { z } from "zod";
export const charges = tenantRepo<Charge>("charges", (t, site) => site === DEFAULT_SITE ? seedOf(t, "charges") : [], { site: true });
const allowed: Record<ChargeState, ChargeState[]> = {
  indicative: ["approved", "adjusted", "rejected", "under_review"], under_review: ["approved", "adjusted", "rejected"],
  adjusted: ["approved", "rejected"], approved: ["exported"], rejected: [], exported: [],
};
/** Charges are indicative until a user decides. Adjust/reject need a reason; export only from approved. */
export function decide(id: string, action: ChargeState, by: string, reason?: string, amount?: number) {
  const c = charges.get(id); if (!c) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!allowed[c.state].includes(action)) throw Object.assign(new Error(`Cannot ${action} from ${c.state}`), { status: 409 });
  if ((action === "adjusted" || action === "rejected") && !reason?.trim()) throw Object.assign(new Error("Reason required"), { status: 422 });
  if (action === "adjusted") { if (amount == null || amount < 0) throw Object.assign(new Error("Amount required"), { status: 422 }); c.amount = amount; }
  c.state = action; c.history.push({ at: new Date().toISOString(), by, action, reason, amount: c.amount });
  publish({ type: "ChargeStateChanged", aggregateId: c.id, aggregateVersion: c.history.length, payload: { chargeId: c.id, state: action } } as any);
  return c;
}
export const router = Router()
  .get("/charges", (_q, r) => r.json(charges.all()))
  .post("/charges/:id/:action", body(z.object({ by: z.string().max(64).optional(), reason: z.string().max(500).optional(), amount: z.coerce.number().nonnegative().max(1e6).optional() })), (q, r) => { try { r.json(decide(String(q.params.id), String(q.params.action) as ChargeState, q.body.by ?? "demo.user", q.body.reason, q.body.amount)); } catch (e: any) { r.status(e.status ?? 400).json({ error: e.message }); } });
