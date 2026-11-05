/** Browser-level startup tests with a mocked desktop bridge; run with Vite on :5173. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']} : {})});
async function open(options = {}) {
  const context = await browser.newContext({viewport:{width:options.narrow ? 540 : 1200,height:800},colorScheme:options.theme ?? 'light',reducedMotion:options.reduced ? 'reduce' : 'no-preference'});
  await context.addInitScript((opts) => {
    let attempts = 0, storageCalls = 0, failing = Boolean(opts.failOnce);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    window.waypoint = {
      platform:'test', versions:{electron:'test',chrome:'test',app:'0.3.0'},
      auth:{appearance:async()=>{await wait(opts.appearanceDelay ?? 10); return opts.preference ?? opts.theme ?? 'light';},
        status:async()=>{ attempts++; if (opts.hang) return new Promise(()=>{}); await wait(opts.delay ?? 20); if (failing) throw new Error('offline'); return opts.exists ?? true; },
        verify:async()=>false, create:async()=>{}},
      storage:{read:async()=>{storageCalls++; return null;}, write:async()=>{}, remove:async()=>{}},
      briefingSnapshot:async()=>JSON.stringify({version:4,state:{tasks:[],events:[],categories:[],settings:{operatorName:'SYSOP',hour24:true,theme:opts.theme ?? 'light'}}}),
      openMain:async()=>{}, briefingDismiss:async()=>{}, capabilities:async()=>({}), notify:async()=>true,
      bootComplete:()=>{window.startupTest.bootSignals++;}, rendererReady:()=>{},onOpenCreate:()=>()=>{},onReminderDelivered:()=>()=>{},onReminderAction:()=>()=>{},
    };
    window.startupTest = { getAttempts:()=>attempts, getStorageCalls:()=>storageCalls, allowRetry:()=>{failing = false;}, bootSignals:0, initAt:null, loginAt:null };
    const observer = new MutationObserver(() => {
      if (window.startupTest.initAt === null && document.querySelector('.system-init, .light-boot')) window.startupTest.initAt = performance.now();
      if (window.startupTest.loginAt === null && document.querySelector('.auth-screen')) window.startupTest.loginAt = performance.now();
    });
    observer.observe(document, {childList:true, subtree:true});
  }, options);
  const page = await context.newPage();
  return {context,page};
}
try {
  // First launch, normal animation, and exact logo asset.
  {
    const {context,page} = await open({exists:false,theme:'light'});
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('main',{name:'WAYPOINT system initialization'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'CREATE OPERATOR'}).count(),0);
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0);
    assert.equal(await page.locator('.light-boot').count(),1);
    assert.equal(await page.locator('.system-init').count(),0);
    await page.locator('.light-boot-art img').evaluate(img => img.decode());
    const src = await page.locator('.light-boot-art img').getAttribute('src');
    assert(src.includes('waypoint-operations-console-logo.png'));
    assert.equal(await page.evaluate(() => window.startupTest.getStorageCalls()),0);
    await page.waitForTimeout(2800);
    assert(await page.getByRole('main',{name:'WAYPOINT system initialization'}).isVisible());
    assert.equal(await page.getByRole('heading',{name:'CREATE OPERATOR'}).count(),0);
    await page.getByRole('heading',{name:'CREATE OPERATOR'}).waitFor({timeout:5000});
    const introDuration = await page.evaluate(() => window.startupTest.loginAt - window.startupTest.initAt);
    assert(introDuration >= 3500, `startup was visible for ${introDuration}ms, expected at least 3500ms`);
    await page.waitForFunction(() => window.startupTest.bootSignals === 1);
    assert.equal(await page.locator('#auth-confirm').count(),1);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),'light');
    assert.equal(await page.evaluate(() => window.startupTest.getStorageCalls()),0);
    await context.close();
    console.log('First-time setup, startup transition and supplied logo passed (mock bridge)');
  }
  // Waiting longer than the visual intro cannot advance the authentication gate.
  {
    const {context,page} = await open({exists:true,theme:'dark',delay:4700});
    await page.goto('http://127.0.0.1:5173/');
    await page.getByText('LOADING OPERATOR INTERFACE').waitFor();
    await page.waitForTimeout(3900);
    assert.equal(await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).count(),0);
    assert.equal(await page.getByText('OPERATOR GATE / READY').count(),0);
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0);
    assert.equal(await page.locator('.system-init').count(),1, 'dark animation is retained');
    assert((await page.locator('.system-init-logo img').getAttribute('src')).includes('waypoint-emblem.png'), 'dark artwork remains unchanged');
    assert.equal(await page.locator('.light-boot').count(),0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),'dark');
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor({timeout:5000});
    await page.waitForFunction(() => window.startupTest.bootSignals === 1);
    assert.equal(await page.locator('.auth-ambient').count(),1, 'existing login animations remain');
    await context.close();
    console.log('Delayed returning-user status and dark theme passed (mock bridge)');
  }
  // Appearance is also required, even when operator status is already known.
  {
    const {context,page} = await open({exists:true,theme:'light',appearanceDelay:4500});
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForTimeout(3900);
    assert.equal(await page.locator('.system-init, .light-boot').count(), 0, 'no animation shown before saved theme');
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0);
    assert.equal(await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).count(),0);
    assert.equal(await page.getByText('OPERATOR GATE / READY').count(),0);
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor({timeout:5000});
    await context.close();
    console.log('Delayed appearance initialization passed (mock bridge)');
  }
  // SYSTEM follows the actual OS theme without mounting the other animation.
  for (const osTheme of ['light', 'dark']) {
    const {context,page} = await open({theme:osTheme,preference:'system',delay:1500,reduced:true});
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('main',{name:'WAYPOINT system initialization'}).waitFor();
    assert.equal(await page.locator(osTheme === 'dark' ? '.system-init' : '.light-boot').count(),1);
    assert.equal(await page.locator(osTheme === 'dark' ? '.light-boot' : '.system-init').count(),0);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),osTheme);
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor();
    await context.close();
    console.log(`System theme ${osTheme} chooses the correct boot (mock bridge)`);
  }
  // Failure is fail-closed and offers retry, including reduced-motion timing.
  {
    const {context,page} = await open({exists:true,theme:'dark',reduced:true,narrow:true,failOnce:true});
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('alert').getByText('LOCAL INITIALIZATION UNAVAILABLE').waitFor();
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0, 'failed initialization cannot signal authentication readiness');
    assert.equal(await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).count(),0);
    assert.equal(await page.locator('.system-init-progress span').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.evaluate(() => window.startupTest.allowRetry());
    await page.getByRole('button',{name:'RETRY INITIALIZATION'}).click();
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor({timeout:1200});
    await page.waitForFunction(() => window.startupTest.bootSignals === 1);
    assert((await page.evaluate(() => window.startupTest.getAttempts())) >= 2);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme),'dark');
    await context.close();
    console.log('Failure, retry and reduced-motion transition passed (mock bridge)');
  }
  // A stalled IPC must eventually expose a retry rather than spin forever.
  {
    const {context,page} = await open({hang:true,reduced:true});
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('alert').getByText('LOCAL INITIALIZATION UNAVAILABLE').waitFor({timeout:15000});
    assert.equal(await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).count(),0);
    assert(await page.getByRole('button',{name:'RETRY INITIALIZATION'}).isVisible());
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0);
    await context.close();
    console.log('Stalled initialization timeout passed (mock bridge)');
  }
  // Briefing path must not wait for either auth IPC call.
  {
    const {context,page} = await open({delay:3000});
    await page.goto('http://127.0.0.1:5173/?window=briefing');
    await page.getByText('DAILY BRIEFING', {exact:false}).first().waitFor({timeout:1500});
    assert.equal(await page.locator('.system-init, .light-boot').count(),0);
    assert.equal(await page.evaluate(() => window.startupTest.bootSignals),0);
    assert.equal(await page.evaluate(() => window.startupTest.getAttempts()),0);
    await context.close();
    console.log('Briefing bypasses startup/auth initialization (mock bridge)');
  }
} finally { await browser.close(); }
