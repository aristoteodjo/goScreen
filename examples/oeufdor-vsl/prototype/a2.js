const L = require('./lib');
(async () => {
  const b = await L.launch(); const c = await L.context(b, 'buyer-state.json'); const p = await c.newPage();
  const rec = new L.Recorder(p, 'a2');
  try {
    await p.goto(`https://oeufsdor.vercel.app/commandes/${process.env.ORDER}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await rec.start();
    await rec.scene('A10', 'Reçu. Notez le producteur');
    await rec.nudge(1500);
    await L.tap(rec, p.locator('[aria-label="5 sur 5 : Excellent"]').first());
    await rec.nudge(500);
    await L.type(rec, p.locator('#rating-comment'), 'Œufs bien frais, merci', 70);
    await rec.nudge(500);
    await L.tap(rec, p.getByRole('button', { name: 'Envoyer ma note' }));
    await p.waitForLoadState('networkidle');
    await rec.end(2000);

    await rec.scene('A11', 'Tout votre historique');
    await L.tap(rec, p.getByRole('link', { name: 'Mes commandes' }).first());
    await p.waitForURL(/\/commandes\/?$/); await p.waitForLoadState('networkidle');
    await rec.nudge(1800);
    await p.goto('https://oeufsdor.vercel.app/compte', { waitUntil: 'networkidle' });
    await rec.nudge(1500);
    await L.scroll(rec, 420, 1600);
    await rec.end(1800);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message); await L.shot(p, 'a2-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  await b.close();
})();
