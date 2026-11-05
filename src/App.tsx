import emblem from "@/assets/waypoint-emblem.png";
/**
 * WAYPOINT — Personal Operations Console
 * Renderer shell: boot sequence, sidebar + command strip layout, page
 * routing with transitions, global entry editor, confirm dialogs and the
 * client-side reminder watcher (fires OS notifications via the desktop
 * bridge when packaged).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BellRing, X } from "lucide-react";
import type { Entry, PageKey, ThemeMode } from "@/types";
import { normalizeReminder, offsetLabel } from "@/types";
import { ShellContext, type ConfirmOpts, type ModalRequest } from "@/lib/shell";
import { useHydrated, useOpsStore } from "@/store/useOpsStore";
import { mergeISO, pad2, todayISO } from "@/lib/time";
import { expandEvents, occurrenceStart } from "@/lib/schedule";
import { bridge, isDesktop } from "@/lib/storage";
import { useThemeSync } from "@/lib/theme";
import { pageVariants, pageVariantsReduced } from "@/lib/motion";
import Sidebar from "@/components/Sidebar";
import TopBar, { PAGE_META } from "@/components/TopBar";
import BootFX from "@/components/BootFX";
import EntryModal from "@/components/EntryModal";
import { ConfirmDialog } from "@/components/ui/Modal";
import { StatusDot } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";
import Dashboard from "@/pages/Dashboard";
import Tasks from "@/pages/Tasks";
import CalendarPage from "@/pages/CalendarPage";
import Events from "@/pages/Events";
import Completed from "@/pages/Completed";
import Settings from "@/pages/Settings";
import SettingsVerification from "@/components/SettingsVerification";
import "@/components/settings-verification.css";
import Briefing from "@/pages/Briefing";
import DesktopAuthentication from "@/components/DesktopAuthentication";

/** The Daily Briefing window reuses this bundle with ?window=briefing */
const IS_BRIEFING =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("window") === "briefing";

/* ---------------------------------------------------------------- toasts */
interface Toast {
  id: string;
  title: string;
  body: string;
  page: PageKey;
  /** Present when the toast mirrors a main-process reminder (snoozable). */
  reminderId?: string;
  missed?: boolean;
}

/**
 * WEB-PREVIEW ONLY reminder fallback.
 *
 * In the desktop build every reminder is scheduled and delivered by the
 * Electron main process (electron/scheduler.ts) so notifications fire with
 * the window hidden, minimised or closed to tray. This renderer loop only
 * runs in the browser preview, which has no main process at all.
 */
function useReminderWatcher(push: (t: Toast) => void) {
  const tasks = useOpsStore((s) => s.tasks);
  const events = useOpsStore((s) => s.events);
  const fired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isDesktop()) return; // main-process scheduler owns delivery
    const check = () => {
      const now = new Date();
      const today = todayISO();
      const maybeFire = (key: string, fireAt: number, guardUntil: number, t: Toast) => {
        if (fired.current.has(key)) return;
        const ms = now.getTime();
        if (ms >= fireAt && ms <= guardUntil) {
          fired.current.add(key);
          push(t);
          bridge()
            ?.notify({ title: `WAYPOINT — ${t.title}`, body: t.body })
            .catch(() => {});
        }
      };

      for (const task of tasks) {
        if (task.completed || !task.dueTime || task.date !== today) continue;
        const dueMs = mergeISO(task.date, task.dueTime).getTime();
        for (const offset of normalizeReminder(task.reminder).offsets) {
          const lead = offset * 60000;
          maybeFire(`task:${task.id}:${task.date}:+${offset}`, dueMs - lead, dueMs + 15 * 60000, {
            id: `task:${task.id}:+${offset}`,
            title: task.title,
            body:
              offset === 0
                ? `Objective due now — ${task.dueTime}`
                : `Objective due in ${offsetLabel(offset)} — ${task.dueTime}`,
            page: "tasks",
          });
        }
      }

      for (const occ of expandEvents(events, today, today)) {
        const startMs = occurrenceStart(occ);
        for (const offset of normalizeReminder(occ.reminder).offsets) {
          const lead = offset * 60000;
          maybeFire(
            `event:${occ.id}:${occ.occurrenceDate}:+${offset}`,
            startMs - lead,
            startMs + 15 * 60000,
            {
              id: `event:${occ.id}:+${offset}`,
              title: occ.title,
              body:
                offset === 0
                  ? `Transmission starting — ${occ.startTime}`
                  : `Transmission in ${offsetLabel(offset)} — ${occ.startTime}`,
              page: "events",
            },
          );
        }
      }
    };
    check();
    const t = window.setInterval(check, 20_000);
    return () => window.clearInterval(t);
  }, [tasks, events, push]);
}

/**
 * Branded pre-hydration gate. Held only while the persisted store loads
 * (a no-op for the synchronous web backend; a few IPC round-trips under
 * Electron's async file bridge). Prevents seed data from ever flashing
 * over the operator's real records.
 */
function HydrationScreen() {
  return (
    <div className="h-full grid place-items-center bg-chrome grid-bg-dark text-fog">
      <div className="flex flex-col items-center gap-5">
        <img src={emblem} alt="" className="size-9 object-contain flex-none" />
        <div className="micro text-mint flex items-center gap-2">
          <StatusDot />
          MOUNTING LOCAL OPERATIONS STORE…
        </div>
        <div className="h-[3px] w-44 bg-white/10 overflow-hidden">
          <div className="h-full w-1/4 bg-acid scan" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */
export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const reducedMotion = useReducedMotion();
  const [lockedTheme, setLockedTheme] = useState<ThemeMode>("system");
  useThemeSync(isDesktop() && !IS_BRIEFING && !authenticated ? lockedTheme : undefined); // briefing window resolves the same persisted preference
  const hydrated = useHydrated();
  if (IS_BRIEFING) return hydrated ? <Briefing /> : <HydrationScreen />;
  // The browser-only preview has no local credential service; the desktop
  // application is the authoritative authentication environment.
  if (isDesktop() && !authenticated) return <DesktopAuthentication onTheme={setLockedTheme} onAuthenticated={() => { setAuthenticated(true); void useOpsStore.persist.rehydrate(); }} />;
  if (!hydrated) return <HydrationScreen />;
  if (isDesktop()) return <motion.div className="h-full" initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.3 }}><ConsoleApp /></motion.div>;
  return <ConsoleApp />;
}

function ConsoleApp() {
  const reduce = useReducedMotion() ?? false;
  const [revealed, setRevealed] = useState(false);
  const [bootDone, setBootDone] = useState(false);

  const [page, setPage] = useState<PageKey>("dashboard");
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pageRef = useRef<PageKey>("dashboard");
  const previousPage = useRef<PageKey>("dashboard");
  const settingsGeneration = useRef(0);
  const unlockedRef = useRef(false);
  const settingsPicker = useRef<{ blurSeen: boolean } | null>(null);
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const [settingsLockVersion, setSettingsLockVersion] = useState(0);
  const lockSettings = useCallback(() => {
    settingsGeneration.current++;
    settingsPicker.current = null;
    unlockedRef.current = false;
    setSettingsUnlocked(false);
    if (pageRef.current === "settings") setConfirmState(null);
    setSettingsLockVersion(n => n + 1);
  }, []);
  // This lease is available only while Settings is unlocked. It covers one
  // native-dialog blur, not subsequent blurs, navigation, or hidden windows.
  const beginSettingsFilePicker = useCallback((): (() => void) | null => {
    if (pageRef.current !== "settings" || !unlockedRef.current || settingsPicker.current) return null;
    const picker = { blurSeen: false };
    settingsPicker.current = picker;
    window.dispatchEvent(new Event("waypoint:settings-picker-state"));
    // If a blocked picker never blurs or fires cancel/change, fail closed rather
    // than leaving the exception active indefinitely.
    const watchdog = window.setTimeout(() => {
      if (settingsPicker.current === picker && !picker.blurSeen) finish();
    }, 2000);
    const finish = () => {
      window.clearTimeout(watchdog);
      if (settingsPicker.current !== picker) return;
      settingsPicker.current = null;
      window.dispatchEvent(new Event("waypoint:settings-picker-state"));
    };
    return finish;
  }, []);
  const captureSettingsAccess = useCallback(() => {
    const generation = settingsGeneration.current;
    return () => pageRef.current === "settings" && unlockedRef.current && settingsGeneration.current === generation;
  }, []);
  const guardedConfirm = useCallback((opts: ConfirmOpts) => {
    if (pageRef.current !== "settings") { setConfirmState(opts); return; }
    if (!unlockedRef.current) return;
    const generation = settingsGeneration.current;
    setConfirmState({ ...opts, onConfirm: () => {
      if (pageRef.current === "settings" && unlockedRef.current && settingsGeneration.current === generation) opts.onConfirm();
    } });
  }, []);
  const navigate = useCallback((next: PageKey) => {
    const current = pageRef.current;
    if (next === "settings" || current === "settings") lockSettings();
    if (next === "settings" && current !== "settings") previousPage.current = current;
    pageRef.current = next;
    setPage(next);
  }, [lockSettings]);
  const verifySettings = useCallback(async (verify: () => Promise<boolean>) => {
    const generation = settingsGeneration.current;
    const ok = await verify();
    if (ok && generation === settingsGeneration.current && pageRef.current === "settings" &&
        document.visibilityState === "visible" && document.hasFocus()) {
      unlockedRef.current = true;
      setSettingsUnlocked(true);
    }
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const reset = () => {
      window.clearTimeout(timer);
      if (unlockedRef.current && pageRef.current === "settings" && !settingsPicker.current) timer = window.setTimeout(lockSettings, 60_000);
    };
    const lock = () => { window.clearTimeout(timer); if (pageRef.current === "settings") lockSettings(); };
    const onBlur = () => {
      const picker = settingsPicker.current;
      if (picker && !picker.blurSeen) { picker.blurSeen = true; return; }
      lock();
    };
    const onVisibility = () => { if (document.visibilityState !== "visible") lock(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const event of events) window.addEventListener(event, reset, { passive: true, capture: true });
    window.addEventListener("blur", onBlur);
    window.addEventListener("waypoint:settings-picker-state", reset);
    document.addEventListener("visibilitychange", onVisibility);
    reset();
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("waypoint:settings-picker-state", reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [settingsUnlocked, lockSettings]);
  const pushToast = useCallback((t: Toast) => {
    setToasts((prev) => [...prev.filter((x) => x.id !== t.id), t]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
    }, 9000);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useReminderWatcher(pushToast);

  // System tray "Add Task / Add Event" requests arrive via the desktop bridge.
  // The main process queues directives until we explicitly report readiness
  // (mounted → subscribed → rendererReady), so nothing is lost if the console
  // window had to be created on demand.
  useEffect(() => {
    const b = bridge();
    if (!b?.onOpenCreate) return;
    const off = b.onOpenCreate((kind) => setModal({ mode: "create", kind }));
    b.rendererReady();
    return off;
  }, []);

  /**
   * Background engine → console. The main process delivers the OS
   * notification; this mirrors it as an in-app toast while the console is
   * open so the existing UI language is preserved.
   */
  useEffect(() => {
    const b = bridge();
    if (!b?.onReminderDelivered) return;
    return b.onReminderDelivered((p) => {
      pushToast({
        id: p.id,
        title: p.missed ? `MISSED — ${p.title}` : p.title,
        body: p.body,
        page: p.kind === "task" ? "tasks" : "events",
        reminderId: p.id,
        missed: p.missed,
      });
    });
  }, [pushToast]);

  /**
   * Notification actions (Windows toast buttons) are routed here because the
   * renderer is the single authoritative writer of the operations database —
   * the main process never mutates it.
   */
  useEffect(() => {
    const b = bridge();
    if (!b?.onReminderAction) return;
    return b.onReminderAction((a) => {
      const store = useOpsStore.getState();
      if (a.cmd === "complete-task") {
        const task = store.tasks.find((t) => t.id === a.entryId);
        if (task && !task.completed) store.toggleTask(task.id);
        navigate("tasks");
        return;
      }
      // open-entry
      const entry: Entry | undefined =
        a.kind === "task"
          ? store.tasks.find((t) => t.id === a.entryId)
          : store.events.find((e) => e.id === a.entryId);
      navigate(a.kind === "task" ? "tasks" : "events");
      if (entry) setModal({ mode: "edit", entry });
    });
  }, [navigate]);

  // Esc closes the topmost surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmState) setConfirmState(null);
      else if (modal) setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmState, modal]);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;
      case "tasks":
        return <Tasks />;
      case "calendar":
        return <CalendarPage />;
      case "events":
        return <Events />;
      case "completed":
        return <Completed />;
      case "settings":
        return settingsUnlocked ? <div className="settings-protected-content"><Settings /></div> : <SettingsVerification key={settingsLockVersion} onVerified={verifySettings} onBack={() => navigate(previousPage.current)} />;
    }
  };

  return (
    <ShellContext.Provider
      value={{
        page,
        navigate,
        openCreate: (kind, presetDate) => setModal({ mode: "create", kind, presetDate }),
        openEdit: (entry: Entry) => setModal({ mode: "edit", entry }),
        confirm: guardedConfirm,
        beginSettingsFilePicker,
        captureSettingsAccess,
      }}
    >
      {!bootDone && (
        <BootFX onReveal={() => setRevealed(true)} onDone={() => setBootDone(true)} />
      )}

      {revealed && (
        <div className={cn("h-full flex bg-paper", (page !== "settings" || !settingsUnlocked) && "settings-lock-active")}>
          <Sidebar page={page} onNavigate={navigate} />

          <div className="flex-1 min-w-0 flex flex-col grid-bg">
            <TopBar page={page} />

            <main className="flex-1 overflow-y-auto relative">
              {/* page-change acid sweep */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={page}
                  variants={reduce ? pageVariantsReduced : pageVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="px-4 sm:px-6 lg:px-9 py-6 lg:py-8 max-w-[1560px] mx-auto w-full"
                >
                  {renderPage()}
                </motion.div>
              </AnimatePresence>
            </main>

            <footer className="h-8 flex-none border-t border-line bg-paper/85 backdrop-blur flex items-center justify-between px-4 lg:px-9">
              <span className="micro text-mute flex items-center gap-2">
                <StatusDot />
                WAYPOINT OPS-CONSOLE v0.3.0 — LOCAL PERSISTENCE ACTIVE
              </span>
              <span className="micro text-mute hidden sm:flex items-center gap-4">
                <span className="tnum">
                  MODULE {PAGE_META[page].code}/{PAGE_META[page].title}
                </span>
                <span className="w-8 h-px bg-ink/30" />
                STAGE 03 // BACKGROUND REMINDERS
              </span>
            </footer>
          </div>
        </div>
      )}

      {/* entry editor */}
      <AnimatePresence>
        {modal && <EntryModal req={modal} onClose={() => setModal(null)} />}
      </AnimatePresence>

      {/* A Settings lock must not retain an exiting confirmation dialog. */}
      <AnimatePresence key={settingsLockVersion}>
        {confirmState && (
          <ConfirmDialog opts={confirmState} onClose={() => setConfirmState(null)} />
        )}
      </AnimatePresence>

      {/* reminder toasts */}
      <div className="fixed bottom-12 right-4 lg:right-8 z-[80] w-[320px] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 48 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto bg-chrome text-fog border border-chrome shadow-[6px_6px_0_rgba(25,25,25,0.25)]"
            >
              <div className="h-1 bg-acid" />
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "micro flex items-center gap-2",
                      t.missed ? "text-mint" : "text-acid",
                    )}
                  >
                    <BellRing size={11} /> {t.missed ? "MISSED" : "REMINDER"} //{" "}
                    {pad2(toasts.indexOf(t) + 1)}
                  </span>
                  <button
                    onClick={() => dismissToast(t.id)}
                    className="text-fog/50 hover:text-acid transition-colors"
                    aria-label="Dismiss"
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className="font-display font-semibold text-sm mt-1.5 leading-snug">
                  {t.title}
                </div>
                <div className="micro text-fog/55! mt-1 normal-case tracking-wide">{t.body}</div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => {
                      navigate(t.page);
                      dismissToast(t.id);
                    }}
                    className="micro bg-acid text-acidink px-2.5 py-1.5 font-semibold hover:bg-paper transition-colors"
                  >
                    VIEW RECORD
                  </button>
                  <button
                    onClick={() => dismissToast(t.id)}
                    className="micro border border-white/25 text-fog/70 px-2.5 py-1.5 hover:border-acid hover:text-acid transition-colors"
                  >
                    ACKNOWLEDGE
                  </button>
                  {t.reminderId && bridge()?.reminders && (
                    <button
                      onClick={() => {
                        void bridge()?.reminders.snooze(t.reminderId!, 10);
                        dismissToast(t.id);
                      }}
                      className="micro border border-white/25 text-fog/70 px-2.5 py-1.5 hover:border-mint hover:text-mint transition-colors"
                    >
                      SNOOZE 10M
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ShellContext.Provider>
  );
}
