/* ---------------------------------------------------------------- units */
var U = NL.units;
close('parse 1.5', U.parseQuantity('1.5'), 1.5);
close('parse "1 1/2"', U.parseQuantity('1 1/2'), 1.5);
close('parse "3/4"', U.parseQuantity('3/4'), 0.75);
close('parse "1½"', U.parseQuantity('1½'), 1.5);
close('parse "2,5"', U.parseQuantity('2,5'), 2.5);
ok('parse junk -> null', U.parseQuantity('abc') === null);
ok('parse empty -> null', U.parseQuantity('') === null);
close('1 oz', U.toGrams(1, 'oz').grams, 28.3495, 0.001);
close('1 lb', U.toGrams(1, 'lb').grams, 453.592, 0.001);
close('2.5 kg', U.toGrams(2.5, 'kg').grams, 2500);
close('500 ml water', U.toGrams(500, 'ml').grams, 500);
close('1 L', U.toGrams(1, 'l').grams, 1000);
close('1 cup (label)', U.toGrams(1, 'cup').grams, 240);
close('1 tbsp', U.toGrams(1, 'tbsp').grams, 14.7868, 0.001);
close('8 fl oz', U.toGrams(8, 'fl oz').grams, 236.588, 0.001);
ok('volume w/o density flags assumption', U.toGrams(1, 'cup').assumedDensity === true);
close('olive oil 1 tbsp by volume',
  U.toGrams(1, 'tbsp', { density: 0.918 }).grams, 13.574, 0.01);
ok('oil volume does not flag assumption',
  U.toGrams(1, 'tbsp', { density: 0.918 }).assumedDensity === false);
ok('unknown unit -> null', U.toGrams(1, 'furlong', {}) === null);

/* ---------------------------------------------------------------- foods */
var F = NL.foods;
ok('food count >= 130', F.all.length >= 130, F.all.length);
var banana = F.byId('b:banana-raw');
ok('banana found', !!banana);
close('banana kcal/100g', banana.per100.calories, 89);
close('banana potassium', banana.per100.potassium, 358);
close('2 medium bananas', U.toGrams(2, 'medium', banana).grams, 236);
ok('search "chick br" finds chicken breast',
  F.search('chick br', 5).length > 0 &&
  F.search('chick br', 5)[0].name.indexOf('Chicken breast') === 0,
  JSON.stringify(F.search('chick br', 3).map(function (f) { return f.name; })));
ok('search "spinach" returns both spinach rows',
  F.search('spinach', 10).length >= 2);
ok('every food has calories', F.all.every(function (f) {
  return f.per100.calories != null;
}));
ok('every food id unique', (function () {
  var s = {}; return F.all.every(function (f) {
    if (s[f.id]) return false; s[f.id] = 1; return true;
  });
})());
ok('nulls stay unknown, not zero',
  F.byId('b:butternut-squash-raw').per100.choline === undefined,
  JSON.stringify(F.byId('b:butternut-squash-raw').per100.choline));
ok('extras merge in (walnut omega-3)',
  F.byId('b:walnuts-raw').per100.omega3 === 9.08);

ok('whole foods get addedSugar 0 by definition',
  F.byId('b:broccoli-raw').per100.addedSugar === 0 &&
  F.byId('b:chicken-breast-skinless-roasted').per100.addedSugar === 0 &&
  F.byId('b:salmon-atlantic-farmed-cooked').per100.addedSugar === 0);
ok('cured and sweetened items keep unknown addedSugar',
  F.byId('b:bacon-pork-cooked').per100.addedSugar === undefined &&
  F.byId('b:peanut-butter-smooth').per100.addedSugar === undefined &&
  F.byId('b:kimchi').per100.addedSugar === undefined);
ok('bread keeps unknown addedSugar (it is not on the allowlist)',
  F.byId('b:bread-white-enriched').per100.addedSugar === undefined);
ok('declared addedSugar is never overwritten',
  F.byId('b:honey').per100.addedSugar === 82.12 &&
  F.byId('b:soda-cola').per100.addedSugar === 8.98);
ok('plain grains get addedSugar 0',
  F.byId('b:rice-brown-long-grain-cooked').per100.addedSugar === 0);

/* ------------------------------------------------------------ nutrients */
var N = NL.nutrients;
var driM30 = N.driFor('male', 30), driF30 = N.driFor('female', 30);
ok('M30 vitamin C 90', driM30.vitaminC === 90);
ok('F30 iron 18', driF30.iron === 18);
ok('F55 iron 8', N.driFor('female', 55).iron === 8);
ok('M55 B6 1.7', N.driFor('male', 55).vitaminB6 === 1.7);
ok('F12 calcium 1300', N.driFor('female', 12).calcium === 1300);
ok('M75 vitamin D 20', N.driFor('male', 75).vitaminD === 20);
ok('pregnant folate 600', N.driFor('female', 30, 'pregnant').folate === 600);
ok('pregnant iron 27', N.driFor('female', 30, 'pregnant').iron === 27);
ok('lactating iodine 290', N.driFor('female', 30, 'lactating').iodine === 290);
ok('male ignores pregnancy', N.driFor('male', 30, 'pregnant').folate === 400);
ok('40 nutrients defined (15 macro + 14 vitamin + 11 mineral)',
  N.list.length === 40, N.list.length);
ok('group split is 15/14/11', [15, 14, 11].every(function (want, i) {
  var g = ['macro', 'vitamin', 'mineral'][i];
  return N.list.filter(function (m) { return m.group === g; }).length === want;
}));
ok('every nutrient has a unit+group', N.list.every(function (m) {
  return m.unit && m.group && m.dir;
}));

/* ---------------------------------------------------------------- store */
var S = NL.store;
S.load();
S.setProfile({ sex: 'male', age: 30, heightCm: 180, weightKg: 80,
  activity: 1.55, goal: 'lose', rate: 0.5 });
var day = '2026-09-15';
S.addEntry(day, { name: 'Chicken breast', source: 'builtin', foodId: 'b:x',
  qty: 200, unit: 'g', grams: 200, per100: F.byId('b:chicken-breast-skinless-roasted').per100,
  meal: 'Lunch' });
S.addEntry(day, { name: 'Mystery bar', source: 'off', foodId: 'o:1',
  qty: 1, unit: 'g', grams: 50, per100: { calories: 200, protein: 10 }, meal: 'Snacks' });
var r = S.dayTotals(day);
close('totals kcal', r.totals.calories, 165 * 2 + 100, 0.5);
close('totals protein', r.totals.protein, 31.02 * 2 + 5, 0.1);
ok('entry count 2', r.entryCount === 2);
close('coverage for iron = 200/250', r.coverage.iron, 0.8, 0.001);
ok('missing iron names the bar', (r.missing.iron || [])[0] === 'Mystery bar');
close('iron total excludes unknown', r.totals.iron, 1.04 * 2, 0.01);
ok('date shift back', S.shiftKey('2026-01-01', -1) === '2025-12-31');
ok('date shift fwd over month', S.shiftKey('2026-02-28', 1) === '2026-03-01');
ok('leap day', S.shiftKey('2028-02-28', 1) === '2028-02-29');
var e2 = S.getDay(day)[1];
S.removeEntry(day, e2.id);
ok('remove works', S.getDay(day).length === 1);
ok('recents recorded', S.recents().length === 2);
var json = S.exportJSON();
ok('export round-trips', JSON.parse(json).days[day].length === 1);

/* ------------------------------------------------- storage compaction
   Built-in entries are stored by reference and rehydrated on read. These
   guard that the compaction is lossless for the values that matter. */
var S2 = NL.store;
S2.wipe();
var cday = '2026-03-04';
var chicken = F.byId('b:chicken-breast-skinless-roasted');
S2.addEntry(cday, { foodId: chicken.id, source: 'builtin', name: chicken.name,
  brand: '', qty: 6, unit: 'oz', unitLabel: 'oz', grams: 170.1,
  per100: chicken.per100, servings: chicken.servings, density: chicken.density,
  liquid: chicken.liquid, meal: 'Lunch' });

var storedRaw = S2.raw().days[cday][0];
ok('stored built-in entry drops the nutrient snapshot',
  storedRaw.per100 === undefined && storedRaw.servings === undefined);
ok('stored built-in entry drops the derivable name',
  storedRaw.name === undefined);
ok('stored built-in entry keeps a calorie safety value', storedRaw.kc === 165);
ok('stored entry is under 300 bytes', JSON.stringify(storedRaw).length < 300,
  JSON.stringify(storedRaw).length);

var hy = S2.getDay(cday)[0];
ok('read back restores the full nutrient map',
  NL.nutrients.keys.every(function (k) { return hy.per100[k] === chicken.per100[k]; }));
ok('read back restores the name', hy.name === chicken.name);
ok('read back restores servings', hy.servings.length === chicken.servings.length);
ok('read back restores the unit label', hy.unitLabel === 'oz');
close('totals survive compaction', S2.dayTotals(cday).totals.protein,
  31.02 * 1.701, 0.01);
close('micronutrients survive compaction', S2.dayTotals(cday).totals.selenium,
  27.6 * 1.701, 0.01);
ok('coverage still complete after compaction',
  S2.dayTotals(cday).coverage.selenium === 1);

// a serving-unit entry, to check unit-label recovery for named servings
S2.addEntry(cday, { foodId: 'b:banana-raw', source: 'builtin', name: 'x',
  brand: '', qty: 1, unit: 'medium', unitLabel: 'medium', grams: 118,
  per100: banana.per100, servings: banana.servings, meal: 'Snacks' });
ok('named serving label recovers', S2.getDay(cday)[1].unitLabel === 'medium');

// scanned and custom foods must keep their own copy
S2.addEntry(cday, { foodId: 'o:999', source: 'off', name: 'Scanned thing',
  brand: 'Acme', barcode: '999', qty: 1, unit: 'g', grams: 40,
  per100: { calories: 500, protein: 9 }, servings: [], meal: 'Snacks' });
var offRaw = S2.raw().days[cday][2];
ok('scanned entry keeps its full snapshot',
  offRaw.per100 && offRaw.per100.calories === 500 && offRaw.name === 'Scanned thing');
ok('scanned entry reads back unchanged',
  S2.getDay(cday)[2].per100.calories === 500);

// editing a compacted entry
var eid = S2.getDay(cday)[0].id;
S2.updateEntry(cday, eid, { qty: 8, unit: 'oz', grams: 226.8 });
close('edited compacted entry recomputes', S2.dayTotals(cday).totals.protein,
  31.02 * 2.268 + 1.09 * 1.18 + 9 * 0.4, 0.02);
ok('edited entry stays compacted', S2.raw().days[cday][0].per100 === undefined);
ok('edit kept the food reference', S2.getDay(cday)[0].name === chicken.name);

// a food removed by a future build
S2.raw().days[cday].push({ id: 'zz', source: 'builtin', foodId: 'b:gone-forever',
  qty: 100, unit: 'g', grams: 100, meal: 'Snacks', kc: 123 });
var orph = S2.getDay(cday)[3];
ok('missing food is flagged, not dropped', orph.orphan === true);
ok('missing food keeps its calories', orph.per100.calories === 123);
ok('missing food says so plainly', /no longer in the app/.test(orph.name));
ok('day total still includes the orphan',
  Math.round(S2.dayTotals(cday).totals.calories) ===
  Math.round(165 * 2.268 + 89 * 1.18 + 500 * 0.4 + 123));

// legacy logs written before compaction existed
S2.raw().days['2026-03-05'] = [{ id: 'old1', source: 'builtin',
  foodId: 'b:broccoli-raw', name: 'Broccoli, raw', brand: '', qty: 100,
  unit: 'g', unitLabel: 'g', grams: 100, meal: 'Lunch',
  per100: F.byId('b:broccoli-raw').per100,
  servings: F.byId('b:broccoli-raw').servings }];
var freed = S2.compact();
ok('compact() shrinks a legacy log', freed > 500, freed);
ok('legacy entry still reads correctly',
  S2.getDay('2026-03-05')[0].per100.vitaminC === 89.2);
ok('legacy entry got compacted',
  S2.raw().days['2026-03-05'][0].per100 === undefined);

// export/import must survive the whole thing
var snapshot = S2.exportJSON();
var beforeKcal = S2.dayTotals(cday).totals.calories;
S2.wipe();
ok('wipe clears the log', S2.getDay(cday).length === 0);
S2.importJSON(snapshot);
close('import restores totals exactly', S2.dayTotals(cday).totals.calories,
  beforeKcal, 0.001);
close('import restores nutrient detail',
  S2.dayTotals(cday).totals.selenium, 27.6 * 2.268 + 1.0 * 1.18, 0.01);

var u = S2.usage();
ok('usage() reports bytes and counts',
  u.bytes > 0 && u.entries === 5 && u.days === 2,
  JSON.stringify(u));

// Leave the store as the goals section below expects to find it.
S2.wipe();
S2.setProfile({ sex: 'male', age: 30, heightCm: 180, weightKg: 80,
  activity: 1.55, goal: 'lose', rate: 0.5 });

/* ---------------------------------------------------------------- goals */
var G = NL.goals;
close('BMR male 80kg/180cm/30', G.bmr(S.profile()), 1780, 0.01);
close('TDEE @1.55', G.tdee(S.profile()), 2759, 0.01);
close('lose 0.5 lb/wk', G.calorieGoal(S.profile()).value, 2509, 0.6);
S.setProfile({ sex: 'female', weightKg: 60, heightCm: 165 });
close('BMR female 60kg/165cm/30', G.bmr(S.profile()), 1320.25, 0.01);
S.setProfile({ goal: 'lose', rate: 1, activity: 1.2 });
var cg = G.calorieGoal(S.profile());
ok('female floor clamps to 1200', cg.value === 1200 && cg.floored === true,
  cg.value + ' floored=' + cg.floored);
S.setProfile({ bodyFat: 25 });
close('Katch-McArdle 60kg @25%', G.bmr(S.profile()), 370 + 21.6 * 45, 0.01);
S.setProfile({ bodyFat: null, sex: 'male', weightKg: 80, heightCm: 180,
  goal: 'maintain', activity: 1.55 });
var tg = G.targets();
ok('every nutrient has a target slot', N.keys.every(function (k) {
  return tg.targets[k] !== undefined;
}), N.keys.filter(function (k) { return tg.targets[k] === undefined; }).join(','));
close('maintain calories = TDEE', tg.targets.calories.value, 2759, 0.6);
close('protein 1.6 g/kg', tg.targets.protein.value, 128, 0.51);
close('fiber 14g/1000kcal', tg.targets.fiber.value, Math.round(2759 / 1000 * 14), 0.51);
ok('carbs are the remainder and positive', tg.targets.carbs.value > 0);
close('macro kcal reconcile',
  tg.targets.protein.value * 4 + tg.targets.carbs.value * 4 + tg.targets.fat.value * 9,
  tg.targets.calories.value, 6);
ok('vitamin C target from DRI', tg.targets.vitaminC.value === 90);
ok('sodium is a limit', tg.targets.sodium.dir === 'limit');
S.setManualGoal('calories', 2200);
var tg2 = G.targets();
ok('manual calories win', tg2.targets.calories.value === 2200 &&
  tg2.targets.calories.source === 'manual');
close('fiber follows manual calories', tg2.targets.fiber.value, 31, 0.51);
S.setManualGoal('vitaminC', 500);
ok('manual micro wins', G.targets().targets.vitaminC.value === 500);
S.setManualGoal('calories', null);
S.setManualGoal('vitaminC', null);
ok('clearing restores DRI', G.targets().targets.vitaminC.value === 90);
ok('BMI computed', Math.abs(G.bmi(S.profile()) - 24.69) < 0.01, G.bmi(S.profile()));
ok('BMI label', G.bmiLabel(24.69) === 'healthy range');
S.setProfile({ sex: null, age: null, heightCm: null, weightKg: null });
ok('missing profile lists 4', G.missingProfile().length === 4);
ok('no profile -> null calories', G.targets().targets.calories.value === null);

/* ------------------------------------------------------ open food facts */
var O = NL.off;
close('1 g -> mg', O.normalise('sodium', 1, 'g'), 1000);
close('500 mg -> mg', O.normalise('sodium', 500, 'mg'), 500);
close('0.0009 g vit A -> mcg', O.normalise('vitaminA', 0.0009, 'g'), 900, 0.001);
close('400 IU vit D -> mcg', O.normalise('vitaminD', 400, 'iu'), 10, 0.001);
close('30 IU vit E -> mg', O.normalise('vitaminE', 30, 'iu'), 20.1, 0.001);
close('1000 kJ -> kcal', O.normalise('calories', 1000, 'kj'), 239.005, 0.01);
ok('%DV rejected', O.normalise('vitaminC', 45, '%') === null);
ok('unknown unit rejected', O.normalise('iron', 5, 'bushels') === null);
ok('missing value -> null', O.normalise('iron', null, 'mg') === null);

var p100 = O.per100From({
  'energy-kcal_100g': 250, 'proteins_100g': 8, 'carbohydrates_100g': 40,
  'fat_100g': 6, 'saturated-fat_100g': 2, 'fiber_100g': 3,
  'salt_100g': 1.25, 'salt_unit': 'g',
  'vitamin-a_100g': 0.0006, 'vitamin-a_unit': 'g',
  'vitamin-d_100g': 200, 'vitamin-d_unit': 'iu',
  'calcium_100g': 0.12, 'calcium_unit': 'g',
  'vitamin-b9_100g': 0.0002, 'vitamin-b9_unit': 'g'
});
close('off kcal', p100.calories, 250);
close('off salt -> sodium', p100.sodium, 500, 0.5);
close('off vit A', p100.vitaminA, 600, 0.001);
close('off vit D IU', p100.vitaminD, 5, 0.001);
close('off calcium', p100.calcium, 120, 0.001);
close('off folate', p100.folate, 200, 0.001);
ok('off leaves absent nutrients unknown', p100.zinc === undefined);

var kj = O.per100From({ 'energy-kj_100g': 2000, 'proteins_100g': 5 });
close('kJ-only energy fallback', kj.calories, 478.0, 0.1);

var food = O.toFood({
  code: '123', product_name: 'Test Bar', brands: 'Acme, Other',
  serving_size: '40 g', serving_quantity: 40, product_quantity: 200,
  nutriments: { 'energy-kcal_100g': 400, 'proteins_100g': 20 }
});
ok('off name', food.name === 'Test Bar');
ok('off brand takes first', food.brand === 'Acme');
ok('off serving grams', food.servings[0].grams === 40);
ok('off serving label is a bare noun (UI adds the grams)',
  food.servings[0].label === 'serving', food.servings[0].label);
ok('off keeps the label wording separately',
  food.servingNote === '40 g');
ok('off package serving', food.servings[1].grams === 200);
close('off portion math', U.toGrams(1, 'serving', food).grams, 40);

/* ------------------------------------------- off hardening (regressions) */
ok('per-serving bare field is ignored',
  O.per100From({ sodium: 500, 'proteins_100g': 5 }).sodium === undefined);
ok('impossible sodium rejected (200 g per 100 g)',
  O.per100From({ 'sodium_100g': 200, 'sodium_unit': 'g' }).sodium === undefined);
ok('salty-but-real sodium kept (20 g per 100 g, salt is 39)',
  O.per100From({ 'sodium_100g': 20, 'sodium_unit': 'g' }).sodium === 20000);
ok('mg-unit micronutrient converts', O.per100From(
  { 'vitamin-c_100g': 45, 'vitamin-c_unit': 'mg' }).vitaminC === 45);
ok('mcg-unit micronutrient converts', O.per100From(
  { 'vitamin-b12_100g': 2.4, 'vitamin-b12_unit': 'mcg' }).vitaminB12 === 2.4);
ok('plausible sodium kept', O.per100From(
  { 'sodium_100g': 0.6, 'sodium_unit': 'g' }).sodium === 600);
ok('negative rejected', O.per100From(
  { 'proteins_100g': -5, 'proteins_unit': 'g' }).protein === undefined);
ok('absurd calories rejected', O.per100From(
  { 'energy-kcal_100g': 99999 }).calories === undefined);
ok('900 kcal (pure fat) still allowed', O.per100From(
  { 'energy-kcal_100g': 884 }).calories === 884);
ok('100 g protein per 100 g allowed (isolate)', O.per100From(
  { 'proteins_100g': 90, 'proteins_unit': 'g' }).protein === 90);

/* -------------------------------------------------------------- scanner */
ok('valid UPC-A passes', NL.scanner.validChecksum('038000138416'));
ok('bad check digit fails', !NL.scanner.validChecksum('038000138417'));
ok('EAN-13 valid', NL.scanner.validChecksum('4006381333931'));

/* ------------------------------------------------------------- wrap up */
log('');
log(PASS + ' passed, ' + FAIL + ' failed');
OUT.join('\n');
