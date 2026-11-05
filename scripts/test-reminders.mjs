#!/usr/bin/env node
/**
 * WAYPOINT — reminder engine test suite.
 *
 * Exercises the pure scheduling brain (dist-electron/reminder-core.js) and
 * the atomic ledger store with a FULLY CONTROLLED CLOCK and a MOCKED
 * notifier — no Electron, no real time, no real notifications.
 *
 * Run:  npm run build:electron && node scripts/test-reminders.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applySnooze,
  buildInstances,
  markCancelled,
  markDelivered,
  markExpired,
  normalizeOffsets,
  notificationBody,
  planReminders,
  sanitizeLedger,
  emptyLedger,
  localMs,
} from "../dist-electron/reminder-core.js";
import { readLedger, writeLedgerAtomic } from "../dist-electron/ledger-store.js";
import { parseDb } from "../dist-electron/db-reader.js";

/* ------------------------------------------------------------ harness -- */
let passed = 0;
let failed = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    results.push(`PASS — ${name}`);
  } else {
    failed++;
    results.push(`FAIL — ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const LOOKBACK = 25 * 3600_000;
const LOOKAHEAD = 2 * 86400_000;

/**
 * Mirror of scheduler.scan() using the pure engine + a mocked notifier.
 * Returns every notification that WOULD have been shown.
 */
function runScan(db, ledger, now, opts = {}) {
  const sent = [];
  const settings = db.settings ?? {};
  const { instances } = buildInstances(db, now - LOOKBACK, now + LOOKAHEAD);
  const plan = planReminders(instances, ledger, {
    now,
    notificationsEnabled: settings.notificationsEnabled !== false,
    catchUpEnabled: settings.catchUpMissed !== false,
    ...opts,
  });

  for (const inst of plan.due) {
    sent.push({ id: inst.id, title: inst.title, missed: false, body: notificationBody(inst, false) });
    markDelivered(ledger, inst, now, "delivered");
  }
  for (const rec of plan.snoozeDue) {
    sent.push({ id: rec.id, title: rec.title, missed: false, snoozed: true });
    ledger.entries[rec.id] = { ...rec, state: "delivered", deliveredAt: now, snoozeUntil: undefined };
  }
  if (plan.missed.length) {
    const consolidate = settings.consolidateMissed !== false;
    if (consolidate && plan.missed.length > 3) {
      sent.push({ id: "summary", title: `${plan.missed.length} missed reminders`, missed: true, summary: true });
    } else {
      for (const inst of plan.missed) {
        sent.push({ id: inst.id, title: inst.title, missed: true, body: notificationBody(inst, true) });
      }
    }
    for (const inst of plan.missed) markDelivered(ledger, inst, now, "missed");
  }
  for (const inst of plan.expire) markExpired(ledger, inst, now);
  for (const id of plan.cancel) markCancelled(ledger, id, now);
  return { sent, plan };
}

const rem = (...offsets) => ({ enabled: offsets.length > 0, minutesBefore: offsets[0] ?? 15, offsets });
const task = (o) => ({ kind: "task", repeat: "none", completed: false, ...o });
const event = (o) => ({ kind: "event", repeat: "none", endTime: "15:00", ...o });

/* =======================================================================
   1 — single reminder delivery
   ===================================================================== */
{
  const db = {
    tasks: [task({ id: "t1", title: "Calibrate array", date: "2026-03-10", dueTime: "14:00", reminder: rem(15) })],
    events: [],
  };
  const ledger = emptyLedger();
  const before = runScan(db, ledger, localMs("2026-03-10", "13:40"));
  check("01 single reminder: silent before its time", before.sent.length === 0);
  const at = runScan(db, ledger, localMs("2026-03-10", "13:45"));
  check("01 single reminder: delivered at T-15", at.sent.length === 1 && at.sent[0].title === "Calibrate array");
}

/* =======================================================================
   2 — multiple reminders for one event (the spec's 4-offset example)
   ===================================================================== */
{
  const db = {
    tasks: [],
    events: [
      event({ id: "e1", title: "Uplink sync", date: "2026-11-10", startTime: "14:00", reminder: rem(0, 15, 60, 1440) }),
    ],
  };
  const { instances } = buildInstances(db, localMs("2026-11-01", "00:00"), localMs("2026-11-11", "00:00"));
  const fires = instances.map((i) => new Date(i.fireAt).toISOString().slice(0, 16)).sort();
  const expect = [
    localMs("2026-11-09", "14:00"),
    localMs("2026-11-10", "13:00"),
    localMs("2026-11-10", "13:45"),
    localMs("2026-11-10", "14:00"),
  ].map((m) => new Date(m).toISOString().slice(0, 16)).sort();
  check("02 multiple reminders: 4 distinct fire times", instances.length === 4, `got ${instances.length}`);
  check("02 multiple reminders: exact schedule matches spec", JSON.stringify(fires) === JSON.stringify(expect), fires.join(" | "));

  // each delivers exactly once, in order
  const ledger = emptyLedger();
  let total = 0;
  for (const m of [
    localMs("2026-11-09", "14:00"),
    localMs("2026-11-10", "13:00"),
    localMs("2026-11-10", "13:45"),
    localMs("2026-11-10", "14:00"),
  ]) {
    total += runScan(db, ledger, m).sent.length;
  }
  check("02 multiple reminders: all four delivered", total === 4, `got ${total}`);
}

/* =======================================================================
   3 — delivery exactly at the scheduled time (offset 0)
   ===================================================================== */
{
  const db = { tasks: [], events: [event({ id: "e2", title: "Standup", date: "2026-04-02", startTime: "09:00", reminder: rem(0) })] };
  const ledger = emptyLedger();
  const r = runScan(db, ledger, localMs("2026-04-02", "09:00"));
  check("03 offset 0 fires at the scheduled moment", r.sent.length === 1 && /Starting now/.test(r.sent[0].body));
}

/* =======================================================================
   4 — duplicate prevention across repeated scans
   ===================================================================== */
{
  const db = { tasks: [task({ id: "t4", title: "Audit", date: "2026-03-10", dueTime: "10:00", reminder: rem(5) })], events: [] };
  const ledger = emptyLedger();
  const base = localMs("2026-03-10", "09:55");
  let sends = 0;
  for (let i = 0; i < 10; i++) sends += runScan(db, ledger, base + i * 15_000).sent.length;
  check("04 duplicate prevention: exactly one delivery over 10 scans", sends === 1, `got ${sends}`);
}

/* =======================================================================
   5 — snooze reschedules delivery
   ===================================================================== */
{
  const db = { tasks: [task({ id: "t5", title: "Filter swap", date: "2026-03-10", dueTime: "12:00", reminder: rem(0) })], events: [] };
  const ledger = emptyLedger();
  const t0 = localMs("2026-03-10", "12:00");
  runScan(db, ledger, t0);
  const rid = Object.keys(ledger.entries)[0];
  applySnooze(ledger, rid, 10, t0);
  const during = runScan(db, ledger, t0 + 5 * 60000);
  check("05 snooze: silent while snoozed", during.sent.length === 0);
  const after = runScan(db, ledger, t0 + 10 * 60000);
  check("05 snooze: re-delivered when the snooze elapses", after.sent.length === 1 && after.sent[0].snoozed === true);

  // repeated snoozing
  applySnooze(ledger, rid, 5, t0 + 10 * 60000);
  const again = runScan(db, ledger, t0 + 15 * 60000);
  check("05 snooze: repeated snoozing works", again.sent.length === 1);
  check("05 snooze: snooze count tracked", (ledger.entries[rid].snoozeCount ?? 0) === 2, String(ledger.entries[rid].snoozeCount));
}

/* =======================================================================
   6 — snooze survives an application restart (atomic ledger round-trip)
   ===================================================================== */
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "wpt-ledger-"));
  const db = { tasks: [task({ id: "t6", title: "Relay check", date: "2026-03-10", dueTime: "08:00", reminder: rem(0) })], events: [] };
  const ledger = emptyLedger();
  const t0 = localMs("2026-03-10", "08:00");
  runScan(db, ledger, t0);
  const rid = Object.keys(ledger.entries)[0];
  applySnooze(ledger, rid, 15, t0);
  writeLedgerAtomic(dir, ledger);

  // ---- simulated restart: fresh read from disk ----
  const reloaded = readLedger(dir);
  check("06 snooze persistence: state survives restart", reloaded.entries[rid]?.state === "snoozed");
  check("06 snooze persistence: snoozeUntil preserved", reloaded.entries[rid]?.snoozeUntil === t0 + 15 * 60000);
  const after = runScan(db, reloaded, t0 + 15 * 60000);
  check("06 snooze persistence: fires after restart", after.sent.length === 1);
  rmSync(dir, { recursive: true, force: true });
}

/* =======================================================================
   7 — completing a task cancels its reminders
   ===================================================================== */
{
  const db = { tasks: [task({ id: "t7", title: "Submit report", date: "2026-03-10", dueTime: "16:00", reminder: rem(30) })], events: [] };
  const ledger = emptyLedger();
  const before = runScan(db, ledger, localMs("2026-03-10", "15:00"));
  check("07 completion: silent before the offset", before.sent.length === 0);
  db.tasks[0].completed = true; // user ticks it off
  const after = runScan(db, ledger, localMs("2026-03-10", "15:30"));
  check("07 completion: completed task never notifies", after.sent.length === 0);
}

/* =======================================================================
   8 — deleting an event cancels its reminders (incl. a pending snooze)
   ===================================================================== */
{
  const db = { tasks: [], events: [event({ id: "e8", title: "Perimeter drill", date: "2026-03-10", startTime: "10:00", reminder: rem(0) })] };
  const ledger = emptyLedger();
  const t0 = localMs("2026-03-10", "10:00");
  runScan(db, ledger, t0);
  const rid = Object.keys(ledger.entries)[0];
  applySnooze(ledger, rid, 10, t0);
  db.events = []; // deleted by the user
  const after = runScan(db, ledger, t0 + 10 * 60000);
  check("08 deletion: deleted event does not notify", after.sent.length === 0);
  check("08 deletion: pending snooze cancelled", ledger.entries[rid].state === "cancelled");
}

/* =======================================================================
   9/10/11 — recurring daily / weekly / monthly occurrences
   ===================================================================== */
{
  const daily = {
    tasks: [],
    events: [event({ id: "ed", title: "Shift briefing", date: "2026-03-01", startTime: "09:00", repeat: "daily", reminder: rem(0) })],
  };
  const { instances: di } = buildInstances(daily, localMs("2026-03-05", "00:00"), localMs("2026-03-07", "23:59"));
  check("09 daily recurrence: one occurrence per day", di.length === 3, `got ${di.length}`);
  // Start the series at the first scan so no earlier occurrence falls inside
  // the 24h catch-up window (that behaviour is covered by tests 13/14).
  const dailyFresh = {
    tasks: [],
    events: [event({ id: "ed2", title: "Shift briefing", date: "2026-03-05", startTime: "09:00", repeat: "daily", reminder: rem(0) })],
  };
  const ledger = emptyLedger();
  const d1 = runScan(dailyFresh, ledger, localMs("2026-03-05", "09:00")).sent;
  const d2 = runScan(dailyFresh, ledger, localMs("2026-03-06", "09:00")).sent;
  const d2dup = runScan(dailyFresh, ledger, localMs("2026-03-06", "09:01")).sent;
  check(
    "09 daily recurrence: each day fires exactly once",
    d1.length === 1 && d2.length === 1 && d2dup.length === 0,
    `d1=${d1.length} d2=${d2.length} dup=${d2dup.length}`,
  );
  check(
    "09 daily recurrence: distinct identity per occurrence",
    d1[0].id !== d2[0].id,
  );

  const weekly = {
    tasks: [],
    events: [event({ id: "ew", title: "Weekly sync", date: "2026-03-02", startTime: "11:00", repeat: "weekly", reminder: rem(0) })],
  };
  const { instances: wi } = buildInstances(weekly, localMs("2026-03-02", "00:00"), localMs("2026-03-30", "23:59"));
  const wdates = wi.map((i) => i.occurrenceDate);
  check(
    "10 weekly recurrence: every 7 days",
    JSON.stringify(wdates) === JSON.stringify(["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]),
    wdates.join(","),
  );

  const monthly = {
    tasks: [],
    events: [event({ id: "em", title: "Monthly review", date: "2026-01-10", startTime: "15:00", repeat: "monthly", reminder: rem(60) })],
  };
  const { instances: mi } = buildInstances(monthly, localMs("2026-01-01", "00:00"), localMs("2026-04-30", "23:59"));
  const mdates = mi.map((i) => i.occurrenceDate);
  check(
    "11 monthly recurrence: same day each month",
    JSON.stringify(mdates) === JSON.stringify(["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]),
    mdates.join(","),
  );
  check("11 monthly recurrence: offset applied to each occurrence", mi.every((i) => i.scheduledAt - i.fireAt === 3600_000));
}

/* =======================================================================
   12 — rescheduling an event recalculates its future schedule
   ===================================================================== */
{
  const db = { tasks: [], events: [event({ id: "e12", title: "Convoy window", date: "2026-03-10", startTime: "14:00", reminder: rem(30) })] };
  const ledger = emptyLedger();
  const idBefore = buildInstances(db, localMs("2026-03-09", "00:00"), localMs("2026-03-11", "00:00")).instances[0].id;
  runScan(db, ledger, localMs("2026-03-10", "13:30"));
  check("12 reschedule: original fired once", Object.keys(ledger.entries).length === 1);

  db.events[0].startTime = "18:00"; // user moves the event
  const idAfter = buildInstances(db, localMs("2026-03-09", "00:00"), localMs("2026-03-11", "00:00")).instances[0].id;
  check("12 reschedule: identity changes with the new time", idBefore !== idAfter);
  const after = runScan(db, ledger, localMs("2026-03-10", "17:30"));
  check("12 reschedule: new occurrence delivers", after.sent.length === 1);
  const dup = runScan(db, ledger, localMs("2026-03-10", "17:31"));
  check("12 reschedule: still no duplicates", dup.sent.length === 0);
}

/* =======================================================================
   13/14 — missed reminders after downtime + the 24h catch-up window
   ===================================================================== */
{
  const db = {
    tasks: [task({ id: "t13", title: "Overnight audit", date: "2026-03-10", dueTime: "02:00", reminder: rem(0) })],
    events: [],
  };
  // machine was off at 02:00; WAYPOINT starts at 08:00
  const ledger = emptyLedger();
  const boot = runScan(db, ledger, localMs("2026-03-10", "08:00"));
  check("13 missed: downtime reminder is reported", boot.sent.length === 1 && boot.sent[0].missed === true);
  check("13 missed: ledger records the missed state", Object.values(ledger.entries)[0].state === "missed");
  const again = runScan(db, ledger, localMs("2026-03-10", "08:01"));
  check("13 missed: never repeated", again.sent.length === 0);

  // outside the 24h window → silently expired, not notified
  const old = {
    tasks: [task({ id: "t14", title: "Ancient task", date: "2026-03-08", dueTime: "02:00", reminder: rem(0) })],
    events: [],
  };
  const l2 = emptyLedger();
  const r2 = runScan(old, l2, localMs("2026-03-10", "08:00"));
  check("14 catch-up window: >24h old is NOT notified", r2.sent.length === 0);

  // just inside the window → notified
  const fresh = {
    tasks: [task({ id: "t14b", title: "Yesterday task", date: "2026-03-09", dueTime: "20:00", reminder: rem(0) })],
    events: [],
  };
  const l3 = emptyLedger();
  const r3 = runScan(fresh, l3, localMs("2026-03-10", "08:00"));
  check("14 catch-up window: <24h old IS notified as missed", r3.sent.length === 1 && r3.sent[0].missed);

  // consolidation of many missed reminders
  const many = {
    tasks: Array.from({ length: 6 }, (_, i) =>
      task({ id: `tm${i}`, title: `Missed ${i}`, date: "2026-03-10", dueTime: "03:00", reminder: rem(i * 5) }),
    ),
    events: [],
    settings: { consolidateMissed: true },
  };
  const l4 = emptyLedger();
  const r4 = runScan(many, l4, localMs("2026-03-10", "08:00"));
  check("14 catch-up: many missed collapse into one summary", r4.sent.length === 1 && r4.sent[0].summary === true, `sent ${r4.sent.length}`);
  check("14 catch-up: every missed instance still ledgered", Object.keys(l4.entries).length === 6);
}

/* =======================================================================
   15 — Windows sleep/resume recalculation
   ===================================================================== */
{
  const db = {
    tasks: [],
    events: [event({ id: "e15", title: "Post-resume sync", date: "2026-03-10", startTime: "12:00", repeat: "daily", reminder: rem(0) })],
  };
  const ledger = emptyLedger();
  const beforeSleep = runScan(db, ledger, localMs("2026-03-10", "09:00"));
  check("15 resume: nothing fires before sleep", beforeSleep.sent.length === 0);
  check("15 resume: next wake computed while idle", beforeSleep.plan.nextWakeAt === localMs("2026-03-10", "12:00"));
  // machine suspends 09:00 → 14:00; the resume handler triggers a rescan
  const onResume = runScan(db, ledger, localMs("2026-03-10", "14:00"));
  check("15 resume: the slept-through occurrence is caught", onResume.sent.length === 1 && onResume.sent[0].missed === true);
  // tomorrow's occurrence is scheduled fresh
  const tomorrow = runScan(db, ledger, localMs("2026-03-11", "12:00"));
  check("15 resume: following day still schedules", tomorrow.sent.length === 1 && tomorrow.sent[0].missed === false);
}

/* =======================================================================
   16 — corrupted / missing ledger recovery
   ===================================================================== */
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "wpt-corrupt-"));
  const file = path.join(dir, "waypoint-reminder-ledger.json");

  writeFileSync(file, "{ this is not json");
  check("16 corrupt ledger: truncated JSON → empty ledger", Object.keys(readLedger(dir).entries).length === 0);

  writeFileSync(file, JSON.stringify({ entries: "not-an-object" }));
  check("16 corrupt ledger: wrong shape → empty ledger", Object.keys(readLedger(dir).entries).length === 0);

  writeFileSync(file, JSON.stringify({ entries: { a: { id: "a", state: "bogus" }, b: { id: "b", state: "delivered" } } }));
  const partial = readLedger(dir);
  check("16 corrupt ledger: invalid rows dropped, valid kept", !partial.entries.a && !!partial.entries.b);

  // the engine still runs on a recovered ledger, and user data is untouched
  const db = { tasks: [task({ id: "t16", title: "After recovery", date: "2026-03-10", dueTime: "10:00", reminder: rem(0) })], events: [] };
  const r = runScan(db, partial, localMs("2026-03-10", "10:00"));
  check("16 corrupt ledger: scheduling continues after recovery", r.sent.length === 1);

  check("16 sanitize: null/array inputs are safe", Object.keys(sanitizeLedger(null).entries).length === 0 && Object.keys(sanitizeLedger([1, 2]).entries).length === 0);

  // atomic write leaves valid JSON
  writeLedgerAtomic(dir, partial);
  const roundTrip = JSON.parse(readFileSync(file, "utf-8"));
  check("16 atomic write: file is valid JSON after write", typeof roundTrip.entries === "object");
  rmSync(dir, { recursive: true, force: true });
}

/* =======================================================================
   17 — v2 database migration (legacy single-offset reminders)
   ===================================================================== */
{
  check("17 migration: legacy enabled+minutesBefore → offsets", JSON.stringify(normalizeOffsets({ enabled: true, minutesBefore: 30 })) === "[30]");
  check("17 migration: disabled legacy reminder → no offsets", normalizeOffsets({ enabled: false, minutesBefore: 30 }).length === 0);
  check("17 migration: missing reminder is safe", normalizeOffsets(undefined).length === 0);
  check("17 migration: new offsets array wins", JSON.stringify(normalizeOffsets({ offsets: [15, 0, 15, 60] })) === "[0,15,60]");
  check("17 migration: junk values filtered", JSON.stringify(normalizeOffsets({ offsets: [15, -5, "x", null, 30] })) === "[15,30]");

  // a v2-shaped database schedules identically to an explicit v3 one
  const v2 = { tasks: [task({ id: "t17", title: "Legacy task", date: "2026-03-10", dueTime: "12:00", reminder: { enabled: true, minutesBefore: 15 } })], events: [] };
  const v3 = { tasks: [task({ id: "t17", title: "Legacy task", date: "2026-03-10", dueTime: "12:00", reminder: rem(15) })], events: [] };
  const a = buildInstances(v2, localMs("2026-03-09", "00:00"), localMs("2026-03-11", "00:00")).instances;
  const b = buildInstances(v3, localMs("2026-03-09", "00:00"), localMs("2026-03-11", "00:00")).instances;
  check("17 migration: legacy record schedules identically", JSON.stringify(a) === JSON.stringify(b));
}

/* =======================================================================
   18 — existing task & event records preserved end-to-end
   ===================================================================== */
{
  const payload = {
    version: 3,
    state: {
      settings: { operatorName: "SYSOP", notificationsEnabled: true },
      tasks: [
        task({ id: "keep1", title: "Existing task", date: "2026-03-10", dueTime: "09:00", reminder: { enabled: true, minutesBefore: 5 } }),
        task({ id: "keep2", title: "Completed one", date: "2026-03-10", dueTime: "09:00", completed: true, reminder: rem(5) }),
      ],
      events: [event({ id: "keep3", title: "Existing event", date: "2026-03-10", startTime: "17:00", reminder: rem(0) })],
    },
  };
  const file = JSON.stringify({ "waypoint.db.v1": JSON.stringify(payload) });
  const { db, ok } = parseDb(file);
  check("18 preservation: two-layer store decodes", ok === true);
  check("18 preservation: all tasks present", db.tasks.length === 2);
  check("18 preservation: all events present", db.events.length === 1);
  check("18 preservation: settings readable by the engine", db.settings.operatorName === "SYSOP");

  const ledger = emptyLedger();
  const r = runScan(db, ledger, localMs("2026-03-10", "08:55"));
  check("18 preservation: legacy reminder on an existing record fires", r.sent.length === 1 && r.sent[0].title === "Existing task");

  const bad = parseDb("{not json");
  check("18 preservation: malformed store never throws", bad.ok === false && bad.db.tasks.length === 0);
}

/* =======================================================================
   extra — tasks without a due time are reported, never invented
   ===================================================================== */
{
  const db = { tasks: [task({ id: "tx", title: "No time task", date: "2026-03-10", reminder: rem(15) })], events: [] };
  const { instances, unschedulable } = buildInstances(db, localMs("2026-03-09", "00:00"), localMs("2026-03-11", "00:00"));
  check("19 no-due-time task is not scheduled silently", instances.length === 0 && unschedulable.length === 1 && unschedulable[0].reason === "NO_DUE_TIME");
}

/* =======================================================================
   extra — master notification switch
   ===================================================================== */
{
  const db = {
    tasks: [task({ id: "t20", title: "Muted", date: "2026-03-10", dueTime: "10:00", reminder: rem(0) })],
    events: [],
    settings: { notificationsEnabled: false },
  };
  const ledger = emptyLedger();
  const r = runScan(db, ledger, localMs("2026-03-10", "10:00"));
  check("20 master switch: no delivery when notifications are disabled", r.sent.length === 0);
}

/* --------------------------------------------------------------- report */
console.log("\n—— WAYPOINT REMINDER ENGINE TESTS ——");
for (const r of results) console.log(r);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
