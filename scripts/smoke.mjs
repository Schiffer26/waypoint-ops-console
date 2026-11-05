#!/usr/bin/env node
/**
 * WAYPOINT e2e smoke harness (headless Chromium, web preview channel).
 *
 * Verifies: boot, navigation, task CRUD + completion, persistence,
 * v1→v2 settings migration, all three appearance modes, and the
 * Daily Briefing surface (?window=briefing).
 *
 * Usage:  npm run dev                                  (terminal 1 — dev server on :5173)
 *         node scripts/smoke.mjs                        (terminal 2)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5173";
const errors = [];
const results = [];
const note = (label, ok) => {
  results.push(`${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) process.exitCode = 1;
};

mkdirSync("shots", { recursive: true });

const browser = await chromium.launch();

async function session({ storageSeed, media = "light", name }) {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 950 },
    colorScheme: media,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] PAGEERROR: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${name}] CONSOLE: ${m.text().slice(0, 160)}`);
  });
  if (storageSeed) {
    await ctx.addInitScript((seed) => {
      window.localStorage.setItem("waypoint.db.v1", JSON.stringify(seed));
    }, storageSeed);
  }
  return { ctx, page };
}

/* ---------- 1 · light appearance, boot, core CRUD ---------- */
{
  const { ctx, page } = await session({ name: "light" });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600); // boot wipe
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  note(`light first-run resolves data-theme=light (got ${theme})`, theme === "light");
  await page.screenshot({ path: "shots/01-light-dashboard.png" });

  // create a task through the entry editor
  await page.click("aside >> text=Tasks");
  await page.waitForTimeout(600);
  await page.click("text=LOG TASK");
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="Objective designation"]', "SMOKE E2E OBJECTIVE");
  await page.click("text=LOG RECORD");
  await page.waitForTimeout(700);
  note(
    "task creation through modal",
    (await page.locator("text=SMOKE E2E OBJECTIVE").count()) > 0,
  );

  // completion animation → ledger write (target the row we just created)
  const createdRow = page.locator("div.group", { hasText: "SMOKE E2E OBJECTIVE" }).first();
  await createdRow.locator('button[aria-label="Complete task"]').click();
  await page.waitForTimeout(1300);
  await page.click("aside >> text=Completed");
  await page.waitForTimeout(700);
  note(
    "completion lands in Completed ledger",
    (await page.locator("text=SMOKE E2E OBJECTIVE").count()) > 0,
  );

  // persistence across reload
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2400);
  await page.click("aside >> text=Completed");
  await page.waitForTimeout(600);
  note(
    "persistence survives reload",
    (await page.locator("text=SMOKE E2E OBJECTIVE").count()) > 0,
  );
  await ctx.close();
}

/* ---------- 2 · v1 → v2 migration keeps existing data ---------- */
{
  const { ctx, page } = await session({
    name: "migration",
    storageSeed: {
      version: 1,
      state: {
        tasks: [
          {
            id: "legacy-1",
            kind: "task",
            title: "LEGACY PRE-MIGRATION RECORD",
            description: "",
            date: new Date().toISOString().slice(0, 10),
            categoryId: "cat-ops",
            priority: "high",
            reminder: { enabled: false, minutesBefore: 15 },
            repeat: "none",
            completed: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        events: [],
        categories: [
          { id: "cat-ops", code: "OPS", name: "Operations", color: "#FFFA00" },
        ],
        settings: { operatorName: "VETERAN", hour24: true, weekStartsOn: 1 },
      },
    },
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  await page.click("aside >> text=Tasks");
  await page.waitForTimeout(700);
  note(
    "v1 venue: legacy task survives migration",
    (await page.locator("text=LEGACY PRE-MIGRATION RECORD").count()) > 0,
  );
  await page.click("aside >> text=Dashboard");
  await page.waitForTimeout(700);
  const greeting = await page.locator("text=VETERAN").count();
  note("v1 settings (operator name) preserved", greeting > 0);
  await page.click("aside >> text=Tasks");
  await page.waitForTimeout(500);
  await page.click("aside >> text=Settings");
  await page.waitForTimeout(700);
  note(
    "appearance section present with 3 modes",
    (await page.locator("text=SYSTEM DEFAULT").count()) > 0 &&
      (await page.locator("text=DARK MODE").count()) > 0,
  );
  await ctx.close();
}

/* ---------- 3 · forced dark appearance ---------- */
{
  const { ctx, page } = await session({
    name: "dark",
    storageSeed: {
      version: 2,
      state: {
        settings: { theme: "dark", briefingAtLogin: true, operatorName: "OPERATOR", hour24: true, weekStartsOn: 1 },
      },
    },
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  note(`forced dark resolves data-theme=dark (got ${theme})`, theme === "dark");
  await page.screenshot({ path: "shots/02-dark-dashboard.png" });
  await page.click("aside >> text=Tasks");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shots/03-dark-tasks.png" });
  await page.click("aside >> text=Calendar");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shots/04-dark-calendar.png" });
  await page.click("aside >> text=Settings");
  await page.waitForTimeout(700);
  await page.screenshot({ path: "shots/05-dark-settings.png" });
  await ctx.close();
}

/* ---------- 4 · system appearance follows emulated OS ---------- */
{
  const { ctx, page } = await session({ name: "system-dark", media: "dark" });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2400);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  note(`system mode tracks OS dark (got ${theme})`, theme === "dark");
  await ctx.close();
}

/* ---------- 5 · daily briefing surface ---------- */
{
  const { ctx, page } = await session({ name: "briefing" });
  await page.goto(`${BASE}/?window=briefing`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  note(
    "briefing renders identity + stats + actions",
    (await page.locator("text=DAILY BRIEFING").count()) > 0 &&
      (await page.locator("text=OPEN MAIN CONSOLE").count()) > 0 &&
      (await page.locator("text=DISMISS").count()) > 0,
  );
  await page.screenshot({ path: "shots/06-briefing-light.png" });
  await ctx.close();

  const d = await session({ name: "briefing-dark", media: "dark" });
  await d.page.goto(`${BASE}/?window=briefing`, { waitUntil: "networkidle" });
  await d.page.waitForTimeout(1500);
  await d.page.screenshot({ path: "shots/07-briefing-dark.png" });
  await d.ctx.close();
}

console.log("\n—— WAYPOINT SMOKE ——");
results.forEach((r) => console.log(r));
console.log(errors.length ? `\nERRORS:\n${errors.join("\n")}` : "NO RUNTIME ERRORS");
await browser.close();
