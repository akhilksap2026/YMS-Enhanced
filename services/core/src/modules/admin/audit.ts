// Append-only audit trail of every successful write (who, what, where). Viewer: GET /v1/admin/audit.
import { tenantRepo } from "../../shared/repo.ts";
import { runAs, type Principal } from "../../shared/tenancy.ts";
export interface AuditRow { id: string; at: string; userId: string; name: string; role: string; method: string; path: string; status: number; siteId: string; detail?: string }
export const auditLog = tenantRepo<AuditRow>("audit", () => []);
let seq = 0;
export function audit(p: Pick<Principal, "userId" | "name" | "role" | "tenantId">, method: string, path: string, status: number, siteId: string, detail?: string) {
  runAs(p.tenantId, () => { const at = new Date().toISOString(); auditLog.put({ id: `au-${Date.now().toString(36)}-${(seq++).toString(36)}`, at, userId: p.userId, name: p.name, role: p.role, method, path: path.replace(/[?#].*$/, ""), status, siteId, detail });
    const all = auditLog.all(); if (all.length > 5000) all.sort((a, b) => a.at.localeCompare(b.at)).slice(0, all.length - 5000).forEach((x) => auditLog.del(x.id)); });
}
export function queryAudit(f: { user?: string; q?: string; from?: string; to?: string; limit?: number }) {
  return auditLog.all().filter((a) => (!f.user || a.userId === f.user || a.name.toLowerCase().includes(f.user.toLowerCase())) && (!f.q || (a.path + " " + (a.detail ?? "")).toLowerCase().includes(f.q.toLowerCase()))
    && (!f.from || a.at >= f.from) && (!f.to || a.at <= f.to)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.min(f.limit ?? 500, 2000));
}
