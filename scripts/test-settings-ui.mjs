/** Browser-level Settings access tests; Electron bridge is mocked. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']} : {})});
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport:{width:1200,height:900},colorScheme:theme,reducedMotion:'reduce'});
    await context.addInitScript(theme => {
      let resolvePending;
      window.settingsTest = { hold:false, resolve:() => resolvePending?.(true), saved:{}, simulatePicker:false };
      const originalClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function() {
        if (this.type === 'file' && window.settingsTest.simulatePicker) {
          window.dispatchEvent(new Event('blur'));
          return;
        }
        return originalClick.call(this);
      };
      const originalObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { window.settingsTest.exported = blob; return originalObjectURL(blob); };
      window.waypoint = {
        platform:'test', versions:{app:'0.3.0'},
        auth:{appearance:async()=>theme, status:async()=>true, verify:async()=>true,
          verifySettings:async key => window.settingsTest.hold ? new Promise(resolve => {resolvePending=resolve;}) : key === 'correct access key'},
        storage:{read:async()=>null,write:async(k,v)=>{window.settingsTest.saved[k]=v;},remove:async()=>{}},
        bootComplete:()=>{},rendererReady:()=>{},onOpenCreate:()=>()=>{},onReminderDelivered:()=>()=>{},onReminderAction:()=>()=>{},
        capabilities:async()=>({}),getAutoLaunch:async()=>false,notify:async()=>true,
      };
    }, theme);
    const page = await context.newPage();
    await page.clock.install();
    await page.goto('http://127.0.0.1:5173/');
    await page.locator('#auth-operator').fill('operator');
    await page.locator('#auth-key').fill('correct access key');
    await page.getByRole('button',{name:'AUTHENTICATE'}).click();
    const nav = name => page.locator('nav').getByRole('button',{name:new RegExp(name,'i')});
    await nav('tasks').click();
    await nav('settings').click();
    const gate = page.getByRole('heading',{name:'SETTINGS ACCESS'});
    await gate.waitFor();
    assert.equal(await page.locator('.settings-protected-content').count(), 0);
    await page.getByRole('button',{name:'Show access key'}).click();
    assert.equal(await page.locator('#settings-access-key').getAttribute('type'), 'text');
    await page.getByRole('button',{name:'Hide access key'}).click();
    assert.equal(await page.locator('#settings-access-key').getAttribute('type'), 'password');
    await page.locator('#settings-access-key').fill('wrong access key');
    await page.getByRole('button',{name:'AUTHENTICATE'}).click();
    await page.getByText('ACCESS DENIED',{exact:true}).waitFor();
    assert.equal(await page.locator('.settings-protected-content').count(), 0);
    await page.getByRole('button',{name:'BACK'}).click();
    assert.equal(await nav('tasks').locator('span.bg-acid').count(), 1, 'Back returns to the previous Tasks page');
    await nav('settings').click();
    await gate.waitFor();
    const unlock = async () => {
      await page.locator('#settings-access-key').fill('correct access key');
      await page.getByRole('button',{name:'AUTHENTICATE'}).click();
      await page.getByText('CONSOLE CONFIGURATION & SYSTEM INTEGRATION').waitFor();
    };
    await unlock();
    // Export a real archive, then select it through a simulated native dialog.
    await page.getByRole('button',{name:'EXPORT JSON'}).click();
    const archive = await page.evaluate(async () => JSON.parse(await window.settingsTest.exported.text()));
    assert(archive.tasks.length && archive.events.length && archive.categories.length);
    archive.tasks[0].title = 'RESTORED TEST TASK';
    archive.events[0].title = 'RESTORED TEST EVENT';
    archive.categories[0].name = 'Restored category';
    archive.settings.operatorName = 'RESTORED OPERATOR';
    await page.evaluate(() => { window.settingsTest.simulatePicker = true; });
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await page.clock.fastForward(65_000);
    assert(await page.getByText('CONSOLE CONFIGURATION & SYSTEM INTEGRATION').isVisible(), 'native picker blur and idle time must not lock Settings');
    const fileInput = page.locator('input[type=file]');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await fileInput.setInputFiles({name:'waypoint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByText('RESTORE IMPORTED ARCHIVE').waitFor();
    assert.equal(await fileInput.inputValue(), '', 'file input is reset after selection');
    await confirmation.getByRole('button',{name:'RESTORE'}).click();
    await page.getByText('ARCHIVE RESTORED — REGISTRY REPLACED').waitFor();
    await page.waitForFunction(() => {
      const raw = window.settingsTest.saved['waypoint.db.v1'];
      if (!raw) return false;
      const state = JSON.parse(raw).state;
      return state.tasks[0]?.title === 'RESTORED TEST TASK' && state.events[0]?.title === 'RESTORED TEST EVENT' &&
        state.categories[0]?.name === 'Restored category' && state.settings.operatorName === 'RESTORED OPERATOR';
    });
    // Close the exiting confirmation by locking and unlocking, as in the existing blur tests.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await gate.waitFor();
    await unlock();
    // The very same file can be selected again after the input is reset.
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await fileInput.setInputFiles({name:'waypoint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await confirmation.getByText('RESTORE IMPORTED ARCHIVE').waitFor();
    assert.equal(await fileInput.inputValue(), '');
    await confirmation.getByRole('button',{name:'ABORT'}).click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await gate.waitFor();
    await unlock();
    // Malformed JSON and read failures are reported.
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await fileInput.setInputFiles({name:'waypoint.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await page.getByText('IMPORT FAILED — INVALID WAYPOINT ARCHIVE').waitFor();
    assert.equal(await fileInput.inputValue(), '');
    await page.evaluate(() => { window.settingsTest.originalRead = FileReader.prototype.readAsText; FileReader.prototype.readAsText = function() { this.dispatchEvent(new Event('error')); }; });
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await fileInput.setInputFiles({name:'waypoint.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await page.getByText('IMPORT FAILED — FILE COULD NOT BE READ').waitFor();
    await page.evaluate(() => { FileReader.prototype.readAsText = window.settingsTest.originalRead; });
    // A cancellation clears the lease: ordinary blur still locks immediately.
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await fileInput.dispatchEvent('cancel');
    assert.equal(await fileInput.inputValue(), '');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await gate.waitFor();
    await unlock();
    // Cancel without a cancel event is covered by the native window-focus fallback.
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('blur')); });
    await gate.waitFor();
    await unlock();
    await nav('dashboard').click();
    assert.equal(await page.locator('.settings-protected-content:visible').count(), 0, 'leaving hides Settings immediately');
    await nav('settings').click();
    await gate.waitFor();
    await unlock();
    // Activity resets the idle timer; lock at 60 seconds of inactivity.
    await page.clock.fastForward(50_000);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {key:'Shift'})));
    await page.clock.fastForward(59_000);
    assert(await page.getByText('CONSOLE CONFIGURATION & SYSTEM INTEGRATION').isVisible());
    await page.clock.fastForward(1_100);
    await gate.waitFor();
    assert.equal(await page.locator('.settings-protected-content:visible').count(), 0);
    await unlock();
    await page.getByTitle('Delete category (records reassigned to first category)').first().click();
    await page.getByRole('alertdialog').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await gate.waitFor();
    await page.clock.fastForward(500);
    assert.equal(await page.getByRole('alertdialog').count(), 0, 'Settings confirmation closes on lock');
    assert.equal(await page.locator('.settings-protected-content:visible').count(), 0);
    await unlock();
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'}); document.dispatchEvent(new Event('visibilitychange')); });
    await gate.waitFor();
    assert.equal(await page.locator('.settings-protected-content:visible').count(), 0);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable:true, value:'visible'}); document.dispatchEvent(new Event('visibilitychange')); });
    await unlock();
    // A second blur or a hidden window is never covered by the picker exception.
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await gate.waitFor();
    await unlock();
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable:true, value:'hidden'}); document.dispatchEvent(new Event('visibilitychange')); });
    await gate.waitFor();
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable:true, value:'visible'}); document.dispatchEvent(new Event('visibilitychange')); });
    await unlock();
    // Late file reads cannot open a confirmation after leaving Settings.
    await page.evaluate(() => { window.settingsTest.originalRead = FileReader.prototype.readAsText; FileReader.prototype.readAsText = function() { window.settingsTest.pendingReader = this; }; });
    await page.getByRole('button',{name:'IMPORT JSON'}).click();
    await page.locator('input[type=file]').setInputFiles({name:'waypoint.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))});
    await nav('tasks').click();
    await page.evaluate(data => { const reader=window.settingsTest.pendingReader; Object.defineProperty(reader, 'result', {value:JSON.stringify(data)}); reader.dispatchEvent(new Event('load')); FileReader.prototype.readAsText=window.settingsTest.originalRead; }, archive);
    assert.equal(await page.getByText('RESTORE IMPORTED ARCHIVE').count(), 0);
    await nav('settings').click();
    await gate.waitFor();
    // A verification started before losing focus cannot unlock on late success.
    await page.evaluate(() => {window.settingsTest.hold = true;});
    await page.locator('#settings-access-key').fill('correct access key');
    await page.getByRole('button',{name:'AUTHENTICATE'}).click();
    await page.evaluate(() => {window.dispatchEvent(new Event('blur')); window.settingsTest.resolve();});
    await gate.waitFor();
    assert.equal(await page.locator('.settings-protected-content:visible').count(), 0);
    await context.close();
    console.log(`Settings access, re-locking, inactivity and stale verification passed: ${theme} (mock bridge)`);
  }
} finally { await browser.close(); }
