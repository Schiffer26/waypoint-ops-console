#!/usr/bin/env node
/**
 * WAYPOINT desktop e2e (real Electron binary, run under Xvfb headless).
 *
 * Scenario matrix (Stage 02A.1):
 *   A  startup launch + briefing preference ON  → briefing window, no console
 *   B  startup launch + briefing preference OFF → tray-dormant, no windows
 *   C  manual launch                            → full console, no briefing
 *   D  PREVIEW BRIEFING opens the popup regardless of the saved preference
 *   T  tray Add Task with NO console window    → queued until renderer ready
 *   H  briefing shows persisted data, never seed data (hydration gate)
 *
 * Usage:  npm run dev                                  (terminal 1 — dev server on :5173)
 *         xvfb-run -a node scripts/smoke-desktop.mjs   (terminal 2)
 */
import { _electron as electron } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "http://localhost:5173";
const DB_KEY = "waypoint.db.v1";

/* Electron resolves userData from package.json "productName" → "WAYPOINT". */
const userData = path.join(os.homedir(), ".config", "WAYPOINT");
const kvFile = path.join(userData, "waypoint-store.json");

const results = [];
const note = (label, ok) => {
  results.push(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedKv({ briefingAtLogin, operatorName = "SYSOP" }) {
  mkdirSync(userData, { recursive: true });
  const payload = {
    version: 2,
    state: {
      settings: {
        operatorName,
        hour24: true,
        weekStartsOn: 1,
        theme: "system",
        briefingAtLogin,
      },
      tasks: [
        {
          id: "e2e-seeded-1",
          kind: "task",
          title: "PRE-EXISTING ON-DISK RECORD",
          description: "seeded by smoke-desktop",
          date: new Date().toISOString().slice(0, 10),
          categoryId: "cat-ops",
          priority: "high",
          reminder: { enabled: false, minutesBefore: 15 },
          repeat: "none",
          completed: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      events: [
        {
          id: "e2e-seeded-ev1",
          kind: "event",
          title: "SYSOP STANDBY WINDOW",
          description: "",
          date: new Date().toISOString().slice(0, 10),
          startTime: "23:00",
          endTime: "23:30",
          categoryId: "cat-sys",
          priority: "medium",
          reminder: { enabled: false, minutesBefore: 15 },
          repeat: "none",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      categories: [
        { id: "cat-ops", code: "OPS", name: "Operations", color: "#FFFA00" },
        { id: "cat-sys", code: "SYS", name: "Systems", color: "#00FFA2" },
      ],
    },
  };
  writeFileSync(kvFile, JSON.stringify({ [DB_KEY]: JSON.stringify(payload) }));
}

function clearKv() {
  try {
    rmSync(kvFile);
  } catch {
    /* not present */
  }
}

async function launch(args = []) {
  const app = await electron.launch({
    args: [".", ...args],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: BASE,
      WAYPOINT_TEST: "1",
      DISPLAY: process.env.DISPLAY,
    },
  });
  for (const w of app.windows()) hookPage(w);
  app.on("window", hookPage);
  return app;
}

function hookPage(page) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      console.log(`  [renderer:${page.url().slice(-20)}] ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => console.log(`  [renderer pageerror] ${e.message}`));
}

async function waitWindow(app, predicate, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hit = app.windows().find((w) => predicate(w.url()));
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}
const isBriefingUrl = (u) => u.includes("window=briefing");
const isConsoleUrl = (u) => !u.includes("window=briefing");

/* ---------------------------------------------------------- scenario A+H */
{
  seedKv({ briefingAtLogin: true });
  const app = await launch(["--waypoint-startup"]);
  const briefing = await waitWindow(app, isBriefingUrl);
  note("A — startup launch + pref ON shows briefing window", !!briefing);
  if (briefing) {
    await briefing.waitForSelector("text=DAILY BRIEFING", { timeout: 10000 });
    const hasOperator = (await briefing.locator("text=SYSOP").count()) > 0;
    const hasRecord =
      (await briefing.locator("text=PRE-EXISTING ON-DISK RECORD").count()) +
        (await briefing.locator("text=SYSOP STANDBY").count()) >
      0;
    note("H — briefing renders persisted data, not seed data", hasOperator || hasRecord);
  }
  const consoleWin = await waitWindow(app, isConsoleUrl, 2500);
  note("A — console stays hidden on startup launch", !consoleWin);
  await app.close();
}

/* ---------------------------------------------------------- scenario B+T */
{
  seedKv({ briefingAtLogin: false });
  const app = await launch(["--waypoint-startup"]);
  const briefing = await waitWindow(app, isBriefingUrl, 3500);
  note("B — startup launch + pref OFF suppresses briefing", !briefing);
  const consoleWin = await waitWindow(app, isConsoleUrl, 1500);
  note("B — tray-dormant: no windows of any kind", !consoleWin);

  // T — tray Add Task with NO console window created yet.
  await app.evaluate(() => {
    globalThis.__waypointDebug.trayAddTask("task");
  });
  const consoleAfterTray = await waitWindow(app, isConsoleUrl, 15000);
  if (consoleAfterTray) {
    await consoleAfterTray.waitForSelector("text=NEW TASK", { timeout: 15000 });
    const modalUp = (await consoleAfterTray.locator("text=NEW TASK").count()) > 0;
    note("T — tray Add Task created console + opened entry editor", modalUp);
  } else {
    note("T — tray Add Task created console + opened entry editor", false);
  }
  await app.close();
}

/* ---------------------------------------------------------- scenario C+D */
{
  seedKv({ briefingAtLogin: false }); // D must work even with pref OFF
  const app = await launch(); // manual launch, no startup arg
  const consoleWin = await waitWindow(app, isConsoleUrl);
  note("C — manual launch opens the full console", !!consoleWin);
  const briefing = await waitWindow(app, isBriefingUrl, 2500);
  note("C — manual launch does NOT open the briefing", !briefing);

  if (consoleWin) {
    await consoleWin.waitForSelector("aside >> text=Settings", { timeout: 15000 });
    await consoleWin.click("aside >> text=Settings");
    await consoleWin.waitForSelector("text=PREVIEW BRIEFING", { timeout: 10000 });
    await consoleWin.click("text=PREVIEW BRIEFING");
    const preview = await waitWindow(app, isBriefingUrl);
    note("D — PREVIEW BRIEFING opens popup regardless of preference", !!preview);
    if (preview) {
      await preview.waitForSelector("text=DISMISS", { timeout: 10000 });
      await preview.click("text=DISMISS");
      await sleep(800);
      const stillThere = await waitWindow(app, isBriefingUrl, 1500);
      note("D — DISMISS closes only the briefing window", !stillThere);
      const consoleStill = await waitWindow(app, isConsoleUrl, 1500);
      note("D — console unaffected after briefing dismiss", !!consoleStill);
    }
  }
  await app.close();
}

clearKv();
console.log("\n—— WAYPOINT DESKTOP SMOKE ——");
results.forEach((r) => console.log(r));
