// Writes dev/phrases-<lang>.json: every fixed sentence the app can say (see voicePhrases() in dev/ui.js).
// Usage: cd tests && node export-phrases.js zh
const path = require('path'), fs = require('fs'), puppeteer = require('puppeteer-core');
const lang = process.argv[2] || 'zh';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const pg = await b.newPage();
  await pg.goto('file://' + path.resolve(__dirname, '../index.html'));
  const list = await pg.evaluate(l => { S.lang = l; return voicePhrases(); }, lang);
  fs.writeFileSync(path.resolve(__dirname, '../dev/phrases-' + lang + '.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(list.length + ' phrases → dev/phrases-' + lang + '.json');
  await b.close();
})();
