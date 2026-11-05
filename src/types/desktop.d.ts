/**
 * Typings for the Electron preload bridge (window.waypoint).
 * Exposed via contextBridge with contextIsolation enabled — the renderer
 * never receives direct Node.js access. When the app runs in a plain
 * browser (web preview), `window.waypoint` is undefined and every feature
 * degrades gracefully to web-local behaviour.
 */

export interface WaypointNotification {
  title: string;
  body: string;
}

export type ReminderState = "delivered" | "snoozed" | "missed" | "cancelled";

/** One row of the main-process delivery ledger. */
export interface ReminderHistoryEntry {
  id: string;
  kind: "task" | "event";
  entryId: string;
  title: string;
  occurrenceDate: string;
  scheduledTime: string;
  scheduledAt: number;
  offset: number;
  fireAt: number;
  state: ReminderState;
  deliveredAt?: number;
  missedAt?: number;
  cancelledAt?: number;
  snoozeUntil?: number;
  snoozeCount?: number;
}

export interface SchedulerStatus {
  running: boolean;
  lastScanAt: number;
  upcoming: number;
  unschedulable: { kind: string; entryId: string; title: string; reason: string }[];
  nextWakeAt: number | null;
}

export interface DeliveredReminder {
  id: string;
  kind: "task" | "event";
  entryId: string;
  title: string;
  body: string;
  missed: boolean;
  occurrenceDate: string;
  scheduledTime: string;
  offset: number;
}

export interface ReminderActionMsg {
  cmd: "complete-task" | "open-entry";
  kind: "task" | "event";
  entryId: string;
}

export interface WaypointBridge {
  auth: {
    appearance(): Promise<"light" | "dark" | "system">;
    status(): Promise<boolean>;
    create(operator: string, key: string): Promise<void>;
    verify(operator: string, key: string): Promise<boolean>;
    verifySettings(key: string): Promise<boolean>;
  };
  platform: NodeJS.Platform | string;
  versions: { electron: string; chrome: string; app: string };
  /** Fire an OS-level notification (Windows Action Center). */
  notify: (n: WaypointNotification) => Promise<boolean>;
  /** Windows "launch at login" integration. */
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  /** File-backed key/value storage inside the OS user-data directory. */
  storage: {
    read: (key: string) => Promise<string | null>;
    write: (key: string, value: string) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  briefingSnapshot(): Promise<string | null>;
  /** Runtime capability report (drives the Settings › System Integration panel). */
  capabilities: () => Promise<{
    notifications: boolean;
    autoLaunch: boolean;
    tray: boolean;
    briefing: boolean;
    storage: boolean;
    backgroundScheduler?: boolean;
    toastActions?: boolean;
  }>;

  /** Background reminder engine (main process). */
  reminders: {
    history: (limit?: number) => Promise<ReminderHistoryEntry[]>;
    clearHistory: () => Promise<boolean>;
    snooze: (id: string, minutes: number) => Promise<boolean>;
    status: () => Promise<SchedulerStatus>;
    rescan: () => Promise<boolean>;
    test: () => Promise<boolean>;
    testSound: (choice?: string) => Promise<boolean>;
    cancelEntry: (entryId: string) => Promise<boolean>;
  };
  onReminderDelivered: (cb: (p: DeliveredReminder) => void) => () => void;
  onReminderAction: (cb: (a: ReminderActionMsg) => void) => () => void;
  /** Show/restore the main console window from the briefing popup. */
  openMain: () => Promise<void>;
  /** Close only the briefing window (app keeps running via the tray). */
  briefingDismiss: () => Promise<void>;
  /** Open (or focus) the Daily Briefing window on demand. */
  openBriefing: () => Promise<void>;
  bootComplete: () => void;
  /** Sent once after the console renderer subscribes to tray directives. */
  rendererReady: () => void;
  /** Main-process push: tray "Add Task / Add Event" requests. Returns an unsubscribe fn. */
  onOpenCreate: (cb: (kind: "task" | "event") => void) => () => void;
}

declare global {
  interface Window {
    waypoint?: WaypointBridge;
  }
}

export {};
