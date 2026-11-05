import { useEffect, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { bridge } from "@/lib/storage";
import "./authentication.css";

export default function Authentication({ onAuthenticated }: { onAuthenticated: () => void }) {
  const reduce = useReducedMotion();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [operator, setOperator] = useState("");
  const [key, setKey] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    bridge()!.auth.status().then((exists) => setSetup(!exists)).catch(() => setError("LOCAL OPERATOR RECORD UNAVAILABLE"));
  }, []);
  const fail = (message: string) => { setError(message); setAttempt((n) => n + 1); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || setup === null) return;
    if (!operator.trim()) return fail("ENTER AN OPERATOR IDENTIFIER");
    if (setup && (key.length < 12 || key.length > 128)) return fail("ACCESS_KEY MUST BE 12–128 CHARACTERS");
    if (setup && key !== confirmation) return fail("ACCESS_KEY CONFIRMATION DOES NOT MATCH");
    setBusy(true); setError("");
    try {
      if (setup) await bridge()!.auth.create(operator, key);
      else if (!(await bridge()!.auth.verify(operator, key))) { fail("ACCESS DENIED"); return; }
      setKey(""); setConfirmation(""); onAuthenticated();
    } catch {
      fail("LOCAL AUTHENTICATION UNAVAILABLE");
      // Another setup may have completed; never offer a replacement account.
      bridge()!.auth.status().then((exists) => { if (exists) setSetup(false); }).catch(() => {});
    } finally { setBusy(false); }
  }
  const entrance = (delay: number) => reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay } };
  return (
    <div className="auth-screen grid-bg">
      {!reduce && <motion.div className="auth-wipe" initial={{ scaleX: 0 }} animate={{ scaleX: [0, 1, 0] }} transition={{ duration: 1, times: [0, .55, 1] }} />}
      <header className="auth-header"><div className="auth-brand"><span className="auth-mark">W</span><span>WAYPOINT<small>PERSONAL OPERATIONS CONSOLE</small></span></div><span className="auth-header-code">SYS / 04A&nbsp;&nbsp; — &nbsp;&nbsp;LOCAL ACCESS</span></header>
      <main className="auth-main">
        <motion.div className="auth-panel" {...entrance(.1)}>
          <div className="auth-panel-top"><span>IDENTITY VERIFICATION</span><span>01 / 01</span></div>
          <motion.div className="auth-emblem" {...entrance(.18)}><span>W</span><i /></motion.div>
          <motion.div {...entrance(.24)}><div className="auth-kicker"><span className="auth-dot" /> LOCAL SYSTEM // {setup ? "INITIAL SETUP" : "SECURE ACCESS"}</div><h1>{setup ? "CREATE OPERATOR" : "OPERATOR AUTHENTICATION"}</h1><p className="auth-description">{setup ? "Initialize the authorized operator for this local console." : "Verify your operator credentials to access the operations console."}</p></motion.div>
          <motion.form onSubmit={submit} className="auth-form" {...entrance(.34)}>
            <label htmlFor="auth-operator">OPERATOR <span>01</span></label>
            <input id="auth-operator" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="username" maxLength={128} disabled={busy || setup === null} />
            <label htmlFor="auth-key">ACCESS_KEY <span>02</span></label>
            <div className="auth-secret"><input id="auth-key" type={show ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} maxLength={128} disabled={busy || setup === null} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide access key" : "Show access key"} aria-pressed={show}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {setup && <><label htmlFor="auth-confirm">CONFIRM ACCESS_KEY <span>03</span></label><div className="auth-secret"><input id="auth-confirm" type={show ? "text" : "password"} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" maxLength={128} disabled={busy} /></div><p className="auth-hint">12–128 CHARACTERS // SPACES PERMITTED</p></>}
            <motion.div key={attempt} role="alert" className="auth-error" animate={!reduce && error ? { x: [0, -5, 5, -3, 0] } : {}} transition={{ duration: .3 }}>{error}</motion.div>
            <motion.button className="auth-submit" type="submit" disabled={busy || setup === null} whileHover={reduce ? {} : { y: -2 }} whileTap={reduce ? {} : { scale: .99 }}>{busy ? "VERIFYING LOCAL RECORD…" : setup ? "CREATE OPERATOR" : "AUTHENTICATE"}<ArrowUpRight size={19} /></motion.button>
          </motion.form>
          <div className="auth-panel-bottom"><span>WAYPOINT // ACCESS CONTROL</span><span>LOCAL ONLY</span></div>
        </motion.div>
      </main>
      <footer className="auth-footer"><span>WAYPOINT SYSTEMS &nbsp; / &nbsp; V{bridge()?.versions.app ?? "0.3.0"}</span><span><i className="auth-dot" /> LOCAL SYSTEM ONLINE</span></footer>
    </div>
  );
}
