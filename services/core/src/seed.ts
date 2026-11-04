// DEMO DATA ONLY. All carriers, plates and units are fictitious (DEMO prefix / XX plates).
import type { Carrier, Zone, Door, Unit, Appointment, Task, Charge, ExceptionItem } from "../../../packages/contracts/index.ts";
import { withCheck } from "./shared/iso6346.ts";
export type Seed = ReturnType<typeof makeSeed>;
/** Build a fresh data set for one tenant. "demo" is the richer, scripted presenter data set. */
export function makeSeed(profile: "ops" | "demo" = "ops") {

let s = profile === "demo" ? 7 : 42; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const now = Date.now(); const h = (x: number) => new Date(now + x * 3600e3).toISOString();

const carriers: Carrier[] = [
  ["Demo Northline Haulage", "DNLH"], ["Demo Ridgeway Freight", "DRWF"], ["Demo Coastal Carriers", "DCCR"],
  ["Demo Atlas Logistics", "DATL"], ["Demo Meridian Transport", "DMTR"], ["Demo Pinecrest Trucking", "DPCT"],
].map(([name, scac]) => [profile === "demo" ? name : name.replace("Demo ", ""), scac]).map(([name, scac], i) => ({ id: `c${i + 1}`, name, scac }));

const owners = ["DMOU", "TSTU", "FKEU", "XMPU"];
const units: Unit[] = [];
for (let i = 0; i < (profile === "demo" ? 70 : 64); i++) {
  const container = i % 3 !== 0;
  const number = container ? withCheck(pick(owners) + String(100000 + Math.floor(rnd() * 899999))) : `TR-${4100 + i}`;
  const r = rnd();
  units.push({ id: `u${i + 1}`, number, kind: container ? "container" : "trailer", carrierId: pick(carriers).id,
    status: r < 0.07 ? "quarantine" : r < 0.15 ? "hold" : r < 0.3 ? "warn" : "ok", location: "",
    gateInAt: h(-(1 + rnd() * 70)), load: rnd() < 0.6 ? "loaded" : "empty", reefer: i % 9 === 0, hazmat: i % 13 === 0 ? "Class 3" : undefined });
}
const zoneDefs: [string, Zone["kind"], number][] = [["A", "row", 16], ["B", "row", 16], ["C", "row", 16], ["R", "reefer", 8], ["H", "hold", 6], ["W", "waiting", 8]];
const zones: Zone[] = zoneDefs.map(([n, kind, count]) => ({ id: `z${n}`, name: n, kind,
  slots: Array.from({ length: count }, (_, k) => ({ id: `${n}${String(k + 1).padStart(2, "0")}`, zoneId: `z${n}`, label: `${n}${String(k + 1).padStart(2, "0")}` })) }));
const doors: Door[] = Array.from({ length: 14 }, (_, i) => ({ id: `d${i + 1}`, label: `D${String(i + 1).padStart(2, "0")}`, state: "free" as const }));
doors[12].state = "blocked";
// place units
const placeable = zones.filter((z) => z.kind !== "waiting");
let ui = 0;
for (const u of units) {
  if (ui < 8 && u.status === "ok") { const d = doors[ui]; d.state = "occupied"; d.unitId = u.id; d.since = h(-rnd() * 4); u.location = d.label; ui++; continue; }
  const pool = u.status === "quarantine" ? zones.filter((z) => z.kind === "hold") : u.reefer ? zones.filter((z) => z.kind === "reefer") : placeable.filter((z) => z.kind === "row");
  const free = pool.flatMap((z) => z.slots).filter((sl) => !sl.unitId);
  const sl = free.length ? pick(free) : undefined; if (sl) { sl.unitId = u.id; u.location = sl.label; }
}
const plates = () => `XX-${Math.floor(100 + rnd() * 899)}-${String.fromCharCode(65 + Math.floor(rnd() * 26))}${String.fromCharCode(65 + Math.floor(rnd() * 26))}`;
const appointments: Appointment[] = Array.from({ length: 22 }, (_, i) => {
  const start = Math.floor(-3 + i * 0.6);
  const st: Appointment["status"] = start < -1 ? (i % 4 === 0 ? "no_show" : "arrived") : start < 0 ? "late" : "booked";
  return { id: `a${i + 1}`, ref: `APT-${70210 + i}`, carrierId: carriers[i % 6].id, slotStart: h(start), slotEnd: h(start + 1),
    direction: i % 3 ? "inbound" : "outbound", status: st, source: (["native", "otm", "sap"] as const)[i % 3],
    plate: plates(), unitNumber: i % 2 ? withCheck(pick(owners) + String(200000 + i * 7919 % 799999)) : `TR-${5200 + i}` };
});
const tasks: Task[] = units.slice(10, 24).map((u, i) => ({ id: `t${i + 1}`, version: 1, type: (["spot", "pull", "move", "hook"] as const)[i % 4], unitId: u.id,
  from: u.location || "W01", to: i % 2 ? doors[(i + 8) % 12].label : `B${String((i % 16) + 1).padStart(2, "0")}`, priority: ((i % 3) + 1) as 1 | 2 | 3,
  status: i < 3 ? "in_progress" : i < 9 ? "assigned" : "open", assignee: i < 9 ? pick(["Spotter 1", "Spotter 2", "Spotter 3"]) : undefined, createdAt: h(-rnd() * 2) }));
const charges: Charge[] = units.filter((u) => u.gateInAt && now - Date.parse(u.gateInAt) > 36 * 3600e3).slice(0, 14).map((u, i): Charge => {
  const dwell = (now - Date.parse(u.gateInAt!)) / 3600e3; const free = i % 2 ? 48 : 24; const billable = Math.max(0, Math.ceil(dwell - free)); const rate = i % 2 ? 6 : 8.5;
  return { id: `ch${i + 1}`, visitRef: `VIS-${30400 + i}`, carrierId: u.carrierId, unitId: u.id, kind: u.kind === "container" ? "demurrage" : "detention",
    freeHours: free, billableHours: billable, rate, currency: "USD", amount: +(billable * rate).toFixed(2), state: i === 0 ? "approved" : i === 1 ? "adjusted" : "indicative",
    history: [{ at: h(-1), by: "system", action: "computed (indicative)", amount: +(billable * rate).toFixed(2) }] };
}).filter((c) => c.billableHours > 0);
const exceptions: ExceptionItem[] = [
  ...units.filter((u) => u.status === "quarantine").map((u, i) => ({ id: `e-q${i}`, severity: "high" as const, text: `Quarantine: ${u.number} failed inspection`, unitId: u.id, at: h(-0.5 - i) })),
  ...units.filter((u) => u.reefer).slice(0, 2).map((u, i) => ({ id: `e-r${i}`, severity: "high" as const, text: `Reefer ${u.number} set-point deviation +3.1°C`, unitId: u.id, at: h(-0.2 - i) })),
  ...appointments.filter((a) => a.status === "late").map((a) => ({ id: `e-l${a.id}`, severity: "med" as const, text: `${a.ref} late, slot ${a.slotStart.slice(11, 16)}`, at: a.slotStart })),
  { id: "e-d13", severity: "low" as const, text: "Door D13 blocked: leveller maintenance", at: h(-5) },
];
  const settings = [{ id: "site", appointmentSource: "native" as "native" | "sap" | "otm", features: { kiosk: true, ai: profile === "demo" }, brandName: profile === "demo" ? "Acme Logistics" : "", brandLogo: "", rates: { detention: 6, demurrage: 8.5, freeHoursDetention: 48, freeHoursDemurrage: 24 }, siteName: profile === "demo" ? "Riverside DC (demo)" : "Riverside DC" }];
  return { carriers, units, zones, doors, appointments, tasks, charges, exceptions, settings, outbox: [] as { id: string; at: string; channel: string; to: string; text: string; kind?: string }[] };
}
