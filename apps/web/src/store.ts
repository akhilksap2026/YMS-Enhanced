import { createContext, useContext } from "react";
import type { Unit, Zone, Door, Appointment, Task, Charge, ExceptionItem, Carrier } from "./api";
export interface Data { units: Unit[]; zones: Zone[]; doors: Door[]; appointments: Appointment[]; tasks: Task[]; charges: Charge[]; exceptions: ExceptionItem[]; carriers: Carrier[] }
export interface Ctx { d: Data; reload: () => Promise<void>; toast: (m: string, err?: boolean) => void; run: (f: () => Promise<unknown>, okMsg: string) => Promise<boolean>; query: string; carrier: (id: string) => string; unit: (id?: string) => Unit | undefined }
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);
