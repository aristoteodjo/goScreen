const L = require('./lib');
(async () => {
  const b = await L.launch(); const c = await L.context(b, 'pro-state.json'); const p = await c.newPage();
  const rec = new L.Recorder(p, 'p11');
  try {
    await p.goto('https://oeufsdor-pro.vercel.app/producer', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await rec.start();
    await rec.scene('P11', 'Retirez sur votre Mobile Money');
    await rec.nudge(900);
    await L.tap(rec, p.getByRole('link', { name: 'Portefeuille' }).last());
    await p.waitForURL('**/producer/wallet'); await p.waitForLoadState('networkidle');
    await rec.nudge(1800);
    const r = p.getByRole('button', { name: /Retirer/ }).first();
    await r.waitFor({ timeout: 15000 });
    await L.tap(rec, r);
    const d = p.getByRole('dialog'); await d.waitFor();
    await rec.nudge(900);
    await L.tap(rec, d.getByRole('button', { name: 'MTN MoMo' }));
    await rec.nudge(700);
    await L.tap(rec, d.getByRole('button', { name: 'Recevoir le code sur WhatsApp' }));
    const code = await L.lastCode(p, 30000);
    await rec.nudge(1200);
    const box = d.locator('#payout-code');
    if (await box.count()) await L.tap(rec, box);
    await p.keyboard.type(code, { delay: 170 });
    await rec.nudge(700);
    console.log('STEP2', (await d.innerText()).replace(/\n+/g, ' | '));
    console.log(await d.locator('button').evaluateAll(e => e.map(x => (x.innerText || x.getAttribute('aria-label') || '').trim())));
    const confirm = d.locator('button[type=submit]').last();
    await L.tap(rec, confirm);
    await d.waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.nudge(1200);
    await L.scroll(rec, 300, 1200);
    await rec.end(2000);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message); await L.shot(p, 'p11-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  console.log('END', (await p.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 700));
  await b.close();
})();
