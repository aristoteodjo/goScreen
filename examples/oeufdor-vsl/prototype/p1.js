const L = require('./lib');
(async () => {
  const b = await L.launch();
  const ctx = await L.context(b);
  const p = await ctx.newPage();
  const rec = new L.Recorder(p, 'p1');
  try {
    await p.waitForTimeout(Number(process.env.WAIT_MS || 0));
    await p.goto('https://oeufsdor-pro.vercel.app/login', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    await rec.start();
    await rec.scene('P1', 'Votre numéro WhatsApp suffit');
    await L.type(rec, p.locator('input[type=tel]').first(), process.env.PRODUCER_PHONE);
    await L.tap(rec, p.getByRole('button', { name: 'Recevoir le code' }));
    const code = await L.lastCode(p);
    await rec.nudge(700);
    await p.keyboard.type(code, { delay: 160 });
    await L.tap(rec, p.getByRole('button', { name: 'Se connecter' }));
    await p.waitForURL('**/producer', { timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(600);
    await ctx.storageState({ path: 'pro-state.json' });

    await rec.scene('P2', 'Toute votre activité sur un écran');
    await rec.nudge(1800);
    await L.scroll(rec, 700, 2200);
    await rec.nudge(800);
    await L.scroll(rec, 900, 2000);
    await rec.end(900);

    await rec.scene('P3', 'Un produit en moins d\'une minute');
    await L.tap(rec, p.getByRole('link', { name: 'Stock' }).last());
    await p.waitForURL('**/producer/stock');
    await p.waitForLoadState('networkidle');
    await rec.nudge(700);
    await L.tap(rec, p.getByRole('button', { name: 'Ajouter mon premier produit' }));
    const dlg = p.getByRole('dialog');
    await dlg.waitFor();
    await rec.nudge(500);
    await L.tap(rec, dlg.locator('#product-category'));
    await rec.nudge(500);
    await L.tap(rec, p.getByRole('option', { name: /Œuf de poulet/ }));
    await L.type(rec, dlg.locator('#product-variety'), 'calibre moyen');
    await L.type(rec, dlg.locator('#product-price'), '2100');
    await L.type(rec, dlg.locator('#product-quantity'), '50');
    await rec.nudge(500);
    await L.tap(rec, dlg.getByRole('button', { name: 'Ajouter au stock' }));
    await dlg.waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(400);

    await rec.scene('P4', 'Vérifié : en vente tout de suite');
    await rec.nudge(2600);
    await rec.end(200);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message);
    await L.shot(p, 'p1-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  console.log((await p.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 1200));
  console.log(await p.locator('button,a').evaluateAll(els => els.map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean)));
  await b.close();
})();
