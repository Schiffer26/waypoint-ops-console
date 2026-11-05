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
        bootComplete:()=>{}, rendererReady:()=>{}, onOpenCreate:()=>()=>{}, onReminderDelivered:()=>()=>{}, onReminderAction:()=>()=>{},
      };
      window.authTestCalls = () => calls;
    }, {theme});
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('heading',{name:'OPERATOR AUTHENTICATION'}).waitFor();
    await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme);
    const cardWordmark = page.locator('.auth-emblem-wordmark');
    assert(await cardWordmark.isVisible());
    assert.equal(await cardWordmark.evaluate(el => el.firstChild.textContent), 'WAYPOINT');
    assert.equal(await cardWordmark.locator('small').textContent(), 'PERSONAL OPERATIONS CONSOLE');
    assert(await cardWordmark.locator('small').isVisible());
    const wordmark = page.locator('.auth-brand > span');
    const subtitle = wordmark.locator('small');
    assert.equal(await wordmark.evaluate(el => el.firstChild.textContent), 'WAYPOINT');
    assert.equal(await subtitle.textContent(), 'PERSONAL OPERATIONS CONSOLE');
    assert(await wordmark.isVisible());
    assert(await subtitle.isVisible());
    // Verify readable foreground contrast against the actual themed header background.
    for (const text of [wordmark, subtitle, cardWordmark, cardWordmark.locator('small')]) {
      const contrast = await text.evaluate(el => {
        const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number);
        const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const fg = luminance(getComputedStyle(el).color);
        const bg = luminance(getComputedStyle(document.querySelector('.auth-screen')).backgroundColor);
        return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
      });
      assert(contrast >= 4.5, `header text contrast ${contrast} in ${theme} theme`);
    }
    assert(await page.getByText('IDENTITY VERIFICATION', {exact:true}).isVisible());
    assert(await page.locator('label[for="auth-operator"]').isVisible());
    assert(await page.locator('label[for="auth-key"]').isVisible());
    for (const selector of ['.auth-mark', '.auth-emblem img']) {
      const image = page.locator(selector);
      assert((await image.getAttribute('src')).includes('waypoint-emblem.png'));
      assert(await image.evaluate(async img => { await img.decode(); return img.naturalWidth === 1095 && img.naturalHeight === 1073 && getComputedStyle(img).objectFit === 'contain'; }));
    }
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
    const sidebarEmblem = page.locator('aside img');
    await sidebarEmblem.waitFor();
    assert((await sidebarEmblem.getAttribute('src')).includes('waypoint-emblem.png'));
    assert(await sidebarEmblem.evaluate(async img => { await img.decode(); return getComputedStyle(img).objectFit === 'contain'; }));
    console.log(`Authentication screen UI passed: ${theme}, ${reducedMotion} (mock bridge)`);
    await ctx.close();
  }
} finally { await browser.close(); }
