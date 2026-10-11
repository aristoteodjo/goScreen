const L = require('./lib');
(async () => {
  const b = await L.launch(); const ctx = await L.context(b, 'pro-state.json'); const p = await ctx.newPage();
  const rec = new L.Recorder(p, 'p1b');
  try {
    await p.goto('https://oeufsdor-pro.vercel.app/producer/stock', { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await rec.start();
    await rec.scene('P5', 'Nouvelle collecte ? Ajoutez un lot');
    await rec.nudge(800);
    await L.tap(rec, p.getByRole('button', { name: 'Ajouter un lot' }));
    let dlg = p.getByRole('dialog'); await dlg.waitFor();
    await rec.nudge(600);
    await L.type(rec, dlg.locator('#producer-quantity'), '40');
    await rec.nudge(900);
    await L.tap(rec, dlg.getByRole('button', { name: 'Ajouter le lot' }));
    await dlg.waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(1800);

    await rec.scene('P6', 'Des œufs cassés ? Retirez-les');
    await L.tap(rec, p.getByRole('button', { name: 'Voir les lots et les prix' }));
    await p.getByRole('button', { name: 'Modifier ce lot' }).first().waitFor({ timeout: 20000 });
    await rec.nudge(900);
    await L.tap(rec, p.getByRole('button', { name: 'Modifier ce lot' }).first());
    dlg = p.getByRole('dialog'); await dlg.waitFor();
    await rec.nudge(600);
    await L.type(rec, dlg.locator('#producer-correct-quantity'), '3');
    await L.tap(rec, dlg.getByText('Cassé', { exact: true }));
    await rec.nudge(700);
    await L.tap(rec, dlg.getByRole('button', { name: 'Retirer du lot' }));
    await dlg.waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForLoadState('networkidle');
    await rec.end(800);

    await rec.scene('P7', 'Chaque lot suivi jusqu\'à sa date limite');
    await rec.nudge(1200);
    await L.scroll(rec, 260, 1500);
    await rec.nudge(1500);
    await L.scroll(rec, 260, 1500);
    await rec.end(1500);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message); await L.shot(p, 'p1b-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  console.log((await p.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 1500));
  await b.close();
})();
