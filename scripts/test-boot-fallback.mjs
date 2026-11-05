import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, ipcMain, windows } from 'electron';
const scenario = process.argv[2];
if (!['renderer-failure','manual-during-boot','startup-during-boot','startup-without-window'].includes(scenario)) throw new Error('Unknown scenario');
const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-boot-'));
process.env.WAYPOINT_TEST_DIR = dir;
process.env.WAYPOINT_TEST = '1';
process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
try {
  await import('../dist-electron/main.js');
  await new Promise(r => setImmediate(r));
  let main = windows[0];
  if (scenario === 'startup-without-window') { main.destroy(); main = null; }
  else main.hide();
  assert.equal(windows.length, 1, 'manual launch opens only the console');
  app.emit('second-instance', {}, ['waypoint', '--waypoint-startup']);
  await new Promise(r => setImmediate(r));
  if (scenario === 'startup-without-window') {
    main = windows[1];
    assert(main && !main.visible, 'a missing console boots hidden for startup');
    assert.equal(windows.filter(w => !w.destroyed).length, 1);
  } else {
    assert.equal(windows.length, 1, 'automatic briefing waits for boot');
    assert.equal(main.visible, false, 'startup never restores tray-hidden console');
  }
  if (scenario === 'startup-during-boot' || scenario === 'startup-without-window') {
    ipcMain.emit('waypoint:boot-complete', {sender:main.webContents,senderFrame:main.webContents.mainFrame});
    assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1, 'startup request releases only after boot');
    app.emit('second-instance', {}, ['waypoint', '--waypoint-startup']);
    await new Promise(r => setImmediate(r));
    assert.equal(windows.filter(w => !w.destroyed && w.options.title.includes('Daily Briefing')).length, 1, 'repeated startup does not duplicate briefing');
    assert.equal(main.visible, false);
  } else if (scenario === 'renderer-failure') {
    main.webContents.emit('did-fail-load', {}, -3, 'aborted', '', true);
    assert.equal(windows.length, 1, 'aborted navigations do not release briefing');
    main.webContents.emit('render-process-gone');
    assert.equal(windows.length, 1, 'renderer failure must not bypass boot handshake');
    main.webContents.navigate('http://localhost:5173/');
    ipcMain.emit('waypoint:boot-complete', {sender:main.webContents,senderFrame:main.webContents.mainFrame});
    assert.equal(windows.length, 2, 'queued briefing opens after recovered renderer finishes boot');
  } else {
    globalThis.__waypointDebug.createBriefingWindow();
    assert.equal(windows.length, 2);
    windows[1].destroy();
    ipcMain.emit('waypoint:boot-complete', {sender:main.webContents,senderFrame:main.webContents.mainFrame});
    assert.equal(windows.length, 2, 'dismissed manual briefing is not reopened by queued startup');
  }
  app.emit('before-quit');
  console.log(`Boot fallback ${scenario} passed (mock Electron)`);
} finally { await rm(dir, {recursive:true, force:true}); }
