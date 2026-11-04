import express from "express";
import cors from "cors";
import * as tenant from "./modules/tenant/index.ts";
import * as appts from "./modules/appointments/index.ts";
import * as gate from "./modules/gate/index.ts";
import * as yard from "./modules/yard/index.ts";
import * as dock from "./modules/dock/index.ts";
import * as tasks from "./modules/tasks/index.ts";
import * as detention from "./modules/detention/index.ts";
import * as notifications from "./modules/notifications/index.ts";
import * as auth from "./modules/auth/index.ts";
import * as admin from "./modules/admin/index.ts";
import * as demo from "./modules/demo/index.ts";
import * as integrations from "./modules/integrations/index.ts";
import "./modules/integrations/wire.ts";
import { log } from "./shared/bus.ts";
import { tid } from "./shared/tenancy.ts";
export const app = express().use(cors()).use(express.json({ limit: "1mb" })).get("/health", (_q, r) => r.json({ ok: true })).use("/v1/integrations/inbound", integrations.inboundRouter).use("/v1", auth.authn)
  .use("/v1/auth", auth.router).use("/v1/admin", admin.router).use("/v1/demo", demo.router)
  .use("/v1/tenant", tenant.router).use("/v1/appointments", appts.router).use("/v1/gate", gate.router)
  .use("/v1/yard", yard.router).use("/v1/dock", dock.router).use("/v1/tasks", tasks.router)
  .use("/v1/detention", detention.router).use("/v1/integrations", integrations.router).use("/v1/notifications", notifications.router)
  .get("/v1/events", (_q, r) => r.json(log.filter((e) => e.tenantId === tid()).slice(-100)));
