const L = require('./lib');
const CODE = process.env.CODE;
(async () => {
  const b = await L.launch(); const c = await L.context(b, 'pro-state.json'); const p = await c.newPage();
  const rec = new L.Recorder(p, 'p2');
  try {
    await p.goto('https://oeufsdor-pro.vercel.app/producer', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await rec.start();
    await rec.scene('P8', 'Une commande payée arrive');
    await rec.nudge(1500);
    await L.tap(rec, p.getByRole('link', { name: 'Commandes' }).last());
    await p.waitForURL('**/producer/orders'); await p.waitForLoadState('networkidle');
    await rec.nudge(1800);
    await L.tap(rec, p.locator(`main a[href$="/producer/orders/${process.env.ORDER}"]`).first());
    await p.waitForURL(new RegExp(process.env.ORDER)); await p.waitForLoadState('networkidle');
    await rec.end(2200);

    await rec.scene('P9', 'Saisissez le code de l\'acheteur');
    await L.tap(rec, p.getByRole('button', { name: 'Valider la remise' }).first());
    const d = p.getByRole('dialog'); await d.waitFor();
    await rec.nudge(700);
    await L.type(rec, d.locator('#producer-code'), CODE, 160);
    await rec.nudge(700);
    await L.tap(rec, d.getByRole('button', { name: 'Valider la remise' }));
    await d.waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(600);

    await rec.scene('P10', 'Terminée. L\'argent est à vous');
    await rec.nudge(2200);
    console.log('DONE PAGE', (await p.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 1200));
    console.log(await p.locator('main button, main [role=radio]').evaluateAll(e => e.map(x => `${x.tagName} role=${x.getAttribute('role')||''} aria=${x.getAttribute('aria-label')||''} text=${(x.innerText||'').trim().slice(0,30)}`)));
    const five = p.locator('main').getByRole('radio', { name: /5/ }).or(p.locator('main').getByRole('button', { name: /5 étoile|5 sur 5|5\/5/ })).first();
    if (await five.count()) {
      await L.tap(rec, five);
      await rec.nudge(600);
      const send = p.getByRole('button', { name: 'Envoyer ma note' });
      if (await send.count()) { await L.tap(rec, send); await p.waitForLoadState('networkidle'); }
    }
    await rec.end(2200);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message); await L.shot(p, 'p2-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  await b.close();
})();
