/**
 * WAYPOINT — background reminder scheduler (Electron main process).
 *
 * Thin shell around the pure engine in reminder-core.ts:
 *   • reads the renderer-owned DB (read-only) + its own ledger
 *   • asks the engine for a plan
 *   • delivers native notifications and persists the outcome
 *
 * Runs entirely in the main process, so reminders fire with the dashboard
 * minimised, hidden to tray, or never opened at all. A single 15s interval
 * plus event-driven rescans (data change / power resume / snooze) — no
 * per-entry timers, so thousands of reminders cost nothing.
 */
import { BrowserWindow, Notification, app, powerMonitor } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDb } from "./db-reader.js";
import { readLedger, writeLedgerAtomic } from "./ledger-store.js";
import {
  applySnooze,
  buildInstances,
  cancelForEntry,
  markCancelled,
  markDelivered,
  markExpired,
  notificationBody,
  planReminders,
  pruneLedger,
  type Ledger,
  type LedgerEntry,
  type ReminderInstance,
} from "./reminder-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TICK_MS = 15_000;
/** Write-burst coalescing window for trailing rescans. */
const COALESCE_MS = 400;
const LOOKAHEAD_MS = 2 * 86400000;
const LOOKBACK_MS = 25 * 3600000;

export type SoundChoice = "subtle" | "system" | "silent";

export interface DeliveredPayload {
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

export interface ReminderAction {
  cmd: "complete-task" | "open-entry";
  kind: "task" | "event";
  entryId: string;
}

export interface SchedulerHooks {
  /** Mirror a delivery into the console UI (in-app toast) when it is open. */
  onDelivered: (p: DeliveredPayload) => void;
  /** Action requiring the renderer (it owns all DB writes). */
  onAction: (a: ReminderAction) => void;
}

let hooks: SchedulerHooks | null = null;
let timer: NodeJS.Timeout | null = null;
let soundWindow: BrowserWindow | null = null;
let subtleWavB64: string | null = null;
let running = false;
let lastScanAt = 0;
let trailingTimer: NodeJS.Timeout | null = null;

/* ------------------------------------------------------------ helpers -- */

function userData(): string {
  return app.getPath("userData");
}

function loadLedger(): Ledger {
  return readLedger(userData());
}

function saveLedger(l: Ledger): void {
  writeLedgerAtomic(userData(), l);
}

function soundAssetPath(): string | null {
  const candidates = [
    path.join(__dirname, "../assets/notify-subtle.wav"),
    path.join(process.resourcesPath ?? "", "assets/notify-subtle.wav"),
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

function currentSound(): SoundChoice {
  const { db } = readDb(userData());
  const v = db.settings?.notificationSound;
  return v === "system" || v === "silent" ? v : "subtle";
}

/* -------------------------------------------------------------- sound -- */
/**
 * Windows toast XML can only reference built-in ms-winsoundevent sounds;
 * custom audio files are an MSIX-only feature, so the bundled SUBTLE tone is
 * played through a hidden renderer (the toast itself is muted). Any failure
 * here is swallowed — sound must never block a notification.
 */
function playSubtle(): void {
  try {
    if (!subtleWavB64) {
      const p = soundAssetPath();
      if (!p) return;
      subtleWavB64 = readFileSync(p).toString("base64");
    }
    if (!soundWindow || soundWindow.isDestroyed()) {
      soundWindow = new BrowserWindow({
        show: false,
        width: 0,
        height: 0,
        webPreferences: {
          offscreen: false,
          sandbox: true,
          contextIsolation: true,
          // A hidden window has no user gesture; without this Chromium's
          // autoplay policy silently blocks the tone on Windows.
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      void soundWindow.loadURL("data:text/html,<html><body></body></html>");
    }
    const run = () => {
      soundWindow?.webContents
        .executeJavaScript(
          `(() => { const a = new Audio("data:audio/wav;base64,${subtleWavB64}"); a.volume = 0.5; a.play().catch(() => {}); })()`,
        )
        .catch(() => {});
    };
    if (soundWindow.webContents.isLoading()) soundWindow.webContents.once("did-finish-load", run);
    else run();
  } catch {
    /* sound is strictly best-effort */
  }
}

/* ------------------------------------------------------- notifications -- */

const xmlEscape = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );

function buildToastXml(
  title: string,
  body: string,
  kind: "task" | "event",
  rid: string,
  sound: SoundChoice,
): string {
  const open = `waypoint://open?rid=${encodeURIComponent(rid)}`;
  const actions: string[] = [];
  if (kind === "task") {
    actions.push(
      `<action content="Mark complete" activationType="protocol" arguments="${xmlEscape(`waypoint://complete?rid=${encodeURIComponent(rid)}`)}"/>`,
    );
  }
  actions.push(
    `<action content="Snooze 10 min" activationType="protocol" arguments="${xmlEscape(`waypoint://snooze?rid=${encodeURIComponent(rid)}&min=10`)}"/>`,
  );
  actions.push(
    `<action content="${kind === "task" ? "Open task" : "Open event"}" activationType="protocol" arguments="${xmlEscape(open)}"/>`,
  );
  const audio =
    sound === "system"
      ? `<audio src="ms-winsoundevent:Notification.Default"/>`
      : `<audio silent="true"/>`;
  return `<toast launch="${xmlEscape(open)}" activationType="protocol">
  <visual><binding template="ToastGeneric">
    <text>${xmlEscape(title)}</text>
    <text>${xmlEscape(body)}</text>
  </binding></visual>
  <actions>${actions.join("")}</actions>
  ${audio}
</toast>`;
}

function deliver(
  title: string,
  body: string,
  kind: "task" | "event",
  rid: string,
  entryId: string,
): void {
  const sound = currentSound();

  // Test recorder (enabled only under WAYPOINT_TEST) — lets the live suite
  // observe dispatch decisions without a desktop notification daemon.
  if (process.env.WAYPOINT_TEST === "1") {
    const g = globalThis as Record<string, unknown>;
    const log = (g.__waypointSent as unknown[]) ?? [];
    log.push({
      title,
      body,
      kind,
      rid,
      entryId,
      sound,
      hasToastXml: process.platform === "win32",
    });
    g.__waypointSent = log;
  }

  if (!Notification.isSupported()) return;
  const silentFlag = sound !== "system";

  let n: Notification;
  if (process.platform === "win32") {
    n = new Notification({
      title,
      body,
      silent: silentFlag,
      toastXml: buildToastXml(title, body, kind, rid, sound),
    });
  } else {
    n = new Notification({ title, body, silent: silentFlag });
  }
  // Clicking the toast body (non-Windows, or Windows without protocol route).
  n.on("click", () => hooks?.onAction({ cmd: "open-entry", kind, entryId }));
  n.show();
  if (sound === "subtle") playSubtle();
}

/* ----------------------------------------------------------- the scan -- */

export function scan(reason: string): void {
  if (!app.isReady()) return;
  lastScanAt = Date.now();
  const now = Date.now();
  const { db, ok } = readDb(userData());
  if (!ok) return; // database not written yet — nothing to schedule

  const settings = db.settings ?? {};
  const notificationsEnabled = settings.notificationsEnabled !== false;
  const catchUpEnabled = settings.catchUpMissed !== false;
  const consolidate = settings.consolidateMissed !== false;

  const { instances } = buildInstances(db, now - LOOKBACK_MS, now + LOOKAHEAD_MS);
  const ledger = loadLedger();
  const plan = planReminders(instances, ledger, {
    now,
    notificationsEnabled,
    catchUpEnabled,
  });

  let dirty = false;

  // 1 — on-time deliveries
  for (const inst of plan.due) {
    deliver(
      `WAYPOINT — ${inst.title}`,
      notificationBody(inst, false),
      inst.kind,
      inst.id,
      inst.entryId,
    );
    markDelivered(ledger, inst, now, "delivered");
    hooks?.onDelivered({
      id: inst.id,
      kind: inst.kind,
      entryId: inst.entryId,
      title: inst.title,
      body: notificationBody(inst, false),
      missed: false,
      occurrenceDate: inst.occurrenceDate,
      scheduledTime: inst.scheduledTime,
      offset: inst.offset,
    });
    dirty = true;
  }

  // 2 — snoozed reminders whose time has come
  for (const rec of plan.snoozeDue) {
    const body = `SNOOZED · ${rec.kind === "task" ? "Due" : "Starts"} ${rec.occurrenceDate} · ${rec.scheduledTime}`;
    deliver(`WAYPOINT — ${rec.title}`, body, rec.kind, rec.id, rec.entryId);
    ledger.entries[rec.id] = {
      ...rec,
      state: "delivered",
      deliveredAt: now,
      snoozeUntil: undefined,
    };
    hooks?.onDelivered({
      id: rec.id,
      kind: rec.kind,
      entryId: rec.entryId,
      title: rec.title,
      body,
      missed: false,
      occurrenceDate: rec.occurrenceDate,
      scheduledTime: rec.scheduledTime,
      offset: rec.offset,
    });
    dirty = true;
  }

  // 3 — missed (downtime catch-up), consolidated when numerous
  if (plan.missed.length > 0) {
    if (consolidate && plan.missed.length > 3) {
      const first = plan.missed[0];
      const titles = plan.missed
        .slice(0, 3)
        .map((m) => m.title)
        .join(", ");
      deliver(
        `WAYPOINT — ${plan.missed.length} missed reminders`,
        `While WAYPOINT was offline: ${titles}${plan.missed.length > 3 ? ` +${plan.missed.length - 3} more` : ""}`,
        first.kind,
        first.id,
        first.entryId,
      );
    } else {
      for (const inst of plan.missed) {
        deliver(
          `WAYPOINT — ${inst.title}`,
          notificationBody(inst, true),
          inst.kind,
          inst.id,
          inst.entryId,
        );
      }
    }
    for (const inst of plan.missed) {
      markDelivered(ledger, inst, now, "missed");
      hooks?.onDelivered({
        id: inst.id,
        kind: inst.kind,
        entryId: inst.entryId,
        title: inst.title,
        body: notificationBody(inst, true),
        missed: true,
        occurrenceDate: inst.occurrenceDate,
        scheduledTime: inst.scheduledTime,
        offset: inst.offset,
      });
    }
    dirty = true;
  }

  // 4 — housekeeping: expired + cancelled
  for (const inst of plan.expire) {
    markExpired(ledger, inst, now);
    dirty = true;
  }
  for (const id of plan.cancel) {
    markCancelled(ledger, id, now);
    dirty = true;
  }

  if (dirty) {
    saveLedger(pruneLedger(ledger, now));
    console.log(
      `[waypoint:reminders] scan(${reason}) due=${plan.due.length} snoozed=${plan.snoozeDue.length} missed=${plan.missed.length} cancelled=${plan.cancel.length}`,
    );
  }
}

/* ------------------------------------------------------------- public -- */

export function startScheduler(h: SchedulerHooks): void {
  if (running) return;
  hooks = h;
  running = true;

  scan("startup"); // initial scan incl. 24h missed catch-up

  timer = setInterval(() => scan("tick"), TICK_MS);

  // Windows sleep / resume: the interval is unreliable across suspend, so
  // recalculate the whole schedule the moment the machine comes back.
  try {
    powerMonitor.on("resume", () => scan("power-resume"));
    powerMonitor.on("unlock-screen", () => scan("unlock"));
  } catch {
    /* powerMonitor unavailable on this platform */
  }
  console.log("[waypoint:reminders] scheduler started");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (trailingTimer) clearTimeout(trailingTimer);
  trailingTimer = null;
  running = false;
  if (soundWindow && !soundWindow.isDestroyed()) soundWindow.destroy();
  soundWindow = null;
}

/**
 * Called right after the renderer persists the DB — recalculates at once.
 *
 * Writes arrive in bursts (zustand persists on every store mutation), so
 * calls inside the coalescing window are collapsed into a single TRAILING
 * rescan rather than dropped — the last write of a burst must never be
 * missed, otherwise a new reminder could wait up to a full tick.
 */
export function requestRescan(reason = "data-change"): void {
  const since = Date.now() - lastScanAt;
  if (since < COALESCE_MS) {
    if (trailingTimer) return;
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      scan(`${reason}:trailing`);
    }, COALESCE_MS - since);
    return;
  }
  scan(reason);
}

export function snoozeReminder(id: string, minutes: number): boolean {
  const now = Date.now();
  const ledger = loadLedger();
  if (!ledger.entries[id]) {
    // Snoozing a reminder that was delivered before a restart: rebuild it.
    const { db } = readDb(userData());
    const { instances } = buildInstances(db, now - LOOKBACK_MS, now + LOOKAHEAD_MS);
    const match = instances.find((i) => i.id === id);
    if (!match) return false;
    applySnooze(ledger, id, minutes, now, match);
  } else {
    applySnooze(ledger, id, minutes, now);
  }
  saveLedger(pruneLedger(ledger, now));
  console.log(`[waypoint:reminders] snoozed ${id} +${minutes}m`);
  return true;
}

/** Cancel pending reminders for an entry (task completed / entry deleted). */
export function cancelEntryReminders(entryId: string): void {
  const ledger = loadLedger();
  cancelForEntry(ledger, entryId, Date.now());
  saveLedger(ledger);
}

export function getHistory(limit = 200): LedgerEntry[] {
  const ledger = loadLedger();
  return Object.values(ledger.entries)
    .filter((e) => e.state !== "cancelled")
    .sort((a, b) => {
      const ta = a.deliveredAt ?? a.missedAt ?? a.snoozeUntil ?? a.fireAt;
      const tb = b.deliveredAt ?? b.missedAt ?? b.snoozeUntil ?? b.fireAt;
      return tb - ta;
    })
    .slice(0, limit);
}

export function clearHistory(): void {
  const ledger = loadLedger();
  const keep: Ledger = { version: ledger.version, entries: {} };
  // Snoozed reminders are pending work, not history — they survive a clear.
  for (const e of Object.values(ledger.entries)) {
    if (e.state === "snoozed") keep.entries[e.id] = e;
  }
  saveLedger(keep);
}

/** Diagnostics for Settings: entries that cannot be scheduled, and counts. */
export function schedulerStatus(): {
  running: boolean;
  lastScanAt: number;
  upcoming: number;
  unschedulable: { kind: string; entryId: string; title: string; reason: string }[];
  nextWakeAt: number | null;
} {
  const now = Date.now();
  const { db } = readDb(userData());
  const { instances, unschedulable } = buildInstances(db, now - LOOKBACK_MS, now + LOOKAHEAD_MS);
  const ledger = loadLedger();
  const plan = planReminders(instances, ledger, { now });
  return {
    running,
    lastScanAt,
    upcoming: instances.filter((i) => i.fireAt > now && !ledger.entries[i.id]).length,
    unschedulable,
    nextWakeAt: plan.nextWakeAt,
  };
}

export function testNotification(): boolean {
  if (!Notification.isSupported()) return false;
  const sound = currentSound();
  const n = new Notification({
    title: "WAYPOINT — SYSTEM CHECK",
    body: "Background reminder engine is operational.",
    silent: sound !== "system",
  });
  n.show();
  if (sound === "subtle") playSubtle();
  return true;
}

export function testSound(choice?: SoundChoice): boolean {
  const sound = choice ?? currentSound();
  if (sound === "silent") return true;
  if (sound === "subtle") {
    if (!soundAssetPath()) return false;
    playSubtle();
    return true;
  }
  // SYSTEM: the Windows sound is owned by the toast itself.
  if (!Notification.isSupported()) return false;
  new Notification({
    title: "WAYPOINT — SOUND TEST",
    body: "Standard Windows notification sound.",
    silent: false,
  }).show();
  return true;
}

export function resolveInstanceById(id: string): ReminderInstance | null {
  const now = Date.now();
  const { db } = readDb(userData());
  const { instances } = buildInstances(db, now - LOOKBACK_MS, now + LOOKAHEAD_MS);
  return instances.find((i) => i.id === id) ?? null;
}
