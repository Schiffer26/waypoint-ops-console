/**
 * SEC.06 — SETTINGS
 * Profile, preferences, category matrix, data control (export / import /
 * reset) and the Windows system-integration panel. Desktop-only features
 * are clearly labelled when running in the web preview instead of faked.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AppWindow,
  BellRing,
  History as HistoryIcon,
  Volume2,
  Download,
  FolderDown,
  Moon,
  Plus,
  Power,
  RefreshCw,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import type { OpsData, ThemeMode } from "@/types";
import type { SchedulerStatus } from "@/types/desktop";
import { useOpsStore } from "@/store/useOpsStore";
import { useShell } from "@/lib/shell";
import { bridge, isDesktop, resolveStorageBackend } from "@/lib/storage";
import { resolveTheme, useSystemDark } from "@/lib/theme";
import { fmtStamp } from "@/lib/time";
import NotificationHistory from "@/components/NotificationHistory";
import { CATEGORY_PALETTE } from "@/data/seed";
import { instantChild, riseChild, staggerParent } from "@/lib/motion";
import { Btn, Micro, PageHead, SectionHead, StatusDot, Switch } from "@/components/ui/primitives";
import { cn } from "@/utils/cn";

interface Caps {
  notifications: boolean;
  autoLaunch: boolean;
  tray: boolean;
  briefing: boolean;
  storage: boolean;
}

export default function Settings() {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const itemV = reduce ? instantChild : riseChild;

  const settings = useOpsStore((s) => s.settings);
  const categories = useOpsStore((s) => s.categories);
  const updateSettings = useOpsStore((s) => s.updateSettings);
  const addCategory = useOpsStore((s) => s.addCategory);
  const deleteCategory = useOpsStore((s) => s.deleteCategory);
  const tasks = useOpsStore((s) => s.tasks);
  const events = useOpsStore((s) => s.events);
  const replaceAll = useOpsStore((s) => s.replaceAll);
  const factoryReset = useOpsStore((s) => s.factoryReset);

  const [name, setName] = useState(settings.operatorName);
  const [sysmsg, setSysmsg] = useState<string | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CATEGORY_PALETTE[1]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [schedStatus, setSchedStatus] = useState<SchedulerStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setSysmsg(msg);
    window.setTimeout(() => setSysmsg(null), 4000);
  };

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    b.capabilities().then(setCaps).catch(() => setCaps(null));
    b.getAutoLaunch().then(setAutoLaunch).catch(() => {});
    const poll = () => {
      b.reminders?.status().then(setSchedStatus).catch(() => {});
    };
    poll();
    const t = window.setInterval(poll, 10_000);
    return () => window.clearInterval(t);
  }, []);

  const commitName = () => {
    const v = name.trim().toUpperCase().slice(0, 24);
    if (!v) return setName(settings.operatorName);
    updateSettings({ operatorName: v });
    setName(v);
    flash(`OPERATOR CALLSIGN UPDATED → ${v}`);
  };

  const testNotification = async () => {
    const b = bridge();
    if (b) {
      const ok = await b.notify({
        title: "WAYPOINT — SYSTEM CHECK",
        body: "Windows notification pipeline is operational.",
      });
      flash(ok ? "NOTIFICATION DISPATCHED VIA DESKTOP BRIDGE" : "DESKTOP BRIDGE REJECTED DISPATCH");
      return;
    }
    if (!("Notification" in window)) {
      flash("NOTIFICATIONS UNSUPPORTED IN THIS ENVIRONMENT");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      new Notification("WAYPOINT — SYSTEM CHECK", {
        body: "Web notification pipeline is operational. Desktop build routes via Windows.",
      });
      flash("NOTIFICATION DISPATCHED VIA BROWSER CHANNEL");
    } else {
      flash("PERMISSION DENIED — NOTIFICATION CHANNEL BLOCKED");
    }
  };

  const toggleAutoLaunch = async (v: boolean) => {
    const b = bridge();
    if (!b) return;
    const applied = await b.setAutoLaunch(v);
    setAutoLaunch(applied);
    flash(applied ? "AUTO-LAUNCH ARMED — RUNS AT WINDOWS LOGIN" : "AUTO-LAUNCH DISARMED");
  };

  const exportData = () => {
    const payload = {
      app: "WAYPOINT",
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks,
      events,
      categories,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `waypoint-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("DATA EXPORTED — ARCHIVE WRITTEN TO DOWNLOADS");
  };

  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Partial<OpsData>;
        if (!Array.isArray(data.tasks) || !Array.isArray(data.events) || !Array.isArray(data.categories)) {
          throw new Error("schema");
        }
        shell.confirm({
          title: "RESTORE IMPORTED ARCHIVE",
          body: `Archive contains ${data.tasks.length} tasks and ${data.events.length} events. Current data will be replaced.`,
          confirmLabel: "RESTORE",
          danger: true,
          onConfirm: () => {
            replaceAll({
              tasks: data.tasks ?? [],
              events: data.events ?? [],
              categories: data.categories ?? [],
              settings: data.settings ?? settings,
            });
            flash("ARCHIVE RESTORED — REGISTRY REPLACED");
          },
        });
      } catch {
        flash("IMPORT FAILED — INVALID WAYPOINT ARCHIVE");
      }
    };
    reader.readAsText(file);
  };

  const desktopLive = isDesktop();
  const systemDark = useSystemDark();
  const effectiveTheme = resolveTheme(settings.theme, systemDark);

  const appearanceOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "system", label: "SYSTEM DEFAULT", icon: AppWindow },
    { value: "light", label: "LIGHT MODE", icon: Sun },
    { value: "dark", label: "DARK MODE", icon: Moon },
  ];

  const previewBriefing = () => {
    const b = bridge();
    if (b) void b.openBriefing();
    else window.open(`${window.location.pathname}?window=briefing`, "_blank", "width=440,height=640");
  };

  return (
    <motion.div variants={reduce ? undefined : staggerParent} initial="hidden" animate="show">
      <PageHead
        no="SEC.06"
        title="Settings"
        sub="CONSOLE CONFIGURATION & SYSTEM INTEGRATION"
        right={
          sysmsg ? (
            <motion.div
              key={sysmsg}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="tag bg-acid text-acidink border border-acidink"
            >
              <StatusDot color="var(--color-ink)" /> {sysmsg}
            </motion.div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 lg:gap-5 items-start">
        {/* ================= 00 APPEARANCE ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5 xl:col-span-2">
          <SectionHead
            no="00"
            title="Appearance"
            right={
              <Micro className="tnum">
                OS REPORTS: {systemDark ? "DARK" : "LIGHT"} — EFFECTIVE: {effectiveTheme.toUpperCase()}
              </Micro>
            }
          />
          <div className="grid grid-cols-3 border border-line">
            {appearanceOptions.map((opt) => {
              const active = settings.theme === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    updateSettings({ theme: opt.value });
                    flash(`APPEARANCE PROTOCOL → ${opt.label}`);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2.5 px-3 py-3.5 micro-lg border-r border-line last:border-r-0 transition-colors",
                    active ? "bg-chrome text-acid" : "text-mute hover:text-ink hover:bg-surface2",
                  )}
                >
                  <Icon size={14} />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <Micro className="block mt-4 normal-case tracking-wide text-mute/80">
            System Default tracks the Windows appearance setting live. Manual selections override
            the OS across every panel, modal, calendar and notification surface.
          </Micro>
        </motion.section>

        {/* ================= 01 PROFILE ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5">
          <SectionHead no="01" title="Operator Profile" />
          <Micro className="block mb-1.5">CALLSIGN / DISPLAY NAME</Micro>
          <div className="flex gap-2">
            <input
              className="field font-semibold uppercase"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && commitName()}
            />
            <Btn variant="dark" onClick={commitName}>
              SET
            </Btn>
          </div>
          <Micro className="block mt-4 normal-case tracking-wide text-mute/80">
            Used in the dashboard briefing greeting. Stored locally only.
          </Micro>
        </motion.section>

        {/* ================= 02 PREFERENCES ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5">
          <SectionHead no="02" title="Preferences" />
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wide">
                  24-Hour Clock
                </div>
                <Micro className="normal-case tracking-wide">Affects all timestamps</Micro>
              </div>
              <Switch
                checked={settings.hour24}
                onChange={(v) => updateSettings({ hour24: v })}
                label="24-hour clock"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-dashed border-line pt-4">
              <div>
                <div className="text-[13px] font-semibold uppercase tracking-wide">Week Start</div>
                <Micro className="normal-case tracking-wide">Calendar grid alignment</Micro>
              </div>
              <div className="flex border border-line">
                {([1, 0] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => updateSettings({ weekStartsOn: v })}
                    className={cn(
                      "px-3.5 py-2 micro transition-colors",
                      settings.weekStartsOn === v ? "bg-chrome text-acid" : "text-mute hover:text-ink",
                    )}
                  >
                    {v === 1 ? "MON" : "SUN"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ================= 03 CATEGORY MATRIX ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5">
          <SectionHead no="03" title="Category Matrix" right={<Micro>x{categories.length}</Micro>} />
          <div className="space-y-1.5 mb-5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border border-line px-3 py-2 bg-surface">
                <span className="size-4 border border-ink/40 flex-none" style={{ background: c.color }} />
                <span className="micro-lg w-10 flex-none">{c.code}</span>
                <span className="text-[13px] font-medium flex-1 truncate">{c.name}</span>
                <button
                  className="icon-btn danger size-[24px]"
                  title="Delete category (records reassigned to first category)"
                  onClick={() =>
                    shell.confirm({
                      title: "DELETE CATEGORY",
                      body: `“${c.name}” will be removed; its tasks and events will be reassigned to the first remaining category.`,
                      confirmLabel: "DELETE",
                      danger: true,
                      onConfirm: () => deleteCategory(c.id),
                    })
                  }
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <Micro className="block mb-2">REGISTER NEW CATEGORY</Micro>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="field w-20! uppercase"
              placeholder="CODE"
              maxLength={3}
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            />
            <input
              className="field flex-1 min-w-[140px]"
              placeholder="Designation"
              maxLength={24}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-1">
              {CATEGORY_PALETTE.map((col) => (
                <button
                  key={col}
                  aria-label={`color ${col}`}
                  onClick={() => setNewColor(col)}
                  className={cn(
                    "size-7 border transition-transform",
                    newColor === col ? "border-acidink scale-110 shadow-[2px_2px_0_var(--color-chrome)]" : "border-line",
                  )}
                  style={{ background: col }}
                />
              ))}
            </div>
            <Btn
              variant="dark"
              disabled={!newCode || !newName.trim()}
              onClick={() => {
                addCategory({ code: newCode, name: newName.trim(), color: newColor });
                setNewCode("");
                setNewName("");
                flash("CATEGORY REGISTERED");
              }}
            >
              <Plus size={12} /> ADD
            </Btn>
          </div>
        </motion.section>

        {/* ================= 04 DATA CONTROL ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5">
          <SectionHead no="04" title="Data Control" />
          <div className="micro text-mute normal-case tracking-wide mb-4">
            Backend: {resolveStorageBackend().name} — {tasks.length} tasks · {events.length} events
            on record. All data stays on this machine.
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="dark" onClick={exportData}>
              <Download size={12} /> EXPORT JSON
            </Btn>
            <Btn variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> IMPORT JSON
            </Btn>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importData(f);
                e.target.value = "";
              }}
            />
            <Btn
              variant="ghost"
              onClick={() =>
                shell.confirm({
                  title: "RESTORE SAMPLE DATA",
                  body: "The registry will be replaced with the default demonstration dataset.",
                  confirmLabel: "RESTORE",
                  onConfirm: () => {
                    factoryReset(true);
                    flash("SAMPLE DATASET RESTORED");
                  },
                })
              }
            >
              <RefreshCw size={12} /> SAMPLE DATA
            </Btn>
            <Btn
              variant="ghost"
              onClick={() =>
                shell.confirm({
                  title: "PURGE ALL DATA",
                  body: "Every task, event and custom category will be permanently erased from local storage.",
                  confirmLabel: "PURGE EVERYTHING",
                  danger: true,
                  onConfirm: () => {
                    factoryReset(false);
                    flash("LOCAL STORE PURGED");
                  },
                })
              }
            >
              <Trash2 size={12} /> PURGE ALL
            </Btn>
          </div>
        </motion.section>

        {/* ================= 05 REMINDER ENGINE ================= */}
        <motion.section variants={itemV} className="panel px-6 py-5 xl:col-span-2">
          <SectionHead
            no="05"
            title="Reminder Engine"
            right={
              <Micro className="tnum">
                {desktopLive
                  ? `BACKGROUND SCHEDULER · ${schedStatus?.running ? "RUNNING" : "IDLE"}${
                      schedStatus ? ` · ${schedStatus.upcoming} QUEUED` : ""
                    }`
                  : "WEB PREVIEW — RENDERER FALLBACK"}
              </Micro>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wide">
                    All Notifications
                  </div>
                  <Micro className="normal-case tracking-wide">
                    Master switch for reminder delivery
                  </Micro>
                </div>
                <Switch
                  checked={settings.notificationsEnabled}
                  onChange={(v) => {
                    updateSettings({ notificationsEnabled: v });
                    flash(v ? "REMINDER ENGINE ARMED" : "ALL NOTIFICATIONS SUPPRESSED");
                  }}
                  label="all notifications"
                />
              </div>

              <div className="border-t border-dashed border-line pt-4">
                <Micro className="block mb-2">NOTIFICATION SOUND</Micro>
                <div className="grid grid-cols-3 border border-line">
                  {(
                    [
                      { v: "subtle", label: "SUBTLE" },
                      { v: "system", label: "SYSTEM" },
                      { v: "silent", label: "SILENT" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      onClick={() => {
                        updateSettings({ notificationSound: o.v });
                        flash(`SOUND PROFILE → ${o.label}`);
                      }}
                      className={cn(
                        "px-2 py-2.5 micro border-r border-line last:border-r-0 transition-colors",
                        settings.notificationSound === o.v
                          ? "bg-chrome text-acid"
                          : "text-mute hover:text-ink",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <Micro className="block mt-2 normal-case tracking-wide text-mute/80">
                  SUBTLE plays a bundled tone through WAYPOINT (the toast itself is muted);
                  SYSTEM uses the standard Windows notification sound.
                </Micro>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-4">
                <Btn
                  variant="dark"
                  onClick={async () => {
                    const b = bridge();
                    if (b?.reminders) {
                      const ok = await b.reminders.test();
                      flash(ok ? "TEST NOTIFICATION DISPATCHED" : "NOTIFICATIONS UNSUPPORTED");
                    } else {
                      await testNotification();
                    }
                  }}
                >
                  <BellRing size={12} /> TEST NOTIFICATION
                </Btn>
                <Btn
                  variant="ghost"
                  onClick={async () => {
                    const b = bridge();
                    if (!b?.reminders) return flash("SOUND TEST REQUIRES THE DESKTOP BUILD");
                    const ok = await b.reminders.testSound(settings.notificationSound);
                    flash(ok ? "SOUND TEST PLAYED" : "SOUND ASSET UNAVAILABLE — CHECK PACKAGING");
                  }}
                >
                  <Volume2 size={12} /> TEST SOUND
                </Btn>
                <Btn variant="ghost" onClick={() => setHistoryOpen(true)}>
                  <HistoryIcon size={12} /> HISTORY
                </Btn>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wide">
                    Missed Reminder Catch-up
                  </div>
                  <Micro className="normal-case tracking-wide">
                    Replay reminders missed while offline (24h window)
                  </Micro>
                </div>
                <Switch
                  checked={settings.catchUpMissed}
                  onChange={(v) => {
                    updateSettings({ catchUpMissed: v });
                    flash(v ? "CATCH-UP ENABLED — 24H LOOK-BACK" : "CATCH-UP DISABLED");
                  }}
                  label="missed catch-up"
                />
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-dashed border-line pt-4">
                <div>
                  <div className="text-[13px] font-semibold uppercase tracking-wide">
                    Consolidate Missed
                  </div>
                  <Micro className="normal-case tracking-wide">
                    Summarise instead of flooding the Action Center
                  </Micro>
                </div>
                <Switch
                  checked={settings.consolidateMissed}
                  onChange={(v) => {
                    updateSettings({ consolidateMissed: v });
                    flash(v ? "MISSED REMINDERS WILL BE SUMMARISED" : "MISSED SENT INDIVIDUALLY");
                  }}
                  label="consolidate missed"
                />
              </div>

              <div className="border-t border-dashed border-line pt-4 space-y-1.5">
                <Micro className="block">ENGINE DIAGNOSTICS</Micro>
                <Micro className="block text-mute/80 normal-case tracking-wide tnum">
                  Last scan:{" "}
                  {schedStatus?.lastScanAt
                    ? fmtStamp(schedStatus.lastScanAt, settings.hour24)
                    : "—"}
                </Micro>
                <Micro className="block text-mute/80 normal-case tracking-wide tnum">
                  Next wake:{" "}
                  {schedStatus?.nextWakeAt
                    ? fmtStamp(schedStatus.nextWakeAt, settings.hour24)
                    : "no reminders queued"}
                </Micro>
                {schedStatus && schedStatus.unschedulable.length > 0 && (
                  <div className="border border-acidink bg-acid px-3 py-2 mt-2">
                    <Micro className="block text-acidink">
                      {schedStatus.unschedulable.length} ENTRY(S) CANNOT BE SCHEDULED
                    </Micro>
                    <Micro className="block text-acidink/80 normal-case tracking-wide mt-1">
                      Reminders are set but no due time is specified — open the record and add a
                      time:{" "}
                      {schedStatus.unschedulable
                        .slice(0, 3)
                        .map((u) => u.title)
                        .join(", ")}
                    </Micro>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ================= 06 SYSTEM INTEGRATION ================= */}
        <motion.section
          variants={itemV}
          className="panel-ink xl:col-span-2 relative overflow-hidden"
        >
          <div className="absolute inset-0 grid-bg-dark pointer-events-none" />
          <div className="relative px-6 py-6">
            <SectionHead
              no="06"
              title="System Integration"
              light
              right={
                <span className={cn("tag border", desktopLive ? "bg-mint text-acidink border-mint" : "tag-outline border-white/25! text-fog/60!")}>
                  <StatusDot color={desktopLive ? "var(--color-ink)" : "var(--color-acid)"} />
                  {desktopLive ? "DESKTOP BRIDGE LIVE" : "WEB PREVIEW — BRIDGE STANDBY"}
                </span>
              }
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
              {/* notifications */}
              <div className="border border-white/15 p-4">
                <div className="flex items-center gap-2.5">
                  <BellRing size={15} className="text-acid flex-none" />
                  <span className="font-display font-semibold text-fog text-[13px] uppercase tracking-wide">
                    Notifications
                  </span>
                </div>
                <Micro className="block mt-2 text-fog/50!">
                  CHANNEL: {desktopLive ? "WINDOWS ACTION CENTER" : "BROWSER FALLBACK"}
                </Micro>
                {caps && (
                  <Micro className="block mt-1 text-fog/50!">
                    STATUS: {caps.notifications ? "OPERATIONAL" : "UNAVAILABLE"}
                  </Micro>
                )}
                <Btn variant="acid" className="mt-4 py-2!" onClick={testNotification}>
                  RUN TEST
                </Btn>
              </div>
              {/* startup */}
              <div className="border border-white/15 p-4">
                <div className="flex items-center gap-2.5">
                  <Power size={15} className="text-acid flex-none" />
                  <span className="font-display font-semibold text-fog text-[13px] uppercase tracking-wide">
                    Startup
                  </span>
                </div>
                <Micro className="block mt-2 text-fog/50!">
                  {desktopLive
                    ? "REGISTERED VIA —WAYPOINT-STARTUP LOGIN ARG"
                    : "REQUIRES PACKAGED DESKTOP BUILD"}
                </Micro>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="micro text-fog/70">LAUNCH AT LOGIN</span>
                    <span className="flex items-center gap-2">
                      <Micro className={autoLaunch ? "text-mint!" : "text-fog/50!"}>
                        {autoLaunch ? "ARMED" : "DISARMED"}
                      </Micro>
                      <Switch
                        checked={autoLaunch}
                        onChange={toggleAutoLaunch}
                        disabled={!desktopLive}
                        label="launch at login"
                      />
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                    <span className="micro text-fog/70">DAILY BRIEFING AT LOGIN</span>
                    <span className="flex items-center gap-2">
                      <Micro className={settings.briefingAtLogin ? "text-mint!" : "text-fog/50!"}>
                        {settings.briefingAtLogin ? "ON" : "OFF"}
                      </Micro>
                      <Switch
                        checked={settings.briefingAtLogin}
                        onChange={(v) => {
                          updateSettings({ briefingAtLogin: v });
                          flash(
                            v
                              ? "DAILY BRIEFING WILL OPEN AT NEXT LOGIN LAUNCH"
                              : "DAILY BRIEFING SUPPRESSED AT LOGIN",
                          );
                        }}
                        label="daily briefing at login"
                      />
                    </span>
                  </div>
                </div>
                <Btn variant="ghost" className="mt-4 py-2! border-white/25! text-fog/80!" onClick={previewBriefing}>
                  PREVIEW BRIEFING
                </Btn>
              </div>
              {/* tray */}
              <div className="border border-white/15 p-4">
                <div className="flex items-center gap-2.5">
                  <FolderDown size={15} className="text-acid flex-none" />
                  <span className="font-display font-semibold text-fog text-[13px] uppercase tracking-wide">
                    System Tray
                  </span>
                </div>
                <Micro className="block mt-2 text-fog/50!">
                  {caps?.tray ? "TRAY AGENT ACTIVE" : "REQUIRES PACKAGED DESKTOP BUILD"}
                </Micro>
                <div className="mt-4 flex items-center gap-2">
                  <span className="tag tag-outline border-white/25! text-fog/60!">
                    <StatusDot color={caps?.tray ? "var(--color-mint)" : "var(--color-acid)"} />
                    {caps?.tray ? "ACTIVE" : "DESKTOP ONLY"}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 border-t border-white/10 pt-3 flex items-start gap-2">
              <TriangleAlert size={12} className="text-acid mt-0.5 flex-none" />
              <Micro className="text-fog/45! normal-case tracking-wide">
                Integration hooks ship in the Electron main process (electron/main.ts). Features not
                yet wired are explicitly labelled above — nothing in this console pretends to work.
              </Micro>
            </div>
          </div>
        </motion.section>
      </div>

      <AnimatePresence>
        {historyOpen && <NotificationHistory onClose={() => setHistoryOpen(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}
