/*
 * End-to-end tests for Nursing Log.
 *
 *   node tests/app.test.mjs
 *
 * Needs Playwright's chromium. If Playwright is installed somewhere other than
 * this project, point PLAYWRIGHT at it:
 *
 *   PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/index.mjs node tests/app.test.mjs
 *
 * Screenshots land in a temp directory; the path is printed at the end.
 */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = await mkdtemp(join(tmpdir(), 'nursing-log-'));

/* A static server for the app, so the suite needs nothing else running. */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.md': 'text/markdown' };
/* A signal too weak to answer, rather than none at all: these requests are
   simply never replied to, which is what a bad connection actually does to a
   fetch. Held so they can be torn down at the end. */
let stall = false;
const stalled = [];

const server = createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);

  /* A page to press Back into, so leaving the app is distinguishable from
     closing a sheet. */
  if (path === '/__sentinel') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>sentinel</title><h1>sentinel</h1>');
    return;
  }

  if (stall) { stalled.push(res); return; }

  if (path.endsWith('/')) path += 'index.html';
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).on('error', () => res.writeHead(404).end()).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* "Yesterday" has to move with the calendar or the suite rots overnight. */
const ymd = ms => new Date(ms).toLocaleDateString('en-CA');   // YYYY-MM-DD, local
const YESTERDAY = ymd(Date.now() - 86400000);
const TOMORROW = ymd(Date.now() + 86400000);

const fails = [];
const ok = [];
function check(name, cond) { (cond ? ok : fails).push(name); }

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
/* Stub the wake lock so the suite can see whether the app asks for one.
   dimMs is huge by default: a veil appearing mid-test would swallow clicks. */
function wakeStub(dimMs) {
  window.NL_DIM_MS = dimMs;
  window.__wake = { taken: 0, released: 0, held: false };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: () => {
        window.__wake.taken++;
        window.__wake.held = true;
        return Promise.resolve({
          addEventListener() {},
          release: () => { window.__wake.released++; window.__wake.held = false; return Promise.resolve(); },
        });
      },
    },
  });
}
await ctx.addInitScript(wakeStub, 600000);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });

// tapping a row opens a read-only view; Edit is a deliberate second tap
const openRow = async (n = 0) => {
  await (await page.$$('.entry'))[n].click();
  const edit = await page.isVisible('#editorEdit') ? '#editorEdit'
    : await page.isVisible('#diaperEdit') ? '#diaperEdit' : null;
  if (!edit) throw new Error('row ' + n + ' did not open a locked card');
  await page.click(edit);
};

check('idle view', await page.isVisible('#idleView'));
check('two start buttons', (await page.$$('[data-start]')).length === 2);
check('empty timeline', (await page.textContent('#history')).includes('will show up here'));
await page.click('[data-filter="feeds"]');
check('feeds empty state', (await page.textContent('#history')).includes('No feedings recorded yet'));
await page.click('[data-filter="diapers"]');
check('diapers empty state', (await page.textContent('#history')).includes('No diapers recorded yet'));
await page.click('[data-filter="all"]');

// ---------- per-side timing ----------
await page.click('[data-start="L"]');
check('running view', await page.isVisible('#runningView'));
check('left tile active', (await page.getAttribute('[data-switch="L"]', 'class')).includes('active'));
check('left marked feeding', (await page.textContent('#leftDot')).includes('feeding'));
check('right shows 0:00', await page.textContent('#rightVal') === '0:00');

await page.waitForTimeout(2500);
const leftBefore = await page.textContent('#leftVal');
check('left accrues (' + leftBefore + ')', leftBefore !== '0:00');
check('right still zero while on left', await page.textContent('#rightVal') === '0:00');

await page.click('[data-switch="R"]');
check('right tile active', (await page.getAttribute('[data-switch="R"]', 'class')).includes('active'));
check('left tile inactive', !(await page.getAttribute('[data-switch="L"]', 'class')).includes('active'));
const leftFrozen = await page.textContent('#leftVal');
await page.waitForTimeout(2500);
check('left frozen after switch', await page.textContent('#leftVal') === leftFrozen);
const rightNow = await page.textContent('#rightVal');
check('right accrues (' + rightNow + ')', rightNow !== '0:00');

// total = left + right
const toSec = t => t.split(':').reduce((a, p) => a * 60 + +p, 0);
const [L, R, T] = await Promise.all([
  page.textContent('#leftVal'), page.textContent('#rightVal'), page.textContent('#elapsed')
]);
check(`total = L+R (${L}+${R}=${T})`, Math.abs(toSec(L) + toSec(R) - toSec(T)) <= 1);

// tapping the active side again is a no-op
await page.click('[data-switch="R"]');
check('re-tap same side keeps it active', (await page.getAttribute('[data-switch="R"]', 'class')).includes('active'));

// per-side totals survive a reload
await page.reload({ waitUntil: 'networkidle' });
check('running survives reload', await page.isVisible('#runningView'));
check('left total survives reload', await page.textContent('#leftVal') === leftFrozen);
check('active side survives reload', (await page.getAttribute('[data-switch="R"]', 'class')).includes('active'));

await page.click('#stopBtn');
check('idle after stop', await page.isVisible('#idleView'));
check('one entry', (await page.$$('.entry')).length === 1);
check('pill says B', await page.textContent('.entry .pill') === 'B');
check('split shown', (await page.textContent('#history')).includes('Left 1 min · Right 1 min'));
check('row shows ending side', (await page.textContent('#history')).includes('· ended right'));
check('last-fed line counts from the start', (await page.textContent('#sinceText')).includes('Last feed started'));
check('finished line shows the ending side', (await page.textContent('#sinceEnd')).includes('on the right'));
check('finished line counts from the end', (await page.textContent('#sinceEnd')).includes('Finished'));
check('right start button suggested', (await page.getAttribute('[data-start="R"]', 'class')).includes('sel'));
check('right start button says pick up', (await page.textContent('[data-start="R"]')).includes('pick up here'));
check('left start button not suggested', !(await page.getAttribute('[data-start="L"]', 'class')).includes('sel'));

// ---------- reading a record: the editor card, locked ----------
await (await page.$$('.entry'))[0].click();
check('row opens the card', await page.isVisible('#editorScrim'));
check('card is locked', await page.$eval('#editorScrim .sheet', n => n.classList.contains('locked')));
check('title names the record', (await page.textContent('#editorTitle')).includes('Feeding · Both'));
check('reading offers Close and Edit', await page.isVisible('#editorClose') && await page.isVisible('#editorEdit'));
check('no Save while reading', !(await page.isVisible('#editorSave')));
check('no Delete while reading', !(await page.isVisible('#editorDelete')));
check('every field is disabled',
  await page.$$eval('#editorScrim input, #editorScrim textarea', ns => ns.every(n => n.disabled)));
check('values still readable', await page.inputValue('#fLeft') === '1');
check('the chosen side still shows', (await page.getAttribute('[data-pick="B"]', 'class')).includes('sel'));

// tapping a chip while locked must not change the record
await page.click('[data-pick="L"]', { force: true });
check('locked chips ignore taps', (await page.getAttribute('[data-pick="B"]', 'class')).includes('sel'));
check('layout did not switch', await page.isVisible('#durSplit'));
await page.click('[data-end="L"]', { force: true });
check('locked ending side ignores taps', (await page.getAttribute('[data-end="R"]', 'class')).includes('sel'));

await page.click('#editorClose');
check('closing changed nothing', (await page.textContent('#history')).includes('Left 1 min · Right 1 min'));

// Edit unlocks the same card in place
await (await page.$$('.entry'))[0].click();
await page.click('#editorEdit');
check('edit unlocks the card', !(await page.$eval('#editorScrim .sheet', n => n.classList.contains('locked'))));
check('title switches to editing', await page.textContent('#editorTitle') === 'Edit feeding');
check('fields become writable',
  await page.$$eval('#editorScrim input, #editorScrim textarea', ns => ns.every(n => !n.disabled)));
check('Save and Delete appear', await page.isVisible('#editorSave') && await page.isVisible('#editorDelete'));
check('Close and Edit step aside', !(await page.isVisible('#editorClose')) && !(await page.isVisible('#editorEdit')));
await page.click('#editorCancel');

// ---------- editing keeps both sides ----------
await openRow(0);
check('edit title', await page.textContent('#editorTitle') === 'Edit feeding');
check('Both preselected', (await page.getAttribute('[data-pick="B"]', 'class')).includes('sel'));
check('split fields shown', await page.isVisible('#durSplit') && !(await page.isVisible('#durSingle')));
check('left prefilled', await page.inputValue('#fLeft') === '1');
check('right prefilled', await page.inputValue('#fRight') === '1');
check('ended-on shown for Both', await page.isVisible('#endWrap'));
check('ended-on prefilled to right', (await page.getAttribute('[data-end="R"]', 'class')).includes('sel'));

await page.fill('#fLeft', '14');
await page.fill('#fRight', '6');
await page.click('[data-end="L"]');           // she actually finished on the left
await page.fill('#fNotes', 'Switched sides, "good" latch');
await page.click('#editorSave');
check('edited ending side saved', (await page.textContent('#history')).includes('· ended left'));
check('finished line reflects edit', (await page.textContent('#sinceEnd')).includes('on the left'));
check('suggestion follows the edit', (await page.getAttribute('[data-start="L"]', 'class')).includes('sel'));
check('old suggestion cleared', !(await page.getAttribute('[data-start="R"]', 'class')).includes('sel'));
check('edited split saved', (await page.textContent('#history')).includes('Left 14 min · Right 6 min'));
check('total is sum', (await page.textContent('#history')).includes('20 min'));
check('notes shown', (await page.textContent('#history')).includes('Switched sides'));

// switching Both -> Left carries the total across
await openRow(0);
await page.click('[data-pick="L"]');
check('single field shown', await page.isVisible('#durSingle') && !(await page.isVisible('#durSplit')));
check('ended-on hidden for one side', !(await page.isVisible('#endWrap')));
check('label names the side', (await page.textContent('#durLabel')).includes('left'));
check('minutes carried over', await page.inputValue('#fDur') === '20');
// and back again
await page.click('[data-pick="B"]');
check('carried into left field', await page.inputValue('#fLeft') === '20');
await page.click('[data-pick="R"]');
check('B->R carries sum', await page.inputValue('#fDur') === '20');
await page.fill('#fDur', '9');
await page.click('#editorSave');
check('right-only saved', (await page.textContent('#history')).includes('Right only'));
check('one-sided feed needs no ended tag', !(await page.textContent('#history')).includes('· ended'));
check('one-sided finished line says the side', (await page.textContent('#sinceEnd')).includes('on the right'));
check('right-only pill', await page.textContent('.entry .pill') === 'R');
check('right-only duration', (await page.textContent('#history')).includes('9 min'));

// Both with no minutes is rejected
await openRow(0);
await page.click('[data-pick="B"]');
await page.fill('#fLeft', '0');
await page.fill('#fRight', '0');
await page.click('#editorSave');
check('empty Both rejected', await page.isVisible('#editorScrim'));
check('rejection explained', (await page.textContent('#toastText')).includes('at least one side'));

/* One side with no minutes used to save: a row reading "less than a minute"
   with no side on it, which also costs the idle card its pick-up hint. */
await page.click('[data-pick="L"]');
await page.fill('#fDur', '0');
await page.click('#editorSave');
check('a one-sided feed of no minutes is rejected too', await page.isVisible('#editorScrim'));
check('and says what it wants', (await page.textContent('#toastText')).includes('How many minutes'));
await page.click('#editorCancel');

// ---------- manual add ----------
await page.click('#addManualBtn');
check('add title', await page.textContent('#editorTitle') === 'Add a feeding');
check('delete hidden when adding', !(await page.isVisible('#editorDelete')));
await page.fill('#fDate', YESTERDAY);
await page.fill('#fTime', '03:20');
await page.fill('#fDur', '22');
await page.click('#editorSave');
check('two feeds', (await page.$$('.entry')).length === 2);
check('yesterday header', (await page.textContent('#history')).includes('Yesterday'));
check('left only label', (await page.textContent('#history')).includes('Left only'));

/* Nothing is recorded before it happens. A mistyped date used to save, sit at
   the top of the log as the newest thing there, and read as "just now". */
await page.click('#addManualBtn');
await page.fill('#fDate', TOMORROW);
await page.fill('#fDur', '15');
await page.click('#editorSave');
check('a feeding dated tomorrow is refused', (await page.textContent('#toastText')).includes('in the future'));
check('and the sheet stays open', await page.isVisible('#editorScrim'));
check('with nothing saved', (await page.$$('.entry')).length === 2);
await page.click('#editorCancel');

// ---------- diapers ----------
// quick buttons now open the sheet rather than logging blind
await page.click('[data-diaper="pee"]');
check('quick tap opens the sheet', await page.isVisible('#diaperScrim'));
check('sheet titled for logging', await page.textContent('#diaperTitle') === 'Log a diaper');
check('pee preselected from the tap', (await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel'));
check('poop not preselected', !(await page.getAttribute('[data-toggle="poop"]', 'class')).includes('sel'));
check('no size prompt for pee', !(await page.isVisible('#sizeWrap')));
check('nothing logged until saved', (await page.$$('.entry')).length === 2);

await page.fill('#dDate', TOMORROW);
await page.click('#diaperSave');
check('a nappy dated tomorrow is refused', (await page.textContent('#toastText')).includes('in the future'));
await page.click('#diaperCancel');
check('cancel logs nothing', (await page.$$('.entry')).length === 2);
check('diaper stat still 0', await page.textContent('#statDiapers') === '0');
check('no today line before there is anything to count', !(await page.isVisible('#diaperToday')));

// poop asks for a size
await page.click('[data-diaper="poop"]');
check('poop preselected', (await page.getAttribute('[data-toggle="poop"]', 'class')).includes('sel'));
check('pee not preselected for poop tap', !(await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel'));
check('size prompt appears', await page.isVisible('#sizeWrap'));
check('no size chosen yet', (await page.$$('#sizeWrap .sel')).length === 0);
await page.click('[data-size="L"]');
check('size selectable', (await page.getAttribute('[data-size="L"]', 'class')).includes('sel'));
await page.click('[data-size="L"]');
check('tapping again clears it', !(await page.getAttribute('[data-size="L"]', 'class')).includes('sel'));
await page.click('[data-size="M"]');
await page.fill('#dNotes', 'Seedy, mustard colored');
await page.click('#diaperSave');
check('diaper saved from sheet', (await page.$$('.entry')).length === 3);
check('size shown in list', (await page.textContent('#history')).includes('Medium poop'));
check('notes shown', (await page.textContent('#history')).includes('Seedy, mustard'));
check('diaper stat = 1', await page.textContent('#statDiapers') === '1');
check('today counts the poop as dirty and not wet',
  (await page.textContent('#diaperToday')).replace(/\s+/g, ' ') === 'Today 0 wet · 1 dirty');

check('a diaper logged now sorts above a feeding from seconds ago',
  (await page.$$eval('.entry', ns => ns[0].textContent)).includes('Poop'));

// editing without touching date/time must not shift the record
const timeBefore = await page.$$eval('.entry', ns => ns[0].textContent.match(/\d+:\d+ [AP]M/)[0]);
await openRow(0);
await page.fill('#dNotes', 'Seedy, mustard colored, and edited');
await page.click('#diaperSave');
check('untouched time survives an edit',
  (await page.$$eval('.entry', ns => ns[0].textContent)).includes(timeBefore));
check('still sorted above the feeding',
  (await page.$$eval('.entry', ns => ns[0].textContent)).includes('Poop'));

// deselecting poop drops the size question and the stored size
await (await page.$$('.entry'))[0].click();
check('diaper card opens locked', await page.isVisible('#diaperScrim')
  && await page.$eval('#diaperScrim .sheet', n => n.classList.contains('locked')));
check('diaper title names it', (await page.textContent('#diaperTitle')).includes('Diaper · Poop'));
check('size shown while reading', await page.isVisible('#sizeWrap')
  && (await page.getAttribute('[data-size="M"]', 'class')).includes('sel'));
check('notes shown while reading', (await page.inputValue('#dNotes')).includes('Seedy, mustard'));
check('diaper fields disabled',
  await page.$$eval('#diaperScrim input, #diaperScrim textarea', ns => ns.every(n => n.disabled)));
await page.click('[data-toggle="pee"]', { force: true });
check('locked toggles ignore taps', !(await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel'));
await page.click('#diaperEdit');
check('edit unlocks the diaper card', !(await page.$eval('#diaperScrim .sheet', n => n.classList.contains('locked'))));
check('diaper fields writable',
  await page.$$eval('#diaperScrim input, #diaperScrim textarea', ns => ns.every(n => !n.disabled)));
check('size prefilled on edit', (await page.getAttribute('[data-size="M"]', 'class')).includes('sel'));
await page.click('[data-toggle="poop"]');
check('size prompt hides with poop', !(await page.isVisible('#sizeWrap')));
await page.click('[data-toggle="pee"]');
await page.click('#diaperSave');
check('size dropped with the poop', !(await page.textContent('#history')).includes('Medium poop'));
check('still one diaper', await page.textContent('#statDiapers') === '1');
check('today follows the edit', (await page.textContent('#diaperToday')).includes('1 wet · 0 dirty'));

// both, with a size
await page.click('[data-diaper="both"]');
check('both preselected', (await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel')
  && (await page.getAttribute('[data-toggle="poop"]', 'class')).includes('sel'));
check('size prompt shown for both', await page.isVisible('#sizeWrap'));
await page.click('[data-size="S"]');
await page.click('#diaperSave');
check('both logged', await page.textContent('#statDiapers') === '2');
check('a both counts in each column, so the two do not add up to the changes',
  (await page.textContent('#diaperToday')).includes('2 wet · 1 dirty'));
check('both label', (await page.textContent('#history')).includes('Pee + poop'));
check('small size shown', (await page.textContent('#history')).includes('Small poop'));
check('day summary counts wet and dirty', (await page.textContent('#history')).includes('2 wet · 1 dirty'));

// selecting neither is still rejected
await page.click('#addDiaperBtn');
check('add diaper title', await page.textContent('#diaperTitle') === 'Add a diaper');
await page.click('[data-toggle="pee"]');
await page.click('#diaperSave');
check('empty diaper rejected', await page.isVisible('#diaperScrim'));
check('diaper rejection explained', (await page.textContent('#toastText')).includes('pee, poop, or both'));
await page.click('[data-toggle="poop"]');
await page.fill('#dDate', YESTERDAY);
await page.fill('#dTime', '22:10');
await page.click('#diaperSave');
check('past diaper added', (await page.textContent('#history')).includes('10:10 PM'));
check('today diaper count unchanged', await page.textContent('#statDiapers') === '2');
check('yesterday stays out of today\'s wet and dirty',
  (await page.textContent('#diaperToday')).includes('2 wet · 1 dirty'));

// a record with no notes should not show an empty notes box while reading
await page.click('[data-diaper="pee"]');
await page.click('#diaperSave');
await (await page.$$('.entry'))[0].click();
check('empty notes hidden while reading', !(await page.isVisible('#dNotesWrap')));
check('no size row for a pee', !(await page.isVisible('#sizeWrap')));
await page.click('#diaperEdit');
check('notes box returns when editing', await page.isVisible('#dNotesWrap'));
await page.click('#diaperCancel');
await (await page.$$('.entry'))[0].click();
await page.click('#diaperEdit');
await page.click('#diaperDelete');

// ---------- filter views ----------
const rowCount = async () => (await page.$$('.entry')).length;
const allRows = await rowCount();
check('All is the default', (await page.getAttribute('[data-filter="all"]', 'class')).includes('sel'));

await page.click('[data-filter="feeds"]');
const feedRows = await rowCount();
check('feeds view drops diapers', feedRows === 2 && !(await page.textContent('#history')).includes('Diaper'));
check('feeds view has no diaper summary', !(await page.textContent('#history')).includes('diapers'));
check('feeds tab marked', (await page.getAttribute('[data-filter="feeds"]', 'class')).includes('sel'));

await page.click('[data-filter="diapers"]');
const diaperRows = await rowCount();
check('diapers view drops feeds', diaperRows === 3 && !(await page.textContent('#history')).includes(' min'));
check('rows add up', feedRows + diaperRows === allRows);

await page.reload({ waitUntil: 'networkidle' });
check('filter choice remembered', (await page.getAttribute('[data-filter="diapers"]', 'class')).includes('sel'));
check('filter still applied after reload', await rowCount() === diaperRows);

await page.click('[data-filter="all"]');
check('back to everything', await rowCount() === allRows);

const beforeReload = (await page.$$('.entry')).length;
const endBefore = await page.textContent('#history');
await page.reload({ waitUntil: 'networkidle' });
check('everything survives reload', (await page.$$('.entry')).length === beforeReload);
check('ending side survives reload', (await page.textContent('#history')) === endBefore);

// ---------- CSV ----------
await page.click('#menuBtn');
const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
const csvText = await (await csv.createReadStream()).toArray().then(b => Buffer.concat(b).toString());
const csvRows = csvText.trim().split('\r\n');
check('csv header', csvRows[0] === '"Date","Time","Type","Side","Left (min)","Right (min)","Total (min)","Ended on","Pee","Poop","Poop size","Medicine","Dose","Notes"');
check('csv records ending side', csvText.includes('"22","0","22","Left"'));
check('csv row per record', csvRows.length === beforeReload + 1);
check('csv has feeding rows', csvText.includes('"Feeding"'));
check('csv has diaper rows', csvText.includes('"Diaper"'));
check('csv records poop size', csvText.includes('"Yes","Small"'));
check('csv per-side columns', csvText.includes('"Feeding","Left","22","0","22"'));
check('csv escapes quotes in notes', csvText.includes('""good"" latch'));
check('csv oldest first', csvRows[1].includes('3:20 AM'));

// ---------- doctor's summary (PDF) ----------
await page.click('#menuBtn');
const [pdfDl] = await Promise.all([page.waitForEvent('download'), page.click('#exportPdf')]);
const pdfPath = join(SHOTS, 'summary.pdf');
await pdfDl.saveAs(pdfPath);
const pdf = (await readFile(pdfPath)).toString('latin1');

check('pdf filename carries date and time', /nursing-log-summary-\d{8}-\d{4}\.pdf/.test(pdfDl.suggestedFilename()));
check('pdf header', pdf.startsWith('%PDF-1.'));
check('pdf ends properly', pdf.trimEnd().endsWith('%%EOF'));

// a wrong byte offset yields a file that opens blank in some readers and fine in others
const sx = pdf.match(/startxref\s+(\d+)\s+%%EOF/);
check('startxref present', !!sx);
check('startxref lands on the xref table', pdf.slice(+sx[1], +sx[1] + 4) === 'xref');

const xhead = pdf.slice(+sx[1]).match(/^xref\s+0 (\d+)\s+/);
const objCount = +xhead[1];
const xbody = pdf.slice(+sx[1] + xhead[0].length);
let offsetsOk = true, lengthsOk = true;
for (let n = 1; n < objCount; n++) {
  if (!pdf.startsWith(`${n} 0 obj`, +xbody.slice(n * 20, n * 20 + 10))) offsetsOk = false;
}
check(`every object offset is right (${objCount - 1} objects)`, offsetsOk);
check('free entry leads the table', xbody.startsWith('0000000000 65535 f'));
check('trailer size matches', pdf.includes(`/Size ${objCount} /Root 1 0 R`));

for (const m of pdf.matchAll(/<< \/Length (\d+) >>\s*stream\n/g)) {
  const start = m.index + m[0].length;
  if (pdf.indexOf('\nendstream', start) - start !== +m[1]) lengthsOk = false;
}
check('declared stream lengths match the streams', lengthsOk);

check('fonts are the built-in ones, nothing embedded',
  pdf.includes('/BaseFont /Helvetica') && pdf.includes('/BaseFont /Helvetica-Bold')
  && !pdf.includes('/FontFile'));
const pdfPages = +(pdf.match(/\/Count (\d+)/) || [])[1];
check('the page tree counts its pages (' + pdfPages + ')', pdfPages >= 1 && pdfPages <= 6);
check('a fortnight-long log needs no continuation page', !pdf.includes('Day by day, continued'));
check('pdf has the title', pdf.includes('Feeding & Diaper Summary'));
check('pdf has the at-a-glance tiles',
  ['Feeds per day', 'Time per day', 'Average feed', 'Longest gap', 'Wet per day', 'Dirty per day']
    .every(k => pdf.includes(k)));
check('pdf has the day table', pdf.includes('Day by day') && pdf.includes('Left / Right'));
check('pdf carries notes through', pdf.includes('Seedy, mustard colored'));
check('pdf page numbering',
  pdf.includes('Page 1 of ' + pdfPages) && pdf.includes(`Page ${pdfPages} of ${pdfPages}`));
check('pdf escapes parentheses in notes', !/[^\\]\(\)/.test(pdf.split('stream')[1] || ''));
await page.click('#menuBtn');
check('pdf did not count as a backup', !(await page.textContent('#backupStatus')).includes('today'));
await page.click('#menuClose');

// nothing logged yet means nothing to summarise
const emptyCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const ep = await emptyCtx.newPage();
let emptyDownloads = 0;
ep.on('download', () => { emptyDownloads++; });
await ep.goto(BASE, { waitUntil: 'networkidle' });
await ep.click('#menuBtn');
await ep.click('#exportPdf');
await ep.waitForTimeout(300);
check('empty log offers no summary', (await ep.textContent('#toastText')).includes('Nothing to summarise'));
check('empty log produces no file', emptyDownloads === 0);
await emptyCtx.close();

// ---------- JSON round trip ----------
await page.click('#menuBtn');
const [json] = await Promise.all([page.waitForEvent('download'), page.click('#exportJson')]);
const jsonPath = join(SHOTS, 'backup.json');
await json.saveAs(jsonPath);
const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
check('backup version 3', parsed.version === 3);
check('backup has feeds', parsed.entries.length === 2);
check('backup has diapers', parsed.diapers.length === 3);
check('backup keeps poop size', parsed.diapers.some(d => d.size === 'S'));
check('backup drops size without poop', parsed.diapers.every(d => !d.size || d.poop));
check('backup keeps per-side seconds', parsed.entries.some(e => e.leftSec === 1320 && e.rightSec === 0));
check('backup keeps ending side', parsed.entries.every(e => e.endSide === 'L' || e.endSide === 'R'));

// delete one of each, then restore
await openRow(0);
await page.click(await page.isVisible('#diaperDelete') ? '#diaperDelete' : '#editorDelete');
const afterDelete = (await page.$$('.entry')).length;
check('delete removed one', afterDelete === beforeReload - 1);
check('delete offers undo instead of a confirm', await page.isVisible('#toastAction'));

await page.click('#toastAction');
check('undo restores the record', (await page.$$('.entry')).length === beforeReload);
check('undo confirms', (await page.textContent('#toastText')).includes('restored'));

await openRow(0);
await page.click(await page.isVisible('#diaperDelete') ? '#diaperDelete' : '#editorDelete');
check('deleted again', (await page.$$('.entry')).length === beforeReload - 1);

await page.click('#menuBtn');
await page.setInputFiles('#fileInput', jsonPath);
await page.waitForTimeout(400);
check('restore brings it back', (await page.$$('.entry')).length === beforeReload);
check('restore toast', (await page.textContent('#toastText')).includes('Restored 1'));

await page.click('#menuBtn');
await page.setInputFiles('#fileInput', jsonPath);
await page.waitForTimeout(400);
check('re-import adds nothing', (await page.$$('.entry')).length === beforeReload);
check('no-op toast', (await page.textContent('#toastText')).includes('Nothing new'));

// ---------- medicines ----------
await page.click('[data-filter="meds"]');
check('meds empty state', (await page.textContent('#history')).includes('No medicine recorded yet'));
await page.click('[data-filter="all"]');
check('the card invites a first dose',
  (await page.textContent('#medSince')).includes('No medicine recorded yet'));

const medButtons = () => page.$$eval('#medQuick .side-btn', ns => ns.map(n => n.textContent));
check('one button before there is any history', (await medButtons()).length === 1);

await page.click('#medQuick .side-btn');
check('the button opens the editor', await page.isVisible('#medScrim'));
check('opening it records nothing', await page.textContent('#statMeds') === '0');

const medOptions = id => page.$$eval(`#${id} option`, ns => ns.map(n => n.textContent));
check('the medicine is a list', await page.$eval('#mName', n => n.tagName) === 'SELECT');
check('the amount is a list', await page.$eval('#mDose', n => n.tagName) === 'SELECT');
check('it opens on ibuprofen', await page.inputValue('#mName') === 'Ibuprofen');
check('and on 400 mg', await page.inputValue('#mDose') === '400 mg');
check('amounts climb in 200 mg steps',
  (await medOptions('mDose')).filter(t => /mg$/.test(t)).join() === '200 mg,400 mg,600 mg,800 mg,1000 mg');
check('an amount can be left off', (await medOptions('mDose')).includes('Not recorded'));
check('both lists offer something else',
  (await medOptions('mName')).some(t => t.startsWith('Something else')) &&
  (await medOptions('mDose')).some(t => t.startsWith('Something else')));
check('nothing to type in until then',
  !(await page.isVisible('#mNameOtherWrap')) && !(await page.isVisible('#mDoseOtherWrap')));

// "Something else" with nothing typed is still not a record
await page.selectOption('#mName', '__other__');
check('choosing it opens a box to type in', await page.isVisible('#mNameOtherWrap'));
await page.click('#medSave');
check('a dose with no medicine named is refused',
  (await page.textContent('#toastText')).includes('Which medicine'));
check('and the editor stays open', await page.isVisible('#medScrim'));

await page.selectOption('#mName', 'Ibuprofen');
check('going back to the list hides the box', !(await page.isVisible('#mNameOtherWrap')));
await page.fill('#mDate', TOMORROW);
await page.click('#medSave');
check('a dose dated tomorrow is refused', (await page.textContent('#toastText')).includes('in the future'));
await page.fill('#mDate', ymd(Date.now()));
await page.screenshot({ path: join(SHOTS, 'medicine-editor.png') });
await page.selectOption('#mDose', '400 mg');
await page.fill('#mNotes', 'For afterpains');
await page.click('#medSave');
check('the dose saves', !(await page.isVisible('#medScrim')));
check('doses today counts it', await page.textContent('#statMeds') === '1');
check('the card shows the last dose', (await page.textContent('#medSince')).includes('Ibuprofen 400 mg'));
check('the card says how long ago', (await page.textContent('#medSince')).includes('just now'));
check('the timeline shows the medicine', (await page.textContent('#history')).includes('Ibuprofen'));
check('and the amount under it', (await page.textContent('#history')).includes('400 mg'));
check('day totals count the dose', (await page.textContent('h2.day')).includes('1 dose'));

const quick = await medButtons();
check('a medicine taken becomes a one-tap button',
  quick.some(t => t.includes('Ibuprofen') && t.includes('400 mg')));
check('with a way to log something else', quick.some(t => /Something else|Other/.test(t)));

await page.click('#medQuick .side-btn');
check('a repeat dose comes prefilled',
  await page.inputValue('#mName') === 'Ibuprofen' && await page.inputValue('#mDose') === '400 mg');
await page.click('#medCancel');
check('cancelling a repeat records nothing', await page.textContent('#statMeds') === '1');
await page.screenshot({ path: join(SHOTS, 'medicine-card.png') });

// reading a dose must not be able to change it
await page.click('[data-filter="meds"]');
await (await page.$$('.entry'))[0].click();
check('a dose row opens locked',
  await page.$eval('#medScrim .sheet', n => n.classList.contains('locked')));
check('its fields are disabled',
  await page.$$eval('#medScrim input, #medScrim select, #medScrim textarea', ns => ns.every(n => n.disabled)));
check('reading a dose offers Close and Edit',
  await page.isVisible('#medClose') && await page.isVisible('#medEdit'));
check('no delete while reading a dose', !(await page.isVisible('#medDelete')));
await page.screenshot({ path: join(SHOTS, 'medicine-locked.png') });

await page.click('#medEdit');
check('Edit unlocks the dose',
  !(await page.$eval('#medScrim .sheet', n => n.classList.contains('locked'))));
check('delete appears once editing', await page.isVisible('#medDelete'));
await page.selectOption('#mDose', '200 mg');
await page.click('#medSave');
check('the edit sticks', (await page.textContent('#medSince')).includes('200 mg'));

// the date/time gotcha: editing the notes must not shift the dose backwards
const doseRow = () => page.textContent('.entry .time');
const doseAt = await doseRow();
await (await page.$$('.entry'))[0].click();
await page.click('#medEdit');
await page.fill('#mNotes', 'With food');
await page.click('#medSave');
check('editing a dose leaves its time alone', await doseRow() === doseAt);

// a medicine off the list, with no amount, and how both read back
await page.click('#addMedBtn');
await page.selectOption('#mName', '__other__');
await page.fill('#mNameOther', 'Paracetamol');
await page.selectOption('#mDose', '');
await page.click('#medSave');
check('a dose with no amount is fine', (await page.$$('.entry')).length === 2);
check('a medicine off the list saves under the name typed',
  (await page.textContent('#medSince')).includes('Paracetamol'));
await (await page.$$('.entry'))[0].click();
check('the empty amount is hidden while reading', !(await page.isVisible('#mDoseWrap')));
check('reading it shows that name, not "Something else"',
  await page.inputValue('#mName') === 'Paracetamol');
check('with nothing to type in while reading', !(await page.isVisible('#mNameOtherWrap')));
await page.click('#medEdit');
check('and editing keeps it selected rather than resetting it',
  await page.inputValue('#mName') === 'Paracetamol');
await page.click('#medCancel');

check('two medicines make two buttons', (await medButtons()).length === 3);

// backup carries doses, and restoring twice does not duplicate them
await page.click('#menuBtn');
const [medJson] = await Promise.all([page.waitForEvent('download'), page.click('#exportJson')]);
const medPath = join(SHOTS, 'meds-backup.json');
await medJson.saveAs(medPath);
const medParsed = JSON.parse(await readFile(medPath, 'utf8'));
check('the backup carries medicines', medParsed.meds.length === 2);
check('with what was taken', medParsed.meds.some(m => m.name === 'Ibuprofen' && m.dose === '200 mg'));

await (await page.$$('.entry'))[0].click();
await page.click('#medEdit');
await page.click('#medDelete');
check('a dose deletes', (await page.$$('.entry')).length === 1);
check('deleting a dose offers undo', await page.isVisible('#toastAction'));
await page.click('#toastAction');
check('undo brings the dose back', (await page.$$('.entry')).length === 2);

await page.click('#menuBtn');
await page.setInputFiles('#fileInput', medPath);
await page.waitForTimeout(400);
check('restoring the same doses adds nothing',
  (await page.textContent('#toastText')).includes('Nothing new'));
check('and leaves the count alone', (await page.$$('.entry')).length === 2);

await page.click('#menuBtn');
const [medCsv] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsv')]);
const medCsvText = await (await medCsv.createReadStream()).toArray().then(b => Buffer.concat(b).toString());
check('the spreadsheet has a medicine row', medCsvText.includes('"Medicine"'));
check('with the name and amount in their columns', medCsvText.includes('"Ibuprofen","200 mg"'));

await page.click('#menuBtn');
const [medPdf] = await Promise.all([page.waitForEvent('download'), page.click('#exportPdf')]);
const medPdfPath = join(SHOTS, 'summary-meds.pdf');
await medPdf.saveAs(medPdfPath);
const medPdfText = (await readFile(medPdfPath)).toString('latin1');
check('the doctor\'s summary lists doses', medPdfText.includes('Ibuprofen 200 mg'));
check('and says so in the heading', medPdfText.includes('Notes & medicines'));

// an amount off the list survives the same way a name does
await (await page.$$('.entry'))[0].click();
await page.click('#medEdit');
await page.selectOption('#mDose', '__other__');
await page.fill('#mDoseOther', 'Half a tablet');
await page.click('#medSave');
check('an amount off the list saves', (await page.textContent('#medSince')).includes('Half a tablet'));
await (await page.$$('.entry'))[0].click();
check('and reads back as itself', await page.inputValue('#mDose') === 'Half a tablet');
await page.click('#medClose');

await page.click('[data-filter="all"]');
check('the timeline shows feeds, diapers and doses together',
  (await page.$$('.entry')).length > 2);

// ---------- version log ----------
await page.click('#menuBtn');
const versionLine = await page.textContent('#versionLine');
check('the menu names the running version', /^Version \d+\.\d+ · /.test(versionLine));

await page.click('#whatsNew');
check('what\'s new opens its own sheet', await page.isVisible('#logScrim'));
check('the menu closes behind it', !(await page.isVisible('#menuScrim')));

const entries = await page.$$eval('#versionLog .vlog-entry', ns => ns.map(n => ({
  head: n.querySelector('.vlog-head').textContent,
  current: n.classList.contains('current'),
  notes: n.querySelectorAll('li').length,
})));
check('every version is listed', entries.length >= 2);
check('the newest is marked as running',
  entries[0].current && entries[0].head.includes('running now'));
check('only one is marked', entries.filter(e => e.current).length === 1);
check('the running entry matches the menu line',
  versionLine.includes(entries[0].head.split(' · ')[0]));
check('each version says what changed', entries.every(e => e.notes >= 1));
check('this release mentions the share sheet',
  (await page.textContent('#versionLog')).toLowerCase().includes('share sheet'));
await page.screenshot({ path: join(SHOTS, 'version-log.png') });

await page.click('#logClose');
check('closing the log leaves the app', !(await page.isVisible('#logScrim')));

// ---------- newborn basics ----------
const logBefore = await page.textContent('#history');
await page.click('#guideBtn');
check('the ? button opens the basics', await page.isVisible('#guideScrim'));
check('it says it is not medical advice',
  (await page.textContent('#guideNote')).toLowerCase().includes('not medical advice'));

const sections = await page.$$eval('#guide details', ns => ns.map(n => ({
  title: n.querySelector('summary').textContent,
  open: n.open,
  bullets: n.querySelectorAll('li').length,
  urgent: n.classList.contains('urgent'),
})));
check('several sections are listed', sections.length >= 6);
check('every section says something', sections.every(s => s.bullets >= 3));
check('everything starts folded, so the headings fit one screen',
  sections.every(s => !s.open));
check('feeding is the first heading', /feed/i.test(sections[0].title));
check('the call-someone sections stand out', sections.filter(s => s.urgent).length >= 1);
check('folded, every heading fits without scrolling',
  await page.$eval('#guideScrim .sheet', n => n.scrollHeight <= n.clientHeight + 1));
await page.screenshot({ path: join(SHOTS, 'guide.png') });

// the diaper table is the reason most of these taps happen
const diaperIdx = sections.findIndex(s => /diaper/i.test(s.title));
check('diapers has its own section', diaperIdx >= 0);
await (await page.$$('#guide summary'))[diaperIdx].click();
const days = await page.$$eval('#guide .gtable div', ns => ns.map(n => n.textContent));
check('the table covers the first week', days.filter(d => /^Day /.test(d)).length >= 6);
check('day one expects a wet and a black one',
  days.includes('Day 1') && days.some(d => /black/i.test(d)));
check('by day six it is six or more', days.some(d => /Day 6/.test(d)) && days.some(d => /6 or more/.test(d)));
const guideText = (await page.textContent('#guide')).toLowerCase();
check('it says how often to feed', guideText.includes('8 to 12'));
check('it flags a newborn fever', guideText.includes('100.4'));
check('no medicine doses are advised', !/\b\d+\s?mg\b/.test(guideText));
await page.screenshot({ path: join(SHOTS, 'guide-diapers.png') });

await page.click('#guideClose');
check('closing the basics leaves the app', !(await page.isVisible('#guideScrim')));
check('reading the basics changed nothing', await page.textContent('#history') === logBefore);

// it opens the same way every time, not wherever it was left
await page.click('#guideBtn');
check('reopening folds it back up',
  await page.$$eval('#guide details', ns => ns.every(n => !n.open)));
await page.click('#guideScrim', { position: { x: 206, y: 40 } });
check('a tap outside closes it too', !(await page.isVisible('#guideScrim')));

// ---------- v1 data migrates ----------
const migCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const mig = await migCtx.newPage();
await mig.goto(BASE, { waitUntil: 'networkidle' });
await mig.evaluate(() => {
  localStorage.clear();
  const t = new Date(); t.setHours(8, 0, 0, 0);
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify([
    { id: 'v1a', start: t.getTime(), minutes: 18, side: 'L', notes: 'old left' },
    { id: 'v1b', start: t.getTime() - 3600000, minutes: 20, side: 'B', notes: 'old both' },
    { id: 'v1c', start: t.getTime() - 7200000, minutes: 12, side: 'R', notes: 'old right' },
  ]));
  // a v1 running timer had no segStart
  localStorage.setItem('nursinglog.active.v1', JSON.stringify({ start: Date.now() - 60000, side: 'R' }));
});
await mig.reload({ waitUntil: 'networkidle' });
const migText = await mig.textContent('#history');
check('v1 left migrates', migText.includes('Left only') && migText.includes('18 min'));
check('v1 right migrates', migText.includes('Right only') && migText.includes('12 min'));
check('v1 both splits evenly', migText.includes('Left 10 min · Right 10 min'));
check('v1 notes kept', migText.includes('old both'));
check('v1 one-sided infers ending side', !migText.includes('Left only · ended'));
check('v1 Both does not invent an ending side', !migText.includes('Left 10 min · Right 10 min · ended'));
check('v1 running timer adopted', await mig.isVisible('#runningView'));
check('v1 timer counts on its side', (await mig.getAttribute('[data-switch="R"]', 'class')).includes('active'));
const migRight = await mig.textContent('#rightVal');
check('v1 timer elapsed sensible (' + migRight + ')', toSec(migRight) >= 59 && toSec(migRight) <= 65);
await migCtx.close();

// ---------- backup nudge and sharing ----------
const menuText = async () => {
  await page.click('#menuBtn');
  const t = await page.textContent('#backupStatus');
  await page.click('#menuClose');
  return t;
};

check('backed-up status is shown', (await menuText()).includes('Last backup'));
check('no nudge right after backing up', !(await page.isVisible('#backupDot')));

// a log that has gone a long time without a backup gets a quiet dot
await page.evaluate(() => {
  localStorage.setItem('nursinglog.backup.v1', String(Date.now() - 12 * 86400000));
});
await page.reload({ waitUntil: 'networkidle' });
check('overdue backup raises the dot', await page.isVisible('#backupDot'));
check('overdue status names the age', (await menuText()).includes('12 days ago'));
check('overdue status is highlighted',
  await page.$eval('#backupStatus', n => n.classList.contains('due')));

// never backed up is counted from the oldest record, not from install
await page.evaluate(() => localStorage.removeItem('nursinglog.backup.v1'));
await page.reload({ waitUntil: 'networkidle' });
check('never-backed-up shows as such', (await menuText()).includes('Never backed up'));
check('recent log is not nagged', !(await page.isVisible('#backupDot')));

await page.evaluate(() => {
  const feeds = JSON.parse(localStorage.getItem('nursinglog.entries.v1'));
  feeds[feeds.length - 1].start = Date.now() - 30 * 86400000;    // a month of history
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify(feeds));
});
await page.reload({ waitUntil: 'networkidle' });
check('old log with no backup is nudged', await page.isVisible('#backupDot'));
/* That feed is now a month behind the rest, and "719h 59m" is no answer. */
check('a gap of days is counted in days',
  /\d+ days( \d+h)? since the one before/.test(await page.textContent('#history'))
  && !(await page.textContent('#history')).includes('719h'));

// backing up clears the nudge
await page.click('#menuBtn');
const [fresh] = await Promise.all([page.waitForEvent('download'), page.click('#exportJson')]);
await fresh.saveAs(join(SHOTS, 'nudge-clear.json'));
check('backing up clears the dot', !(await page.isVisible('#backupDot')));
check('a download says so rather than claiming a backup',
  (await page.textContent('#toastText')).includes('Saved to Downloads'));
check('status resets to today', (await menuText()).includes('today'));

// where the share sheet exists, the file goes to it instead of Downloads
const shareCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await shareCtx.addInitScript(() => {
  window.__shared = [];
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: data => {
      window.__shared.push(data.files.map(f => f.name));
      return Promise.resolve();
    },
  });
});
const sp = await shareCtx.newPage();
await sp.goto(BASE, { waitUntil: 'networkidle' });
await sp.evaluate(() => localStorage.setItem('nursinglog.entries.v1', JSON.stringify(
  [{ id: 'x', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' }])));
await sp.reload({ waitUntil: 'networkidle' });

await sp.click('#menuBtn');
await sp.click('#exportJson');
await sp.waitForTimeout(200);
const shared = await sp.evaluate(() => window.__shared);
check('backup goes to the share sheet', shared.length === 1 && /^nursing-log-backup-\d{8}-\d{4}\.json$/.test(shared[0][0]));
check('sharing counts as a backup', (await sp.textContent('#backupStatus')).includes('today'));

await sp.click('#menuBtn');                       // exporting closes the menu behind it
await sp.click('#exportCsv');
await sp.waitForTimeout(200);
check('csv shares too', (await sp.evaluate(() => window.__shared)).length === 2);

await shareCtx.close();

// Chrome's share sheet takes only a handful of file types, and .json is not one
// of them: the backup dropped into Downloads with no chance to send it to Drive.
const pickyCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await pickyCtx.addInitScript(() => {
  window.__shared = [];
  const allowed = /\.(txt|csv|pdf|png|jpe?g)$/i;                 // roughly Chrome's list
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: data => !!(data && data.files) && data.files.every(f => allowed.test(f.name)),
  });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async data => {
      window.__shared.push({ name: data.files[0].name, body: await data.files[0].text() });
    },
  });
});
const pp = await pickyCtx.newPage();
let pickyDownloads = 0;
pp.on('download', () => { pickyDownloads++; });
await pp.goto(BASE, { waitUntil: 'networkidle' });
await pp.evaluate(() => localStorage.setItem('nursinglog.entries.v1', JSON.stringify(
  [{ id: 'x', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' }])));
await pp.reload({ waitUntil: 'networkidle' });

await pp.click('#menuBtn');
await pp.click('#exportJson');
await pp.waitForTimeout(300);
const picky = await pp.evaluate(() => window.__shared);
const kept = picky[0] || { name: '', body: '{}' };            // nothing shared: the checks below say so
check('a backup Chrome refuses as json is shared as text',
  picky.length === 1 && /^nursing-log-backup-\d{8}-\d{4}\.json\.txt$/.test(kept.name));
check('the renamed backup still holds the records',
  (JSON.parse(kept.body).entries || []).length === 1);
check('it reaches the share sheet instead of Downloads', pickyDownloads === 0);

// and that file comes back in through restore
const keptPath = join(SHOTS, 'shared-backup.json.txt');
await writeFile(keptPath, kept.body);
await pp.evaluate(() => localStorage.removeItem('nursinglog.entries.v1'));
await pp.reload({ waitUntil: 'networkidle' });
await pp.click('#menuBtn');
await pp.setInputFiles('#fileInput', keptPath);
await pp.waitForTimeout(400);
check('a shared .txt backup restores', (await pp.$$('.entry')).length === 1);
await pickyCtx.close();

// backing out of the share sheet must not claim a backup happened.
// Its own context: a reload re-runs the init script and would undo an in-page stub.
const abortCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await abortCtx.addInitScript(() => {
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
  });
});
const ap = await abortCtx.newPage();
let abortDownloads = 0;
ap.on('download', () => { abortDownloads++; });
await ap.goto(BASE, { waitUntil: 'networkidle' });
await ap.evaluate(() => localStorage.setItem('nursinglog.entries.v1', JSON.stringify(
  [{ id: 'x', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' }])));
await ap.reload({ waitUntil: 'networkidle' });

await ap.click('#menuBtn');
await ap.click('#exportJson');
await ap.waitForTimeout(400);
check('cancelled share is not recorded as a backup',
  (await ap.textContent('#backupStatus')).includes('Never backed up'));
check('cancelled share does not fall back to a download', abortDownloads === 0);
await abortCtx.close();

// ---------- pausing, and taking a stop back ----------
/* Vibration is a read-only accessor in Chromium, same as the wake lock. It goes
   in as an init script too, so it survives this section's reloads. */
const vibeStub = () => {
  window.__vibes = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: ms => { window.__vibes.push(ms); return true; },
  });
};
await ctx.addInitScript(vibeStub);
await page.evaluate(vibeStub);

const feedsNow = async () => (await page.$$('.entry')).length;
const before = await feedsNow();

await page.click('[data-start="L"]');
await page.waitForTimeout(2200);
check('pause offered while feeding', await page.isVisible('#pauseBtn'));
await page.click('#pauseBtn');
const heldTotal = await page.textContent('#elapsed');
const heldLeft = await page.textContent('#leftVal');
check('pause becomes Resume', await page.textContent('#pauseBtn') === 'Resume');
check('paused is spelled out', (await page.textContent('#runPrompt')).includes('Paused'));
check('the tile says paused, not feeding', (await page.textContent('#leftDot')) === 'paused');
check('paused clock is dimmed', (await page.getAttribute('#elapsed', 'class')).includes('paused'));

await page.waitForTimeout(2400);
check('total stops while paused (' + heldTotal + ')', await page.textContent('#elapsed') === heldTotal);
check('the side stops too', await page.textContent('#leftVal') === heldLeft);

// a pause has to survive a reload, or a phone restart mid-break loses the break
await page.reload({ waitUntil: 'networkidle' });
check('still paused after reload', await page.textContent('#pauseBtn') === 'Resume');
check('paused total survives reload', await page.textContent('#elapsed') === heldTotal);
await page.waitForTimeout(1400);
check('and is still frozen', await page.textContent('#elapsed') === heldTotal);

await page.click('#pauseBtn');
check('resume flips the button back', await page.textContent('#pauseBtn') === 'Pause');
check('the tile is feeding again', (await page.textContent('#leftDot')).includes('feeding'));
await page.waitForTimeout(2200);
check('the clock runs again', await page.textContent('#elapsed') !== heldTotal);
/* ~4.4s on the breast across a ~4s break: the break must not be in the total. */
check('the break is not on the clock (' + await page.textContent('#elapsed') + ')',
  toSec(await page.textContent('#elapsed')) < 8);

// while paused, either tile picks the feed back up
await page.click('#pauseBtn');
await page.click('[data-switch="R"]');
check('a side tap resumes', await page.textContent('#pauseBtn') === 'Pause');
check('and picks up on that side', (await page.getAttribute('[data-switch="R"]', 'class')).includes('active'));
await page.waitForTimeout(1200);

// stopping by accident is recoverable
const runningTotal = await page.textContent('#elapsed');
await page.click('#stopBtn');
check('stop saves the feed', await feedsNow() === before + 1);
check('the saved toast offers Resume', await page.isVisible('#toastAction')
  && await page.textContent('#toastAction') === 'Resume');
await page.click('#toastAction');
check('resume puts the timer back', await page.isVisible('#runningView'));
check('and takes the record back out', await feedsNow() === before);
check('with the banked time still on it',
  toSec(await page.textContent('#elapsed')) >= toSec(runningTotal));
check('on the side it ended on', (await page.getAttribute('[data-switch="R"]', 'class')).includes('active'));

// but it must never overwrite a feed already under way
await page.click('#stopBtn');
await page.click('[data-start="L"]');
await page.click('#toastAction');
check('resume refuses over a running feed', (await page.textContent('#toastText')).includes('already running'));
check('the new feed is untouched', await page.isVisible('#runningView'));
check('and the saved one is still saved', await feedsNow() === before + 1);

// ---------- forgetting to tap start, and discarding by mistake ----------
await page.waitForTimeout(1200);
const activeStart = () => page.evaluate(() =>
  JSON.parse(localStorage.getItem('nursinglog.active.v1')).start);
const shortClock = toSec(await page.textContent('#elapsed'));
const startedBefore = await page.textContent('#startedAt');
const startMsBefore = await activeStart();
await page.click('#earlierBtn');
check('five minutes goes on the clock',
  toSec(await page.textContent('#elapsed')) - shortClock >= 299);
check('and onto the side being fed', toSec(await page.textContent('#leftVal')) >= 300);
check('the start time moves back with it', (await page.textContent('#startedAt')) !== startedBefore);
check('by exactly five minutes', startMsBefore - await activeStart() === 300000);
check('adding time offers Undo', await page.textContent('#toastAction') === 'Undo');
await page.click('#toastAction');
check('and takes it straight back off',
  toSec(await page.textContent('#elapsed')) - shortClock < 60);
check('the start comes back too', await activeStart() === startMsBefore);
check('nothing was saved either way', await feedsNow() === before + 1);

/* Glancing at something else and coming back used to break the undo: returning
   rebuilds the running feed from storage, and an undo comparing object
   references then refused — exactly when she would look back and want it. */
await page.click('#earlierBtn');
const addedStart = await activeStart();
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.click('#toastAction');
check('undo still works after leaving the app and coming back',
  await activeStart() === addedStart + 300000);
check('and says nothing about the feeding having moved on',
  !(await page.textContent('#toastText')).includes('moved on'));

// it still refuses when the feed running really is a different one
await page.click('#earlierBtn');
await page.evaluate(() => {
  const a = JSON.parse(localStorage.getItem('nursinglog.active.v1'));
  a.start = Date.now();          // any start but the one the undo left behind
  localStorage.setItem('nursinglog.active.v1', JSON.stringify(a));
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.click('#toastAction');
check('but refuses when the feed has genuinely moved on',
  (await page.textContent('#toastText')).includes('moved on'));

/* There is no discarding a running feed any more. It was a full-width button
   under Stop & Save that threw the feeding away, in the one spot a thumb rests
   for the whole feed; a feed started by mistake is stopped and deleted from the
   list instead. Nothing on the running card may end a feed without saving it. */
let dialogs = 0;
page.on('dialog', d => { dialogs++; d.accept(); });
check('no discard button on the running card', !(await page.isVisible('#cancelBtn')));
check('and nothing offers to',
  !(await page.textContent('#runningView')).toLowerCase().includes('without saving'));

// the way out is Stop & Save and then delete, which nothing does by accident
await page.click('#stopBtn');
check('stopping is the only end', await feedsNow() === before + 2);
await openRow(0);
await page.click('#editorDelete');
check('and a feed started by mistake is deleted from the list', await feedsNow() === before + 1);
check('deleting offers Undo', await page.textContent('#toastAction') === 'Undo');
check('the app asked nothing throughout', dialogs === 0);
check('back to the idle card', await page.isVisible('#idleView'));

// ---------- vibration ----------
await page.evaluate(() => { window.__vibes = []; });
const vibes = () => page.evaluate(() => window.__vibes.length);
await page.click('[data-start="L"]');
check('starting a feed buzzes', await vibes() === 1);
await page.click('[data-switch="R"]');
check('switching sides buzzes', await vibes() === 2);
await page.click('#pauseBtn');
check('pausing buzzes', await vibes() === 3);
await page.click('#pauseBtn');
check('resuming buzzes', await vibes() === 4);
await page.click('#stopBtn');
check('stopping buzzes', await vibes() === 5);

await page.click('#menuBtn');
check('the menu offers vibration', (await page.textContent('#hapticsLine')).includes('On'));
await page.click('#hapticsBtn');
check('it can be turned off', (await page.textContent('#hapticsLine')).includes('Off'));
await page.click('#menuClose');
await page.evaluate(() => { window.__vibes = []; });
await page.click('[data-start="L"]');
check('no buzz once it is off', await vibes() === 0);
await page.click('#stopBtn');
await openRow(0);
await page.click('#editorDelete');

await page.reload({ waitUntil: 'networkidle' });
await page.click('#menuBtn');
check('the choice is remembered', (await page.textContent('#hapticsLine')).includes('Off'));
await page.click('#hapticsBtn');
check('and can be turned back on', (await page.textContent('#hapticsLine')).includes('On'));
await page.click('#menuClose');

// leave the log as this section found it, idle and one reload old
for (let i = 0; i < 4 && await feedsNow() > before; i++) {
  await openRow(0);
  await page.click('#editorDelete');
}
check('section cleaned up after itself', await feedsNow() === before);
await page.reload({ waitUntil: 'networkidle' });
check('idle again', await page.isVisible('#idleView'));

// ---------- an update from the other phone ----------
/* The whole point of this feature is two phones, so the test uses two: his logs
   a nappy and a dose, shares the message, and hers pastes it in. */
const hisCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await hisCtx.addInitScript(() => {
  window.NL_DIM_MS = 600000;
  window.__shared = [];
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: d => { window.__shared.push(d); return Promise.resolve(); },
  });
});
const hp = await hisCtx.newPage();
await hp.goto(BASE, { waitUntil: 'networkidle' });

await hp.click('#menuBtn');
await hp.click('#exportUpdate');
check('nothing to send from an empty log', (await hp.textContent('#toastText')).includes('Nothing logged'));
await hp.click('#menuClose');

// he logs a nappy and a feed of his own
await hp.click('[data-diaper="both"]');
await hp.fill('#dNotes', 'Leaked through');
await hp.click('#diaperSave');
await hp.click('[data-start="R"]');
await hp.waitForTimeout(1200);
await hp.click('#stopBtn');
check('his phone has his two records', (await hp.$$('.entry')).length === 2);

await hp.click('#menuBtn');
await hp.click('#exportUpdate');
const msg = await hp.evaluate(() => window.__shared[0] && window.__shared[0].text);
check('the update goes out as a message', typeof msg === 'string');
check('no file is attached', await hp.evaluate(() => !window.__shared[0].files));
check('it says what it is', msg.includes('2 records'));
check('it says what to do with it', msg.includes('Paste an update'));
check('it carries the records', msg.includes('"diapers"') && msg.includes('"entries"'));
check('ids are left out', !msg.includes('"id"'));
check('empty notes are left out', (msg.match(/"notes":""/g) || []).length === 0);
check('his note is carried', msg.includes('Leaked through'));
check('it is small enough to text (' + msg.length + ' chars)', msg.length < 1200);
check('the menu closes behind it', await hp.isHidden('#menuScrim'));

/* Five days back: inside the week an update now covers, outside the three days
   it used to. A quiet few days between sends must not push records off the end
   with nothing said about it. */
await hp.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('nursinglog.diapers.v1') || '[]');
  list.push({ id: 'old', time: Date.now() - 5 * 86400000, pee: false, poop: true, size: 'M',
              notes: 'Five days back' });
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify(list));
});
await hp.reload({ waitUntil: 'networkidle' });
await hp.click('#menuBtn');
await hp.click('#exportUpdate');
const wide = await hp.evaluate(() => window.__shared[window.__shared.length - 1].text);
check('an update reaches back a week', wide.includes('Five days back'));
check('and says so', wide.includes('last 7 days'));
await hp.click('#menuClose').catch(() => {});

// her phone: paste it in
const hers = await feedsNow();
const herNotes = await page.textContent('#history');
await page.click('#menuBtn');
await page.click('#importPaste');
check('the paste sheet opens', await page.isVisible('#pasteScrim'));
check('and the menu steps aside', await page.isHidden('#menuScrim'));
await page.fill('#pasteBox', 'garbage, not a log at all');
await page.click('#pasteImport');
check('nonsense is refused', (await page.textContent('#toastText')).includes("doesn't look like"));
check('and the sheet stays open to try again', await page.isVisible('#pasteScrim'));

await page.fill('#pasteBox', msg);
await page.click('#pasteImport');
check('his records land in her log', await feedsNow() === hers + 2);
check('she is told how many', (await page.textContent('#toastText')).includes('Added 2 records'));
check('the sheet closes', await page.isHidden('#pasteScrim'));
check('his note came with it', (await page.textContent('#history')).includes('Leaked through'));

// pasting the same message again must be a no-op, since sends overlap by design
await page.click('#menuBtn');
await page.click('#importPaste');
await page.fill('#pasteBox', msg);
await page.click('#pasteImport');
check('the same update twice adds nothing', await feedsNow() === hers + 2);
check('and says so', (await page.textContent('#toastText')).includes('Nothing new'));

// a record of hers must never be replaced by his version of it
const mine = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('nursinglog.diapers.v1'))[0];
  return { time: d.time, pee: d.pee, poop: d.poop, notes: d.notes };
});
await page.click('#menuBtn');
await page.click('#importPaste');
await page.fill('#pasteBox', JSON.stringify({
  app: 'nursing-log',
  diapers: [{ time: mine.time, pee: mine.pee, poop: mine.poop, notes: 'HIS VERSION' }],
}));
await page.click('#pasteImport');
check('a record she already has is left alone', await feedsNow() === hers + 2);
check('her notes are not overwritten', await page.evaluate(() => {
  return JSON.parse(localStorage.getItem('nursinglog.diapers.v1'))[0].notes;
}) === mine.notes);
check('nothing of his leaked in', !(await page.textContent('#history')).includes('HIS VERSION'));

// the message survives being wrapped in whatever the messaging app adds
await page.click('#menuBtn');
await page.click('#importPaste');
await page.fill('#pasteBox', 'Sent from my phone:\n\n' + msg + '\n\n— sent 9:42 PM');
await page.click('#pasteImport');
check('prose around the message is ignored', (await page.textContent('#toastText')).includes('Nothing new'));

await hisCtx.close();

// clean up the two records his phone contributed — one is a nappy, one a feed
for (let i = 0; i < 4 && await feedsNow() > hers; i++) {
  await openRow(0);
  await page.click(await page.isVisible('#editorDelete') ? '#editorDelete' : '#diaperDelete');
}
check('her log is back to her own records', await feedsNow() === hers);
check('and unchanged by all of it', await page.textContent('#history') === herNotes);

// ---------- unreadable data is never written over ----------
/* The bug this guards: a list that wouldn't parse read back as empty, and the
   next save then overwrote the only copy of it. Each case gets its own context
   so a broken log can't leak into the rest of the suite. */
const FEEDS_KEY = 'nursinglog.entries.v1';
const brokenPage = async (raw, init) => {
  const c = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
  await c.addInitScript(wakeStub, 600000);
  if (init) await c.addInitScript(init);
  const p = await c.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [FEEDS_KEY, raw]);
  await p.reload({ waitUntil: 'networkidle' });
  return { c, p };
};
const rescued = p => p.evaluate(() => Object.keys(localStorage)
  .filter(k => k.indexOf('nursinglog.rescue.') === 0)
  .map(k => localStorage.getItem(k)));

// 1. text that won't parse at all
const bad = await brokenPage('[{"start":1755200000000,"leftSec":600,"rightSec":0},{"start":17');
check('the app still opens on a broken log', await bad.p.isVisible('#idleView'));
check('it says so instead of showing an empty log', await bad.p.isVisible('#dataAlert'));
check('and says nothing was deleted',
  (await bad.p.textContent('#dataAlertLine')).includes('set aside, not deleted'));

let aside = await rescued(bad.p);
check('the unreadable text is kept', aside.length === 1);
check('kept byte for byte', JSON.parse(aside[0]).raw.endsWith('"start":17'));
check('and labelled with the list it came from', JSON.parse(aside[0]).key === FEEDS_KEY);

// the regression itself: logging something must not destroy what was set aside
await bad.p.click('[data-start="L"]');
await bad.p.waitForTimeout(1100);
await bad.p.click('#stopBtn');
check('logging still works', (await bad.p.$$('.entry')).length === 1);
aside = await rescued(bad.p);
check('the set-aside copy survives a save', aside.length === 1);
check('still byte for byte', JSON.parse(aside[0]).raw.endsWith('"start":17'));
await bad.p.reload({ waitUntil: 'networkidle' });
check('and survives a reload', (await rescued(bad.p)).length === 1);
check('without rescuing itself a second time', (await rescued(bad.p)).length === 1);
check('the new feed is still there', (await bad.p.$$('.entry')).length === 1);
check('the warning is still up', await bad.p.isVisible('#dataAlert'));

// saving a copy hands over everything unreadable
await bad.p.evaluate(() => {
  window.__saved = [];
  Object.defineProperty(navigator, 'share', {
    configurable: true, value: d => { window.__saved.push(d); return Promise.resolve(); },
  });
});
await bad.p.click('#dataAlert');
check('the warning opens the sheet', await bad.p.isVisible('#rescueScrim'));
check('the sheet points at Restore from backup',
  (await bad.p.textContent('#rescueScrim')).includes('Restore from backup'));
await bad.p.screenshot({ path: `${SHOTS}/data-alert.png` });
await bad.p.click('#rescueSave');
await bad.p.waitForTimeout(200);
check('a copy can be sent off', await bad.p.evaluate(() => window.__saved.length === 1));

// removing it is deliberate and undoable
await bad.p.click('#rescueDrop');
check('removing clears the warning', await bad.p.isHidden('#dataAlert'));
check('and the set-aside copy is gone', (await rescued(bad.p)).length === 0);
await bad.p.click('#toastAction');
check('undo puts it back', (await rescued(bad.p)).length === 1);
check('with the warning', await bad.p.isVisible('#dataAlert'));
check('and the same bytes', JSON.parse((await rescued(bad.p))[0]).raw.endsWith('"start":17'));
await bad.c.close();

// 2. valid JSON that isn't a list
const notList = await brokenPage('{"entries":"gone"}');
check('a log that is not a list is set aside too', await notList.p.isVisible('#dataAlert'));
check('and kept', (await rescued(notList.p)).length === 1);
await notList.c.close();

// 3. one record in a good list that cannot be read
const partial = await brokenPage(JSON.stringify([
  { id: 'good', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' },
  { id: 'odd', start: 'not a number', leftSec: 300, rightSec: 0 },
]));
check('the readable record shows', (await partial.p.$$('.entry')).length === 1);
check('the odd one is announced', await partial.p.isVisible('#dataAlert'));
check('and counted', (await partial.p.textContent('#dataAlertLine')).includes('1 record is'));
check('nothing is set aside for it', (await rescued(partial.p)).length === 0);

await partial.p.click('[data-diaper="pee"]');
await partial.p.click('#diaperSave');
await partial.p.click('[data-start="R"]');
await partial.p.waitForTimeout(1100);
await partial.p.click('#stopBtn');
const stored = await partial.p.evaluate(k => JSON.parse(localStorage.getItem(k)), FEEDS_KEY);
check('the unreadable record is still in storage after saves',
  stored.some(e => e && e.start === 'not a number'));
check('alongside the readable ones', stored.filter(e => typeof e.start === 'number').length === 2);
await partial.p.reload({ waitUntil: 'networkidle' });
check('it survives a reload', (await partial.p.evaluate(k => JSON.parse(localStorage.getItem(k)), FEEDS_KEY))
  .some(e => e && e.start === 'not a number'));
check('and is still not shown', (await partial.p.$$('.entry')).length === 3);
await partial.c.close();

// 4. worst case: it can't even be copied anywhere, so nothing may write over it
const stuckRaw = '[{"start":1755200000000,"leftSec":600},{"bro';
const stuck = await brokenPage(stuckRaw, () => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).indexOf('nursinglog.rescue.') === 0) throw new Error('no room');
    return real.call(this, k, v);
  };
});
check('a log that cannot be copied is left where it is',
  await stuck.p.evaluate(k => localStorage.getItem(k), FEEDS_KEY) === stuckRaw);
check('and is announced', await stuck.p.isVisible('#dataAlert'));
check('as not being saved to',
  (await stuck.p.textContent('#dataAlertLine')).includes("can't be written over"));

await stuck.p.click('[data-start="L"]');
await stuck.p.waitForTimeout(1100);
await stuck.p.click('#stopBtn');
check('a save is refused rather than silently losing it',
  (await stuck.p.textContent('#toastText')).includes('Not saved'));
check('and is not dressed up as a save', !(await stuck.p.textContent('#toastText')).includes('Saved '));
/* Nothing was written, so the feed stays on the clock rather than ending into
   thin air — she can still read the minutes off the screen. */
check('the feed is still running', await stuck.p.isVisible('#runningView'));
check('and nothing appeared in the timeline', (await stuck.p.$$('.entry')).length === 0);
check('the unreadable text is untouched',
  await stuck.p.evaluate(k => localStorage.getItem(k), FEEDS_KEY) === stuckRaw);
await stuck.c.close();

// 5. a healthy log says nothing at all
check('no warning on a good log', await page.isHidden('#dataAlert'));

// ---------- screen wake and dimming ----------
const wake = () => page.evaluate(() => window.__wake);
check('no wake lock while idle', !(await wake()).held);
await page.click('[data-start="L"]');
await page.waitForTimeout(120);
check('feeding takes a wake lock', (await wake()).held);
check('one lock, not one per tick', (await wake()).taken === 1);
await page.click('#stopBtn');
check('stopping releases the wake lock', !(await wake()).held);
await openRow(0);
await page.click('#editorDelete');                   // drop the feed this section created

// dimming, in its own context so the veil can't swallow other tests' clicks
const dimCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await dimCtx.addInitScript(wakeStub, 900);
const dim = await dimCtx.newPage();
await dim.goto(BASE, { waitUntil: 'networkidle' });

await dim.waitForTimeout(1400);
check('idle screen never dims', !(await dim.isVisible('#dimVeil')));

await dim.click('[data-start="L"]');
check('screen starts undimmed', !(await dim.isVisible('#dimVeil')));
await dim.waitForTimeout(1400);
check('screen dims when left alone', await dim.isVisible('#dimVeil'));
check('dim still shows the clock', /\d+:\d\d/.test(await dim.textContent('#veilTime')));
check('dim names the side', (await dim.textContent('#veilSide')).includes('Left'));
check('wake lock held while dim', (await dim.evaluate(() => window.__wake)).held);

const dimmedAt = await dim.textContent('#veilTime');
await dim.waitForTimeout(1100);
check('dim clock keeps counting', await dim.textContent('#veilTime') !== dimmedAt);

// a tap wakes the screen instead of reaching the buttons underneath
await dim.click('#dimVeil');
await dim.waitForTimeout(700);                       // it fades out; see the settle below
check('tap wakes the screen', !(await dim.isVisible('#dimVeil')));
check('tap did not stop the feed', await dim.isVisible('#runningView'));
check('feed still running', (await dim.$$('.entry')).length === 0);

/* And the same with a real finger, which is the case that bit: the veil's clock
   sits directly over Stop & Save, with Cancel a few pixels below it. Hiding the
   veil on pointerdown left the touch's click to land underneath, so waking the
   screen ended the feed. Tap where each button is, through the veil. */
const tapThrough = async sel => {
  await dim.waitForTimeout(2000);                    // the fade, then NL_DIM_MS again
  if (!(await dim.isVisible('#dimVeil'))) throw new Error('veil did not return before ' + sel);
  const box = await dim.locator(sel).boundingBox();
  await dim.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await dim.waitForTimeout(150);
};

await tapThrough('#stopBtn');
check('waking does not reach Stop & Save', await dim.isVisible('#runningView'));
check('waking saved nothing', (await dim.$$('.entry')).length === 0);

await tapThrough('#pauseBtn');
check('waking does not reach Pause', (await dim.textContent('#pauseBtn')) === 'Pause');
check('the feed survives being woken', (await dim.evaluate(
  () => localStorage.getItem('nursinglog.active.v1'))) !== null);

await tapThrough('[data-switch="R"]');
check('waking does not switch sides', (await dim.getAttribute('[data-switch="L"]', 'class')).includes('active'));

/* Waking is its own action: the veil fades rather than vanishing, and stays in
   the way while it does, so the reflex second tap that follows the first lands
   on it rather than on Stop & Save underneath. */
await dim.waitForTimeout(2000);
const stopBox = await dim.locator('#stopBtn').boundingBox();
const tapStop = () => dim.touchscreen.tap(stopBox.x + stopBox.width / 2, stopBox.y + stopBox.height / 2);
await tapStop();
await dim.waitForTimeout(80);
check('the veil fades rather than going at once', await dim.isVisible('#dimVeil'));
await tapStop();                                     // the reflex second tap
await dim.waitForTimeout(80);
await tapStop();                                     // and a third
await dim.waitForTimeout(700);
check('tapping through the fade does nothing', await dim.isVisible('#runningView'));
check('and saves nothing', (await dim.$$('.entry')).length === 0);
check('the veil has gone once it settles', !(await dim.isVisible('#dimVeil')));

// and the screen is properly live again afterwards, not left inert
await dim.click('#pauseBtn');
check('a tap after settling works', (await dim.textContent('#pauseBtn')) === 'Resume');
await dim.click('#pauseBtn');
check('back off pause', (await dim.textContent('#pauseBtn')) === 'Pause');
await dim.waitForTimeout(1400);
check('and it dims again after being woken', await dim.isVisible('#dimVeil'));
await dim.click('#dimVeil');                         // leave it down for the sheet checks below
await dim.waitForTimeout(700);

// an open sheet holds the dim off
await dim.click('#menuBtn');
await dim.waitForTimeout(1400);
check('does not dim over a sheet', !(await dim.isVisible('#dimVeil')));
await dim.click('#menuClose');

// pasting an update mid-feed is a real case too, and a veil would eat the paste
await dim.click('#menuBtn');
await dim.click('#importPaste');
await dim.waitForTimeout(1400);
check('does not dim over the paste sheet', !(await dim.isVisible('#dimVeil')));
await dim.click('#pasteCancel');

// looking something up mid-feed is what the basics are for, so no veil over them either
await dim.click('#guideBtn');
await dim.waitForTimeout(1400);
check('does not dim over the basics', !(await dim.isVisible('#dimVeil')));
check('the feed is still running behind it', await dim.isVisible('#runningView'));
await dim.click('#guideClose');

await dim.click('#stopBtn');
await dim.waitForTimeout(1400);
check('no dimming once the feed ends', !(await dim.isVisible('#dimVeil')));
check('wake lock released with the feed', !(await dim.evaluate(() => window.__wake)).held);
await dimCtx.close();

/* ---------- a feed left running all night ----------
   Falling asleep mid-feed is not an edge case, and the app used to answer it by
   holding the screen on until morning. Past LONG_FEED_MS it hands the screen
   back — the timer keeps running, since only she knows whether the feed ended. */
const napCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await napCtx.addInitScript(wakeStub, 500);
await napCtx.addInitScript(() => { window.NL_LONG_MS = 2500; });
const nap = await napCtx.newPage();
await nap.goto(BASE, { waitUntil: 'networkidle' });
const napWake = () => nap.evaluate(() => window.__wake);

await nap.click('[data-start="L"]');
check('a feed starting holds the screen', (await napWake()).held);
await nap.waitForTimeout(900);
check('and dims while it is an ordinary feed', await nap.isVisible('#dimVeil'));

await nap.waitForTimeout(3200);
check('a feed running long gives the screen back', !(await napWake()).held);
check('and drops the veil with it', !(await nap.isVisible('#dimVeil')));
check('the card asks whether it is still going',
  (await nap.textContent('#runPrompt')).includes('Still feeding?'));
check('the feeding itself is untouched', await nap.isVisible('#runningView'));
check('and still on the phone', (await nap.evaluate(
  () => localStorage.getItem('nursinglog.active.v1'))) !== null);

await nap.click('#pauseBtn');
await nap.waitForTimeout(900);
check('touching it does not take the screen back', !(await napWake()).held);
check('nor start dimming again', !(await nap.isVisible('#dimVeil')));

await nap.click('#stopBtn');
await nap.click('[data-start="R"]');
check('a fresh feed takes the screen again', (await napWake()).held);
await nap.waitForTimeout(900);
check('and dims again', await nap.isVisible('#dimVeil'));
await napCtx.close();

/* The morning after, at the real threshold: opened fresh on a feed started
   three hours ago, it must never claim the screen for it. */
const wokeCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await wokeCtx.addInitScript(wakeStub, 500);
const woke = await wokeCtx.newPage();
await woke.goto(BASE, { waitUntil: 'networkidle' });
await woke.evaluate(() => localStorage.setItem('nursinglog.active.v1', JSON.stringify({
  start: Date.now() - 3 * 3600000, side: 'L', leftSec: 0, rightSec: 0,
  segStart: Date.now() - 3 * 3600000, paused: false })));
await woke.reload({ waitUntil: 'networkidle' });
check('the morning after, the card says how long it has run',
  (await woke.textContent('#runPrompt')).includes('Still feeding?')
  && (await woke.textContent('#runPrompt')).includes('3h'));
await woke.waitForTimeout(1100);
check('and the screen was never claimed for it',
  !(await woke.evaluate(() => window.__wake)).held && !(await woke.isVisible('#dimVeil')));
check('the clock kept the night on it', /^3:0\d:\d\d$/.test(await woke.textContent('#elapsed')));
await wokeCtx.close();

// ---------- the back gesture ----------
/* Its own context, and a sentinel page behind the app, so "left the app" is
   something the suite can actually see rather than infer. */
const backCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await backCtx.addInitScript(wakeStub, 600000);
const bp = await backCtx.newPage();
await bp.goto(BASE + '__sentinel', { waitUntil: 'load' });
await bp.goto(BASE, { waitUntil: 'networkidle' });
await bp.evaluate(() => {
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify([
    { id: 'bk', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' },
  ]));
});
await bp.reload({ waitUntil: 'networkidle' });

const back = async () => { await bp.evaluate(() => history.back()); await bp.waitForTimeout(300); };
const inApp = async () => bp.url().indexOf('__sentinel') < 0 && await bp.isVisible('#idleView');

await bp.click('#menuBtn');
check('the menu opens', await bp.isVisible('#menuScrim'));
await back();
check('back closes the menu', await bp.isHidden('#menuScrim'));
check('and does not close the app', await inApp());

await bp.click('.entry');
check('a record opens read-only', await bp.isVisible('#editorScrim'));
await back();
check('back closes the record', await bp.isHidden('#editorScrim'));
check('still in the app', await inApp());

await bp.click('#guideBtn');
await back();
check('back closes the basics', await bp.isHidden('#guideScrim'));

/* The menu shuts itself before opening what it was asked for. Both happen in
   one go, and they must still cost exactly one entry between them. */
await bp.click('#menuBtn');
await bp.click('#whatsNew');
check('what\'s new replaces the menu', await bp.isVisible('#logScrim') && await bp.isHidden('#menuScrim'));
await back();
check('one back closes it', await bp.isHidden('#logScrim'));
check('and does not leave the app', await inApp());

/* Closing by button has to spend the entry it pushed, or every sheet opened
   and closed leaves a dead one and back stops working altogether. */
for (let i = 0; i < 3; i++) {
  await bp.click('#menuBtn');
  await bp.waitForTimeout(60);
  await bp.click('#menuClose');
  await bp.waitForTimeout(120);
}
check('sheets closed by button leave the app usable', await inApp());
await back();
check('back now leaves the app, having no sheets left to close', bp.url().indexOf('__sentinel') >= 0);

await bp.goForward();
await bp.waitForTimeout(300);
check('and the app comes back', await bp.isVisible('#idleView'));

// a tap beside the card: safe while reading, refused while editing
await bp.click('.entry');
await bp.click('#editorScrim', { position: { x: 206, y: 30 } });
check('a tap outside closes a card being read', await bp.isHidden('#editorScrim'));

await bp.click('.entry');
await bp.click('#editorEdit');
await bp.fill('#fNotes', 'half-typed thought');
await bp.click('#editorScrim', { position: { x: 206, y: 30 } });
check('a tap outside will not discard an edit', await bp.isVisible('#editorScrim'));
check('and what was typed is still there', (await bp.inputValue('#fNotes')) === 'half-typed thought');
await bp.click('#editorCancel');
check('Cancel is still the way out', await bp.isHidden('#editorScrim'));

await bp.click('[data-diaper="pee"]');
check('a new diaper opens unlocked', await bp.isVisible('#diaperScrim'));
await bp.click('#diaperScrim', { position: { x: 206, y: 30 } });
check('a tap outside will not discard a new record either', await bp.isVisible('#diaperScrim'));
await bp.click('#diaperCancel');
await backCtx.close();

// ---------- the "ago" lines keep moving ----------
/* Seeded a second short of the next minute, so the tick is observable in two
   seconds rather than sixty. */
const tickCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await tickCtx.addInitScript(wakeStub, 600000);
const tp = await tickCtx.newPage();
await tp.goto(BASE, { waitUntil: 'networkidle' });
await tp.evaluate(() => {
  const t = Date.now() - 119000;
  localStorage.setItem('nursinglog.meds.v1', JSON.stringify([
    { id: 'm1', time: t, name: 'Ibuprofen', dose: '400 mg', notes: '' },
  ]));
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify([
    { id: 'd1', time: t, pee: true, poop: false, notes: '' },
  ]));
});
await tp.reload({ waitUntil: 'networkidle' });

check('the dose line starts at one minute', (await tp.textContent('#medSince')).includes('1 min ago'));
await tp.evaluate(() => { document.querySelector('#medQuick button').__probe = 'kept'; });
await tp.waitForTimeout(1800);
check('the dose line counts up like the others',
  (await tp.textContent('#medSince')).includes('2 min ago'));
check('the diaper line counts up too', (await tp.textContent('#diaperSince')).includes('2 min ago'));
check('and the quick buttons are not rebuilt under a thumb',
  await tp.evaluate(() => document.querySelector('#medQuick button').__probe === 'kept'));

// coming back to the app rereads every list, medicines included
await tp.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('nursinglog.meds.v1'));
  list.unshift({ id: 'm2', time: Date.now(), name: 'Paracetamol', dose: '500 mg', notes: '' });
  localStorage.setItem('nursinglog.meds.v1', JSON.stringify(list));
  document.dispatchEvent(new Event('visibilitychange'));
});
await tp.waitForTimeout(200);
check('returning to the app picks up medicines as well',
  (await tp.textContent('#medSince')).includes('Paracetamol'));
await tickCtx.close();

// ---------- midnight ----------
/* The clock is shifted to just before midnight so the rollover can be watched
   happening, rather than waited for. */
const mnCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await mnCtx.addInitScript(() => {
  window.NL_DIM_MS = 600000;
  const real = Date.now;
  window.__clock = { offset: 0 };
  const d = new Date(real());
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  window.__clock.offset = (midnight - 4000) - real();
  Date.now = () => real() + window.__clock.offset;
});
const mn = await mnCtx.newPage();
await mn.goto(BASE, { waitUntil: 'networkidle' });
await mn.evaluate(() => {
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify([
    { id: 'mn', start: Date.now() - 3600000, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' },
  ]));
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify([
    { id: 'mnd', time: Date.now() - 3600000, pee: true, poop: false, size: null, notes: '' },
  ]));
});
await mn.reload({ waitUntil: 'networkidle' });
check('the evening\'s feed is under Today', (await mn.textContent('.day')).includes('Today'));
check('and counts in Today\'s totals', (await mn.textContent('#statCount')) === '1');
check('the evening\'s nappy counts in today\'s wet',
  (await mn.textContent('#diaperToday')).includes('1 wet · 0 dirty'));

await mn.evaluate(() => { window.__clock.offset += 6000; });
await mn.waitForTimeout(1600);
check('after midnight it is yesterday\'s', (await mn.textContent('.day')).includes('Yesterday'));
check('and Today starts over without being prompted', (await mn.textContent('#statCount')) === '0');
check('the wet and dirty count starts over too',
  (await mn.textContent('#diaperToday')) === 'None yet today');
await mnCtx.close();

// ---------- a long log stays quick ----------
const longCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await longCtx.addInitScript(wakeStub, 600000);
const lp = await longCtx.newPage();
await lp.goto(BASE, { waitUntil: 'networkidle' });
await lp.evaluate(() => {
  const DAY = 86400000, noon = new Date(); noon.setHours(12, 0, 0, 0);
  const feeds = [], diapers = [];
  for (let d = 0; d < 20; d++) {
    const base = noon.getTime() - d * DAY;
    feeds.push({ id: 'f' + d + 'a', start: base, leftSec: 600, rightSec: 0, endSide: 'L', notes: '' });
    feeds.push({ id: 'f' + d + 'b', start: base - 3600000, leftSec: 300, rightSec: 300, endSide: 'R', notes: '' });
    diapers.push({ id: 'g' + d, time: base - 1800000, pee: true, poop: false, notes: '' });
  }
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify(feeds));
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify(diapers));
});
await lp.reload({ waitUntil: 'networkidle' });

await lp.screenshot({ path: `${SHOTS}/show-older.png`, fullPage: true });
check('only the recent fortnight is built', (await lp.$$('.day')).length === 14);
check('the older days are offered, counted', (await lp.textContent('#history')).includes('Show older (6 more days)'));
check('a day\'s totals survive the single pass',
  (await lp.textContent('.day')).includes('2 feeds · 20 min') && (await lp.textContent('.day')).includes('1 wet · 0 dirty'));

await lp.click('text=Show older (6 more days)');
check('Show older reaches the rest', (await lp.$$('.day')).length === 20);
check('and stops offering once there is nothing older',
  !(await lp.textContent('#history')).includes('Show older'));

/* Feeds are counted start to start, so each row says how long after the one
   before it was. The seeded days run noon and 11am, an hour apart within a day
   and 23 hours across the night. */
check('a feed row says how long after the one before',
  (await lp.textContent('#history')).includes('1h since the one before')
  && (await lp.textContent('#history')).includes('23h since the one before'));
check('the very first feed has nothing to be after',
  !(await lp.$$eval('.entry', ns => !!ns[ns.length - 1].querySelector('.gap'))));
check('every feed but the first has one, and no diaper does',
  await lp.$$eval('.entry', ns => ns.filter(n => n.querySelector('.gap')).length === 39));

/* Filtering rebuilds the list; the day count has to follow the filter. */
await lp.click('[data-filter="diapers"]');
check('a filtered day shows only its own total',
  (await lp.textContent('.day')).includes('1 wet · 0 dirty') && !(await lp.textContent('.day')).includes('feed'));
await lp.click('[data-filter="all"]');

/* Twenty days of table do not fit under the chart, so the report pages on. */
await lp.click('#menuBtn');
const [lpPdfDl] = await Promise.all([lp.waitForEvent('download'), lp.click('#exportPdf')]);
const lpPdfPath = join(SHOTS, 'summary-long.pdf');
await lpPdfDl.saveAs(lpPdfPath);
const lpPdf = (await readFile(lpPdfPath)).toString('latin1');
check('the day table carries on overleaf', lpPdf.includes('Day by day, continued'));
check('and repeats its headings there',
  (lpPdf.match(/\(Left \/ Right \\\(min\\\)\)/g) || []).length === 2);
check('every day is still in the table, none dropped by the break',
  (lpPdf.match(/\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d+(?: \\\(so far\\\))?\)/g) || []).length === 20);
check('today is marked as the part-day it is',
  (lpPdf.match(/\\\(so far\\\)/g) || []).length === 1);
check('the report is titled for the days it actually covers', lpPdf.includes('20 days'));
check('two pages, numbered', lpPdf.includes('Page 1 of 2') && lpPdf.includes('Page 2 of 2'));
const lpOffsets = lpPdf.match(/startxref\s+(\d+)\s+%%EOF/);
const lpHead = lpPdf.slice(+lpOffsets[1]).match(/^xref\s+0 (\d+)\s+/);
const lpBody = lpPdf.slice(+lpOffsets[1] + lpHead[0].length);
let lpOk = true;
for (let n = 1; n < +lpHead[1]; n++) {
  if (!lpPdf.startsWith(`${n} 0 obj`, +lpBody.slice(n * 20, n * 20 + 10))) lpOk = false;
}
check('a paged report still has a byte-exact xref', lpOk);
await longCtx.close();

/* ---------- the report and the part-day ----------

   The appointment is in the morning, so the day the report is made on is a
   fraction of a day. Counting it into "feeds per day" reported a slower baby
   than the real one, which is the one number on the page most likely to be
   read out loud. */
const partCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await partCtx.addInitScript(wakeStub, 600000);
const pt = await partCtx.newPage();
await pt.goto(BASE, { waitUntil: 'networkidle' });
await pt.evaluate(() => {
  const DAY = 86400000, noon = new Date(); noon.setHours(12, 0, 0, 0);
  const feeds = [], diapers = [];
  /* Six finished days at a flat eight feeds each, so the average is exactly
     8.0 — and 7.0 if today's single feed is counted in with them. */
  for (let d = 1; d <= 6; d++) {
    const base = noon.getTime() - d * DAY;
    for (let i = 0; i < 8; i++) {
      feeds.push({ id: 'p' + d + '_' + i, start: base - 6 * 3600000 + i * 3600000,
        leftSec: 600, rightSec: 600, endSide: 'R', notes: '' });
    }
    for (let i = 0; i < 6; i++) {
      diapers.push({ id: 'q' + d + '_' + i, time: base - 6 * 3600000 + i * 3600000,
        pee: true, poop: false, notes: '' });
    }
  }
  feeds.push({ id: 'ptoday', start: Date.now() - 60000, leftSec: 600, rightSec: 600,
    endSide: 'R', notes: '' });
  feeds.sort((a, b) => b.start - a.start);
  diapers.sort((a, b) => b.time - a.time);
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify(feeds));
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify(diapers));
});
await pt.reload({ waitUntil: 'networkidle' });
await pt.click('#menuBtn');
const [ptDl] = await Promise.all([pt.waitForEvent('download'), pt.click('#exportPdf')]);
const ptPath = join(SHOTS, 'summary-partday.pdf');
await ptDl.saveAs(ptPath);
const ptPdf = (await readFile(ptPath)).toString('latin1');

check('per-day feeds come off the finished days', ptPdf.includes('(8.0)'));
check('and are not diluted by the part-day', !ptPdf.includes('(7.0)'));
check('the skipped day is stated, not left to be worked out',
  ptPdf.includes('6 full days before today'));
check('the wet average skips it too', ptPdf.includes('(6.0)'));
/* The table is the log, not the average — the real total still has today in it. */
check('the total still counts every feed', ptPdf.includes('(49)'));
check('the longest gap says which night it was', /\(Longest gap, [A-Z][a-z]{2} \d+/.test(ptPdf));
await partCtx.close();

/* A log that started this morning has no finished day to average, so it has to
   average itself rather than divide by nothing. */
const dayOneCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await dayOneCtx.addInitScript(wakeStub, 600000);
const d1 = await dayOneCtx.newPage();
await d1.goto(BASE, { waitUntil: 'networkidle' });
await d1.evaluate(() => {
  const feeds = [];
  for (let i = 0; i < 4; i++) {
    feeds.push({ id: 'd1_' + i, start: Date.now() - (i + 1) * 600000,
      leftSec: 600, rightSec: 600, endSide: 'R', notes: '' });
  }
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify(feeds));
});
await d1.reload({ waitUntil: 'networkidle' });
await d1.click('#menuBtn');
const [d1Dl] = await Promise.all([d1.waitForEvent('download'), d1.click('#exportPdf')]);
const d1Path = join(SHOTS, 'summary-dayone.pdf');
await d1Dl.saveAs(d1Path);
const d1Pdf = (await readFile(d1Path)).toString('latin1');

check('a first-day report averages itself rather than nothing', d1Pdf.includes('(4.0)'));
check('and does not say "1 days"', !d1Pdf.includes('1 days'));
check('nor claim to skip a day it does not have', !d1Pdf.includes('full days before today'));
check('a one-day report is still a valid file', d1Pdf.startsWith('%PDF-') && d1Pdf.includes('%%EOF'));
await dayOneCtx.close();

/* The doses live on the notes page. It used to stop at the foot of one page and
   say so, which could leave a medicine off the summary entirely. */
const noteCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await noteCtx.addInitScript(wakeStub, 600000);
const np = await noteCtx.newPage();
await np.goto(BASE, { waitUntil: 'networkidle' });
await np.evaluate(() => {
  const DAY = 86400000, noon = new Date(); noon.setHours(12, 0, 0, 0);
  const feeds = [], meds = [];
  for (let d = 1; d <= 20; d++) {
    const base = noon.getTime() - d * DAY;
    feeds.push({ id: 'n' + d, start: base, leftSec: 600, rightSec: 600, endSide: 'R',
      notes: 'Latched well on the left and fussed on the right, then needed winding twice '
        + 'before she would settle back down again. Day ' + d + '.' });
    meds.push({ id: 'nm' + d, time: base + 3600000, name: 'Dose number ' + d,
      dose: '400 mg', notes: '' });
  }
  feeds.sort((a, b) => b.start - a.start);
  meds.sort((a, b) => b.time - a.time);
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify(feeds));
  localStorage.setItem('nursinglog.meds.v1', JSON.stringify(meds));
});
await np.reload({ waitUntil: 'networkidle' });
await np.click('#menuBtn');
const [npDl] = await Promise.all([np.waitForEvent('download'), np.click('#exportPdf')]);
const npPath = join(SHOTS, 'summary-notes.pdf');
await npDl.saveAs(npPath);
const npPdf = (await readFile(npPath)).toString('latin1');

check('the notes carry on overleaf', npPdf.includes('Notes & medicines, continued'));
check('rather than stopping and saying so', !npPdf.includes('not shown'));
let everyDose = true;
for (let d = 1; d <= 20; d++) if (!npPdf.includes('Dose number ' + d)) everyDose = false;
check('not one dose is left off the summary', everyDose);
const npOffsets = npPdf.match(/startxref\s+(\d+)\s+%%EOF/);
const npHead = npPdf.slice(+npOffsets[1]).match(/^xref\s+0 (\d+)\s+/);
const npBody = npPdf.slice(+npOffsets[1] + npHead[0].length);
let npOk = true;
for (let n = 1; n < +npHead[1]; n++) {
  if (!npPdf.startsWith(`${n} 0 obj`, +npBody.slice(n * 20, n * 20 + 10))) npOk = false;
}
check('every page of it has a byte-exact xref', npOk);
await noteCtx.close();

// ---------- PWA ----------
check('service worker active', await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)));
const beforeOffline = (await page.$$('.entry')).length;   // whatever the log holds by now
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
check('works offline', await page.isVisible('#idleView') && (await page.$$('.entry')).length === beforeOffline);
await ctx.setOffline(false);
check('no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

/* No signal at all was always handled, since fetch rejects. A signal too weak
   to answer is the nursery case, and it used to mean a blank screen for as
   long as the radio kept trying: the cached copy now wins the race. */
const slowCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
await slowCtx.addInitScript(wakeStub, 600000);
const slowPage = await slowCtx.newPage();
await slowPage.goto(BASE, { waitUntil: 'networkidle' });
await slowPage.evaluate(() => navigator.serviceWorker.ready);
check('the app is in the cache to fall back on', await slowPage.evaluate(() =>
  caches.keys()
    .then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.match('./index.html')))))
    .then(hits => hits.some(Boolean))));

stall = true;
const slowStart = Date.now();
await slowPage.reload({ waitUntil: 'domcontentloaded' });
await slowPage.waitForSelector('#idleView', { state: 'visible', timeout: 15000 });
const slowTook = Date.now() - slowStart;
stall = false;
check('a signal too weak to answer does not hold the app up (' + slowTook + 'ms)', slowTook < 6000);
await slowCtx.close();

// ---------- screenshots ----------
const shot = async (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
await page.reload({ waitUntil: 'networkidle' });
await shot(page, 'home');
await page.click('[data-start="L"]');
await page.waitForTimeout(1200);
await page.click('[data-switch="R"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/running.png` });
await page.click('#pauseBtn');
await page.screenshot({ path: `${SHOTS}/paused.png` });
await page.click('#stopBtn');
await openRow(0);
await page.click('#editorDelete');

const dark = await browser.newContext({ viewport: { width: 412, height: 980 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const dp = await dark.newPage();
await dp.goto(BASE, { waitUntil: 'networkidle' });
await dp.evaluate(() => {
  const now = Date.now(), M = 60000;
  localStorage.setItem('nursinglog.entries.v1', JSON.stringify([
    { id: 'a', start: now - 52 * M, leftSec: 14 * 60, rightSec: 7 * 60, endSide: 'R', notes: '' },
    { id: 'b', start: now - 200 * M, leftSec: 0, rightSec: 19 * 60, endSide: 'R', notes: 'Cluster feeding, very fussy' },
    { id: 'c', start: now - 400 * M, leftSec: 9 * 60, rightSec: 11 * 60, endSide: 'L', notes: '' },
    { id: 'd', start: now - 1500 * M, leftSec: 21 * 60, rightSec: 0, endSide: 'L', notes: 'Gave vitamin D drops' },
  ]));
  localStorage.setItem('nursinglog.diapers.v1', JSON.stringify([
    { id: 'p', time: now - 30 * M, pee: true, poop: false, notes: '' },
    { id: 'q', time: now - 150 * M, pee: true, poop: true, size: 'L', notes: 'Seedy, mustard colored' },
    { id: 'r', time: now - 1400 * M, pee: false, poop: true, size: 'S', notes: '' },
  ]));
});
await dp.reload({ waitUntil: 'networkidle' });
await shot(dp, 'dark');
await dp.click('.entry');
await dp.screenshot({ path: `${SHOTS}/editor.png` });
await dp.reload({ waitUntil: 'networkidle' });   // the newest row may be a diaper or a feed; just start clean
await dp.click('#guideBtn');
await dp.$$eval('#guide summary', ns => ns[2].click());
await dp.screenshot({ path: `${SHOTS}/guide-dark.png` });
await dp.click('#guideClose');
await dp.click('#menuBtn');
await dp.screenshot({ path: `${SHOTS}/menu-dark.png` });
await dp.click('#importPaste');
await dp.screenshot({ path: `${SHOTS}/paste-dark.png` });
await dark.close();

await browser.close();
stalled.forEach(res => res.destroy());
server.close();

console.log('PASSED ' + ok.length + '   (screenshots: ' + SHOTS + ')');
if (errors.length) { console.log('\nJS ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
if (fails.length) { console.log('\nFAILED ' + fails.length + ':'); fails.forEach(f => console.log('  x ' + f)); process.exit(1); }
console.log('All checks passed.');
