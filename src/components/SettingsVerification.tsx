import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { bridge } from "@/lib/storage";
import "./authentication.css";

/** Presentation gate only; verification and attempt throttling live in main. */
export default function SettingsVerification({ onVerified, onBack }: {
  onVerified: (verify: () => Promise<boolean>) => Promise<void>;
  onBack: () => void;
}) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    const secret = key;
    setKey("");
    try {
      await onVerified(async () => {
        const auth = bridge()?.auth;
        if (!auth?.verifySettings) throw new Error("Verification unavailable");
        const ok = await auth.verifySettings(secret);
        if (!ok && mounted.current) setError("ACCESS DENIED");
        return ok;
      });
    } catch {
      if (mounted.current) setError("LOCAL AUTHENTICATION UNAVAILABLE");
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="auth-panel mx-auto" aria-labelledby="settings-verification-heading">
      <div className="auth-panel-top"><span>IDENTITY VERIFICATION</span><span>SETTINGS / 06</span></div>
      <div className="pt-7"><div className="auth-kicker"><span className="auth-dot" /> LOCAL SYSTEM // SECURE ACCESS</div>
        <h1 id="settings-verification-heading">SETTINGS ACCESS</h1>
        <p className="auth-description">Verify your access key to open Settings.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="settings-access-key">ACCESS_KEY <span>01</span></label>
        <div className="auth-secret"><input id="settings-access-key" type={show ? "text" : "password"} value={key} onChange={e => setKey(e.target.value)} autoComplete="current-password" maxLength={128} disabled={busy} /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide access key" : "Show access key"} aria-pressed={show}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <div role="alert" className="auth-error">{error}</div>
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? "PROCESSING…" : "AUTHENTICATE"}<ArrowUpRight size={19} /></button>
      </form>
      <div className="auth-panel-bottom"><button type="button" onClick={onBack} className="cursor-pointer text-ink">← BACK</button><span>LOCAL ONLY</span></div>
    </section>
  );
}
