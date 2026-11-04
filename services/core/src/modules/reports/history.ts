// Visit history: completed yard visits (gate-in -> gate-out) and door stints. Live operations append here;
// a fresh install seeds 30 days of fictitious history so reports are meaningful from day one.
import { tenantRepo } from "../../shared/repo.ts";
import { DEFAULT_SITE, DEMO_TENANT } from "../../shared/tenancy.ts";
import { seedOf } from "../../seedcache.ts";
export interface YardVisit { id: string; unitId: string; unitNumber: string; carrierId: string; apptRef?: string; slotStart?: string; gateIn?: string; gateOut?: string; lateMin?: number; outcome: "completed" | "no_show"; direction: "inbound" | "outbound" }
export interface DoorVisit { id: string; doorId: string; doorLabel: string; unitId: string; unitNumber?: string; carrierId?: string; start: string; end?: string }
function history(tenant: string) {
  let s = tenant === DEMO_TENANT ? 11 : 97; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const carriers = seedOf(tenant, "carriers"); const quality = carriers.map((_, i) => [0.92, 0.75, 0.85, 0.6, 0.95, 0.8][i % 6]);
  const yv: YardVisit[] = []; const dv: DoorVisit[] = []; const day0 = Math.floor(Date.now() / 864e5) * 864e5;
  for (let d = 30; d >= 1; d--) { const n = 18 + Math.floor(rnd() * 14);
    for (let k = 0; k < n; k++) { const ci = Math.floor(rnd() * carriers.length); const c = carriers[ci]; const q = quality[ci];
      const slot = day0 - d * 864e5 + (4 + rnd() * 15) * 3600e3; const id = `hv${d}-${k}`; const num = `HIST${String(d).padStart(2, "0")}${String(k).padStart(3, "0")}`; const dir = rnd() < 0.6 ? "inbound" : "outbound";
      if (rnd() > 0.97 - (1 - q) * 0.25) { yv.push({ id, unitId: id, unitNumber: num, carrierId: c.id, apptRef: `APT-H${d}${k}`, slotStart: new Date(slot).toISOString(), outcome: "no_show", direction: dir }); continue; }
      const late = rnd() < q ? Math.round(-10 + rnd() * 20) : Math.round(15 + rnd() * 120); const gin = slot + late * 60e3;
      const dwellH = (rnd() < 0.15 ? 24 + rnd() * 50 : 1 + rnd() * 10) * (1.6 - q * 0.6); const gout = gin + dwellH * 3600e3;
      yv.push({ id, unitId: id, unitNumber: num, carrierId: c.id, apptRef: `APT-H${d}${k}`, slotStart: new Date(slot).toISOString(), gateIn: new Date(gin).toISOString(), gateOut: new Date(gout).toISOString(), lateMin: late, outcome: "completed", direction: dir });
      const di = Math.floor(rnd() * 12); const ds = gin + Math.min(dwellH * 0.3, 3) * 3600e3; const dur = (0.6 + rnd() * 1.8) * 3600e3;
      dv.push({ id: `hd${d}-${k}`, doorId: `d${di + 1}`, doorLabel: `D${String(di + 1).padStart(2, "0")}`, unitId: id, unitNumber: num, carrierId: c.id, start: new Date(ds).toISOString(), end: new Date(Math.min(ds + dur, gout)).toISOString() }); } }
  return { yv, dv };
}
const hist = new Map<string, ReturnType<typeof history>>(); const h = (t: string) => { let x = hist.get(t); if (!x) { x = history(t); hist.set(t, x); } return x; };
export const yardVisits = tenantRepo<YardVisit>("yard_visits", (t, site) => site === DEFAULT_SITE ? h(t).yv : [], { site: true });
export const doorVisits = tenantRepo<DoorVisit>("door_visits", (t, site) => site === DEFAULT_SITE ? h(t).dv : [], { site: true });
export const dropHistory = (t: string) => hist.delete(t);
