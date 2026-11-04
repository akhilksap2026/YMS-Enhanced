import { Router } from "express";
import type { AppointmentSource } from "../../../../../packages/contracts/index.ts";
export const tenant = { id: "t-demo", name: "Demo Tenant (fictitious)" };
export const sites = [{ id: "s-rsr", name: "Riverside DC (demo)", tz: "Africa/Bujumbura" }, { id: "s-nth", name: "North Cross-dock (demo)", tz: "Africa/Bujumbura" }];
export const siteConfig: { appointmentSource: AppointmentSource; features: Record<string, boolean> } = { appointmentSource: "native", features: { kiosk: true, ai: false } };
export const router = Router().get("/", (_q, r) => r.json({ tenant, sites, siteConfig }))
  .patch("/config", (q, r) => { Object.assign(siteConfig, q.body); r.json(siteConfig); });
