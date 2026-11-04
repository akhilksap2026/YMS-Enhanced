import { useState } from "react";
import { KeyRound } from "lucide-react";
import { post, type SessionUser } from "../api";
export const PW_RULE = "At least 10 characters, with a letter and a digit.";
export const pwOk = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
export default function Account({ user, toast }: { user: SessionUser; toast: (m: string, e?: boolean) => void }) {
  const [cur, setCur] = useState(""); const [nx, setNx] = useState(""); const [nx2, setNx2] = useState(""); const [busy, setBusy] = useState(false);
  const ok = cur && pwOk(nx) && nx === nx2 && nx !== cur;
  const go = async () => { setBusy(true); try { await post("/auth/password", { current: cur, next: nx }); toast("Password changed"); setCur(""); setNx(""); setNx2(""); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  return <div className="form" style={{ padding: 12 }}>
    <div><b>{user.name}</b><div className="mu">{user.roleLabel}{user.demo ? " · demo session" : ""}</div></div>
    {user.demo ? <p className="hint">Demo sessions have no password. Sign in with a real account to change it.</p> : <>
      <h3 style={{ margin: "8px 0 0", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><KeyRound size={14} />Change password</h3>
      <label>Current password<input className="ctl" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label>New password<input className="ctl" type="password" autoComplete="new-password" value={nx} onChange={(e) => setNx(e.target.value)} /></label>
      <label>Repeat new password<input className="ctl" type="password" autoComplete="new-password" value={nx2} onChange={(e) => setNx2(e.target.value)} /></label>
      <p className={"hint" + (nx && !pwOk(nx) ? " dn" : "")}>{PW_RULE}{nx2 && nx !== nx2 ? " Passwords differ." : ""}</p>
      <button className="btn pri" disabled={!ok || busy} onClick={go}>Change password</button></>}
  </div>;
}
