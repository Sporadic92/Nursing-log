# Nursing Log

A simple breastfeeding tracker that installs on an Android phone like a normal app.
Records **when** a feeding started, **how long** it lasted, **which side** (left / right / both),
and any **notes**. Everything is stored on the phone — no account, no internet needed after
the first visit, nothing sent anywhere.

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

- **Start a feeding** — tap **L**, **R**, or **B**. A timer starts and keeps running even if she
  closes the app or locks the phone.
- **Switched sides partway?** Tap a different letter while the timer runs.
- **Done** — tap **Stop & Save**. It records the start time, the length, and the side.
- **Add notes, or fix a time** — tap any feeding in the list below to edit it, or delete it.
- **Forgot to hit start?** Tap **+ Add a past feeding** and type it in by hand.
- The card at the top always shows **how long since the last feeding** and **which side was last**,
  which is usually the thing you want at 3 a.m.

## Backups (worth reading)

The log lives in the phone's browser storage. That means it survives closing the app, restarting
the phone, and losing signal — but it would be erased by clearing Chrome's site data for this
site, or by uninstalling.

Tap the **⚙** button in the top-right for:

- **Export spreadsheet (CSV)** — opens in Excel or Google Sheets, handy for the pediatrician.
- **Save backup file** — a `.json` file with everything. Keep one in Google Drive now and then.
- **Restore from backup** — reads that file back in. It skips feedings already in the log, so
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
