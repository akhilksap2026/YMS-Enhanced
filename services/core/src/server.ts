import { app } from "./app.ts";
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`core on :${port}`));
