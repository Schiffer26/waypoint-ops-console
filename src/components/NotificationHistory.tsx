/**
 * NOTIFICATION LEDGER — delivered / snoozed / missed reminder history.
 *
 * Rendered as a slide-over so it integrates into the existing Settings page
 * without adding navigation. Data comes from the main-process delivery
 * ledger (waypoint-reminder-ledger.json) — clearing it never touches tasks
 * or events.
 */
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellOff, BellRing, Clock, History, RotateCcw } from "lucide-react";
import type { ReminderHistoryEntry, ReminderState } from "@/types/desktop";
import { offsetLabel } from "@/types";
import { bridge, isDesktop } from "@/lib/storage";
import { useOpsStore } from "@/store/useOpsStore";
import { fmtStamp } from "@/lib/time";
import { SlideOver } from "@/components/ui/Modal";
import { Btn, EmptyState, Micro, StatusDot } from "@/components/ui/primitives";
import { EASE } from "@/lib/motion";
import { cn } from "@/utils/cn";

type Filter = "all" | ReminderState;

const STATE_STYLE: Record<ReminderState, string> = {
  delivered: "bg-mint text-acidink border-acidink",
  missed: "bg-acid text-acidink border-acidink",
  snoozed: "bg-chrome text-acid border-chrome",
  cancelled: "tag-outline",
};

export default function NotificationHistory({ onClose }: { onClose: () => void }) {
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const [rows, setRows] = useState<ReminderHistoryEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const b = bridge();
    if (!b?.reminders) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setRows(await b.reminders.history(200));
    } catch {
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  const shown = rows.filter((r) => filter === "all" || r.state === filter);
  const counts = {
    delivered: rows.filter((r) => r.state === "delivered").length,
    missed: rows.filter((r) => r.state === "missed").length,
    snoozed: rows.filter((r) => r.state === "snoozed").length,
  };

  return (
    <SlideOver
      subtitle="REMINDER ENGINE // DELIVERY LEDGER"
      title="Notification History"
      onClose={onClose}
      footer={
        <>
          <Micro>
            {rows.length} RECORD{rows.length === 1 ? "" : "S"} ON LEDGER
          </Micro>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => void load()}>
              <RotateCcw size={11} /> REFRESH
            </Btn>
            <Btn
              variant="dark"
              disabled={rows.length === 0}
              onClick={async () => {
                await bridge()?.reminders.clearHistory();
                void load();
              }}
            >
              CLEAR HISTORY
            </Btn>
          </div>
        </>
      }
    >
      {!isDesktop() ? (
        <EmptyState
          title="LEDGER UNAVAILABLE IN WEB PREVIEW"
          hint="The delivery ledger lives in the Electron main process. Run the desktop build to inspect it."
        />
      ) : (
        <>
          {/* counters */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              { k: "delivered" as const, label: "DELIVERED", icon: BellRing, n: counts.delivered },
              { k: "missed" as const, label: "MISSED", icon: BellOff, n: counts.missed },
              { k: "snoozed" as const, label: "SNOOZED", icon: Clock, n: counts.snoozed },
            ].map((c) => (
              <button
                key={c.k}
                onClick={() => setFilter(filter === c.k ? "all" : c.k)}
                className={cn(
                  "border px-3 py-2.5 text-left transition-colors",
                  filter === c.k ? "border-ink bg-surface2" : "border-line hover:border-ink",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <c.icon size={11} className="text-mute" />
                  <Micro>{c.label}</Micro>
                </div>
                <div className="font-display font-bold text-2xl tnum mt-1">{c.n}</div>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-3">
            <Micro>{filter === "all" ? "ALL RECORDS" : `FILTER: ${filter.toUpperCase()}`}</Micro>
            <span className="h-px flex-1 bg-line" />
            {filter !== "all" && (
              <button
                className="micro text-mute hover:text-ink transition-colors"
                onClick={() => setFilter("all")}
              >
                RESET
              </button>
            )}
          </div>

          {loading ? (
            <Micro className="block py-6 text-center">READING LEDGER…</Micro>
          ) : shown.length === 0 ? (
            <EmptyState
              title="NO RECORDS"
              hint="Delivered, snoozed and missed reminders are logged here automatically."
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {shown.map((r) => {
                  const ts = r.deliveredAt ?? r.missedAt ?? r.snoozeUntil ?? r.fireAt;
                  return (
                    <motion.div
                      key={r.id}
                      layout="position"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="border border-line bg-surface px-3.5 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-display font-semibold text-[13px] truncate">
                            {r.title}
                          </div>
                          <Micro className="block mt-1">
                            {r.kind === "task" ? "TASK" : "EVENT"} · {r.occurrenceDate} ·{" "}
                            {r.scheduledTime} · {offsetLabel(r.offset)}
                          </Micro>
                        </div>
                        <span className={cn("tag border flex-none", STATE_STYLE[r.state])}>
                          {r.state === "snoozed" && <StatusDot color="var(--color-acid)" />}
                          {r.state.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-dashed border-line">
                        <Micro className="tnum">
                          {r.state === "snoozed" ? "RESUMES " : ""}
                          {fmtStamp(ts, hour24)}
                        </Micro>
                        {(r.snoozeCount ?? 0) > 0 && (
                          <Micro className="tnum">SNOOZED x{r.snoozeCount}</Micro>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
          <div className="flex items-start gap-2 mt-5 pt-4 border-t border-dashed border-line">
            <History size={12} className="text-mute mt-0.5 flex-none" />
            <Micro className="normal-case tracking-wide text-mute/80">
              Clearing the history removes delivery records only. Tasks, events and pending
              snoozes are preserved.
            </Micro>
          </div>
        </>
      )}
    </SlideOver>
  );
}
