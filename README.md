# Nursing Log

A simple breastfeeding tracker that installs on an Android phone like a normal app.
Records **when** a feeding started, **how long she spent on each side**, and any **notes**,
plus **diapers** (pee, poop, or both). Everything is stored on the phone — no account, no
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
- **Done** — tap **Stop & Save**. The feeding is saved with the start time, the minutes on each
  side, a Left / Right / Both label worked out from those, and **which side it ended on** —
  whichever tile was running when she stopped.
- **Look at one** — tap any feeding in the list to read it back: when it started, the total, the
  minutes on each side, which side it ended on, and the notes. That view has no controls to
  nudge, so checking a feeding can't change it.
- **Fix or annotate it** — from that view, tap **Edit** to change the side, time, per-side
  minutes, ending side, or notes, or to delete it. Picking **Both** in the editor gives separate
  boxes for left and right minutes plus an **Ended on** choice; picking one side gives a single
  box, since the ending side is then obvious.
- **Forgot to hit start?** Tap **+ Add a past feeding**.

### Diapers

- Tap **Pee**, **Poop**, or **Both**. That opens a short form, already filled in with what you
  tapped and the current time — add a size and any notes, then **Save**. Nothing is recorded
  until you save, so a mis-tap costs one **Cancel**.
- **How big** (small / medium / large) only appears when there's a poop to describe, and tapping
  the chosen size again clears it. It's optional either way.
- Tap a diaper in the list to read it back, then **Edit** to change any of it or delete it.
- **+ Add a past diaper** for one that wasn't logged when it happened.

### The timeline

The two cards at the top always show **how long since the last feeding** (and which side it
ended on, so it's clear where to pick up next) and **how long since the last diaper** — usually
the thing you want at 3 a.m.

Below them, feedings and diapers share one timeline, newest first, with per-day totals. The
**All / Feeds / Diapers** buttons narrow it to one kind when you want to read just that — the
day totals follow whichever view you pick, and the choice is remembered next time you open
the app.

## Backups (worth reading)

The log lives in the phone's browser storage. That means it survives closing the app, restarting
the phone, and losing signal — but it would be erased by clearing Chrome's site data for this
site, or by uninstalling.

Tap the **⚙** button in the top-right for:

- **Export spreadsheet (CSV)** — feedings and diapers in one chronological sheet, with columns
  for per-side minutes, ending side, pee/poop, and poop size. Opens in Excel or Google Sheets, handy for the pediatrician.
- **Save backup file** — a `.json` file with everything. Keep one in Google Drive now and then.
- **Restore from backup** — reads that file back in. It skips records already in the log, so
  restoring twice won't create duplicates.

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
