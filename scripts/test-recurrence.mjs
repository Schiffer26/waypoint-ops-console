#!/usr/bin/env node
/**
 * WAYPOINT — monthly recurrence correction test suite (Stage 03.1).
 *
 * Covers the end-of-month rollover bug where Date.setMonth() turned
 * "Jan 31 + 1 month" into Mar 3 — skipping February and permanently
 * corrupting every later occurrence.
 *
 * Crucially this also proves PARITY: the real renderer calendar code
 * (src/lib/schedule.ts → expandEvents) and the real background scheduler
 * (dist-electron/reminder-core.js → buildInstances) are bundled/loaded and
 * compared occurrence-for-occurrence, so the UI and notifications can never
 * drift apart.
 *
 * Run: npm run build:electron && node scripts/test-recurrence.mjs
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  addMonthsAnchored,
  daysInMonth,
  enumerateOccurrences,
  resolveAnchorDay,
  shiftByRule,
} from "../dist-electron/recurrence.js";
import { buildInstances, occurrenceDates } from "../dist-electron/reminder-core.js";

/* ------------------------------------------------------------ harness -- */
let passed = 0;
let failed = 0;
const results = [];
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    results.push(`PASS — ${name}`);
  } else {
    failed++;
    results.push(`FAIL — ${name}${detail ? ` :: ${detail}` : ""}`);
  }
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const monthly = (start, from, to, anchor) =>
  enumerateOccurrences(start, "monthly", from, to, anchor);

/* =======================================================================
   1 — the exact scenarios named in the bug report
   ===================================================================== */
eq(
  "01 Jan 31 2026 → May (the reported bug: was Jan31, Mar3, Apr3, May3)",
  monthly("2026-01-31", "2026-01-01", "2026-05-31"),
  ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
);
eq(
  "02 Jan 30 2026 → May 30",
  monthly("2026-01-30", "2026-01-01", "2026-05-31"),
  ["2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30", "2026-05-30"],
);
eq(
  "03 Aug 31 2026 → December",
  monthly("2026-08-31", "2026-08-01", "2026-12-31"),
  ["2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31"],
);
eq(
  "04 Leap year: Jan 31 2024 → April (Feb 29)",
  monthly("2024-01-31", "2024-01-01", "2024-04-30"),
  ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"],
);
eq(
  "05 Non-leap year: Jan 31 2026 → April (Feb 28)",
  monthly("2026-01-31", "2026-01-01", "2026-04-30"),
  ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
);
eq(
  "06 May 30 2026 → August (no clamping needed)",
  monthly("2026-05-30", "2026-05-01", "2026-08-31"),
  ["2026-05-30", "2026-06-30", "2026-07-30", "2026-08-30"],
);

/* =======================================================================
   2 — anchor restoration & drift
   ===================================================================== */
check(
  "07 anchor restored after a short month (Feb 28 → Mar 31)",
  addMonthsAnchored("2026-02-28", 1, 31) === "2026-03-31",
  addMonthsAnchored("2026-02-28", 1, 31),
);
check(
  "08 no cumulative drift across 36 months from Jan 31",
  monthly("2026-01-31", "2026-01-01", "2028-12-31").filter((d) => d.endsWith("-31")).length === 21,
  String(monthly("2026-01-31", "2026-01-01", "2028-12-31").filter((d) => d.endsWith("-31")).length),
);
{
  // every 31-day month in a 3-year run must land on the 31st
  const series = monthly("2026-01-31", "2026-01-01", "2028-12-31");
  const wrong = series.filter((d) => {
    const [y, m, day] = d.split("-").map(Number);
    return day !== Math.min(31, daysInMonth(y, m));
  });
  eq("09 every occurrence equals min(anchor, days-in-month) over 3 years", wrong, []);
  check("09b series length is 36 months", series.length === 36, String(series.length));
}
{
  // Feb 29 anchor: only leap years can honour it
  const s = monthly("2024-02-29", "2024-01-01", "2028-12-31");
  check(
    "10 Feb-29 anchor returns to the 29th on the next leap year",
    s.includes("2024-02-29") && s.includes("2028-02-29") && s.includes("2025-02-28"),
    JSON.stringify(s.filter((d) => d.includes("-02-"))),
  );
}
eq(
  "11 month-end anchor across a year boundary (Dec 31 → Feb)",
  monthly("2025-12-31", "2025-12-01", "2026-03-31"),
  ["2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31"],
);

/* =======================================================================
   3 — windowing: occurrences requested mid-series keep the anchor
   ===================================================================== */
eq(
  "12 mid-series window still anchored (Jan 31 series, Mar–Jun window)",
  monthly("2026-01-31", "2026-03-01", "2026-06-30"),
  ["2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"],
);
eq(
  "13 window starting on a clamped occurrence includes it",
  monthly("2026-01-31", "2026-02-28", "2026-03-31"),
  ["2026-02-28", "2026-03-31"],
);
eq("14 no occurrences before the series start", monthly("2026-06-30", "2026-01-01", "2026-05-31"), []);

/* =======================================================================
   4 — daily / weekly unaffected by the fix
   ===================================================================== */
eq(
  "15 daily still steps one day (incl. across month end)",
  enumerateOccurrences("2026-01-30", "daily", "2026-01-30", "2026-02-02"),
  ["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"],
);
eq(
  "16 weekly still steps seven days (incl. across month end)",
  enumerateOccurrences("2026-01-29", "weekly", "2026-01-01", "2026-03-01"),
  ["2026-01-29", "2026-02-05", "2026-02-12", "2026-02-19", "2026-02-26"],
);
eq(
  "17 one-off entries unchanged",
  enumerateOccurrences("2026-02-10", "none", "2026-01-01", "2026-12-31"),
  ["2026-02-10"],
);
eq(
  "18 daily across a leap day",
  enumerateOccurrences("2024-02-28", "daily", "2024-02-28", "2024-03-01"),
  ["2024-02-28", "2024-02-29", "2024-03-01"],
);

/* =======================================================================
   5 — recurring TASK completion chain (requirements C & D)
   Mirrors useOpsStore.toggleTask: next date = shiftByRule(date, rule, anchor)
   with the anchor carried forward on the spawned task.
   ===================================================================== */
{
  const completeCycle = (task) => {
    const anchorDay = resolveAnchorDay(task.date, task.repeatAnchorDay);
    return {
      ...task,
      date: shiftByRule(task.date, task.repeat, anchorDay),
      repeatAnchorDay: task.repeat === "monthly" ? anchorDay : task.repeatAnchorDay,
    };
  };

  let t = { date: "2026-01-31", repeat: "monthly", repeatAnchorDay: 31 };
  const chain = [t.date];
  for (let i = 0; i < 4; i++) {
    t = completeCycle(t);
    chain.push(t.date);
  }
  eq(
    "19 monthly task completion chain Jan 31 → Feb → Mar (anchor preserved)",
    chain,
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
  );
  check("20 spawned task retains its anchor day", t.repeatAnchorDay === 31, String(t.repeatAnchorDay));

  // legacy task with NO stored anchor: derived from its date, still stable
  let legacy = { date: "2026-01-31", repeat: "monthly" };
  const legacyChain = [legacy.date];
  for (let i = 0; i < 3; i++) {
    legacy = completeCycle(legacy);
    legacyChain.push(legacy.date);
  }
  eq(
    "21 legacy task (no stored anchor) derives it and stays anchored",
    legacyChain,
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
  );

  // leap-year completion chain
  let leap = { date: "2024-01-31", repeat: "monthly", repeatAnchorDay: 31 };
  const leapChain = [leap.date];
  for (let i = 0; i < 3; i++) {
    leap = completeCycle(leap);
    leapChain.push(leap.date);
  }
  eq(
    "22 leap-year task completion chain (Feb 29)",
    leapChain,
    ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"],
  );

  // daily / weekly completion unaffected
  let d = { date: "2026-01-31", repeat: "daily" };
  d = completeCycle(d);
  check("23 daily task completion → next day", d.date === "2026-02-01", d.date);
  let w = { date: "2026-01-31", repeat: "weekly" };
  w = completeCycle(w);
  check("24 weekly task completion → +7 days", w.date === "2026-02-07", w.date);
}

/* =======================================================================
   6 — the SCHEDULER produces the corrected dates
   ===================================================================== */
eq(
  "25 scheduler occurrenceDates() matches the corrected series",
  occurrenceDates("2026-01-31", "monthly", "2026-01-01", "2026-05-31"),
  ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
);
{
  const db = {
    tasks: [],
    events: [
      {
        id: "m1",
        kind: "event",
        title: "Monthly review",
        date: "2026-01-31",
        startTime: "09:00",
        endTime: "10:00",
        repeat: "monthly",
        repeatAnchorDay: 31,
        reminder: { enabled: true, minutesBefore: 0, offsets: [0] },
      },
    ],
  };
  const from = new Date(2026, 0, 1).getTime();
  const to = new Date(2026, 4, 31, 23, 59).getTime();
  const dates = buildInstances(db, from, to).instances.map((i) => i.occurrenceDate);
  eq(
    "26 buildInstances() schedules reminders on the corrected dates",
    dates,
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
  );
}
{
  // an event WITHOUT a stored anchor must still behave correctly
  const db = {
    tasks: [],
    events: [
      {
        id: "m2",
        kind: "event",
        title: "Legacy monthly",
        date: "2026-01-31",
        startTime: "09:00",
        repeat: "monthly",
        reminder: { enabled: true, minutesBefore: 0, offsets: [0] },
      },
    ],
  };
  const dates = buildInstances(
    db,
    new Date(2026, 0, 1).getTime(),
    new Date(2026, 3, 30, 23, 59).getTime(),
  ).instances.map((i) => i.occurrenceDate);
  eq(
    "27 legacy event without repeatAnchorDay still anchors correctly",
    dates,
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
  );
}

/* =======================================================================
   7 — PARITY: real renderer calendar code vs real scheduler code
   ===================================================================== */
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "wpt-parity-"));
  const outfile = path.join(tmp, "renderer-schedule.mjs");

  // Bundle the ACTUAL renderer module graph (src/lib/schedule.ts and
  // everything it imports, incl. src/lib/time.ts → electron/recurrence.ts).
  await build({
    entryPoints: [path.resolve("src/lib/schedule.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent",
    alias: { "@": path.resolve("src") },
  });

  const { expandEvents } = await import(pathToFileURL(outfile).href);

  const cases = [
    { label: "Jan 31 anchored", date: "2026-01-31", anchor: 31, from: "2026-01-01", to: "2026-12-31" },
    { label: "Jan 30 anchored", date: "2026-01-30", anchor: 30, from: "2026-01-01", to: "2026-12-31" },
    { label: "Aug 31 anchored", date: "2026-08-31", anchor: 31, from: "2026-08-01", to: "2027-03-31" },
    { label: "leap Jan 31", date: "2024-01-31", anchor: 31, from: "2024-01-01", to: "2024-12-31" },
    { label: "no stored anchor", date: "2026-01-31", anchor: undefined, from: "2026-01-01", to: "2026-06-30" },
    { label: "mid-series window", date: "2026-01-31", anchor: 31, from: "2026-03-05", to: "2026-07-20" },
  ];

  let mismatches = 0;
  for (const c of cases) {
    const ev = {
      id: "p1",
      kind: "event",
      title: "Parity probe",
      description: "",
      date: c.date,
      startTime: "09:00",
      endTime: "10:00",
      categoryId: "cat",
      priority: "medium",
      repeat: "monthly",
      repeatAnchorDay: c.anchor,
      reminder: { enabled: true, minutesBefore: 0, offsets: [0] },
      createdAt: 1,
      updatedAt: 1,
    };
    // UI path (renderer calendar / events page / dashboard)
    const ui = expandEvents([ev], c.from, c.to).map((o) => o.occurrenceDate);
    // Background scheduler path
    const engine = occurrenceDates(
      c.date,
      "monthly",
      c.from,
      c.to,
      resolveAnchorDay(c.date, c.anchor),
    );
    const same = JSON.stringify(ui) === JSON.stringify(engine);
    if (!same) {
      mismatches++;
      results.push(`      ↳ ${c.label}: UI ${JSON.stringify(ui)} vs ENGINE ${JSON.stringify(engine)}`);
    }
    check(`28 parity — ${c.label}: calendar === scheduler`, same);
  }
  check("29 zero UI/scheduler mismatches overall", mismatches === 0, `${mismatches} mismatched`);

  // Parity for daily & weekly too
  for (const rule of ["daily", "weekly", "none"]) {
    const ev = {
      id: "p2",
      kind: "event",
      title: "Parity probe",
      description: "",
      date: "2026-01-29",
      startTime: "09:00",
      endTime: "10:00",
      categoryId: "cat",
      priority: "medium",
      repeat: rule,
      reminder: { enabled: true, minutesBefore: 0, offsets: [0] },
      createdAt: 1,
      updatedAt: 1,
    };
    const ui = expandEvents([ev], "2026-01-01", "2026-03-15").map((o) => o.occurrenceDate);
    const engine = occurrenceDates("2026-01-29", rule, "2026-01-01", "2026-03-15");
    check(`30 parity — ${rule} rule: calendar === scheduler`, JSON.stringify(ui) === JSON.stringify(engine));
  }

  rmSync(tmp, { recursive: true, force: true });
}

/* =======================================================================
   8 — regression guard: setMonth() must not reappear
   ===================================================================== */
{
  const { readFileSync } = await import("node:fs");
  const files = [
    "electron/recurrence.ts",
    "electron/reminder-core.ts",
    "src/lib/time.ts",
    "src/lib/schedule.ts",
    "src/store/useOpsStore.ts",
  ];
  // Strip comments first — prose mentioning setMonth() must not trip the guard.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const offenders = files.filter((f) =>
    /\.setMonth\s*\(/.test(stripComments(readFileSync(f, "utf-8"))),
  );
  eq("31 no .setMonth() month arithmetic remains in recurrence paths", offenders, []);
}

/* --------------------------------------------------------------- report */
console.log("\n—— WAYPOINT MONTHLY RECURRENCE TESTS ——");
for (const r of results) console.log(r);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
