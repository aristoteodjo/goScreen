const fs = require('fs');
const L = require('./lib');
const BUYER = process.env.BUYER;
(async () => {
  const b = await L.launch();
  const ctx = await L.context(b);
  const p = await ctx.newPage();
  const rec = new L.Recorder(p, 'a1');
  let ref = null;
  try {
    await p.goto('https://oeufsdor.vercel.app/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    await rec.start();
    await rec.scene('A1', 'Des œufs près de chez vous ?');
    await rec.nudge(3200);
    await rec.end(200);

    await rec.scene('A2', 'Votre produit, votre quartier');
    await L.scroll(rec, 380, 900);
    await rec.nudge(500);
    await L.tap(rec, p.locator('#hero-zone'));
    await rec.nudge(600);
    await L.tap(rec, p.getByRole('option', { name: 'Kpota, Calavi' }));
    await rec.nudge(500);
    await L.tap(rec, p.getByRole('button', { name: 'Voir qui en a' }));
    await p.waitForURL(/\/offres/, { timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(500);

    await rec.scene('A3', 'Le vrai stock, en temps réel');
    await rec.nudge(1200);
    const card = p.locator('a[href*="ferme-or"]').first();
    await card.waitFor({ timeout: 20000 });
    const box = await card.boundingBox();
    await L.scroll(rec, Math.max(0, box.y - 180), 1800);
    await rec.nudge(1200);
    await L.tap(rec, card);
    await p.waitForURL(/\/offres\/.+/, { timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(300);

    await rec.scene('A4', 'Choisissez la quantité');
    await rec.nudge(1500);
    const plus = p.getByRole('button', { name: 'Ajouter un' });
    await plus.scrollIntoViewIfNeeded();
    await L.scroll(rec, 260, 800);
    for (let i = 0; i < 9; i++) await L.tap(rec, plus);
    await rec.nudge(500);
    await L.tap(rec, p.locator('#order-pickup'));
    await rec.end(1000);

    await rec.scene('A5', 'Juste votre numéro WhatsApp');
    const phone = p.locator('input[type=tel]').first();
    await L.type(rec, phone, BUYER);
    await L.tap(rec, p.getByRole('button', { name: /Recevoir mon code/ }));
    const code = await L.lastCode(p);
    await rec.nudge(900);
    await p.keyboard.type(code, { delay: 170 });
    await rec.end(900);

    await rec.scene('A6', 'Votre stock est réservé');
    const send = p.getByRole('button', { name: /Envoyer ma commande/ });
    await send.scrollIntoViewIfNeeded();
    await rec.nudge(700);
    await L.tap(rec, send);
    await p.waitForURL(/\/commandes\/.+/, { timeout: 40000 });
    await p.waitForLoadState('networkidle');
    ref = p.url().split('/').pop();
    fs.writeFileSync('order-ref.txt', ref);
    await rec.end(2500);
    await ctx.storageState({ path: 'buyer-state.json' });
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message);
    await L.shot(p, 'a1-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  console.log('REF', ref, p.url());
  console.log((await p.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 1500));
  console.log(await p.locator('main button, main a').evaluateAll(els => els.map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean)).catch(() => []));
  await b.close();
})();
