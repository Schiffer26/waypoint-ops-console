import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, ipcMain, windows } from 'electron';
const scenario = process.argv[2];
if (!['renderer-failure','manual-during-boot'].includes(scenario)) throw new Error('Unknown scenario');
const dir = await mkdtemp(path.join(tmpdir(), 'waypoint-boot-'));
process.env.WAYPOINT_TEST_DIR = dir;
process.env.WAYPOINT_TEST = '1';
process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
try {
  await import('../dist-electron/main.js');
  await new Promise(r => setImmediate(r));
  const main = windows[0];
  assert.equal(windows.length, 1, 'automatic briefing waits for boot');
  if (scenario === 'renderer-failure') {
    main.webContents.emit('did-fail-load', {}, -3, 'aborted', '', true);
    assert.equal(windows.length, 1, 'aborted navigations do not release briefing');
    main.webContents.emit('render-process-gone');
    assert.equal(windows.length, 2, 'renderer failure releases briefing');
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
