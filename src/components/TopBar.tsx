/**
 * Command strip across the top of the content zone: breadcrumb path,
 * quick-add actions.
 */
import { CalendarPlus, Plus } from "lucide-react";
import type { PageKey } from "@/types";
import { useShell } from "@/lib/shell";
import { Btn, Micro, StatusDot } from "@/components/ui/primitives";

export const PAGE_META: Record<PageKey, { code: string; title: string }> = {
  dashboard: { code: "01", title: "DASHBOARD" },
  tasks: { code: "02", title: "TASK REGISTRY" },
  calendar: { code: "03", title: "CALENDAR MATRIX" },
  events: { code: "04", title: "UPCOMING EVENTS" },
  completed: { code: "05", title: "COMPLETED LOG" },
  settings: { code: "06", title: "SETTINGS" },
};

export default function TopBar({ page }: { page: PageKey }) {
  const shell = useShell();
  const meta = PAGE_META[page];
  return (
    <div className="h-[52px] flex-none border-b border-frame bg-paper/85 backdrop-blur flex items-center justify-between gap-4 px-4 lg:px-8 relative z-10">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-2.5 h-2.5 bg-acid border border-acidink flex-none" />
        <Micro className="truncate">
          WPT://{meta.code}/{meta.title}
        </Micro>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 mr-3">
          <StatusDot />
          <Micro>UPLINK: LOCAL-ONLY</Micro>
        </div>
        <Btn variant="dark" onClick={() => shell.openCreate("task")} className="px-3!">
          <Plus size={12} />
          <span className="hidden sm:inline">Task</span>
        </Btn>
        <Btn variant="acid" onClick={() => shell.openCreate("event")} className="px-3!">
          <CalendarPlus size={12} />
          <span className="hidden sm:inline">Event</span>
        </Btn>
      </div>
    </div>
  );
}
