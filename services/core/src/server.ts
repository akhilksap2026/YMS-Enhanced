import { app } from "./app.ts";
import { bootstrap } from "./bootstrap.ts";
import { flush } from "./shared/db.ts";
const port = Number(process.env.PORT ?? 4000);
await bootstrap();
app.listen(port, () => console.log(`core on :${port} (Postgres via PGlite)`));
const bye = async () => { await flush("t-ksap"); await flush("t-demo"); process.exit(0); };
process.on("SIGTERM", bye); process.on("SIGINT", bye);
