import emblem from "@/assets/waypoint-emblem.png";
/**
 * Startup sequence: charcoal init screen with mono diagnostics, then the
 * signature acid wipe that hands off to the mounted application.
 * Skipped entirely when the user prefers reduced motion.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE } from "@/lib/motion";

const BOOT_LINES = [
  "WAYPOINT OPS KERNEL v0.3.0 — COLD START",
  "MOUNTING LOCAL OPERATIONS STORE …….. OK",
  "CALIBRATING DISPLAY GRID ……………… OK",
  "SYNCING LOCAL CLOCK ……………………… OK",
];

export default function BootFX({
  onReveal,
  onDone,
}: {
  onReveal: () => void;
  onDone: () => void;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"init" | "wipe" | "raise">("init");

  useEffect(() => {
    if (reduce) {
      onReveal();
      onDone();
      return;
    }
    const t = window.setTimeout(() => setPhase("wipe"), 1050);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-acid"
      initial={false}
      animate={{ y: phase === "raise" ? "-101%" : "0%" }}
      transition={{ duration: 0.55, ease: EASE }}
      onAnimationComplete={() => {
        if (phase === "raise") onDone();
      }}
    >
      {/* acid screen markings */}
      <div className="absolute inset-x-0 bottom-8 px-8 flex items-end justify-between">
        <span className="micro text-acidink/70">SYSTEMS HANDOFF — RENDERING CONSOLE</span>
        <span className="micro text-acidink/70">WPT-OS // 0.3.0</span>
      </div>
      <motion.div
        className="absolute inset-0 bg-chrome grid-bg-dark flex flex-col justify-center px-8 sm:px-16"
        initial={false}
        animate={{ y: phase === "init" ? "0%" : "-101%" }}
        transition={{ duration: 0.42, ease: EASE }}
        onAnimationComplete={() => {
          if (phase === "wipe") {
            onReveal();
            window.setTimeout(() => setPhase("raise"), 180);
          }
        }}
      >
        <div className="flex items-center gap-4">
          <img src={emblem} alt="" className="size-10 object-contain flex-none" />
          <div>
            <div className="font-display font-bold text-fog tracking-[0.3em] text-lg">
              WAYPOINT
            </div>
            <div className="micro text-fog/50 mt-0.5">PERSONAL OPERATIONS CONSOLE</div>
          </div>
        </div>
        <div className="mt-10 space-y-2 max-w-md">
          {BOOT_LINES.map((l, i) => (
            <motion.div
              key={l}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.2, duration: 0.01 }}
              className="micro text-mint"
            >
              <span className="text-fog/40 mr-3">{String(i).padStart(2, "0")}</span>
              {l}
            </motion.div>
          ))}
        </div>
        <div className="mt-8 h-[3px] w-56 bg-white/10 overflow-hidden">
          <motion.div
            className="h-full bg-acid origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.95, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
