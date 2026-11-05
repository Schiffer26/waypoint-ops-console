/**
 * WAYPOINT — Electron main process (Stage 02A.1).
 *
 * Window manager:
 *  - Main console window (hides to tray on close, restores via tray/click).
 *  - Compact frameless Daily Briefing window (?window=briefing).
 *  - Hidden background operation with single-instance guard.
 *
 * Windows integration:
 *  - Launch-at-login registered with the `--waypoint-startup` argument;
 *    the same argument is passed to getLoginItemSettings when reading state.
 *  - Startup launches open the Daily Briefing gated on the user's persisted
 *    preference (decoded from the two-layer zustand KV file — see prefs.ts).
 *  - Tray: Show / Daily Briefing / Add Task / Quit. Tray actions use a
 *    renderer-readiness handshake so directives are never lost.
 *
 * Security: contextIsolation ON, nodeIntegration OFF, sandboxed preload;
 * the renderer only ever sees the typed window.waypoint bridge.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DB_KEY, STORE_FILE_NAME, parseBriefingPreference } from "./prefs.js";
import {
  cancelEntryReminders,
  clearHistory,
  getHistory,
  requestRescan,
  schedulerStatus,
  snoozeReminder,
  startScheduler,
  stopScheduler,
  testNotification,
  testSound,
  type DeliveredPayload,
  type ReminderAction,
  type SoundChoice,
} from "./scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const STARTUP_ARG = "--waypoint-startup";
const isStartupLaunch = process.argv.includes(STARTUP_ARG);

// Register waypoint:// so Windows toast buttons can activate the app even
// when it is not running. In dev the exec path must be passed explicitly.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("waypoint", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("waypoint");
}

let mainWindow: BrowserWindow | null = null;
let briefingWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

/* --- renderer directive pipeline -------------------------------------- */
type CreateKind = "task" | "event";
const PROTOCOL = "waypoint";

/** Directives queued until the console renderer signals readiness. */
interface Directive {
  channel: "waypoint:open-create" | "waypoint:reminder-action";
  payload: unknown;
}
let pendingDirectives: Directive[] = [];
/** True once the console renderer has mounted and subscribed via the bridge. */
let rendererReady = false;

function flushDirectives(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  const queue = pendingDirectives;
  pendingDirectives = [];
  for (const d of queue) {
    mainWindow.webContents.send(d.channel, d.payload);
    console.log(`[waypoint] directive dispatched → ${d.channel}`);
  }
}

/** Queue a directive and make sure a console window exists to receive it. */
function dispatchToRenderer(channel: Directive["channel"], payload: unknown): void {
  pendingDirectives.push({ channel, payload });
  showMainWindow();
  flushDirectives(); // no-op unless the renderer is already mounted
}

/* ---------------------------------------------------------------- assets */
function trayIconPath(): string | null {
  const candidates = [
    path.join(__dirname, "../assets/tray-icon.png"), // dev + packaged (files → asar)
    path.join(process.resourcesPath ?? "", "assets/tray-icon.png"), // extraResources fallback
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/* ------------------------------------------------------- settings access */
/**
 * Reads the renderer's persisted briefing preference directly from the
 * file-backed KV store. Two nested JSON layers — see electron/prefs.ts.
 */
function readBriefingPreference(): boolean {
  try {
    const file = path.join(app.getPath("userData"), STORE_FILE_NAME);
    if (!existsSync(file)) return true; // never saved → default ON
    return parseBriefingPreference(readFileSync(file, "utf-8"));
  } catch {
    return true; // malformed data fails open to the app default
  }
}

/* ------------------------------------------------------------ storage --- */
const storeFile = (): string => path.join(app.getPath("userData"), STORE_FILE_NAME);

type StoreShape = Record<string, string>;

function readStoreFile(): StoreShape {
  try {
    if (!existsSync(storeFile())) return {};
    const parsed = JSON.parse(readFileSync(storeFile(), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as StoreShape;
  } catch {
    return {};
  }
}

function writeStoreFile(data: StoreShape): void {
  mkdirSync(path.dirname(storeFile()), { recursive: true });
  writeFileSync(storeFile(), JSON.stringify(data), "utf-8");
}

/* ---------------------------------------------------------------- window */
function createMainWindow(show: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "WAYPOINT — Personal Operations Console",
    backgroundColor: "#F2F2EE",
    autoHideMenuBar: true,
    show: false,
    icon: trayIconPath() ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  rendererReady = false;

  if (show) {
    win.once("ready-to-show", () => {
      win.show();
      console.log("[waypoint] console window opened");
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Closing the console hides it to the tray; only a genuine quit proceeds.
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
  });

  if (DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL);
  else void win.loadFile(path.join(__dirname, "../dist/index.html"));

  mainWindow = win;
  return win;
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow(true);
  }
}

/* ---------------------------------------------------------- briefing --- */
function createBriefingWindow(): void {
  if (briefingWindow && !briefingWindow.isDestroyed()) {
    briefingWindow.show();
    briefingWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 452,
    height: 648,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    skipTaskbar: true,
    title: "WAYPOINT — Daily Briefing",
    backgroundColor: "#111111",
    show: false,
    icon: trayIconPath() ?? undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    console.log("[waypoint] briefing window opened");
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => {
    briefingWindow = null;
  });

  if (DEV_SERVER_URL) void win.loadURL(`${DEV_SERVER_URL}?window=briefing`);
  else void win.loadFile(path.join(__dirname, "../dist/index.html"), { query: { window: "briefing" } });

  briefingWindow = win;
}

/* ------------------------------------------------------------------ tray */
/**
 * Tray "Add Task" entry point. Safe to call with NO console window: the
 * window is created on demand and the directive is queued until the
 * freshly mounted renderer signals readiness (ipc "waypoint:renderer-ready").
 */
function trayAddTask(kind: CreateKind): void {
  dispatchToRenderer("waypoint:open-create", kind);
}

/* ------------------------------------------------- notification routing */
/**
 * Toast activation arrives as a `waypoint://` protocol URL (Windows toast
 * buttons use activationType="protocol"). Works whether WAYPOINT is already
 * running (second-instance) or is being launched by the click itself.
 */
function handleProtocolUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.protocol !== `${PROTOCOL}:`) return;
  const cmd = url.hostname || url.pathname.replace(/\//g, "");
  const rid = url.searchParams.get("rid") ?? "";
  console.log(`[waypoint] protocol activation → ${cmd} ${rid}`);

  if (cmd === "snooze") {
    const min = Number(url.searchParams.get("min") ?? "10") || 10;
    snoozeReminder(rid, min);
    return; // no renderer needed — the ledger is main-process owned
  }

  const [kind, entryId] = rid.split(":");
  const k: CreateKind = kind === "event" ? "event" : "task";
  if (!entryId) {
    showMainWindow();
    return;
  }
  if (cmd === "complete") {
    // The renderer owns every DB write — never mutate the store from here.
    cancelEntryReminders(entryId);
    dispatchToRenderer("waypoint:reminder-action", {
      cmd: "complete-task",
      kind: k,
      entryId,
    } satisfies ReminderAction);
    return;
  }
  // default: open
  dispatchToRenderer("waypoint:reminder-action", {
    cmd: "open-entry",
    kind: k,
    entryId,
  } satisfies ReminderAction);
}

/** Pick a waypoint:// URL out of a process argv vector. */
function protocolUrlFromArgv(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null;
}

function createTray(): void {
  const icon = trayIconPath();
  if (!icon) {
    console.warn("[waypoint] tray icon asset missing — tray disabled this session");
    return;
  }
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip("WAYPOINT — Personal Operations Console");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show WAYPOINT", click: () => showMainWindow() },
      { label: "Open Daily Briefing", click: () => createBriefingWindow() },
      { label: "Add Task", click: () => trayAddTask("task") },
      { label: "Add Event", click: () => trayAddTask("event") },
      { type: "separator" },
      {
        label: "Quit WAYPOINT",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => showMainWindow());
}

/* ------------------------------------------------------------------ ipc */
function registerIpc(): void {
  ipcMain.handle("waypoint:notify", (_event, payload: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false;
    new Notification({ title: payload.title, body: payload.body, silent: false }).show();
    return true;
  });

  const loginItem = { path: process.execPath, args: [STARTUP_ARG] };

  ipcMain.handle("waypoint:autoLaunch:get", () => {
    if (!["win32", "darwin"].includes(process.platform)) return false;
    // Args must match registration for a truthful read on Windows.
    return app.getLoginItemSettings(loginItem).openAtLogin;
  });

  ipcMain.handle("waypoint:autoLaunch:set", (_event, enabled: boolean) => {
    if (!["win32", "darwin"].includes(process.platform)) return false;
    app.setLoginItemSettings({ ...loginItem, openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings(loginItem).openAtLogin;
  });

  ipcMain.handle("waypoint:open-main", () => showMainWindow());
  ipcMain.handle("waypoint:briefing:dismiss", () => briefingWindow?.close());
  ipcMain.handle("waypoint:briefing:open", () => createBriefingWindow());

  /** Console renderer handshake: mounted → subscribed → flush tray queue. */
  ipcMain.on("waypoint:renderer-ready", (event) => {
    if (mainWindow && event.sender === mainWindow.webContents) {
      rendererReady = true;
      flushDirectives();
    }
  });

  ipcMain.handle("waypoint:storage:read", (_event, key: string) => {
    const data = readStoreFile();
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
  });
  ipcMain.handle("waypoint:storage:write", (_event, key: string, value: string) => {
    const data = readStoreFile();
    data[key] = value;
    writeStoreFile(data);
    // The renderer just persisted new task/event data — recalculate the
    // schedule immediately (ordering is guaranteed: write completes first).
    if (key === DB_KEY) requestRescan("renderer-write");
  });
  ipcMain.handle("waypoint:storage:remove", (_event, key: string) => {
    const data = readStoreFile();
    delete data[key];
    writeStoreFile(data);
  });

  ipcMain.handle("waypoint:capabilities", () => ({
    notifications: Notification.isSupported(),
    autoLaunch: ["win32", "darwin"].includes(process.platform),
    tray: tray !== null,
    briefing: true,
    storage: true,
    backgroundScheduler: true,
    toastActions: process.platform === "win32",
  }));

  /* ----------------------------- reminder engine ----------------------- */
  ipcMain.handle("waypoint:reminders:history", (_e, limit?: number) => getHistory(limit ?? 200));
  ipcMain.handle("waypoint:reminders:clear-history", () => {
    clearHistory();
    return true;
  });
  ipcMain.handle("waypoint:reminders:snooze", (_e, id: string, minutes: number) =>
    snoozeReminder(id, minutes),
  );
  ipcMain.handle("waypoint:reminders:status", () => schedulerStatus());
  ipcMain.handle("waypoint:reminders:rescan", () => {
    requestRescan("renderer-request");
    return true;
  });
  ipcMain.handle("waypoint:reminders:test", () => testNotification());
  ipcMain.handle("waypoint:reminders:test-sound", (_e, choice?: SoundChoice) => testSound(choice));
  ipcMain.handle("waypoint:reminders:cancel-entry", (_e, entryId: string) => {
    cancelEntryReminders(entryId);
    return true;
  });
}

/* -------------------------------------------------------------- lifecycle */
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Second launch (e.g. user re-opens from Start while running) → hand focus
  // to the existing instance and exit this one.
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    // A toast button / toast body click relaunches with a waypoint:// URL.
    const url = protocolUrlFromArgv(argv);
    if (url) {
      handleProtocolUrl(url);
      return;
    }
    if (argv.includes(STARTUP_ARG)) {
      if (readBriefingPreference()) createBriefingWindow();
      return;
    }
    showMainWindow();
  });

  // macOS protocol activation (Windows arrives through second-instance/argv).
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleProtocolUrl(url);
  });

  void app.whenReady().then(() => {
    // Windows toast identity: notifications require a matching AppUserModelID
    // and a Start Menu shortcut (the NSIS installer creates one).
    if (process.platform === "win32") app.setAppUserModelId("com.waypoint.console");
    registerIpc();
    createTray();

    const briefingPref = readBriefingPreference();
    console.log(
      `[waypoint] main ready — startupLaunch=${isStartupLaunch} tray=${tray !== null} briefingAtLogin=${briefingPref}`,
    );

    if (isStartupLaunch) {
      // A — Windows login: tray-dormant launch, briefing popup per preference.
      if (briefingPref) createBriefingWindow();
    } else {
      // B — manual launch: full console, no briefing.
      createMainWindow(true);
    }

    // Background reminder engine — runs regardless of window visibility.
    startScheduler({
      onDelivered: (p: DeliveredPayload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("waypoint:reminder-delivered", p);
        }
      },
      onAction: (a: ReminderAction) => {
        if (a.cmd === "complete-task") cancelEntryReminders(a.entryId);
        dispatchToRenderer("waypoint:reminder-action", a);
      },
    });

    // A cold start caused by clicking a toast carries the URL in argv.
    const launchUrl = protocolUrlFromArgv(process.argv);
    if (launchUrl) handleProtocolUrl(launchUrl);

    // Test hook — registered only under WAYPOINT_TEST for the desktop e2e suite.
    if (process.env.WAYPOINT_TEST === "1") {
      (globalThis as Record<string, unknown>).__waypointDebug = {
        trayAddTask,
        createBriefingWindow,
        showMainWindow,
        readBriefingPreference,
        rescan: (reason?: string) => requestRescan(reason ?? "test"),
        snooze: (id: string, minutes: number) => snoozeReminder(id, minutes),
        history: () => getHistory(),
        handleProtocolUrl,
      };
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    // C — hidden background operation: the tray keeps the process alive;
    // only the explicit Quit path (isQuitting) terminates.
    if (isQuitting || !tray) app.quit();
  });

  app.on("before-quit", () => {
    // D — genuine quit: let the OS reap the process normally.
    isQuitting = true;
    stopScheduler();
    briefingWindow?.destroy();
    mainWindow?.destroy();
    tray?.destroy();
    tray = null;
  });
}
