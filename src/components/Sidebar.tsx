import emblem from "@/assets/waypoint-emblem.png";
/**
 * Vertical operations navigation — charcoal identity rail with numbered
 * mono-labeled sections and live system status footer.
 */
import { useRef } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  LayoutDashboard,
  ListChecks,
  Settings,
} from "lucide-react";
import type { PageKey } from "@/types";
import { useNow } from "@/hooks/useNow";
import { useOpsStore } from "@/store/useOpsStore";
import { fmtClock, toISODate } from "@/lib/time";
import { isDesktop, resolveStorageBackend } from "@/lib/storage";
import { StatusDot } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

const NAV: { key: PageKey; idx: string; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", idx: "01", label: "Dashboard", icon: LayoutDashboard },
  { key: "tasks", idx: "02", label: "Tasks", icon: ListChecks },
  { key: "calendar", idx: "03", label: "Calendar", icon: Calendar },
  { key: "events", idx: "04", label: "Upcoming", icon: CalendarClock },
  { key: "completed", idx: "05", label: "Completed", icon: CheckCircle2 },
  { key: "settings", idx: "06", label: "Settings", icon: Settings },
];

export default function Sidebar({
  page,
  onNavigate,
}: {
  page: PageKey;
  onNavigate: (p: PageKey) => void;
}) {
  const now = useNow(1000);
  const mountedAt = useRef(Date.now());
  const hour24 = useOpsStore((s) => s.settings.hour24);
  const pending = useOpsStore((s) => s.tasks).filter((t) => !t.completed).length;

  const upMin = Math.max(0, Math.floor((now.getTime() - mountedAt.current) / 60000));
  const uptime = `${String(Math.floor(upMin / 60)).padStart(2, "0")}:${String(upMin % 60).padStart(2, "0")}`;

  return (
    <aside className="w-[76px] lg:w-[252px] flex-none bg-chrome text-fog flex flex-col border-r border-chrome relative z-20">
      {/* identity block */}
      <div className="px-4 lg:px-6 pt-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <img src={emblem} alt="" className="size-9 object-contain flex-none" />
          <div className="hidden lg:block min-w-0">
            <div className="font-display font-bold tracking-[0.28em] text-[15px] leading-none">
              WAYPOINT
            </div>
            <div className="micro text-fog/40 mt-1.5">OPS CONSOLE — v0.3.0</div>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 mt-5 micro text-fog/40">
          <StatusDot />
          LOCAL GRID — STABLE
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2.5 lg:px-3 overflow-y-auto">
        {NAV.map((item) => {
          const active = page === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={cn(
                "relative flex items-center gap-3 px-3 py-[11px] text-left transition-colors duration-200 group",
                active ? "text-fog" : "text-fog/45 hover:text-fog",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-edge"
                  className="absolute left-0 inset-y-1 w-[3px] bg-acid"
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
              <span
                className={cn(
                  "micro hidden xl:block w-5 text-right flex-none transition-colors",
                  active ? "text-acid" : "text-fog/30 group-hover:text-fog/60",
                )}
              >
                {item.idx}
              </span>
              <Icon
                size={15}
                className={cn(
                  "flex-none transition-colors",
                  active ? "text-acid" : "text-fog/40 group-hover:text-fog",
                )}
              />
              <span className="hidden lg:block font-display font-semibold text-[12px] tracking-[0.2em] uppercase flex-1 truncate">
                {item.label}
              </span>
              {item.key === "tasks" && pending > 0 && (
                <span className="hidden lg:grid micro bg-white/10 text-fog/80 px-1.5 py-0.5 place-items-center">
                  {pending}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* system footer */}
      <div className="border-t border-white/10 px-4 lg:px-6 py-4 space-y-2.5">
        <div className="hidden lg:block space-y-2">
          <div className="flex justify-between micro text-fog/40">
            <span className="flex items-center gap-2">
              <StatusDot /> SYS.NOMINAL
            </span>
            <span className="tnum">UP {uptime}</span>
          </div>
          <div className="micro text-fog/40">
            STORAGE // {resolveStorageBackend().name}
          </div>
          <div className="micro">
            <span className="text-fog/40">DESKTOP LINK // </span>
            {isDesktop() ? (
              <span className="text-mint">LIVE</span>
            ) : (
              <span className="text-fog/60">STANDBY — WEB PREVIEW</span>
            )}
          </div>
          <div className="h-px bg-white/10 my-1" />
          <div className="font-mono tnum text-xl text-fog">{fmtClock(now, hour24)}</div>
          <div className="micro text-fog/40">{toISODate(now)}</div>
        </div>
        <div className="lg:hidden flex justify-center">
          <StatusDot />
        </div>
      </div>
    </aside>
  );
}
