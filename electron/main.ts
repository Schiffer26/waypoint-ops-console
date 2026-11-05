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
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, Tray } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { operatorExists, createOperator, authenticate, authenticateKey, LoginThrottle } from "./auth.js";
import { ConsoleSession, type SenderContext, type WindowContext } from "./session.js";
import { briefingSnapshot, appearance } from "./briefing-data.js";
import { briefingBounds } from "./briefing-position.js";
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
let briefingReady = false;
let consoleBootComplete = false;
let pendingAutomaticBriefing = false;
// One automatic briefing per process; dismissal must survive later activations.
let automaticBriefingHandled = false;
let tray: Tray | null = null;
let isQuitting = false;
const session = new ConsoleSession();
const expectedMainUrl = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).href : pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const expectedBriefingUrl = (() => { const url = new URL(expectedMainUrl); url.searchParams.set("window", "briefing"); return url.href; })();
const context = (win: BrowserWindow | null): WindowContext | null => win && !win.isDestroyed() ? {
  webContents: win.webContents, mainFrame: win.webContents.mainFrame, url: win.webContents.getURL(),
} : null;
const requireMain = (event: SenderContext) => session.requireMain(event, context(mainWindow), expectedMainUrl);
const requireAuth = (event: SenderContext) => session.requireAuthenticated(event, context(mainWindow), expectedMainUrl);
const requireBriefing = (event: SenderContext) => {
  const win = context(briefingWindow);
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.mainFrame || win.url !== expectedBriefingUrl) throw new Error("Authorization denied: untrusted briefing renderer");
};

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
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady || !session.isActive(context(mainWindow))) return;
  const queue = pendingDirectives;
  pendingDirectives = [];
  for (const d of queue) {
    if (d.channel === "waypoint:reminder-action" && (d.payload as ReminderAction).cmd === "complete-task") cancelEntryReminders((d.payload as ReminderAction).entryId);
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
  consoleBootComplete = false;
  session.invalidate();
  win.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame) {
      session.invalidate(); rendererReady = false; consoleBootComplete = false;
      // Same-document navigation retains React memory; reload the trusted entry
      // so a hash/history navigation cannot leave the unlocked UI visible.
      if (inPlace) setImmediate(() => { if (!win.isDestroyed()) void win.loadURL(expectedMainUrl); });
    }
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  win.webContents.on("render-process-gone", () => {
    session.invalidate(); rendererReady = false; consoleBootComplete = false;
  });

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
    session.invalidate();
    mainWindow = null;
    rendererReady = false;
    consoleBootComplete = false;
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
function requestAutomaticBriefing(): void {
  if (automaticBriefingHandled || !readBriefingPreference()) return;
  if (briefingWindow && !briefingWindow.isDestroyed()) {
    automaticBriefingHandled = true;
    return;
  }
  if (consoleBootComplete) {
    automaticBriefingHandled = true;
    createBriefingWindow();
  } else {
    pendingAutomaticBriefing = true;
  }
}
function createBriefingWindow(): void {
  // A manual opening also satisfies any pending automatic request.
  if (pendingAutomaticBriefing) automaticBriefingHandled = true;
  pendingAutomaticBriefing = false;
  if (briefingWindow && !briefingWindow.isDestroyed()) {
    // A second request during load must not show an unpainted window.
    if (briefingReady) { briefingWindow.show(); briefingWindow.focus(); }
    return;
  }
  const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const display = mainBounds ? screen.getDisplayMatching(mainBounds) : screen.getPrimaryDisplay();
  const bounds = briefingBounds(display.workArea, mainBounds);
  const win = new BrowserWindow({
    ...bounds,
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

  briefingWindow = win;
  briefingReady = false;
  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    briefingReady = true;
    win.show();
    console.log("[waypoint] briefing window opened");
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  win.on("closed", () => {
    if (briefingWindow === win) { briefingWindow = null; briefingReady = false; }
  });

  if (DEV_SERVER_URL) void win.loadURL(`${DEV_SERVER_URL}?window=briefing`);
  else void win.loadFile(path.join(__dirname, "../dist/index.html"), { query: { window: "briefing" } });

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
  const authFile = () => path.join(app.getPath("userData"), "waypoint-auth.json");
  const throttle = new LoginThrottle(path.join(app.getPath("userData"), "waypoint-auth-attempts.json"));
  let setupPending = false;
  ipcMain.handle("waypoint:auth:appearance", (event) => { requireMain(event); return appearance(readStoreFile()); });
  ipcMain.handle("waypoint:auth:status", (event) => { requireMain(event); return operatorExists(authFile()); });
  ipcMain.handle("waypoint:auth:create", async (event, operator: unknown, key: unknown) => {
    requireMain(event);
    if (setupPending) throw new Error("Operator setup unavailable");
    setupPending = true;
    try {
      const generation = session.snapshot();
      if (await operatorExists(authFile())) throw new Error("Operator setup unavailable");
      await createOperator(authFile(), operator, key);
      session.grant(event, context(mainWindow), expectedMainUrl, generation);
    } finally { setupPending = false; }
  });
  ipcMain.handle("waypoint:auth:verify", async (event, operator: unknown, key: unknown) => {
    requireMain(event);
    const generation = session.snapshot();
    const ok = await throttle.run(() => authenticate(authFile(), operator, key));
    if (ok) session.grant(event, context(mainWindow), expectedMainUrl, generation);
    return ok;
  });
  ipcMain.handle("waypoint:auth:verify-settings", async (event, key: unknown) => {
    requireAuth(event);
    const generation = session.snapshot();
    const ok = await throttle.run(() => authenticateKey(authFile(), key));
    // A navigation, destruction, or replacement session during scrypt must not
    // make this result usable in a different authentication generation.
    requireAuth(event);
    if (generation !== session.snapshot()) throw new Error("Authorization denied: session expired");
    return ok;
  });
  ipcMain.handle("waypoint:briefing:snapshot", (event) => { requireBriefing(event); return briefingSnapshot(readStoreFile()); });
  ipcMain.handle("waypoint:notify", (event, payload: { title: string; body: string }) => {
    requireAuth(event);
    if (!Notification.isSupported()) return false;
    new Notification({ title: payload.title, body: payload.body, silent: false }).show();
    return true;
  });

  const loginItem = { path: process.execPath, args: [STARTUP_ARG] };

  ipcMain.handle("waypoint:autoLaunch:get", (event) => {
    requireAuth(event);
    if (!["win32", "darwin"].includes(process.platform)) return false;
    // Args must match registration for a truthful read on Windows.
    return app.getLoginItemSettings(loginItem).openAtLogin;
  });

  ipcMain.handle("waypoint:autoLaunch:set", (event, enabled: boolean) => {
    requireAuth(event);
    if (!["win32", "darwin"].includes(process.platform)) return false;
    app.setLoginItemSettings({ ...loginItem, openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings(loginItem).openAtLogin;
  });

  ipcMain.handle("waypoint:open-main", (event) => { requireBriefing(event); showMainWindow(); });
  ipcMain.handle("waypoint:briefing:dismiss", (event) => { requireBriefing(event); briefingWindow?.close(); });
  ipcMain.handle("waypoint:briefing:open", (event) => { requireAuth(event); createBriefingWindow(); });

  // This is a presentation handshake only: it never grants authentication.
  ipcMain.on("waypoint:boot-complete", (event) => {
    try {
      requireMain(event);
      consoleBootComplete = true;
      if (pendingAutomaticBriefing) {
        pendingAutomaticBriefing = false;
        if (readBriefingPreference() && !automaticBriefingHandled) {
          automaticBriefingHandled = true;
          createBriefingWindow();
        }
      }
    } catch { /* Ignore unrelated or stale renderers. */ }
  });

  /** Console renderer handshake: mounted → subscribed → flush tray queue. */
  ipcMain.on("waypoint:renderer-ready", (event) => {
    try { requireAuth(event); rendererReady = true; flushDirectives(); } catch { /* unauthenticated renderer cannot flush directives */ }
  });

  ipcMain.handle("waypoint:storage:read", (event, key: string) => {
    requireAuth(event);
    const data = readStoreFile();
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
  });
  ipcMain.handle("waypoint:storage:write", (event, key: string, value: string) => {
    requireAuth(event);
    const data = readStoreFile();
    data[key] = value;
    writeStoreFile(data);
    // The renderer just persisted new task/event data — recalculate the
    // schedule immediately (ordering is guaranteed: write completes first).
    if (key === DB_KEY) requestRescan("renderer-write");
  });
  ipcMain.handle("waypoint:storage:remove", (event, key: string) => {
    requireAuth(event);
    const data = readStoreFile();
    delete data[key];
    writeStoreFile(data);
  });

  ipcMain.handle("waypoint:capabilities", (event) => { requireAuth(event); return ({
    notifications: Notification.isSupported(),
    autoLaunch: ["win32", "darwin"].includes(process.platform),
    tray: tray !== null,
    briefing: true,
    storage: true,
    backgroundScheduler: true,
    toastActions: process.platform === "win32",
  }); });

  /* ----------------------------- reminder engine ----------------------- */
  ipcMain.handle("waypoint:reminders:history", (event, limit?: number) => { requireAuth(event); return getHistory(limit ?? 200); });
  ipcMain.handle("waypoint:reminders:clear-history", (event) => {
    requireAuth(event);
    clearHistory();
    return true;
  });
  ipcMain.handle("waypoint:reminders:snooze", (event, id: string, minutes: number) => { requireAuth(event); return snoozeReminder(id, minutes); },
  );
  ipcMain.handle("waypoint:reminders:status", (event) => { requireAuth(event); return schedulerStatus(); });
  ipcMain.handle("waypoint:reminders:rescan", (event) => {
    requireAuth(event);
    requestRescan("renderer-request");
    return true;
  });
  ipcMain.handle("waypoint:reminders:test", (event) => { requireAuth(event); return testNotification(); });
  ipcMain.handle("waypoint:reminders:test-sound", (event, choice?: SoundChoice) => { requireAuth(event); return testSound(choice); });
  ipcMain.handle("waypoint:reminders:cancel-entry", (event, entryId: string) => {
    requireAuth(event);
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
    // second-instance can arrive while the first instance is still starting.
    void app.whenReady().then(() => {
      if (!argv.includes(STARTUP_ARG)) {
        showMainWindow();
        return;
      }
      if (!readBriefingPreference() || automaticBriefingHandled) return;
      // A startup activation must never restore a console hidden in the tray.
      // If no console exists, boot a hidden renderer to complete the handshake.
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(false);
      requestAutomaticBriefing();
    });
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

    // Both fresh manual and Windows startup launches queue the briefing when
    // enabled; neither opens it before the console's boot-ready handshake.
    // Windows startup remains tray-dormant when the preference is disabled.
    if (!isStartupLaunch || briefingPref) {
      if (briefingPref) requestAutomaticBriefing();
      createMainWindow(true);
    }

    // Background reminder engine — runs regardless of window visibility.
    startScheduler({
      onDelivered: (p: DeliveredPayload) => {
        if (mainWindow && !mainWindow.isDestroyed() && session.isActive(context(mainWindow))) {
          mainWindow.webContents.send("waypoint:reminder-delivered", p);
        }
      },
      onAction: (a: ReminderAction) => {
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
    session.invalidate();
    stopScheduler();
    briefingWindow?.destroy();
    mainWindow?.destroy();
    tray?.destroy();
    tray = null;
  });
}
