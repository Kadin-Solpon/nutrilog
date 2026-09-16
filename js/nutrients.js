/* nutrients.js — nutrient definitions and Dietary Reference Intake (DRI) tables.
   Sources: Institute of Medicine / National Academies DRI tables (RDA where one
   exists, otherwise AI). Potassium & sodium use the 2019 NAM revision. */
(function (NL) {
  'use strict';

  // Canonical storage units. Every nutrient value in the app is stored in the
  // unit declared here, per 100 g of food.
  var NUTRIENTS = [
    // key,               label,                unit,   group,      dir,      dp
    ['calories',          'Calories',           'kcal', 'macro',    'target', 0],
    ['protein',           'Protein',            'g',    'macro',    'target', 1],
    ['carbs',             'Carbs',              'g',    'macro',    'target', 1],
    ['fiber',             'Fiber',              'g',    'macro',    'target', 1],
    ['sugar',             'Total sugars',       'g',    'macro',    'none',   1],
    ['addedSugar',        'Added sugars',       'g',    'macro',    'limit',  1],
    ['fat',               'Fat',                'g',    'macro',    'target', 1],
    ['satFat',            'Saturated fat',      'g',    'macro',    'limit',  1],
    ['monoFat',           'Monounsaturated',    'g',    'macro',    'none',   1],
    ['polyFat',           'Polyunsaturated',    'g',    'macro',    'none',   1],
    ['transFat',          'Trans fat',          'g',    'macro',    'limit',  1],
    ['omega3',            'Omega-3 (ALA+EPA+DHA)', 'g', 'macro',    'target', 2],
    ['cholesterol',       'Cholesterol',        'mg',   'macro',    'limit',  0],
    ['caffeine',          'Caffeine',           'mg',   'macro',    'none',   0],
    ['alcohol',           'Alcohol',            'g',    'macro',    'none',   1],

    ['vitaminA',          'Vitamin A',          'mcg',  'vitamin',  'target', 0],
    ['vitaminC',          'Vitamin C',          'mg',   'vitamin',  'target', 1],
    ['vitaminD',          'Vitamin D',          'mcg',  'vitamin',  'target', 1],
    ['vitaminE',          'Vitamin E',          'mg',   'vitamin',  'target', 1],
    ['vitaminK',          'Vitamin K',          'mcg',  'vitamin',  'target', 1],
    ['thiamin',           'Thiamin (B1)',       'mg',   'vitamin',  'target', 2],
    ['riboflavin',        'Riboflavin (B2)',    'mg',   'vitamin',  'target', 2],
    ['niacin',            'Niacin (B3)',        'mg',   'vitamin',  'target', 1],
    ['pantothenicAcid',   'Pantothenic acid (B5)', 'mg', 'vitamin', 'target', 2],
    ['vitaminB6',         'Vitamin B6',         'mg',   'vitamin',  'target', 2],
    ['biotin',            'Biotin (B7)',        'mcg',  'vitamin',  'target', 1],
    ['folate',            'Folate (B9)',        'mcg',  'vitamin',  'target', 0],
    ['vitaminB12',        'Vitamin B12',        'mcg',  'vitamin',  'target', 2],
    ['choline',           'Choline',            'mg',   'vitamin',  'target', 0],

    ['calcium',           'Calcium',            'mg',   'mineral',  'target', 0],
    ['iron',              'Iron',               'mg',   'mineral',  'target', 1],
    ['magnesium',         'Magnesium',          'mg',   'mineral',  'target', 0],
    ['phosphorus',        'Phosphorus',         'mg',   'mineral',  'target', 0],
    ['potassium',         'Potassium',          'mg',   'mineral',  'target', 0],
    ['sodium',            'Sodium',             'mg',   'mineral',  'limit',  0],
    ['zinc',             'Zinc',                'mg',   'mineral',  'target', 1],
    ['copper',            'Copper',             'mcg',  'mineral',  'target', 0],
    ['manganese',         'Manganese',          'mg',   'mineral',  'target', 2],
    ['selenium',          'Selenium',           'mcg',  'mineral',  'target', 1],
    ['iodine',            'Iodine',             'mcg',  'mineral',  'target', 0]
  ].map(function (r) {
    return { key: r[0], label: r[1], unit: r[2], group: r[3], dir: r[4], dp: r[5] };
  });

  var BY_KEY = {};
  NUTRIENTS.forEach(function (n) { BY_KEY[n.key] = n; });

  // The four rings / headline numbers on the Today screen.
  var HEADLINE = ['calories', 'protein', 'carbs', 'fat'];

  /* ---- DRI tables -------------------------------------------------------
     Six age bands, indexed by BANDS. Values are RDA when available, else AI.
     Nutrients absent from these tables have no DRI and are shown untargeted
     (or are derived from calorie intake — see goals.js). */
  var BANDS = ['9-13', '14-18', '19-30', '31-50', '51-70', '71+'];

  function bandIndex(age) {
    if (age == null || isNaN(age)) return 2;
    if (age < 14) return 0;
    if (age < 19) return 1;
    if (age < 31) return 2;
    if (age < 51) return 3;
    if (age < 71) return 4;
    return 5;
  }

  var DRI = {
    //                     9-13  14-18  19-30  31-50  51-70   71+
    vitaminA:        { m: [ 600,   900,   900,   900,   900,   900],
                       f: [ 600,   700,   700,   700,   700,   700] },
    vitaminC:        { m: [  45,    75,    90,    90,    90,    90],
                       f: [  45,    65,    75,    75,    75,    75] },
    vitaminD:        { m: [  15,    15,    15,    15,    15,    20],
                       f: [  15,    15,    15,    15,    15,    20] },
    vitaminE:        { m: [  11,    15,    15,    15,    15,    15],
                       f: [  11,    15,    15,    15,    15,    15] },
    vitaminK:        { m: [  60,    75,   120,   120,   120,   120],
                       f: [  60,    75,    90,    90,    90,    90] },
    thiamin:         { m: [ 0.9,   1.2,   1.2,   1.2,   1.2,   1.2],
                       f: [ 0.9,   1.0,   1.1,   1.1,   1.1,   1.1] },
    riboflavin:      { m: [ 0.9,   1.3,   1.3,   1.3,   1.3,   1.3],
                       f: [ 0.9,   1.0,   1.1,   1.1,   1.1,   1.1] },
    niacin:          { m: [  12,    16,    16,    16,    16,    16],
                       f: [  12,    14,    14,    14,    14,    14] },
    pantothenicAcid: { m: [   4,     5,     5,     5,     5,     5],
                       f: [   4,     5,     5,     5,     5,     5] },
    vitaminB6:       { m: [ 1.0,   1.3,   1.3,   1.3,   1.7,   1.7],
                       f: [ 1.0,   1.2,   1.3,   1.3,   1.5,   1.5] },
    biotin:          { m: [  20,    25,    30,    30,    30,    30],
                       f: [  20,    25,    30,    30,    30,    30] },
    folate:          { m: [ 300,   400,   400,   400,   400,   400],
                       f: [ 300,   400,   400,   400,   400,   400] },
    vitaminB12:      { m: [ 1.8,   2.4,   2.4,   2.4,   2.4,   2.4],
                       f: [ 1.8,   2.4,   2.4,   2.4,   2.4,   2.4] },
    choline:         { m: [ 375,   550,   550,   550,   550,   550],
                       f: [ 375,   400,   425,   425,   425,   425] },

    calcium:         { m: [1300,  1300,  1000,  1000,  1000,  1200],
                       f: [1300,  1300,  1000,  1000,  1200,  1200] },
    iron:            { m: [   8,    11,     8,     8,     8,     8],
                       f: [   8,    15,    18,    18,     8,     8] },
    magnesium:       { m: [ 240,   410,   400,   420,   420,   420],
                       f: [ 240,   360,   310,   320,   320,   320] },
    phosphorus:      { m: [1250,  1250,   700,   700,   700,   700],
                       f: [1250,  1250,   700,   700,   700,   700] },
    potassium:       { m: [2500,  3000,  3400,  3400,  3400,  3400],
                       f: [2300,  2300,  2600,  2600,  2600,  2600] },
    sodium:          { m: [1800,  2300,  2300,  2300,  2300,  2300],
                       f: [1800,  2300,  2300,  2300,  2300,  2300] },
    zinc:            { m: [   8,    11,    11,    11,    11,    11],
                       f: [   8,     9,     8,     8,     8,     8] },
    copper:          { m: [ 700,   890,   900,   900,   900,   900],
                       f: [ 700,   890,   900,   900,   900,   900] },
    manganese:       { m: [ 1.9,   2.2,   2.3,   2.3,   2.3,   2.3],
                       f: [ 1.6,   1.6,   1.8,   1.8,   1.8,   1.8] },
    selenium:        { m: [  40,    55,    55,    55,    55,    55],
                       f: [  40,    55,    55,    55,    55,    55] },
    iodine:          { m: [ 120,   150,   150,   150,   150,   150],
                       f: [ 120,   150,   150,   150,   150,   150] },
    omega3:          { m: [ 1.2,   1.6,   1.6,   1.6,   1.6,   1.6],
                       f: [ 1.0,   1.1,   1.1,   1.1,   1.1,   1.1] }
  };

  // Pregnancy / lactation deltas applied on top of the female column.
  // Absolute overrides, not multipliers.
  var PREG = {
    pregnant: { vitaminA: 770, vitaminC: 85, vitaminK: 90, thiamin: 1.4,
      riboflavin: 1.4, niacin: 18, pantothenicAcid: 6, vitaminB6: 1.9,
      biotin: 30, folate: 600, vitaminB12: 2.6, choline: 450, iron: 27,
      magnesium: 350, zinc: 11, copper: 1000, selenium: 60, iodine: 220,
      omega3: 1.4 },
    lactating: { vitaminA: 1300, vitaminC: 120, vitaminE: 19, thiamin: 1.4,
      riboflavin: 1.6, niacin: 17, pantothenicAcid: 7, vitaminB6: 2.0,
      biotin: 35, folate: 500, vitaminB12: 2.8, choline: 550, iron: 9,
      zinc: 12, copper: 1300, selenium: 70, iodine: 290, omega3: 1.3 }
  };

  // Tolerable Upper Intake Levels (adult). Used only to warn; several of these
  // apply to supplemental forms, so the UI wording stays soft.
  var UL = {
    vitaminA: 3000, vitaminC: 2000, vitaminD: 100, vitaminE: 1000,
    niacin: 35, vitaminB6: 100, folate: 1000, choline: 3500,
    calcium: 2500, iron: 45, magnesium: 350, phosphorus: 4000,
    zinc: 40, copper: 10000, manganese: 11, selenium: 400, iodine: 1100
  };
  // These ULs apply only to supplemental or fortified forms (magnesium as a
  // laxative salt, nicotinic acid, folic acid, alpha-tocopherol), so a high
  // reading from whole food is not a concern — the UI notes it without
  // raising a warning. Vitamin A is deliberately NOT here: its UL covers
  // preformed retinol from food, and a single serving of liver clears it.
  var UL_SUPPLEMENTAL_ONLY = { magnesium: true, niacin: true, folate: true,
    vitaminE: true };

  function driFor(sex, age, state) {
    var col = sex === 'female' ? 'f' : 'm';
    var i = bandIndex(age);
    var out = {};
    Object.keys(DRI).forEach(function (k) { out[k] = DRI[k][col][i]; });
    if (sex === 'female' && state && PREG[state]) {
      var o = PREG[state];
      Object.keys(o).forEach(function (k) { out[k] = o[k]; });
    }
    return out;
  }

  NL.nutrients = {
    list: NUTRIENTS, byKey: BY_KEY, headline: HEADLINE,
    bands: BANDS, bandIndex: bandIndex, driFor: driFor, UL: UL,
    ulSupplementalOnly: UL_SUPPLEMENTAL_ONLY,
    keys: NUTRIENTS.map(function (n) { return n.key; })
  };
})(window.NL = window.NL || {});
