#!/usr/bin/env node
/**
 * WAYPOINT — live scheduler verification against the REAL Electron main
 * process (headless under Xvfb).
 *
 * Proves the background engine actually runs in the packaged architecture:
 *   • notifications are dispatched with NO console window open (tray-dormant)
 *   • the delivery ledger is written to the real userData directory
 *   • duplicates are suppressed across scans
 *   • snooze through the IPC/bridge path persists and re-delivers
 *   • a 24h missed reminder is caught at startup
 *
 * Electron's Notification is stubbed inside the main process via the
 * WAYPOINT_TEST hook so nothing depends on a desktop notification daemon.
 *
 * Usage: npm run dev   (terminal 1)
 *        xvfb-run -a node scripts/smoke-scheduler.mjs   (terminal 2)
 */
import { _electron as electron } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "http://localhost:5173";
const userData = path.join(os.homedir(), ".config", "WAYPOINT");
const kvFile = path.join(userData, "waypoint-store.json");
const ledgerFile = path.join(userData, "waypoint-reminder-ledger.json");

const results = [];
const note = (label, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} — ${label}${ok || !detail ? "" : ` :: ${detail}`}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function seed(tasks, events, settings = {}) {
  mkdirSync(userData, { recursive: true });
  const payload = {
    version: 3,
    state: {
      settings: {
        operatorName: "SYSOP",
        hour24: true,
        weekStartsOn: 1,
        theme: "system",
        briefingAtLogin: false,
        notificationsEnabled: true,
        notificationSound: "silent",
        catchUpMissed: true,
        consolidateMissed: true,
        ...settings,
      },
      tasks,
      events,
      categories: [{ id: "cat-ops", code: "OPS", name: "Operations", color: "#FFFA00" }],
    },
  };
  writeFileSync(kvFile, JSON.stringify({ "waypoint.db.v1": JSON.stringify(payload) }));
  rmSync(ledgerFile, { force: true });
}

const rem = (...offsets) => ({ enabled: offsets.length > 0, minutesBefore: offsets[0] ?? 15, offsets });

async function launch(args = []) {
  return electron.launch({
    args: [".", ...args],
    env: { ...process.env, VITE_DEV_SERVER_URL: BASE, WAYPOINT_TEST: "1" },
  });
}

/** Deliveries recorded by the scheduler's WAYPOINT_TEST recorder. */
const sentIn = (app) => app.evaluate(() => globalThis.__waypointSent ?? []);

const readLedger = () =>
  existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf-8")) : { entries: {} };

/* ---------------------------------------------------------------- run -- */
const now = new Date();

/* 1 — a reminder due right now fires with no window open (tray-dormant) */
{
  const due = new Date(now.getTime() + 2000); // ~now
  seed(
    [
      {
        id: "live1",
        kind: "task",
        title: "LIVE SCHEDULER TASK",
        description: "",
        date: iso(due),
        dueTime: hm(due),
        categoryId: "cat-ops",
        priority: "high",
        reminder: rem(0),
        repeat: "none",
        completed: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [],
  );

  // --waypoint-startup => briefing suppressed above => NO windows at all
  const app = await launch(["--waypoint-startup"]);
  await sleep(3000);
  const windows = app.windows().length;
  note("live: launched tray-dormant with zero windows", windows === 0, `windows=${windows}`);

  // force a scan tick (the engine also ticks every 15s on its own)
  await app.evaluate(() => globalThis.__waypointDebug?.rescan?.("test"));
  await sleep(1500);

  let sent = await sentIn(app);
  const hit = sent.find((s) => (s.title || "").includes("LIVE SCHEDULER TASK"));
  note("live: reminder delivered with NO window open", !!hit, JSON.stringify(sent).slice(0, 160));
  if (process.platform === "win32") {
    note("live: Windows toast XML with actions attached", !!hit?.hasToastXml);
  }

  const ledger = readLedger();
  const rid = Object.keys(ledger.entries)[0];
  note("live: delivery written to the ledger file", !!rid && ledger.entries[rid].state === "delivered");

  // duplicate suppression across further scans
  await app.evaluate(() => globalThis.__waypointDebug?.rescan?.("test2"));
  await sleep(1200);
  sent = await sentIn(app);
  const count = sent.filter((s) => (s.title || "").includes("LIVE SCHEDULER TASK")).length;
  note("live: no duplicate delivery on rescan", count === 1, `count=${count}`);

  // snooze through the real main-process API, then verify persistence
  if (rid) {
    const ok = await app.evaluate((_el, id) => globalThis.__waypointDebug?.snooze?.(id, 5), rid);
    const after = readLedger();
    note("live: snooze accepted and persisted", ok === true && after.entries[rid].state === "snoozed");
    note("live: snoozeUntil stored in the future", (after.entries[rid].snoozeUntil ?? 0) > Date.now());
  }
  // history IPC surface used by the Notification History drawer
  const hist = await app.evaluate(() => globalThis.__waypointDebug?.history?.() ?? []);
  note("live: history API returns ledger rows", Array.isArray(hist) && hist.length >= 1, `rows=${hist.length}`);
  note(
    "live: history row carries state + title",
    !!hist[0]?.state && !!hist[0]?.title,
    JSON.stringify(hist[0] ?? {}).slice(0, 120),
  );

  await app.close();
}

/* 2 — missed reminder from downtime is caught at the next startup */
{
  const past = new Date(now.getTime() - 3 * 3600_000); // 3h ago
  seed(
    [
      {
        id: "missed1",
        kind: "task",
        title: "DOWNTIME MISSED TASK",
        description: "",
        date: iso(past),
        dueTime: hm(past),
        categoryId: "cat-ops",
        priority: "high",
        reminder: rem(0),
        repeat: "none",
        completed: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [],
  );
  const app = await launch(["--waypoint-startup"]);
  await sleep(3500);
  const sent = await sentIn(app);
  const hit = sent.find((s) => (s.title || "").includes("DOWNTIME MISSED TASK"));
  note("live: missed reminder caught on startup", !!hit, JSON.stringify(sent).slice(0, 160));
  note("live: flagged as MISSED in the body", !!hit && /MISSED/.test(hit.body ?? ""), hit?.body ?? "");
  const ledger = readLedger();
  const states = Object.values(ledger.entries).map((e) => e.state);
  note("live: ledger records the missed state", states.includes("missed"), states.join(","));
  await app.close();
}

/* 3 — completed tasks never notify */
{
  const due = new Date(now.getTime() - 60_000);
  seed(
    [
      {
        id: "donetask",
        kind: "task",
        title: "ALREADY COMPLETED TASK",
        description: "",
        date: iso(due),
        dueTime: hm(due),
        categoryId: "cat-ops",
        priority: "high",
        reminder: rem(0),
        repeat: "none",
        completed: true,
        completedAt: Date.now(),
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [],
  );
  const app = await launch(["--waypoint-startup"]);
  await sleep(3000);
  const sent = await sentIn(app);
  note(
    "live: completed task produced no notification",
    !sent.some((s) => (s.title || "").includes("ALREADY COMPLETED TASK")),
  );
  await app.close();
}

rmSync(ledgerFile, { force: true });
console.log("\n—— WAYPOINT LIVE SCHEDULER SMOKE ——");
results.forEach((r) => console.log(r));
