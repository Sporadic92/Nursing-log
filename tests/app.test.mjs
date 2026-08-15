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
import { readFile, mkdtemp } from 'node:fs/promises';
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
const server = createServer((req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
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
check('last-fed line shows ending side', (await page.textContent('#sinceText')).includes('ended on right'));

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
check('last-fed reflects edit', (await page.textContent('#sinceText')).includes('ended on left'));
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
check('one-sided last-fed says the side', (await page.textContent('#sinceText')).includes('ended on right'));
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

// ---------- diapers ----------
// quick buttons now open the sheet rather than logging blind
await page.click('[data-diaper="pee"]');
check('quick tap opens the sheet', await page.isVisible('#diaperScrim'));
check('sheet titled for logging', await page.textContent('#diaperTitle') === 'Log a diaper');
check('pee preselected from the tap', (await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel'));
check('poop not preselected', !(await page.getAttribute('[data-toggle="poop"]', 'class')).includes('sel'));
check('no size prompt for pee', !(await page.isVisible('#sizeWrap')));
check('nothing logged until saved', (await page.$$('.entry')).length === 2);

await page.click('#diaperCancel');
check('cancel logs nothing', (await page.$$('.entry')).length === 2);
check('diaper stat still 0', await page.textContent('#statDiapers') === '0');

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

// both, with a size
await page.click('[data-diaper="both"]');
check('both preselected', (await page.getAttribute('[data-toggle="pee"]', 'class')).includes('sel')
  && (await page.getAttribute('[data-toggle="poop"]', 'class')).includes('sel'));
check('size prompt shown for both', await page.isVisible('#sizeWrap'));
await page.click('[data-size="S"]');
await page.click('#diaperSave');
check('both logged', await page.textContent('#statDiapers') === '2');
check('both label', (await page.textContent('#history')).includes('Pee + poop'));
check('small size shown', (await page.textContent('#history')).includes('Small poop'));
check('day summary counts diapers', (await page.textContent('#history')).includes('2 diapers'));

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
check('csv header', csvRows[0] === '"Date","Time","Type","Side","Left (min)","Right (min)","Total (min)","Ended on","Pee","Poop","Poop size","Notes"');
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

check('pdf filename', /nursing-log-summary-\d{8}\.pdf/.test(pdfDl.suggestedFilename()));
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
check('one or two pages', /\/Count [12][^0-9]/.test(pdf));
check('pdf has the title', pdf.includes('Feeding & Diaper Summary'));
check('pdf has the at-a-glance tiles',
  ['Feeds per day', 'Time per day', 'Average feed', 'Longest gap', 'Wet per day', 'Dirty per day']
    .every(k => pdf.includes(k)));
check('pdf has the day table', pdf.includes('Day by day') && pdf.includes('Left / Right'));
check('pdf carries notes through', pdf.includes('Seedy, mustard colored'));
check('pdf page numbering', pdf.includes('Page 1 of 2') && pdf.includes('Page 2 of 2'));
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
check('backup version 2', parsed.version === 2);
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

// backing up clears the nudge
await page.click('#menuBtn');
const [fresh] = await Promise.all([page.waitForEvent('download'), page.click('#exportJson')]);
await fresh.saveAs(join(SHOTS, 'nudge-clear.json'));
check('backing up clears the dot', !(await page.isVisible('#backupDot')));
check('backing up is confirmed', (await page.textContent('#toastText')).includes('Backed up'));
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
check('backup goes to the share sheet', shared.length === 1 && /nursing-log-backup-\d+\.json/.test(shared[0][0]));
check('sharing counts as a backup', (await sp.textContent('#backupStatus')).includes('today'));

await sp.click('#menuBtn');                       // exporting closes the menu behind it
await sp.click('#exportCsv');
await sp.waitForTimeout(200);
check('csv shares too', (await sp.evaluate(() => window.__shared)).length === 2);

await shareCtx.close();

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
check('tap wakes the screen', !(await dim.isVisible('#dimVeil')));
check('tap did not stop the feed', await dim.isVisible('#runningView'));
check('feed still running', (await dim.$$('.entry')).length === 0);

// an open sheet holds the dim off
await dim.click('#menuBtn');
await dim.waitForTimeout(1400);
check('does not dim over a sheet', !(await dim.isVisible('#dimVeil')));
await dim.click('#menuClose');

await dim.click('#stopBtn');
await dim.waitForTimeout(1400);
check('no dimming once the feed ends', !(await dim.isVisible('#dimVeil')));
check('wake lock released with the feed', !(await dim.evaluate(() => window.__wake)).held);
await dimCtx.close();

// ---------- PWA ----------
check('service worker active', await page.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active).catch(() => false)));
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
check('works offline', await page.isVisible('#idleView') && (await page.$$('.entry')).length === beforeReload);
await ctx.setOffline(false);
check('no horizontal scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

// ---------- screenshots ----------
const shot = async (p, name) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
await page.reload({ waitUntil: 'networkidle' });
await shot(page, 'home');
await page.click('[data-start="L"]');
await page.waitForTimeout(1200);
await page.click('[data-switch="R"]');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/running.png` });
page.once('dialog', d => d.accept());
await page.click('#cancelBtn');

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
await dark.close();

await browser.close();
server.close();

console.log('PASSED ' + ok.length + '   (screenshots: ' + SHOTS + ')');
if (errors.length) { console.log('\nJS ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
if (fails.length) { console.log('\nFAILED ' + fails.length + ':'); fails.forEach(f => console.log('  x ' + f)); process.exit(1); }
console.log('All checks passed.');
