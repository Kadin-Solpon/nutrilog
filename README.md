# NutriLog

A free calorie, macro, vitamin and mineral tracker that runs as a web app on
your iPhone. No account, no subscription, no App Store, no build step. Your log
lives on your phone and nothing is uploaded.

- **Barcode scanning** via the camera, resolved against
  [Open Food Facts](https://world.openfoodfacts.org) (~3M packaged products, free, no key).
- **137 built-in whole foods** with full USDA nutrient profiles, searchable offline.
- **Any common food measure** — g, kg, mg, oz, lb, ml, L, fl oz, cup, tbsp, tsp,
  pint, quart, gallon, plus per-food servings ("1 medium", "1 slice"). Accepts
  fractions: `1 1/2`, `3/4`, `1½`.
- **40 nutrients tracked** — energy, all macros, fiber, added sugar, omega-3,
  cholesterol, 14 vitamins and 11 minerals.
- **Day-by-day log** with meal grouping and a 7-day calorie chart.
- **Goals tab** that takes your height, age, weight, sex and activity level and
  computes every target: calories from Mifflin-St Jeor (or Katch-McArdle if you
  supply body fat %), macros from your calorie goal, and vitamins/minerals from
  the US DRI tables for your age and sex. Override any target by typing over it.
- **Works offline** after the first load, and installs to the home screen with
  its own icon and no browser chrome.

---

## Getting it onto your iPhone

The camera needs HTTPS, so the app has to be served over https — a plain
`file://` or `http://` LAN address will not let Safari open the camera. GitHub
Pages gives you HTTPS hosting for free and never expires.

### 1. Put the code on GitHub

Create a new **public** repository at <https://github.com/new> — call it
`nutrilog`. Don't add a README or .gitignore; this project has both. Then, from
this folder:

```sh
git remote add origin https://github.com/YOUR-USERNAME/nutrilog.git
git branch -M main
git push -u origin main
```

### 2. Add it to your home screen

On your iPhone, open that URL **in Safari** (Add to Home Screen is a Safari
feature). Then:

1. Tap the **Share** button (the square with the arrow).
2. Scroll down and tap **Add to Home Screen**.
3. Tap **Add**.

You now have a NutriLog icon that opens full-screen with no address bar. Open it
once from the home screen, then tap **Scan barcode** and allow camera access
when Safari asks.

**Installing it this way also protects your data.** Safari clears
locally-stored data for ordinary websites you haven't visited in 7 days;
home-screen web apps are exempt. Use the home-screen icon, not a Safari tab.

---

## Running it locally

Any static file server works. With Python (already on macOS):

```sh
python3 -m http.server 8777
```

Then open <http://127.0.0.1:8777>. `localhost` counts as a secure origin, so
barcode scanning works here too — handy for testing on the Mac.

To try it from your phone on the same Wi-Fi, use your Mac's LAN IP. Note that
`http://192.168.x.x:8777` is **not** a secure origin, so everything works
*except* the camera; use "Type code" to enter barcodes by hand.

## Tests

147 assertions covering unit conversion, the food table, DRI lookups, the
energy and target math, the day-log totals, and the Open Food Facts parser.
plus the storage-compaction round-trip. They run through JavaScriptCore via
`osascript`, so there is nothing to install:

```sh
sh test/run.sh
```

## Layout

```
index.html              app shell and the tab bar
css/app.css             all styling; light and dark are both hand-picked
js/nutrients.js         nutrient definitions, DRI tables, upper limits
js/units.js             quantity parsing and conversion to grams
js/foods.js             the built-in whole-food table
js/store.js             localStorage persistence, the day log, totals
js/goals.js             BMR/TDEE and the full target set
js/off.js               Open Food Facts client and unit normalisation
js/scanner.js           camera barcode scanning
js/app.js               views, rendering, interaction
sw.js                   service worker, for offline
test/                   the test suite and its runner
```

There is no framework and no bundler. Each view returns an HTML string, `#app`
gets `innerHTML`, and one delegated click listener handles everything.

## How the numbers are produced

**Energy.** Mifflin-St Jeor by default; Katch-McArdle when you give a body fat
percentage. Multiplied by your activity factor, then adjusted by 500 kcal per
pound per week of intended weight change, with a floor of 1500 kcal (male) /
1200 kcal (female).

**Macros.** Protein from bodyweight — 2.0 g/kg when cutting, 1.8 when gaining,
1.6 when maintaining. Fat at 27.5% of calories. Carbs take whatever calories
remain. Fiber at the DRI's 14 g per 1000 kcal.

**Vitamins and minerals.** RDA where one exists, otherwise AI, from the
Institute of Medicine DRI tables, keyed to your age band and sex, with the 2019
revision for sodium and potassium. Pregnancy and breastfeeding raise the
relevant targets. Tolerable Upper Intake Levels are used to flag excess —
except for magnesium, niacin, folate and vitamin E, whose limits apply only to
supplements and fortified foods, so exceeding those from food is noted but not
warned about. Vitamin A's limit *is* warned about, because it covers preformed
retinol from food and one serving of liver clears it.

**Unknown is never zero.** If a food has no value recorded for a nutrient, it is
excluded from that nutrient's total and the Nutrients screen tells you how much
of your day's food was missing data. A nutrient nothing recorded shows `—`,
not a confident `0`.

## Accuracy caveats

- Built-in whole-food figures are USDA averages, rounded. A real banana varies.
- Open Food Facts is crowd-sourced from product labels. Most entries are fine;
  some are wrong or incomplete. If a scanned product looks off, check it against
  the label, and create a custom food if you want to be sure.
- USDA does not record biotin or iodine for most foods, so those two will often
  read low. That's missing data, not a deficiency.
- Converting a volume to a weight needs a density. Foods that are measured by
  volume carry one; for anything else the app assumes 1 g/ml and says so.
  Weighing in grams is always more accurate.
- BMI is shown because it's expected, but it can't tell muscle from fat.

This is a tracking tool, not medical advice.

## Where your data lives, and for how long

Everything is in your browser's `localStorage`, under a single key
(`nutrilog.v1`), scoped to the origin the app is served from. There is no
server, no account and no sync — the log never leaves the device.

**It persists indefinitely, with three exceptions:**

| What removes it | Why |
|---|---|
| Deleting the home-screen app | Takes its storage with it |
| Settings → Safari → Clear History and Website Data | Wipes all site storage, this app included |
| Never installing it to the home screen | Safari deletes script-written storage for ordinary sites after 7 days of Safari use without interacting with that site |

That last row is the one to watch. **Add it to your home screen and open it from
that icon.** A home-screen web app is not part of Safari and keeps its own
days-of-use counter, which resets every time you open it; Apple has stated it
does not expect such an app's first-party data to be deleted. A plain Safari tab
gets no such protection. Opening the app regularly — which you will, if you're
logging meals — keeps that counter from ever running down.

### How much space it uses

Entries for built-in foods are stored as a reference plus the logged amount, and
the nutrient table is rehydrated from the app on read, so an entry costs about
**240 bytes** rather than the ~1.6 kB a full nutrient snapshot would take.
Measured at twelve items a day:

| | |
|---|---|
| One day | ~2.8 kB |
| One year | ~0.64 MB |
| Browser budget | ~5 MB per origin |
| Headroom | **about 5 years** of daily logging |

Scanned and custom foods still store a full snapshot, because that data can
change or disappear upstream and history has to own its copy. Those entries run
nearer 1.5 kB, so a log made mostly of scanned products fills up faster.

**Goals → Settings & data** shows current usage with a projection, and warns at
70%. Export a backup from the same place now and then — it writes one JSON file
holding everything, and Import restores it on any device.
