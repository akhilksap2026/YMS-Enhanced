import { Router } from "express";
import { subscribe } from "../../shared/bus.ts";
// Channel adapters (SMS/e-mail/push) plug in here; iteration 1 logs to an outbox only.
export const outbox: { at: string; channel: string; to: string; text: string }[] = [];
subscribe((e) => { if (e.type === "GateIn") outbox.push({ at: e.at, channel: "sms", to: "driver", text: `Checked in (${e.payload.decision}). Wait for door call.` }); });
export const router = Router().get("/outbox", (_q, r) => r.json(outbox.slice(-50)));
