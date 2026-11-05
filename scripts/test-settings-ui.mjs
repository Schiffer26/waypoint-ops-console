/** Browser-level Settings access tests; Electron bridge is mocked. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']} : {})});
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({viewport:{width:1200,height:900},colorScheme:theme,reducedMotion:'reduce'});
    await context.addInitScript(theme => {
      let resolvePending;
      window.settingsTest = { hold:false, resolve:() => resolvePending?.(true) };
      window.waypoint = {
        platform:'test', versions:{app:'0.3.0'},
        auth:{appearance:async()=>theme, status:async()=>true, verify:async()=>true,
          verifySettings:async key => window.settingsTest.hold ? new Promise(resolve => {resolvePending=resolve;}) : key === 'correct access key'},
        storage:{read:async()=>null,write:async()=>{},remove:async()=>{}},
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
