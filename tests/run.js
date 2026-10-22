// End-to-end tests for Memory Journal + SafeSleep.
// Usage:  cd tests && npm install && npm test
// Needs Google Chrome; set CHROME_PATH if it isn't in the default macOS location.
const http = require('http'), fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const wait = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

(async () => {
  const srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  // A fresh, isolated phone (own localStorage / IndexedDB). `at` fakes the clock, e.g. [2026,9,21,2,10].
  async function phone(at) {
    const ctx = await browser.createBrowserContext(), pg = await ctx.newPage();
    await pg.emulate(puppeteer.KnownDevices['iPhone 13']);
    pg.errors = [];
    pg.on('pageerror', e => pg.errors.push(e.message));
    if (at) await pg.evaluateOnNewDocument(a => {
      const R = Date, off = new R(...a).getTime() - R.now();
      window.Date = class extends R { constructor(...x) { x.length ? super(...x) : super(R.now() + off); } static now() { return R.now() + off; } };
    }, at);
    await pg.goto(base + 'index.html');
    await wait(500);
    return pg;
  }
  const DAY = [2026, 9, 21, 10, 0]; // a weekday morning, so night mode stays out of the way

  console.log('\nSafeSleep agent (demo.html)');
  const d = await (await browser.createBrowserContext()).newPage();
  const dErr = []; d.on('pageerror', e => dErr.push(e.message));
  await d.goto(base + 'demo.html');
  await test('four scenarios get the expected decision', async () => {
    eq(await d.evaluate(() => ['A', 'B', 'C', 'D'].map(k => runAgent(synth(k), 'full').tier)), ['review', 'ok', 'abstain', 'ok']);
  });
  await test('ablation: rules-only 3 wrong, no-critic 2 wrong, full SafeSleep 0 wrong', async () => {
    eq(await d.evaluate(() => ['rules', 'nocritic', 'full'].map(m => ['A', 'B', 'C', 'D'].filter(k => runAgent(synth(k), m).tier !== EXPECT[k]).length)), [3, 2, 0]);
  });
  await test('medication names normalize 16/16 (typos, brands, Chinese)', async () => {
    eq(await d.evaluate(() => NORMTESTS.filter(x => { const n = normalizeMed(x[0]); return n && n.ing === x[1]; }).length), 16);
  });
  await test('every review cites evidence IDs that exist in the ledger', async () => {
    ok(await d.evaluate(() => { const r = runAgent(synth('A'), 'full'), ids = r.ledger.map(e => e.id);
      return r.reasons.length > 0 && r.reasons.every(x => x.ids.every(i => ids.includes(i))); }));
  });
  await test('demo page has no script errors', async () => eq(dErr, []));

  console.log('\nPhone app (index.html)');
  let pg = await phone(DAY);
  await test('loads with six home tiles and no errors', async () => {
    eq(await pg.$$eval('.tiles .tile:not([hidden])', x => x.length), 6);
    eq(pg.errors, []);
  });
  await test('service worker registers (offline + installable)', async () => {
    ok(await pg.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(r => setTimeout(() => r(false), 4000))])));
  });
  await test('check-in wizard: three taps complete the day', async () => {
    await pg.evaluate(() => show('check')); await wait(200);
    for (let i = 0; i < 3; i++) { await pg.click('#checkBody .vchoices button'); await wait(400); }
    ok(await pg.evaluate(() => checkDone()));
  });
  await test('medicine reminder appears when due and goes away after "I took my medicine"', async () => {
    await pg.evaluate(() => { S.medTime = '08:00'; save(); show('home'); }); await wait(200);
    ok(!(await pg.$eval('#voiceCard', e => e.hidden)), 'card should show');
    await pg.evaluate(() => show('med')); await pg.click('#med'); await wait(2500);
    await pg.evaluate(() => show('home')); await wait(200);
    ok(await pg.$eval('#voiceCard', e => e.hidden), 'card should hide');
  });
  await test('to-do list: Mimi cheers when everything is done', async () => {
    await pg.evaluate(() => { S.todo = 'Water plants\nCall Sunny'; save(); show('todo'); }); await wait(200);
    for (let i = 0; i < 2; i++) { const b = await pg.$$('#todoList button'); await b[i].click(); await wait(150); }
    eq(await pg.$eval('#todoSay', e => e.textContent), await pg.evaluate(() => t('petDone')));
  });
  await test('tapping Mimi reads her bubble aloud', async () => {
    const said = await pg.evaluate(() => { let s = null; const o = speak; speak = x => { s = x; }; $('todoPet').click(); speak = o; return s; });
    eq(said, await pg.$eval('#todoSay', e => e.textContent));
  });
  await test('quiet button: Mimi stops dancing and stays silent when tapped; tap again to dance', async () => {
    const q = await phone([2026, 9, 21, 15, 0]);
    await q.evaluate(() => { speak = x => { window.SAID = (window.SAID || []).concat(x); }; });
    await q.click('#petTog'); await wait(200);
    const r = await q.evaluate(() => { $('homePet').click(); return [S.petQuiet, getComputedStyle($('homePet').querySelector('svg')).animationName, (window.SAID || []).length]; });
    eq(r, [true, 'none', 0]);
    // quiet Mimi = quiet app: opening screens and tapping buttons say nothing
    const quietSaid = await q.evaluate(() => { window.SAID = []; show('todo'); goBack(); show('med'); $('med').click(); show('home'); return window.SAID.length; });
    eq(quietSaid, 0, 'nothing spoken while quiet');
    await q.evaluate(() => { window.SAID = []; });
    await q.click('#petTog'); await wait(200);
    const r2 = await q.evaluate(() => { $('homePet').click(); return [S.petQuiet, getComputedStyle($('homePet').querySelector('svg')).animationName !== 'none', (window.SAID || []).length]; });
    eq(r2, [false, true, 1]);
    eq(q.errors, []);
  });
  await test('holding "Family" for 2 seconds opens the family hub (and the release does not tap a row)', async () => {
    await pg.evaluate(() => show('home'));
    await pg.$eval('#gate', e => e.scrollIntoView()); await wait(100);
    const r = await (await pg.$('#gate')).boundingBox();
    await pg.touchscreen.touchStart(r.x + r.width / 2, r.y + r.height / 2); await wait(1800);
    await pg.touchscreen.touchEnd(); await wait(300);
    eq(await pg.evaluate(() => SCREEN), 'family');
  });
  await test('family voice: record a clip, then the reminder plays it', async () => {
    await pg.evaluate(() => { show('famVoice'); startRec('med'); }); await wait(1500);
    await pg.evaluate(() => stopRec()); await wait(800);
    ok(await pg.evaluate(() => !!S.voiceMeta.med), 'clip saved');
    const played = await pg.evaluate(() => vget('slot:med').then(b => !!b && b.size > 0));
    ok(played, 'clip in IndexedDB');
  });
  await test('backup includes recordings and restores them on a new phone', async () => {
    const json = await pg.evaluate(() => exportAll().then(r => r.json));
    const fresh = await phone(DAY);
    const n = await fresh.evaluate(j => { const d = JSON.parse(j), c = d._clips; delete d._clips; Object.assign(S, d); save(); return importClips(c); }, json);
    eq(n, 1, 'clips restored');
    ok(await fresh.evaluate(() => vget('slot:med').then(b => !!b && b.size > 0)), 'clip readable after import');
    eq(await fresh.evaluate(() => S.medTime), '08:00');
  });
  await test('calendar file: one daily event with an alarm per medicine time', async () => {
    const ics = await pg.evaluate(() => buildICS(['08:00', '20:30']));
    eq((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    eq((ics.match(/RRULE:FREQ=DAILY/g) || []).length, 2);
    eq((ics.match(/BEGIN:VALARM/g) || []).length, 2);
    ok(/DTSTART:\d{8}T080000/.test(ics) && /DTSTART:\d{8}T203000/.test(ics), 'start times');
    ok(ics.includes('\r\n'), 'CRLF line endings');
  });
  await test('task times are understood: "09:00", "9：30", "下午3点半", "8点"', async () => {
    eq(await pg.evaluate(() => ['09:00 喝水', '9：30 散步', '下午3点半 给女儿打电话', '8点 吃早饭', '浇花'].map(x => taskParse(x).time + '|' + taskParse(x).name)),
      ['09:00|喝水', '09:30|散步', '15:30|给女儿打电话', '08:00|吃早饭', 'null|浇花']);
  });
  await test('a timed task reminds at its time, and "Done" ticks it off', async () => {
    const tp = await phone(DAY); // 10:00
    await tp.evaluate(() => { S.checkins[today()] = { sleep: 0, wake: 0, fall: 0 }; S.todo = '09:30 Drink water\n18:00 Call Sunny'; save(); checkReminder(); render(); }); await wait(200);
    ok((await tp.$eval('#vcText', e => e.textContent)).includes('Drink water'), 'card names the due task');
    ok(!(await tp.$eval('#vcText', e => e.textContent)).includes('Call Sunny'), 'later task not yet due');
    await tp.click('#vcBtns button'); await wait(200);
    ok(await tp.evaluate(() => S.done.includes('09:30 Drink water')), 'ticked off');
    ok((await tp.$eval('#vcText', e => e.textContent)).indexOf('Drink water') < 0, 'reminder gone');
    eq(tp.errors, []);
  });
  await test('calendar file also includes timed tasks', async () => {
    const ev = await pg.evaluate(() => { const o = S.todo; S.todo = '09:00 Drink water\nWater plants'; const e = calEvents(); S.todo = o; return e.map(x => x.time); });
    ok(ev.includes('09:00') && ev.includes('08:00'), JSON.stringify(ev));
  });
  await test('safety report shows a decision and demo scenario A asks for review', async () => {
    await pg.evaluate(() => { show('famDemo'); enterDemo('A'); }); await wait(400);
    eq(await pg.evaluate(() => [SCREEN, runAgent(S, 'full').tier]), ['famReport', 'review']);
    await pg.evaluate(() => exitDemo());
  });
  await test('usage stats count app opens and screens, never content', async () => {
    const u = await pg.evaluate(() => S.usage[today()]);
    ok(u.open >= 1 && u.check >= 1 && u.med >= 1, JSON.stringify(u));
    const known = await pg.evaluate(() => USE_KEYS);
    ok(Object.keys(u).every(k => known.includes(k)), 'only known counters');
  });
  await test('phone app has no script errors', async () => eq(pg.errors, []));

  console.log('\nNight mode (fake clock 2:10 am)');
  const n = await phone([2026, 9, 21, 2, 10]);
  await test('opening the app at night goes straight to the night screen', async () => eq(await n.evaluate(() => SCREEN), 'night'));
  await test('"getting up" then "back in bed" logs one trip with its duration', async () => {
    await n.click('#nBtns button'); await wait(200);
    await n.evaluate(() => { S.upNow -= 7 * 60000; }); // pretend 7 minutes passed
    await n.click('#nBtns button'); await wait(200);
    const r = await n.evaluate(() => [S.nightUps.length, Math.round((S.nightUps[0].e - S.nightUps[0].s) / 60000), S.night[nightKey()]]);
    eq(r, [1, 7, 1]);
  });
  await test('the trip shows up in the family safety report', async () => {
    await n.evaluate(() => show('famReport')); await wait(300);
    ok((await n.$eval('#nightLog', e => e.innerText)).includes('7'));
  });
  await test('the daily "good morning" greeting does not play at night', async () => {
    eq(await n.evaluate(() => { let called = false; const o = playKey; playKey = () => { called = true; return Promise.resolve(true); };
      S.voiceMeta.hello = { dur: 2 }; S.helloDay = ''; tryHello(); playKey = o; delete S.voiceMeta.hello; return called; }), false);
  });
  await test('reopening at night from another screen goes to night mode, but not while family is using it', async () => {
    const vis = () => n.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await n.evaluate(() => { nightSkip = 0; show('journal'); }); await vis(); await wait(200);
    eq(await n.evaluate(() => SCREEN), 'night');
    await n.evaluate(() => show('famMeds')); await vis(); await wait(200);
    eq(await n.evaluate(() => SCREEN), 'famMeds');
  });
  await test('night mode has no script errors', async () => eq(n.errors, []));

  console.log('\nNight mode preview (daytime)');
  const v = await phone(DAY);
  await test('family can preview night mode in the daytime, and the preview records nothing', async () => {
    await v.evaluate(() => show('famDemo')); await wait(200);
    await v.click('#nightPreview'); await wait(200);
    eq(await v.evaluate(() => SCREEN), 'night');
    await v.click('#nBtns button'); await wait(150); await v.click('#nBtns button'); await wait(150);
    eq(await v.evaluate(() => [S.nightUps.length, Object.keys(S.night).length, !!S.upNow]), [0, 0, false]);
    await v.click('#nHome'); await wait(300);
    eq(await v.evaluate(() => SCREEN), 'famDemo');
    eq(v.errors, []);
  });

  await browser.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
