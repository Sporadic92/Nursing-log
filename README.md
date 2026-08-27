# Nursing Log

A simple breastfeeding tracker that installs on an Android phone like a normal app.
Records **when** a feeding started, **how long she spent on each side**, and any **notes**,
plus **formula** top-ups in ounces, **diapers** (pee, poop, or both) and **medicines** she takes. Everything is stored on the phone — no account, no
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
- **Pause** — for a burp, a nappy change, or a baby who has dozed off. The clock stops where it
  is, so the break never counts as time on the breast, however long it lasts — a paused feed
  stays paused through closing the app or restarting the phone. Tap **Resume** to carry on where
  she left off, or tap either side to pick up on that one.
- **The screen stays on** while a feed is timing, so you never have to unlock the phone to see
  the clock. After half a minute untouched it goes black except for the time and the side, dim
  enough for a dark room. Tap anywhere to bring the app back — that first tap only wakes the
  screen, it can't press anything.
- **Done** — tap **Stop & Save**. The feeding is saved with the start time, the minutes on each
  side, a Left / Right / Both label worked out from those, and **which side it ended on** —
  whichever tile was running when she stopped.
- **Stopped it by mistake?** The message that appears afterwards offers **Resume** for a few
  seconds. Tapping it takes the record back out and puts the timer back exactly where it was,
  with the minutes on each side still on it.
- **Look at one** — tap any feeding in the list to read it back on the same card it was entered
  on: the side, the start time, the minutes on each side, which side it ended on, and the notes.
  Nothing on that card responds to a tap, so checking a feeding can't change it.
- **Fix or annotate it** — tap **Edit** and the same card comes to life, ready to change the
  side, time, per-side minutes, ending side, or notes, or to delete it. Deleting offers **Undo** for a few seconds
  afterwards, so a wrong tap is recoverable. Picking **Both** in the editor gives separate
  boxes for left and right minutes plus an **Ended on** choice; picking one side gives a single
  box, since the ending side is then obvious.
- **Forgot to hit start?** If the feed is already under way, tap **Started 5 min earlier** under
  the clock: it puts five minutes on the side being fed and moves the start time back with them.
  Tap it twice for ten. For a feed that's already over, tap **+ Add a past feeding**.
- **Started one by mistake?** Tap **Stop & Save**, then tap the feeding in the list below,
  tap **Edit** and then **Delete this feeding**. There is no discard button on the timer any
  more: it sat right under Stop & Save, where a thumb could catch it and throw away a feed you
  were part-way through.
- **Buzz** — the phone gives a short buzz when a feeding starts, switches sides, pauses or stops,
  so a tap in the dark is confirmed without looking. Turn it off under **Vibration** in the menu.

### Getting out of a card

Whenever something is open — a record, the menu, the newborn basics — the phone's **back swipe
closes it**, the same as tapping Close. It won't close the app any more; that only happens when
there's nothing open to close.

Tapping the empty space beside a card closes it too, but **not while you're editing** — that
would throw away what you'd typed. When a card is open for editing, only **Cancel** or **Save**
will leave it.

### Diapers

- Tap **Pee**, **Poop**, or **Both**. That opens a short form, already filled in with what you
  tapped and the current time — add a size and any notes, then **Save**. Nothing is recorded
  until you save, so a mis-tap costs one **Cancel**.
- **How big** (small / medium / large) only appears when there's a poop to describe, and tapping
  the chosen size again clears it. It's optional either way.
- Tap a diaper in the list to read it back the same way, then **Edit** to change any of it or
  delete it.
- **+ Add a past diaper** for one that wasn't logged when it happened.
- Under the "last diaper" line, the card says **how many wet and how many dirty there have been
  today**, and every day in the timeline says the same. A nappy that was both counts once in
  each, so the two don't add up to the number of changes — wet and dirty are counted separately
  because that's how the wet-and-dirty table in **?** is written.

### Formula

The card under the feeding one is for a bottle of formula, for when you're supplementing.

- Tap an amount and then **Save**. The **last two amounts you gave** sit on the card as buttons,
  so the same bottle again is one tap and a Save. **Other** opens the form on its own.
- The form is a list rather than a box to type in, and it opens on **2 oz**. Amounts run from
  half an ounce up to 8 oz. If you gave something that isn't on the list, pick **Something else**
  at the bottom and type the number of ounces — quarters are fine, so 2.75 works.
- Tap a bottle in the list to read it back, then **Edit** to change it or delete it. Deleting
  offers **Undo**, the same as everywhere else.
- **+ Add a past bottle** for one you didn't log at the time.
- The top line says **how long since the last bottle and how much it was**, and under it,
  **how many bottles and how many ounces today**.

Bottles are counted **on their own**, not folded into the breastfeeding numbers. Feeds, minutes
and the gap between feeds all still mean exactly what they meant before — formula gets its own
**Formula** figure in today's totals, its own tab in the filter, and its own line on each day in
the timeline. Nothing you'd already recorded changed meaning when this was added.

### The timeline

The feeding card at the top always shows two things: **how long ago the last feed started** —
feeds are usually counted start to start — and **how long ago it finished**, which is the other
half of the question at 3 a.m. The finished line also says which side it ended on, and the
button for that side is highlighted and reads **pick up here**, since that's where the next feed
starts. Below it, the formula, diaper and medicine cards show **how long since the last one**, and the
formula and diaper cards add today's counts.

Below them, feedings, formula, diapers and medicines share one timeline, newest first, with
per-day totals. Each feeding says **how long after the one before** it was, since that's the gap
people ask about. The **All / Feeds / Formula / Diapers / Meds** buttons narrow it to one kind when you want to read just that — the
day totals follow whichever view you pick, and the choice is remembered next time you open
the app.

It shows the last two weeks, with **Show older** at the bottom for another fortnight each time
you tap it. That's just what's drawn on screen — nothing is deleted, and the spreadsheet, the
doctor's summary and the backup always cover everything.

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
and go into the backup, the spreadsheet, and the doctor's summary. Bottles do the same with a
🍼, and the summary adds **ounces per day** and an ounces column to its table.

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

- **Summary for the doctor (PDF)** — the last four weeks: feeds and minutes per
  day, average feed length, longest gap between feeds, wet and dirty nappies per day, a chart of
  each day, and a day-by-day table, which carries on to a second page when four weeks won't fit
  under the chart. Medicines taken, and any notes you wrote, go on the page after that. If the log is
  younger than four weeks it covers the days it actually has, rather than padding the table with
  empty ones. It opens the share
  sheet, so you can email it ahead of an appointment or show it on the phone.
- **Export spreadsheet (CSV)** — feedings, diapers and medicines in one chronological sheet, with columns
  for per-side minutes, ending side, pee/poop, and poop size. Opens in Excel or Google Sheets, handy for the pediatrician.
- **Save backup file** — a file with everything in it. On the phone this opens Android's share
  sheet, so you can send it straight to Google Drive, email it to yourself, or save it to Files —
  it doesn't just vanish into Downloads. Chrome won't put a `.json` file on the share sheet, so
  the shared copy is named `…json.txt`; that's the same file, and Restore reads it back fine.
- **Restore from backup** — reads that file back in. It skips records already in the log, so
  restoring twice won't create duplicates.
- **Send an update** — the last week as a message, for texting to the other phone. See
  below.
- **Paste an update** — the other end of that: paste in what was texted to you.
- **Vibration** — on or off. Tap the line to switch it.
- **What's new** — the version running on this phone, and what changed in each one before it.
  Worth a look after an update: if the version at the top isn't the newest, the phone is still
  on the old copy — close the app fully and open it again.

If it's been more than about ten days since the last backup, a small dot appears on the **⚙**
button and the menu says how long it's been. That's the whole reminder — no banners, no popups.
Backing up clears it.

## If something goes wrong with the log

If the app ever finds part of your log unreadable, a **red line appears at the top of the
screen**. It's the only warning of its kind in the app, and it means what it says:

- **Nothing has been deleted.** The part it couldn't read is set aside exactly as it was, and
  anything you log from now on saves normally.
- **Tap the red line.** It offers to **save a copy** of whatever couldn't be read — do that first
  and send it somewhere safe, in case it can be recovered later.
- **Then use Restore from backup** with your most recent backup file to bring those records back.
  That's what the backup is for, and it's why the app nags about making one.
- Once you've saved a copy, **Remove it from this phone** clears the warning. It offers Undo.

The one thing that would previously have lost records for good — the app quietly showing an empty
log and then saving over it — can't happen now: it refuses to write over anything it couldn't
read.

## Two phones, one log

If both of you want to log things, run the app on both phones and send records over as a text.
Her phone holds the real log; his sends what he recorded across.

**On the phone that recorded something** — tap **⚙** → **Send an update**. That puts the last
week into a text message, ready to send to the other phone. It's a block of gibberish with
a line above it explaining what it is; send the whole thing.

**On the phone that keeps the log** — copy the message (long-press it → Copy), tap **⚙** →
**Paste an update**, paste it in, and tap **Add to my log**.

Three things worth knowing:

- **It only ever adds.** Anything already in the log is left exactly as it is. Nothing you wrote
  can be replaced by what arrives, and pasting the same message twice does nothing the second
  time — it'll say "Nothing new to add".
- **Sending the same days again is fine**, and is the point of sending a whole week each time: if
  a message never gets read, or you don't get round to pasting one in for a few days, the next
  one still carries those records.
- **If you both log the same nappy, it'll show up twice.** There's no way for two phones to know
  they mean the same one. Delete whichever you like — tap it, **Edit**, **Delete**.

For anything bigger than a message will carry — a phone that's been logging for weeks — use
**Save backup file** instead and send the file. Restoring it works the same way: it only adds.

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
