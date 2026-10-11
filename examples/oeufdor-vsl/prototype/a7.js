const fs = require('fs');
const L = require('./lib');
(async () => {
  const b = await L.launch(); const ctx = await L.context(b, 'buyer-state.json'); const p = await ctx.newPage();
  const rec = new L.Recorder(p, 'a7');
  const ref = fs.readFileSync('order-ref.txt', 'utf8').trim();
  try {
    await p.goto(`https://oeufsdor.vercel.app/commandes/${ref}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await rec.start();
    await rec.scene('A7', 'Vous payez OEUF D\'OR, pas le vendeur');
    await rec.nudge(1500);
    await L.tap(rec, p.getByRole('button', { name: /Payer ·/ }));
    let fp;
    for (let i = 0; i < 40 && !fp; i++) { fp = p.frames().find(f => f.url().includes('fedapay.com')); await p.waitForTimeout(250); }
    const mm = fp.locator('a:visible', { hasText: 'Mobile Money' }).first();
    await mm.waitFor({ timeout: 30000 });
    await rec.nudge(1200);
    await L.tap(rec, mm);
    const phone = fp.locator('#phone_number');
    await phone.waitFor({ timeout: 30000 });
    await rec.nudge(800);
    const receipt = fp.locator('#sendReceipt');
    if (await receipt.isChecked().catch(() => false)) { await L.tap(rec, fp.locator('label[for=sendReceipt]:visible, #sendReceipt').first(), { force: true }); }
    if (await receipt.isChecked().catch(() => false)) await receipt.uncheck({ force: true });
    if (process.env.PAY_PHONE) { await phone.fill(''); await L.type(rec, phone, process.env.PAY_PHONE, 70); }
    await rec.nudge(600);
    await L.tap(rec, fp.locator('button[type=submit]:visible').first());
    await rec.nudge(6000);
    await L.shot(p, 'a7-after-submit');
    console.log('FP', (await fp.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 500));
    // The page follows the provider's signed notification; the order turns paid on its own.
    await p.getByText('Votre code de remise', { exact: false }).first().waitFor({ timeout: 120000 }).catch(async () => {
      await rec.nudge(1000); await p.reload({ waitUntil: 'networkidle' });
    });
    await rec.end(800);

    await rec.scene('A8', 'Votre code de remise');
    await rec.nudge(1500);
    await L.scroll(rec, 300, 1500);
    await rec.nudge(1500);
    await L.scroll(rec, 400, 1500);
    await rec.end(1500);
    await rec.stop();
  } catch (e) {
    console.error('FAIL', e.message); await L.shot(p, 'a7-fail');
    if (rec.frames.length) await rec.stop().catch(() => {});
  }
  console.log((await p.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 1800));
  await b.close();
})();
