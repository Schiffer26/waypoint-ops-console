// Real main-process lifecycle/IPC handlers, using mocked Electron windows.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handlers, windows, app, ipcMain } from 'electron';

const scenario = process.argv[2];
if (!['manual', 'startup', 'disabled', 'startup-disabled'].includes(scenario)) throw new Error('Missing scenario');
if (scenario === 'startup' || scenario === 'startup-disabled') process.argv.push('--waypoint-startup');
const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-startup-'));
process.env.WAYPOINT_TEST_DIR = dir;
process.env.WAYPOINT_TEST = '1';
process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
const key = 'waypoint.db.v1';
const data = {version:4, state:{tasks:[], events:[], categories:[], settings:{briefingAtLogin:!scenario.includes('disabled'),operatorName:'TEST',theme:'dark',hour24:true}}};
const invoke = (name, win, ...args) => Promise.resolve().then(() => handlers.get(`waypoint:${name}`)({sender:win.webContents,senderFrame:win.webContents.mainFrame}, ...args));
try {
  await writeFile(path.join(dir, 'waypoint-store.json'), JSON.stringify({[key]:JSON.stringify(data)}));
  // Exercise the Windows-only initialization branch on non-Windows test hosts.
  if (process.argv.includes('--simulate-windows')) Object.defineProperty(process, 'platform', { value: 'win32' });
  await import('../dist-electron/main.js');
  await new Promise(r => setImmediate(r));
  if (process.platform === 'win32') assert.equal(app.appUserModelId, 'com.waypoint.console', 'Windows app identity should be registered');
  let briefing = windows.find(w => w.options.title.includes('Daily Briefing'));
  let main = windows.find(w => w.options.title.includes('Personal Operations'));
  if (scenario.includes('disabled')) {
    if (scenario === 'startup-disabled') {
      assert(!main && !briefing, 'disabled Windows startup remains tray-dormant');
      globalThis.__waypointDebug.showMainWindow();
      main = windows.find(w => w.options.title.includes('Personal Operations'));
    }
    assert(main && !briefing, 'disabled preference must suppress automatic briefing');
  } else {
    assert(main && !briefing, `${scenario} must wait for console boot`);
    const event = {sender: main.webContents, senderFrame: main.webContents.mainFrame};
    ipcMain.emit('waypoint:boot-complete', {sender: main.webContents, senderFrame: {}});
    assert.equal(windows.filter(w => w.options.title.includes('Daily Briefing')).length, 0, 'subframes cannot signal readiness');
    app.emit('second-instance', {}, ['waypoint']);
    await new Promise(r => setImmediate(r));
    assert.equal(windows.filter(w => w.options.title.includes('Daily Briefing')).length, 0, 'repeated launch still waits for boot');
    ipcMain.emit('waypoint:boot-complete', event);
    ipcMain.emit('waypoint:boot-complete', event);
    briefing = windows.find(w => w.options.title.includes('Daily Briefing'));
    assert(briefing, `${scenario} should open briefing after boot`);
    const bounds = briefing.getBounds();
    const center = main.getBounds().x + main.getBounds().width / 2;
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 1920 && bounds.y >= 0 && bounds.y + bounds.height <= 1080);
    assert(bounds.x + bounds.width <= center - 250 || bounds.x >= center + 250, 'briefing does not cover the login panel');
    assert.equal(briefing.visible, false, 'briefing stays hidden until ready-to-show');
    globalThis.__waypointDebug.createBriefingWindow();
    assert.equal(briefing.showCount, 0, 'duplicate request must not show before ready');
    assert.equal(briefing.focusCount, 0, 'duplicate request must not focus before ready');
    assert.equal(windows.filter(w => w.options.title.includes('Daily Briefing')).length, 1);
    briefing.emit('ready-to-show');
    assert.equal(briefing.visible, true);
    assert((await invoke('briefing:snapshot', briefing)).includes('TEST'));
    await invoke('open-main', briefing);
    main = windows.find(w => w.options.title.includes('Personal Operations'));
    assert(main, 'briefing opens the main window');
    await assert.rejects(invoke('storage:read', main, key), /authentication required/);
    await assert.rejects(invoke('storage:read', briefing, key), /Authorization denied/);
  }
  assert(main);
  await invoke('auth:create', main, 'operator', 'strong access key');
  const beforeShow = briefing?.showCount;
  const beforeFocus = briefing?.focusCount;
  await invoke('briefing:open', main); // Settings uses this same IPC
  if (briefing) {
    assert.equal(briefing.showCount, beforeShow + 1, 'ready briefing is shown again');
    assert.equal(briefing.focusCount, beforeFocus + 1, 'ready briefing is focused');
  }
  if (scenario.includes('disabled')) {
    briefing = windows.find(w => w.options.title.includes('Daily Briefing'));
    assert(briefing, 'manual Settings preview works with preference disabled');
    briefing.emit('ready-to-show');
  }
  assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  assert(briefing.visible);
  if (!scenario.includes('disabled')) {
    app.emit('second-instance', {}, ['waypoint']);
    await new Promise(r => setImmediate(r));
    assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
    main.hide();
    app.emit('second-instance', {}, ['waypoint', '--waypoint-startup']);
    await new Promise(r => setImmediate(r));
    assert.equal(main.visible, false, 'startup activation does not expose an existing tray-hidden console');
    assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  }
  briefing.destroy();
  await invoke('briefing:open', main);
  const replacement = windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing'));
  assert.equal(replacement.length, 1, 'briefing can reopen after close');
  const next = replacement[0];
  assert.equal(next.visible, false, 'replacement must wait for ready-to-show');
  await invoke('briefing:open', main);
  assert.equal(next.showCount, 0, 'closed window readiness must not leak to replacement');
  assert.equal(next.focusCount, 0, 'replacement must not be focused during load');
  assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  // A stale closed event must not clear the current window or its readiness.
  briefing.emit('closed');
  await invoke('briefing:open', main);
  assert.equal(next.showCount, 0);
  assert.equal(next.focusCount, 0);
  assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1);
  next.emit('ready-to-show');
  assert(next.visible);
  await invoke('briefing:open', main);
  assert.equal(next.showCount, 2, 'ready replacement can be shown');
  assert.equal(next.focusCount, 1, 'ready replacement can be focused');
  next.destroy();
  await invoke('briefing:open', main);
  const loading = windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing'))[0];
  loading.destroy(); // close before the first paint
  loading.emit('ready-to-show');
  assert.equal(loading.showCount, 0, 'a destroyed window must not show on a late ready event');
  await invoke('briefing:open', main);
  const final = windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing'));
  assert.equal(final.length, 1, 'closing during load allows one fresh window');
  await invoke('briefing:open', main);
  assert.equal(final[0].showCount, 0);
  assert.equal(final[0].focusCount, 0);
  final[0].emit('ready-to-show');
  assert(final[0].visible);
  app.emit('before-quit');
  console.log(`Briefing ${scenario} startup/Settings/security lifecycle passed (mock Electron)`);
} finally { await rm(dir, {recursive:true, force:true}); }
