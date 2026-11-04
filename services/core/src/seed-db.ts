// npm run seed — (re)creates the database: drops data dir contents only if --fresh is passed.
import { rmSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
const dir = process.env.YMS_DB_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "../data/pg");
if (process.argv.includes("--fresh")) rmSync(dir, { recursive: true, force: true });
const { bootstrap } = await import("./bootstrap.ts"); await bootstrap(dir); console.log("seeded", dir); process.exit(0);
