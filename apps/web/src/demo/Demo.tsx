import type { Role } from "../api";
export function DemoBadge(_: { onTour: () => void }) { return <span className="chip demo">DEMO</span>; }
export function DemoRoleSwitch(_: { role: Role; onSwitch: (r: Role) => void }) { return null; }
export function Tour(_: { onClose: () => void; switchRole: (r: Role) => Promise<void> }) { return null; }
