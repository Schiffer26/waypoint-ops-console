/**
 * WAYPOINT — preload bridge (CommonJS for sandbox compatibility).
 *
 * Exposes a strictly typed `window.waypoint` surface via contextBridge.
 * The renderer runs with contextIsolation ON and nodeIntegration OFF —
 * this file is the only communication channel.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export interface NotifyPayload {
  title: string;
  body: string;
}

export type CreateKind = "task" | "event";

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    app: "0.3.0",
  },

  auth: {
    appearance: (): Promise<"light" | "dark" | "system"> => ipcRenderer.invoke("waypoint:auth:appearance"),
    status: (): Promise<boolean> => ipcRenderer.invoke("waypoint:auth:status"),
    create: (operator: string, key: string): Promise<void> => ipcRenderer.invoke("waypoint:auth:create", operator, key),
    verify: (operator: string, key: string): Promise<boolean> => ipcRenderer.invoke("waypoint:auth:verify", operator, key),
  },

  /** Windows Action Center notification via the main process. */
  notify: (payload: NotifyPayload): Promise<boolean> =>
    ipcRenderer.invoke("waypoint:notify", payload),

  /** Windows launch-at-login registration (with matching startup args). */
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke("waypoint:autoLaunch:get"),
  setAutoLaunch: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("waypoint:autoLaunch:set", enabled),

  /** File-backed persistence inside the OS user-data directory. */
  storage: {
    read: (key: string): Promise<string | null> => ipcRenderer.invoke("waypoint:storage:read", key),
    write: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke("waypoint:storage:write", key, value),
    remove: (key: string): Promise<void> => ipcRenderer.invoke("waypoint:storage:remove", key),
  },

  briefingSnapshot: (): Promise<string | null> => ipcRenderer.invoke("waypoint:briefing:snapshot"),

  /** Capability report consumed by Settings › System Integration. */
  capabilities: (): Promise<{
    notifications: boolean;
    autoLaunch: boolean;
    tray: boolean;
    briefing: boolean;
    storage: boolean;
  }> => ipcRenderer.invoke("waypoint:capabilities"),

  /** Briefing window ↔ main console window hand-offs. */
  openMain: (): Promise<void> => ipcRenderer.invoke("waypoint:open-main"),
  briefingDismiss: (): Promise<void> => ipcRenderer.invoke("waypoint:briefing:dismiss"),
  openBriefing: (): Promise<void> => ipcRenderer.invoke("waypoint:briefing:open"),

  /** Presentation completion only; does not grant a session. */
  bootComplete: (): void => ipcRenderer.send("waypoint:boot-complete"),

  /**
   * Readiness handshake: the console renderer sends this once it has
   * subscribed to tray directives, letting the main process flush any
   * queued "Add Task / Add Event" request safely.
   */
  rendererReady: (): void => {
    ipcRenderer.send("waypoint:renderer-ready");
  },

  /** Tray "Add Task / Add Event" → console entry editor. */
  onOpenCreate: (cb: (kind: CreateKind) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, kind: CreateKind) => cb(kind);
    ipcRenderer.on("waypoint:open-create", listener);
    return () => ipcRenderer.removeListener("waypoint:open-create", listener);
  },

  /* ------------------------- background reminder engine ---------------- */
  reminders: {
    /** Delivery ledger (delivered / snoozed / missed), newest first. */
    history: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke("waypoint:reminders:history", limit),
    clearHistory: (): Promise<boolean> => ipcRenderer.invoke("waypoint:reminders:clear-history"),
    snooze: (id: string, minutes: number): Promise<boolean> =>
      ipcRenderer.invoke("waypoint:reminders:snooze", id, minutes),
    status: (): Promise<unknown> => ipcRenderer.invoke("waypoint:reminders:status"),
    rescan: (): Promise<boolean> => ipcRenderer.invoke("waypoint:reminders:rescan"),
    test: (): Promise<boolean> => ipcRenderer.invoke("waypoint:reminders:test"),
    testSound: (choice?: string): Promise<boolean> =>
      ipcRenderer.invoke("waypoint:reminders:test-sound", choice),
    cancelEntry: (entryId: string): Promise<boolean> =>
      ipcRenderer.invoke("waypoint:reminders:cancel-entry", entryId),
  },

  /** Main → renderer: a reminder was just delivered (mirrors the in-app toast). */
  onReminderDelivered: (cb: (p: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on("waypoint:reminder-delivered", listener);
    return () => ipcRenderer.removeListener("waypoint:reminder-delivered", listener);
  },

  /** Main → renderer: notification action requiring a DB write / navigation. */
  onReminderAction: (cb: (a: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, a: unknown) => cb(a);
    ipcRenderer.on("waypoint:reminder-action", listener);
    return () => ipcRenderer.removeListener("waypoint:reminder-action", listener);
  },
};

contextBridge.exposeInMainWorld("waypoint", api);
