const { build } = require('./compose');
const { project } = require('./goscreen');
const films = require('./films');
(async () => {
  for (const f of [films.buyer, films.producer]) {
    console.log('video', await build(f));
    console.log('goscreen', project(f).video);
  }
})().catch(e => { console.error(e); process.exit(1); });
