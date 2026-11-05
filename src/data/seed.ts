/**
 * First-run seed data. Dates are generated relative to "today" so the console
 * boots into a live, believable operations state. Only written when no
 * persisted store exists — never overwrites user data.
 */
import type { Category, EventEntry, OpsData, TaskEntry } from "@/types";
import { addDaysISO, todayISO } from "@/lib/time";
import { uid } from "@/lib/storage";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "cat-ops", code: "OPS", name: "Operations", color: "#FFFA00" },
  { id: "cat-sys", code: "SYS", name: "Systems", color: "#00FFA2" },
  { id: "cat-res", code: "RES", name: "Research", color: "#191919" },
  { id: "cat-fld", code: "FLD", name: "Field Ops", color: "#FF7A00" },
  { id: "cat-log", code: "LOG", name: "Logistics", color: "#777777" },
];

export const CATEGORY_PALETTE = ["#FFFA00", "#00FFA2", "#191919", "#FF7A00", "#777777"];

export function buildSeed(): OpsData {
  const t0 = Date.now();
  const t = todayISO();
  let seq = 0;
  const stamp = () => t0 + seq++ * 1000;

  const task = (
    partial: Omit<TaskEntry, "id" | "kind" | "createdAt" | "updatedAt"> &
      Partial<Pick<TaskEntry, "createdAt" | "updatedAt">>,
  ): TaskEntry => ({
    id: uid(),
    kind: "task",
    createdAt: stamp(),
    updatedAt: stamp(),
    ...partial,
  });

  const event = (
    partial: Omit<EventEntry, "id" | "kind" | "createdAt" | "updatedAt">,
  ): EventEntry => ({
    id: uid(),
    kind: "event",
    createdAt: stamp(),
    updatedAt: stamp(),
    ...partial,
  });

  /** Reminder config helper — Stage-03 multi-offset shape. */
  const rem = (...offsets: number[]) => ({
    enabled: offsets.length > 0,
    minutesBefore: offsets[0] ?? 15,
    offsets,
  });
  const noReminder = rem();

  const tasks: TaskEntry[] = [
    task({
      title: "Review northern route logistics",
      description: "Cross-check convoy timing against depot capacity before the briefing.",
      date: t,
      dueTime: "10:00",
      categoryId: "cat-ops",
      priority: "high",
      reminder: rem(15, 30),
      repeat: "none",
      completed: false,
    }),
    task({
      title: "Calibrate sensor array — bay 04",
      description: "Full sweep and drift report. File results to the systems archive.",
      date: t,
      dueTime: "16:30",
      categoryId: "cat-sys",
      priority: "medium",
      reminder: noReminder,
      repeat: "weekly",
      completed: false,
    }),
    task({
      title: "Compile weekly operations summary",
      description: "Aggregate completion metrics and flag anomalies for review.",
      date: t,
      dueTime: "18:00",
      categoryId: "cat-res",
      priority: "medium",
      reminder: noReminder,
      repeat: "none",
      completed: false,
    }),
    task({
      title: "Restock filtration units",
      description: "Two pallets outstanding — confirm with logistics before end of day.",
      date: addDaysISO(t, -1),
      dueTime: "17:00",
      categoryId: "cat-log",
      priority: "medium",
      reminder: noReminder,
      repeat: "none",
      completed: false,
    }),
    task({
      title: "Audit comms relay uptime",
      description: "Uptime dipped below threshold on relay 3. Root-cause and patch.",
      date: addDaysISO(t, -2),
      dueTime: "12:00",
      categoryId: "cat-sys",
      priority: "critical",
      reminder: noReminder,
      repeat: "none",
      completed: false,
    }),
    task({
      title: "Submit expedition requisition",
      description: "Manifest for the sector K-9 survey — funds cleared last cycle.",
      date: addDaysISO(t, 1),
      dueTime: "11:00",
      categoryId: "cat-log",
      priority: "low",
      reminder: noReminder,
      repeat: "none",
      completed: false,
    }),
    task({
      title: "Terrain survey — sector K-9",
      description: "Recurring field pass. Upload telemetry after each sweep.",
      date: addDaysISO(t, 3),
      dueTime: "07:30",
      categoryId: "cat-fld",
      priority: "high",
      reminder: rem(60),
      repeat: "weekly",
      completed: false,
    }),
    task({
      title: "Morning systems check",
      description: "Routine integrity scan — all racks nominal.",
      date: t,
      dueTime: "06:30",
      categoryId: "cat-sys",
      priority: "low",
      reminder: noReminder,
      repeat: "daily",
      completed: true,
      completedAt: Date.now() - 3 * 3600000,
    }),
    task({
      title: "Update navigation charts",
      description: "Fold latest route deltas into the master chart set.",
      date: addDaysISO(t, -1),
      dueTime: "15:00",
      categoryId: "cat-res",
      priority: "low",
      reminder: noReminder,
      repeat: "none",
      completed: true,
      completedAt: Date.now() - 20 * 3600000,
    }),
    task({
      title: "Distribute rations manifest",
      description: "Manifest circulated to all section leads.",
      date: addDaysISO(t, -1),
      dueTime: "09:00",
      categoryId: "cat-log",
      priority: "medium",
      reminder: noReminder,
      repeat: "none",
      completed: true,
      completedAt: Date.now() - 26 * 3600000,
    }),
  ];

  const events: EventEntry[] = [
    event({
      title: "Shift briefing — deck 02",
      description: "Daily alignment: routes, weather windows, staffing.",
      date: t,
      startTime: "13:00",
      endTime: "13:30",
      categoryId: "cat-ops",
      priority: "high",
      reminder: rem(15),
      repeat: "daily",
    }),
    event({
      title: "Perimeter inspection drill",
      description: "Quarter-schedule readiness drill, sectors 4 through 7.",
      date: addDaysISO(t, 1),
      startTime: "09:00",
      endTime: "10:30",
      categoryId: "cat-fld",
      priority: "medium",
      reminder: rem(30),
      repeat: "weekly",
    }),
    event({
      title: "Supply convoy arrival window",
      description: "Inbound manifest 88-C. Dock crew on standby.",
      date: addDaysISO(t, 2),
      startTime: "14:00",
      endTime: "15:00",
      categoryId: "cat-log",
      priority: "medium",
      reminder: noReminder,
      repeat: "none",
    }),
    event({
      title: "Comms uplink sync",
      description: "Encrypted handshake with relay north. Do not interrupt power.",
      date: addDaysISO(t, 4),
      startTime: "20:00",
      endTime: "21:00",
      categoryId: "cat-sys",
      priority: "critical",
      reminder: rem(30),
      repeat: "none",
    }),
    event({
      title: "Quarterly route planning session",
      description: "Long-range planning with all section leads.",
      date: addDaysISO(t, 7),
      startTime: "08:00",
      endTime: "10:00",
      categoryId: "cat-res",
      priority: "high",
      reminder: noReminder,
      repeat: "none",
    }),
  ];

  return {
    tasks,
    events,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    settings: {
      operatorName: "OPERATOR",
      hour24: true,
      weekStartsOn: 1,
      theme: "system",
      briefingAtLogin: true,
      notificationsEnabled: true,
      notificationSound: "subtle",
      catchUpMissed: true,
      consolidateMissed: true,
    },
  };
}
