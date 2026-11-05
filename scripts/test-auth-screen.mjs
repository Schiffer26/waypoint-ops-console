/** Browser UI test with a fake desktop bridge. Run against `npm run dev`;
 * install Playwright Chromium or set CHROMIUM_EXECUTABLE to a Chromium binary. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE, args:['--no-sandbox']} : {})});
try {
  for (const [theme, reducedMotion] of [['light','no-preference'], ['dark','no-preference'], ['light','reduce'], ['dark','reduce']]) {
    const ctx = await browser.newContext({viewport:{width:reducedMotion === 'reduce' ? 520 : 1200,height:800},colorScheme:theme,reducedMotion});
    await ctx.addInitScript(({theme}) => {
      let calls = 0;
      window.waypoint = {
        platform:'test', versions:{electron:'test',chrome:'test',app:'0.3.0'},
        auth:{appearance:async()=>theme, status:async()=>true, create:async()=>{}, verify:async (_operator, key)=>{calls++; await new Promise(r=>setTimeout(r,600)); return key === 'a valid access key';}},
        storage:{read:async()=>null,write:async()=>{},remove:async()=>{}},
        capabilities:async()=>({}), notify:async()=>true,
        rendererReady:()=>{}, onOpenCreate:()=>()=>{}, onReminderDelivered:()=>()=>{}, onReminderAction:()=>()=>{},
      };
      window.authTestCalls = () => calls;
    }, {theme});
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor();
    await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
    await page.evaluate(() => { window.phaseHistory = []; const el = document.querySelector('.auth-phase'); new MutationObserver(() => window.phaseHistory.push(el.textContent)).observe(el, {subtree:true,childList:true,characterData:true}); });
    await page.locator('#auth-operator').fill('operator');
    await page.locator('#auth-key').fill('incorrect access key');
    await page.getByRole('button',{name:'Show access key'}).click();
    assert.equal(await page.locator('#auth-key').getAttribute('type'), 'text');
    await page.getByRole('button',{name:'Hide access key'}).click();
    assert.equal(await page.locator('#auth-key').getAttribute('type'), 'password');
    await page.getByRole('button',{name:'AUTHENTICATE'}).click();
    assert.equal(await page.getByRole('button',{name:'PROCESSING…'}).isDisabled(), true);
    await page.locator('form').evaluate(form => form.requestSubmit());
    assert.equal(await page.evaluate(() => window.authTestCalls()), 1);
    await page.getByText('AUTHENTICATING OPERATOR').waitFor();
    assert.equal(await page.getByText('ACCESS GRANTED').count(), 0);
    await page.getByText('ACCESS DENIED').waitFor();
    assert.equal(await page.getByText('ACCESS GRANTED').count(), 0);
    await page.locator('#auth-key').fill('a valid access key');
    await page.getByRole('button',{name:'AUTHENTICATE'}).click();
    await page.getByText('AUTHENTICATING OPERATOR').waitFor();
    assert.equal(await page.getByText('ACCESS GRANTED').count(), 0);
    if (reducedMotion === 'reduce') {
      const animation = await page.locator('.auth-ambient-grid').evaluate(el => getComputedStyle(el).animationName);
      assert.equal(animation, 'none');
    } else {
      const animation = await page.locator('.auth-ambient-grid').evaluate(el => getComputedStyle(el).animationName);
      assert.equal(animation, 'auth-grid-drift');
      await page.waitForFunction(() => window.phaseHistory.includes('ACCESS GRANTED')); 
    }
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor({state:'detached',timeout:10000});
    assert.equal(await page.evaluate(() => window.authTestCalls()), 2);
    console.log(`Authentication screen UI passed: ${theme}, ${reducedMotion} (mock bridge)`);
    await ctx.close();
  }
} finally { await browser.close(); }
