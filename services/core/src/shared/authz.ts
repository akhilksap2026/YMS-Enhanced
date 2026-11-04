import type { Role } from "./tenancy.ts";
export type Perm = "session" | "ops:read" | "carrier:read" | "yard:write" | "dock:write" | "tasks:create" | "tasks:transition" | "gate:write" | "appt:write" | "detention:read" | "detention:decide" | "admin" | "notes:read";
const ALL: Perm[] = ["ops:read", "carrier:read", "yard:write", "dock:write", "tasks:create", "tasks:transition", "gate:write", "appt:write", "detention:read", "detention:decide", "admin", "notes:read"];
export const ROLE_PERMS: Record<Role, Perm[]> = {
  tenant_admin: ALL,
  yard_manager: ["ops:read", "carrier:read", "yard:write", "dock:write", "tasks:create", "tasks:transition", "gate:write", "appt:write", "detention:read", "notes:read"],
  gate_guard: ["ops:read", "carrier:read", "gate:write", "appt:write", "notes:read"],
  dock_supervisor: ["ops:read", "carrier:read", "yard:write", "dock:write", "tasks:create", "tasks:transition", "notes:read"],
  spotter: ["ops:read", "tasks:transition", "notes:read"],
  carrier: ["carrier:read", "appt:write", "notes:read"],
  detention_approver: ["ops:read", "carrier:read", "detention:read", "detention:decide", "notes:read"],
};
// First match wins. Paths are relative to /v1.
const RULES: [string, RegExp, Perm][] = [
  ["GET", /^\/tenant\/?$/, "session"], // branding + site config: any signed-in user
  ["GET", /^\/yard\/carriers/, "carrier:read"],
  ["GET", /^\/appointments/, "carrier:read"],
  ["POST", /^\/appointments/, "appt:write"],
  ["GET", /^\/notifications/, "notes:read"], ["POST", /^\/notifications/, "notes:read"],
  ["POST", /^\/integrations\/erp\//, "detention:decide"],
  ["GET", /^\/detention/, "detention:read"], ["POST", /^\/detention/, "detention:decide"],
  ["PATCH", /^\/tenant/, "admin"], ["*", /^\/admin/, "admin"],
  ["POST", /^\/gate/, "gate:write"],
  ["POST", /^\/yard/, "yard:write"],
  ["POST", /^\/dock/, "dock:write"],
  ["POST", /^\/tasks\/?$/, "tasks:create"], ["POST", /^\/tasks\//, "tasks:transition"],
  ["GET", /./, "ops:read"],
];
export function required(method: string, path: string): Perm { for (const [m, re, p] of RULES) if ((m === "*" || m === method) && re.test(path)) return p; return "admin"; }
export const can = (role: Role, p: Perm) => p === "session" ? role in ROLE_PERMS : ROLE_PERMS[role]?.includes(p) ?? false;
