// Demo users per role. Credentials are documented in README only.
import type { Role } from "./shared/tenancy.ts";
export const DEMO_PASSWORD = "Ymsnow!2026";
export const SEED_USERS: { tenant: string; email: string; name: string; role: Role; carrierId?: string }[] = [
  ...([["yard_manager", "Yard Manager"], ["gate_guard", "Gate Guard"], ["dock_supervisor", "Dock Supervisor"], ["spotter", "Spotter 1"], ["carrier", "Ridgeway Dispatch"], ["tenant_admin", "Tenant Admin"], ["detention_approver", "Detention Approver"]] as [Role, string][])
    .map(([role, name]) => ({ tenant: "t-ksap", email: `${role.replace("_", ".")}@ksap.example`, name, role, carrierId: role === "carrier" ? "c2" : undefined })),
];
