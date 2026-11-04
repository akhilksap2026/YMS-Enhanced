/** Yard world geometry (site layout in metres-ish grid units) and 2.5D / plan projections.
 *  Site-specific layout lives here so a new site only swaps this file (or loads it from site config later). */
import type { Door, Zone } from "../api";
export type Mode = "iso" | "plan" | "heat";
export type Rect = { x: number; y: number; w: number; l: number };
export const SLOT_W = 2.1, SLOT_L = 4.2;
const ZONE_ORIGIN: Record<string, [number, number]> = { A: [4, 6.8], B: [4, 11.6], C: [4, 16.4], R: [4, 24.4], H: [22, 24.4], W: [4, 30.2] };
export const doorX = (i: number) => 5 + (i - 1) * 2.25;
export const BUILDING: Rect = { x: 3, y: -1, w: 34, l: 4.6 };
export const LANES = [0, 1, 2, 3].map((l) => ({ x: 42 + l * 2.2, y: 6, w: 1.8, l: 30, inbound: l < 3, label: `${l < 3 ? "IN" : "OUT"} L${l + 1}` }));
export const WORLD = { x0: -1, y0: -1, x1: 51, y1: 37 };
export function zoneRect(z: Zone): Rect { const [x, y] = ZONE_ORIGIN[z.name] ?? [0, 0]; return { x, y, w: z.slots.length * SLOT_W, l: SLOT_L }; }
export function slotRect(label: string): Rect | undefined {
  const m = /^([A-Z])(\d{2})$/.exec(label); if (!m || !ZONE_ORIGIN[m[1]]) return;
  const [x, y] = ZONE_ORIGIN[m[1]]; const i = Number(m[2]) - 1; return { x: x + i * SLOT_W, y, w: SLOT_W - 0.25, l: SLOT_L };
}
export function doorRect(label: string): Rect | undefined { const i = Number(label.slice(1)); if (!/^D\d{2}$/.test(label)) return; return { x: doorX(i) - 0.15, y: 3.9, w: 1.8, l: 2.7 }; }
const laneQueue = (i: number): Rect => ({ x: LANES[i % 3].x, y: 8 + Math.floor(i / 3) * 4.4, w: 1.8, l: 4 });
/** Footprint for any unit location string the core can emit (slot, door, "W-zone", "Gate 1", …). */
export function locRect(loc: string, overflowIndex = 0): Rect {
  return slotRect(loc) ?? (doorRect(loc) ? { ...doorRect(loc)!, l: 3.8 } : laneQueue(overflowIndex));
}
export const center = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.l / 2];
export function targetAt(x: number, y: number, zones: Zone[], doors: Door[]): string | undefined {
  for (const d of doors) { const r = doorRect(d.label)!; if (x >= r.x && x <= r.x + r.w && y >= 3 && y <= 6.4) return d.label; }
  for (const z of zones) for (const s of z.slots) { const r = slotRect(s.label); if (r && x >= r.x && x <= r.x + r.w + .25 && y >= r.y && y <= r.y + r.l) return s.label; }
}
export function aisleY(loc: string) { return /^(D|A)/.test(loc) ? 5.8 : /^[BC]/.test(loc) ? 22.9 : /^[RHW]/.test(loc) ? 22.9 : 5.8; }
/** Drive path along the yard roads; good enough for a route preview, not a routing engine. */
export function routeFor(from: string, to: string, i = 0): [number, number][] {
  const a = center(locRect(from, i)), b = center(locRect(to, i)); const ya = aisleY(from), yb = aisleY(to);
  if (ya === yb) return [a, [a[0], ya], [b[0], ya], b];
  return [a, [a[0], ya], [3, ya], [3, yb], [b[0], yb], b];
}
export function along(p: [number, number][], t: number): [number, number] {
  const L: number[] = []; let tot = 0;
  for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); L.push(d); tot += d; }
  let k = Math.max(0, Math.min(1, t)) * tot;
  for (let i = 0; i < L.length; i++) { if (k <= L[i]) { const f = L[i] ? k / L[i] : 0; return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f]; } k -= L[i]; }
  return p[p.length - 1];
}
const S = 14, C = Math.cos(Math.PI / 6);
export function project(mode: Mode) {
  if (mode === "plan") return (x: number, y: number, _z = 0): [number, number] => [x * S * 1.15, y * S * 1.15];
  return (x: number, y: number, z = 0): [number, number] => [(x - y) * C * S, (x + y) * 0.5 * S - z * S];
}
export function unproject(mode: Mode) {
  if (mode === "plan") return (sx: number, sy: number): [number, number] => [sx / (S * 1.15), sy / (S * 1.15)];
  return (sx: number, sy: number): [number, number] => { const a = sx / (C * S), b = sy / (0.5 * S); return [(a + b) / 2, (b - a) / 2]; };
}
export function bounds(mode: Mode) {
  const P = project(mode); const pts = [P(WORLD.x0, WORLD.y0), P(WORLD.x1, WORLD.y0), P(WORLD.x1, WORLD.y1), P(WORLD.x0, WORLD.y1), P(BUILDING.x, BUILDING.y, 4)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
