import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { app } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { flush } from "./shared/db.ts";
import { startWorker } from "./modules/integrations/index.ts";
import { startRulesWorker } from "./modules/appointments/index.ts";
const port = Number(process.env.PORT ?? 4000);
const web = process.env.WEB_DIST ?? join(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/dist");
await bootstrap();
startWorker(); startRulesWorker();
const root = express();
root.disable("x-powered-by");
root.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:", "blob:"], "upgrade-insecure-requests": null } }, hsts: false }));
root.use(["/v1/auth/reset-request", "/v1/auth/reset"], rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));
root.use("/v1/auth/login", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));
root.use("/v1", rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false }));
root.use(app);
if (existsSync(join(web, "index.html"))) {
  root.use(express.static(web, { index: false, maxAge: "1h" }));
  root.get(/^(?!\/v1\/).*/, (_q, r) => r.sendFile(join(web, "index.html")));
}
root.listen(port, () => console.log(`YMS Enhanced on http://localhost:${port}${existsSync(web) ? "" : " (API only; web not built)"}`));
const bye = async () => { await flush("t-ksap"); await flush("t-demo"); process.exit(0); };
process.on("SIGTERM", bye); process.on("SIGINT", bye);
