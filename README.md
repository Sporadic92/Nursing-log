# Nursing Log

A simple breastfeeding tracker that installs on an Android phone like a normal app.
Records **when** a feeding started, **how long she spent on each side**, and any **notes**,
plus **diapers** (pee, poop, or both) and **medicines** she takes. Everything is stored on the phone — no account, no
internet needed after the first visit, nothing sent anywhere.

## Put it on her phone (about 5 minutes)

### Step 1 — turn on GitHub Pages (do this once)

GitHub Pages is free only on public repositories. This repository holds nothing private —
just the app's code — because the feeding log itself never leaves the phone it was entered on.
So make the repository public first:

1. **Settings** → **General** → scroll to the bottom → **Change visibility** → **Make public**,
   then confirm by typing the repository name.

Then turn on Pages:

1. **Settings** (top row) → **Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set the branch to `claude/breastfeeding-tracker-android-hg00uu` and the folder to `/ (root)`.
4. Click **Save**. Wait 1–2 minutes, then refresh the page — it will show the live link, which
   looks like:

   ```
   https://sporadic92.github.io/Nursing-log/
   ```

   (That capital `N` matters — use the exact link GitHub shows you.)

### Step 2 — install it on the phone

1. Text or email that link to her.
2. Open it **in Chrome** on the Android phone.
3. Tap the **⋮** menu in the top-right → **Add to Home screen** (or **Install app**) → **Install**.
4. A "Nursing Log" icon appears on her home screen. Opening it from there runs it full screen,
   with no browser bars, and it works with no signal.

## Using it

### Feedings

- **Start** — tap **Left** or **Right**. A timer starts and keeps running even if she closes the
  app or locks the phone.
- **Switch sides** — tap the other tile. Each side keeps its own running total, and the big
  number on top is the combined time. Time already banked on a side stops counting the moment
  she switches away from it.
- **The screen stays on** while a feed is timing, so you never have to unlock the phone to see
  the clock. After half a minute untouched it goes black except for the time and the side, dim
  enough for a dark room. Tap anywhere to bring the app back — that first tap only wakes the
  screen, it can't press anything.
- **Done** — tap **Stop & Save**. The feeding is saved with the start time, the minutes on each
  side, a Left / Right / Both label worked out from those, and **which side it ended on** —
  whichever tile was running when she stopped.
- **Look at one** — tap any feeding in the list to read it back on the same card it was entered
  on: the side, the start time, the minutes on each side, which side it ended on, and the notes.
  Nothing on that card responds to a tap, so checking a feeding can't change it.
- **Fix or annotate it** — tap **Edit** and the same card comes to life, ready to change the
  side, time, per-side minutes, ending side, or notes, or to delete it. Deleting offers **Undo** for a few seconds
  afterwards, so a wrong tap is recoverable. Picking **Both** in the editor gives separate
  boxes for left and right minutes plus an **Ended on** choice; picking one side gives a single
  box, since the ending side is then obvious.
- **Forgot to hit start?** Tap **+ Add a past feeding**.

### Diapers

- Tap **Pee**, **Poop**, or **Both**. That opens a short form, already filled in with what you
  tapped and the current time — add a size and any notes, then **Save**. Nothing is recorded
  until you save, so a mis-tap costs one **Cancel**.
- **How big** (small / medium / large) only appears when there's a poop to describe, and tapping
  the chosen size again clears it. It's optional either way.
- Tap a diaper in the list to read it back the same way, then **Edit** to change any of it or
  delete it.
- **+ Add a past diaper** for one that wasn't logged when it happened.

### The timeline

The two cards at the top always show **how long since the last feeding** (and which side it
ended on, so it's clear where to pick up next) and **how long since the last diaper** — usually
the thing you want at 3 a.m.

Below them, feedings, diapers and medicines share one timeline, newest first, with per-day
totals. The **All / Feeds / Diapers / Meds** buttons narrow it to one kind when you want to read just that — the
day totals follow whichever view you pick, and the choice is remembered next time you open
the app.

## Medicines

The third card logs what you take and when — it was added for ibuprofen after the hospital.

The line at the top says what you last took and how long ago, which is usually the thing you
actually want to know. Underneath, the medicines you've taken most recently become buttons: tap
**Ibuprofen 400 mg** and the form opens already filled in, with the time set to now — you only
have to press Save. **Something else** opens a fresh one, and **+ Add a past dose** is there for
a dose you forgot to log at the time.

The form itself is two lists rather than boxes to type in. It opens on **Ibuprofen** and
**400 mg**, so most of the time you can just press Save. The amounts go 200, 400, 600, 800 and
1000 mg, or **Not recorded** if you'd rather not put one down. If what you took isn't on either
list, pick **Something else** at the bottom and type it — it's saved exactly as you write it,
and it will read back that way whenever you open it again. There's a notes box if you want it.

Doses show in the timeline with a 💊, count in today's totals, have their own **Meds** filter,
and go into the backup, the spreadsheet, and the doctor's summary.

The app doesn't tell you when the next dose is due or what's safe to take — it only records what
you've taken, so you can see it at a glance or show someone.

## Newborn basics (the ? button)

The **?** button next to the ⚙ opens a page of ordinary newborn guidance — the things that are
hard to hold on to at 4 a.m. It's a list of headings; tap one to open it:

- **How often to feed** — 8 to 12 feeds in 24 hours, timed start to start, and why cluster
  feeding evenings are normal.
- **Signs the baby is hungry** — the early cues, and why crying is a late one.
- **Wet and dirty diapers** — a table of how many wet and how many dirty to expect on each day
  of the first week, what they should look like, and when a change is worth a call.
- **Signs feeding is going well**, **Latch and sore nipples**, and **Safe sleep**.
- **Call about the baby if** and **Call about yourself if** — the red flags, marked in red.

It's a reference and nothing else: it never reads the log, it doesn't work anything out from
what you've recorded, and it doesn't tell you what to do. It says so at the top — whatever the
midwife or pediatrician says wins.

To change the wording, or add a section of your own, look for `var GUIDE = [` in `index.html`.
Each section is a heading and a list of sentences, and adding one is a matter of copying the
pattern of the one above it.

## Backups (worth reading)

The log lives in the phone's browser storage. That means it survives closing the app, restarting
the phone, and losing signal — but it would be erased by clearing Chrome's site data for this
site, or by uninstalling.

Tap the **⚙** button in the top-right (next to the **?**) for:

- **Summary for the doctor (PDF)** — one page covering the last two weeks: feeds and minutes per
  day, average feed length, longest gap between feeds, wet and dirty nappies per day, a chart of
  each day, and a day-by-day table. Medicines taken, and any notes you wrote, go on a second page. It opens the share
  sheet, so you can email it ahead of an appointment or show it on the phone.
- **Export spreadsheet (CSV)** — feedings, diapers and medicines in one chronological sheet, with columns
  for per-side minutes, ending side, pee/poop, and poop size. Opens in Excel or Google Sheets, handy for the pediatrician.
- **Save backup file** — a file with everything in it. On the phone this opens Android's share
  sheet, so you can send it straight to Google Drive, email it to yourself, or save it to Files —
  it doesn't just vanish into Downloads. Chrome won't put a `.json` file on the share sheet, so
  the shared copy is named `…json.txt`; that's the same file, and Restore reads it back fine.
- **Restore from backup** — reads that file back in. It skips records already in the log, so
  restoring twice won't create duplicates.
- **What's new** — the version running on this phone, and what changed in each one before it.
  Worth a look after an update: if the version at the top isn't the newest, the phone is still
  on the old copy — close the app fully and open it again.

If it's been more than about ten days since the last backup, a small dot appears on the **⚙**
button and the menu says how long it's been. That's the whole reminder — no banners, no popups.
Backing up clears it.

## Making changes later

Everything is in `index.html` — the layout, the styling, and the logic, all in one file. Edit it
on GitHub and the change goes live on the phone within a minute or two of reopening the app.

| File | What it is |
| --- | --- |
| `index.html` | The whole app |
| `manifest.webmanifest` | Name, colors, and icon used when installed to the home screen |
| `sw.js` | Makes the app work offline |
| `icons/` | Home-screen icons |

If you change `index.html`, bump the `CACHE` version string at the top of `sw.js`
(`nursing-log-v1` → `nursing-log-v2`) so phones pick the update up right away.
