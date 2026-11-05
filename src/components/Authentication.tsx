import emblem from "@/assets/waypoint-emblem.png";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { bridge } from "@/lib/storage";
import "./authentication.css";

export default function Authentication({ onAuthenticated, operatorExists }: { onAuthenticated: () => void; operatorExists: boolean }) {
  const reduce = useReducedMotion();
  const [setup, setSetup] = useState<boolean | null>(() => !operatorExists);
  const [operator, setOperator] = useState("");
  const [key, setKey] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"" | "VERIFYING CREDENTIALS" | "AUTHENTICATING OPERATOR" | "ACCESS GRANTED">("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const fail = (message: string) => { setError(message); setAttempt((n) => n + 1); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || setup === null) return;
    if (!operator.trim()) return fail("ENTER AN OPERATOR IDENTIFIER");
    if (setup && (key.length < 12 || key.length > 128)) return fail("ACCESS_KEY MUST BE 12–128 CHARACTERS");
    if (setup && key !== confirmation) return fail("ACCESS_KEY CONFIRMATION DOES NOT MATCH");
    submitting.current = true;
    setBusy(true); setError(""); setPhase("VERIFYING CREDENTIALS");
    // Only show the second pending state while the actual IPC is still running.
    const phaseTimer = window.setTimeout(() => { if (mounted.current) setPhase("AUTHENTICATING OPERATOR"); }, 250);
    try {
      if (setup) await bridge()!.auth.create(operator, key);
      else if (!(await bridge()!.auth.verify(operator, key))) {
        if (mounted.current) { setPhase(""); fail("ACCESS DENIED"); }
        return;
      }
      window.clearTimeout(phaseTimer);
      if (!mounted.current) return;
      setKey(""); setConfirmation(""); setPhase("ACCESS GRANTED");
      // This confirmation appears only after the main process grants a session.
      if (!reduce) await new Promise<void>((resolve) => window.setTimeout(resolve, 450));
      if (mounted.current) onAuthenticated();
    } catch {
      if (mounted.current) {
        setPhase(""); fail("LOCAL AUTHENTICATION UNAVAILABLE");
        // Another setup may have completed; never offer a replacement account.
        bridge()!.auth.status().then((exists) => { if (mounted.current && exists) setSetup(false); }).catch(() => {});
      }
    } finally {
      window.clearTimeout(phaseTimer);
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const entrance = (delay: number) => reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay } };
  return (
    <div className="auth-screen grid-bg" data-auth-phase={phase === "ACCESS GRANTED" ? "granted" : undefined}>
      <div className="auth-ambient" aria-hidden="true"><div className="auth-ambient-grid" /><div className="auth-ambient-scan" /><div className="auth-ambient-geometry auth-ambient-geometry-a" /><div className="auth-ambient-geometry auth-ambient-geometry-b" /><div className="auth-ambient-cross auth-ambient-cross-a">+</div><div className="auth-ambient-cross auth-ambient-cross-b">+</div></div>
      {!reduce && <motion.div className="auth-wipe" initial={{ scaleX: 0 }} animate={{ scaleX: [0, 1, 0] }} transition={{ duration: 1, times: [0, .55, 1] }} />}
      <header className="auth-header"><div className="auth-brand"><img className="auth-mark" src={emblem} alt="" /><span>WAYPOINT<small>PERSONAL OPERATIONS CONSOLE</small></span></div><span className="auth-header-code">SYS / 04A&nbsp;&nbsp; — &nbsp;&nbsp;LOCAL ACCESS</span></header>
      <main className="auth-main">
        <motion.div className="auth-panel" {...entrance(.1)}>
          <div className="auth-panel-top"><span>IDENTITY VERIFICATION</span><span>01 / 01</span></div>
          <motion.div className="auth-emblem" {...entrance(.18)}><span><img src={emblem} alt="" /></span><i /></motion.div>
          <motion.div {...entrance(.24)}><div className="auth-kicker"><span className="auth-dot" /> LOCAL SYSTEM // {setup ? "INITIAL SETUP" : "SECURE ACCESS"}</div><h1>{setup ? "CREATE OPERATOR" : "OPERATOR AUTHENTICATION"}</h1><p className="auth-description">{setup ? "Initialize the authorized operator for this local console." : "Verify your operator credentials to access the operations console."}</p></motion.div>
          <motion.form onSubmit={submit} className="auth-form" {...entrance(.34)}>
            <label htmlFor="auth-operator">OPERATOR <span>01</span></label>
            <input id="auth-operator" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="username" maxLength={128} disabled={busy || setup === null} />
            <label htmlFor="auth-key">ACCESS_KEY <span>02</span></label>
            <div className="auth-secret"><input id="auth-key" type={show ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} maxLength={128} disabled={busy || setup === null} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide access key" : "Show access key"} aria-pressed={show}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {setup && <><label htmlFor="auth-confirm">CONFIRM ACCESS_KEY <span>03</span></label><div className="auth-secret"><input id="auth-confirm" type={show ? "text" : "password"} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" maxLength={128} disabled={busy} /></div><p className="auth-hint">12–128 CHARACTERS // SPACES PERMITTED</p></>}
            <div className="auth-phase" role="status" aria-live="polite">{phase && <><span className="auth-phase-indicator" aria-hidden="true" />{phase}</>}</div>
            <motion.div key={attempt} role="alert" className="auth-error" animate={!reduce && error ? { x: [0, -5, 5, -3, 0] } : {}} transition={{ duration: .3 }}>{error}</motion.div>
            <motion.button className="auth-submit" type="submit" disabled={busy || setup === null} whileHover={reduce ? {} : { y: -2 }} whileTap={reduce ? {} : { scale: .99 }}>{busy ? (phase === "ACCESS GRANTED" ? "ACCESS GRANTED" : "PROCESSING…") : setup ? "CREATE OPERATOR" : "AUTHENTICATE"}<ArrowUpRight size={19} /></motion.button>
          </motion.form>
          <div className="auth-panel-bottom"><span>WAYPOINT // ACCESS CONTROL</span><span>LOCAL ONLY</span></div>
        </motion.div>
      </main>
      <footer className="auth-footer"><span>WAYPOINT SYSTEMS &nbsp; / &nbsp; V{bridge()?.versions.app ?? "0.3.0"}</span><span><i className="auth-dot" /> LOCAL SYSTEM ONLINE</span></footer>
    </div>
  );
}
