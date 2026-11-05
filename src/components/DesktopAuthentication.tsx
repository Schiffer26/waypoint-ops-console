import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ThemeMode } from "@/types";
import { bridge } from "@/lib/storage";
import { resolveTheme, useSystemDark } from "@/lib/theme";
import Authentication from "./Authentication";
import SystemInitialization from "./SystemInitialization";
import LightSystemInitialization from "./LightSystemInitialization";

/** Startup is presentation only. Main-process authentication remains authoritative. */
export default function DesktopAuthentication({ onTheme, onAuthenticated }: {
  onTheme: (theme: ThemeMode) => void;
  onAuthenticated: () => void;
}) {
  const reduce = useReducedMotion();
  const systemDark = useSystemDark();
  const [bootTheme, setBootTheme] = useState<ThemeMode | null>(null);
  const signalled = useRef(false);
  const [operatorExists, setOperatorExists] = useState<boolean | null>(null);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    // Wait for the saved theme before starting the full visual introduction.
    if (!appearanceReady && !error) return;
    if (reduce) { setIntroDone(true); return; }
    const timer = window.setTimeout(() => setIntroDone(true), 3500);
    return () => window.clearTimeout(timer);
  }, [reduce, appearanceReady, error]);

  useEffect(() => {
    let active = true;
    setError(false);
    setOperatorExists(null);
    setAppearanceReady(false);
    const timeout = window.setTimeout(() => {
      if (active) { active = false; setError(true); }
    }, 12000);
    Promise.resolve().then(() => {
      const api = bridge()?.auth;
      if (!api) throw new Error("Authentication bridge unavailable");
      const appearance = api.appearance().then((theme) => {
        if (active) {
          // Apply the resolved tokens before mounting either themed animation.
          document.documentElement.dataset.theme = resolveTheme(theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
          onTheme(theme); setBootTheme(theme); setAppearanceReady(true);
        }
      });
      return Promise.all([appearance, api.status()]);
    }).then(([, exists]) => {
      if (active) { window.clearTimeout(timeout); setOperatorExists(exists); }
    }).catch(() => {
      if (active) { active = false; window.clearTimeout(timeout); setError(true); }
    });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [onTheme, retry]);

  const initialized = operatorExists !== null && !error;
  const showLogin = initialized && introDone;
  const signalBootComplete = () => {
    if (!signalled.current) { signalled.current = true; bridge()?.bootComplete(); }
  };
  const dark = bootTheme === "dark" || (bootTheme === "system" && systemDark);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {showLogin ? (
        <motion.div key="authentication" className="h-full" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.2 }}>
          <BootCompleted onReady={signalBootComplete} />
          <Authentication operatorExists={operatorExists} onAuthenticated={onAuthenticated} />
        </motion.div>
      ) : (
        <motion.div key="initialization" className="h-full" exit={reduce ? {} : { opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }}>
          {bootTheme === null ? (
            <div className="h-full grid place-items-center" style={{ background: "#888", color: "#191919" }}>
              {error && <div role="alert" className="text-center font-mono text-xs">LOCAL INITIALIZATION UNAVAILABLE<br /><button type="button" className="mt-4 border p-2" onClick={() => setRetry((n) => n + 1)}>RETRY INITIALIZATION</button></div>}
            </div>
          ) : dark ? (
            <SystemInitialization appearanceReady={appearanceReady} initialized={initialized} error={error} onRetry={() => setRetry((n) => n + 1)} />
          ) : (
            <LightSystemInitialization initialized={initialized} error={error} onRetry={() => setRetry((n) => n + 1)} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Mounted after AnimatePresence has finished the boot screen exit. */
function BootCompleted({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady(); }, [onReady]);
  return null;
}
