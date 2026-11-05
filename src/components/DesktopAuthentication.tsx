import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ThemeMode } from "@/types";
import { bridge } from "@/lib/storage";
import Authentication from "./Authentication";
import SystemInitialization from "./SystemInitialization";

/** Startup is presentation only. Main-process authentication remains authoritative. */
export default function DesktopAuthentication({ onTheme, onAuthenticated }: {
  onTheme: (theme: ThemeMode) => void;
  onAuthenticated: () => void;
}) {
  const reduce = useReducedMotion();
  const [operatorExists, setOperatorExists] = useState<boolean | null>(null);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (reduce) { setIntroDone(true); return; }
    const timer = window.setTimeout(() => setIntroDone(true), 1700);
    return () => window.clearTimeout(timer);
  }, [reduce]);

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
        if (active) { onTheme(theme); setAppearanceReady(true); }
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
  return (
    <AnimatePresence mode="wait" initial={false}>
      {showLogin ? (
        <motion.div key="authentication" className="h-full" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.2 }}>
          <Authentication operatorExists={operatorExists} onAuthenticated={onAuthenticated} />
        </motion.div>
      ) : (
        <motion.div key="initialization" className="h-full" exit={reduce ? {} : { opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }}>
          <SystemInitialization appearanceReady={appearanceReady} initialized={initialized} error={error} onRetry={() => setRetry((n) => n + 1)} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
