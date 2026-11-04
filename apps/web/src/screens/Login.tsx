import { useState } from "react";
import { PW_RULE, pwOk } from "./Account";
import { LogIn, Play, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { post, setToken, type SessionUser } from "../api";
type R = { token: string; user: SessionUser };
export default function Login({ onIn }: { onIn: (u: SessionUser) => void }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [show, setShow] = useState(false);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const done = (r: R) => { setToken(r.token); onIn(r.user); };
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(""); setBusy(true); try { done(await post<R>("/auth/login", { email, password: pw })); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  const demo = async () => { setBusy(true); try { done(await post<R>("/auth/demo")); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  const [mode, setMode] = useState<"in" | "forgot" | "code">("in"); const [code, setCode] = useState(""); const [info, setInfo] = useState("");
  const forgot = async (e: React.FormEvent) => { e.preventDefault(); setErr(""); setBusy(true); try { const r = await post<{ message: string }>("/auth/reset-request", { email }); setInfo(r.message); setMode("code"); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  const reset = async (e: React.FormEvent) => { e.preventDefault(); setErr(""); if (!pwOk(pw)) return setErr(PW_RULE); setBusy(true);
    try { await post("/auth/reset", { email, code, password: pw }); done(await post<R>("/auth/login", { email, password: pw })); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } };
  return <div className="login">
    <div className="login-art" aria-hidden><div className="la-grid" />{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${8 + (i % 6) * 14}%`, top: `${18 + Math.floor(i / 6) * 22}%`, animationDelay: `${i * 0.21}s`, background: ["var(--c-ok)", "var(--c-reefer)", "var(--c-late)", "var(--map-unit)"][i % 4] }} />)}
      <div className="la-copy"><b>Every trailer, door and move.</b><span>One live view of the yard, from gate to dock.</span></div></div>
    {mode !== "in" ? <form className="login-card" onSubmit={mode === "forgot" ? forgot : reset}>
      <div className="logo"><b>Y</b><span>YMSNow</span></div>
      <h1>{mode === "forgot" ? "Reset password" : "Enter reset code"}</h1>
      <p className="mu">{mode === "forgot" ? "We will e-mail a 6-digit code to your work address." : info + " Codes expire after 30 minutes."}</p>
      <div className="fld"><label htmlFor="em2">Email</label><input id="em2" className="ctl" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === "forgot"} readOnly={mode === "code"} /></div>
      {mode === "code" && <><div className="fld"><label htmlFor="cd">Code</label><input id="cd" className="ctl mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus /></div>
        <div className="fld"><label htmlFor="np">New password</label><input id="np" className="ctl" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div><p className="hint">{PW_RULE}</p></>}
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn pri lg" disabled={busy}>{mode === "forgot" ? "Send code" : "Set password and sign in"}</button>
      <button type="button" className="btn lg ghost" onClick={() => { setMode("in"); setErr(""); setPw(""); }}>Back to sign in</button>
    </form> :
    <form className="login-card" onSubmit={submit}>
      <div className="logo"><b>Y</b><span>YMSNow</span></div>
      <h1>Sign in</h1><p className="mu">Use your work account. Your role decides what you can see and change.</p>
      <div className="fld"><label htmlFor="em">Email</label><input id="em" className="ctl" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></div>
      <div className="fld"><label htmlFor="pw">Password</label><div className="pw"><input id="pw" className="ctl" type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <button type="button" className="btn icon ghost" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn pri lg" disabled={busy}><LogIn size={16} />Sign in</button>
      <button type="button" className="linkish" onClick={() => { setMode("forgot"); setErr(""); setPw(""); }}>Forgot password?</button>
      <div className="or"><span>or</span></div>
      <button type="button" className="btn lg" onClick={demo} disabled={busy}><Play size={16} />Start demo</button>
      <p className="hint"><ShieldCheck size={12} /> Demo runs in an isolated demo workspace with fictitious data. It never reads or changes live tenant data.</p>
    </form>}</div>;
}
