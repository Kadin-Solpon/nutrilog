/* off.js — Open Food Facts client (free, no API key, CORS-enabled).
   OFF stores each nutrient per 100 g in whatever unit the label used, with the
   unit in a sibling `<key>_unit` field, so every value goes through unit
   normalisation before it reaches the rest of the app. */
(function (NL) {
  'use strict';

  var BASE = 'https://world.openfoodfacts.org';

  // OFF nutriment key -> our key. Order matters for the aliases below.
  var MAP = {
    'energy-kcal': 'calories', proteins: 'protein', carbohydrates: 'carbs',
    fiber: 'fiber', sugars: 'sugar', 'added-sugars': 'addedSugar',
    fat: 'fat', 'saturated-fat': 'satFat', 'monounsaturated-fat': 'monoFat',
    'polyunsaturated-fat': 'polyFat', 'trans-fat': 'transFat',
    'omega-3-fat': 'omega3', cholesterol: 'cholesterol', sodium: 'sodium',
    potassium: 'potassium', calcium: 'calcium', iron: 'iron',
    magnesium: 'magnesium', phosphorus: 'phosphorus', zinc: 'zinc',
    copper: 'copper', manganese: 'manganese', selenium: 'selenium',
    iodine: 'iodine',
    'vitamin-a': 'vitaminA', 'vitamin-c': 'vitaminC', 'vitamin-d': 'vitaminD',
    'vitamin-e': 'vitaminE', 'vitamin-k': 'vitaminK',
    'vitamin-b1': 'thiamin', 'vitamin-b2': 'riboflavin',
    'vitamin-pp': 'niacin', 'pantothenic-acid': 'pantothenicAcid',
    'vitamin-b6': 'vitaminB6', biotin: 'biotin',
    'vitamin-b9': 'folate', folates: 'folate', 'vitamin-b12': 'vitaminB12',
    choline: 'choline', caffeine: 'caffeine', alcohol: 'alcohol'
  };

  // IU is label-dependent, so it needs a per-nutrient conversion.
  var IU_TO_CANON = {
    vitaminA: 0.3,      // IU retinol -> mcg RAE
    vitaminD: 0.025,    // IU -> mcg
    vitaminE: 0.67      // IU (natural d-alpha) -> mg
  };

  var TO_GRAMS = { g: 1, gram: 1, mg: 1e-3, mcg: 1e-6, 'µg': 1e-6, ug: 1e-6,
    kg: 1000, cl: 10, ml: 1, l: 1000 };

  /* Nothing in 100 g of food can weigh more than 100 g. A value past that
     means the unit was misread, so it is dropped rather than trusted — an
     inflated micronutrient would otherwise trip a false "above upper limit". */
  function plausible(key, value) {
    if (value < 0) return false;
    var unit = canonUnit(key);
    if (unit === 'kcal') return value <= 1000;        // pure fat is ~900
    var grams = unit === 'g' ? value
      : unit === 'mg' ? value / 1e3 : value / 1e6;
    return grams <= 100;
  }

  function canonUnit(key) {
    var m = NL.nutrients.byKey[key];
    return m ? m.unit : 'g';
  }

  /* Normalise one OFF value into our canonical unit. Returns null when the
     unit is something we cannot trust (e.g. "% of daily value"). */
  function normalise(key, value, unit) {
    if (value === null || value === undefined || value === '') return null;
    var v = parseFloat(value);
    if (!isFinite(v)) return null;
    var target = canonUnit(key);
    var u = String(unit || '').toLowerCase().trim();

    if (target === 'kcal') {
      if (u === 'kj') return v / 4.184;
      return v;                                  // already kcal
    }
    if (!u) u = target === 'g' ? 'g' : target;    // OFF omits unit for grams
    if (u === '%' || u === 'dv' || u === '% dv') return null;

    if (u === 'iu') {
      var f = IU_TO_CANON[key];
      return f == null ? null : v * f;
    }

    var grams = TO_GRAMS[u];
    if (grams == null) return null;
    var inGrams = v * grams;
    if (target === 'g') return inGrams;
    if (target === 'mg') return inGrams * 1e3;
    if (target === 'mcg') return inGrams * 1e6;
    return null;
  }

  function per100From(nutriments) {
    var nut = nutriments || {};
    var out = {};

    Object.keys(MAP).forEach(function (offKey) {
      var ourKey = MAP[offKey];
      if (out[ourKey] != null) return;                 // first alias wins
      // Only the _100g field. The bare `nutriments.<key>` is the value as the
      // contributor entered it, which may be per serving — using it as a
      // per-100 g figure would silently inflate or deflate everything.
      var val = normalise(ourKey, nut[offKey + '_100g'], nut[offKey + '_unit']);
      if (val != null && plausible(ourKey, val)) out[ourKey] = val;
    });

    // Energy fallbacks: some products only carry kJ, or only the generic field.
    if (out.calories == null) {
      if (nut['energy-kj_100g'] != null) {
        out.calories = parseFloat(nut['energy-kj_100g']) / 4.184;
      } else if (nut.energy_100g != null) {
        var eu = String(nut.energy_unit || 'kj').toLowerCase();
        out.calories = eu === 'kcal' ? parseFloat(nut.energy_100g)
                                     : parseFloat(nut.energy_100g) / 4.184;
      }
    }
    // Labels outside the US give salt, not sodium.
    if (out.sodium == null && nut.salt_100g != null) {
      var salt = normalise('sodium', nut.salt_100g, nut.salt_unit);
      if (salt != null) out.sodium = salt / 2.5;
    }
    if (out.calories != null) out.calories = Math.round(out.calories * 10) / 10;
    return out;
  }

  /* Pull named servings out of OFF's free-text serving_size.
     The label stays the bare word "serving" — the UI appends the gram figure
     itself, and OFF's serving_size text usually already carries one, so
     folding it in here produced "serving (28 g) (28 g)". The descriptive text
     is surfaced separately as servingNote. */
  function servingsFrom(p) {
    var out = [];
    var grams = parseFloat(p.serving_quantity);
    if (isFinite(grams) && grams > 0) {
      out.push({ id: 'serving', grams: grams, label: 'serving' });
    }
    var pkg = parseFloat(p.product_quantity);
    if (isFinite(pkg) && pkg > 0 && pkg < 5000 && pkg !== grams) {
      out.push({ id: 'package', label: 'whole package', grams: pkg });
    }
    return out;
  }

  function isLiquid(p) {
    var u = String(p.product_quantity_unit || p.quantity || '').toLowerCase();
    return /ml|cl|\bl\b|litre|liter|fl oz/.test(u);
  }

  function toFood(p) {
    if (!p) return null;
    var name = (p.product_name || p.product_name_en || p.generic_name || '').trim();
    if (!name) name = 'Unnamed product';
    var per100 = per100From(p.nutriments);
    return {
      id: 'o:' + (p.code || NL.store.uid()),
      name: name,
      brand: (p.brands || '').split(',')[0].trim(),
      group: 'Packaged',
      source: 'off',
      barcode: p.code || '',
      image: p.image_front_small_url || p.image_small_url || null,
      density: isLiquid(p) ? 1 : null,
      liquid: isLiquid(p),
      servings: servingsFrom(p),
      servingNote: (p.serving_size || '').trim(),
      per100: per100,
      hasEnergy: per100.calories != null
    };
  }

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 12000) : null;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error('Open Food Facts returned ' + r.status);
        return r.json();
      })
      .then(function (j) { if (timer) clearTimeout(timer); return j; })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e.name === 'AbortError'
          ? new Error('Open Food Facts timed out.') : e;
      });
  }

  var FIELDS = ['code', 'product_name', 'product_name_en', 'generic_name',
    'brands', 'quantity', 'serving_size', 'serving_quantity',
    'product_quantity', 'product_quantity_unit', 'nutriments',
    'image_front_small_url', 'image_small_url'].join(',');

  function byBarcode(code) {
    var cached = NL.store.cachedBarcode(code);
    var url = BASE + '/api/v2/product/' + encodeURIComponent(code) +
      '.json?fields=' + FIELDS;
    return fetchJSON(url).then(function (j) {
      if (j.status !== 1 || !j.product) {
        var err = new Error('notfound');
        err.code = 'notfound';
        throw err;
      }
      var food = toFood(j.product);
      NL.store.cacheBarcode(code, food);
      return food;
    }).catch(function (e) {
      if (cached && e.code !== 'notfound') return cached;   // offline fallback
      throw e;
    });
  }

  function search(query, page) {
    var url = BASE + '/cgi/search.pl?search_terms=' +
      encodeURIComponent(query) +
      '&search_simple=1&action=process&json=1&page_size=25&page=' + (page || 1) +
      '&fields=' + FIELDS;
    return fetchJSON(url, 15000).then(function (j) {
      return (j.products || []).map(toFood).filter(function (f) {
        return f && f.hasEnergy;      // no calories = useless for logging
      });
    });
  }

  NL.off = { byBarcode: byBarcode, search: search, toFood: toFood,
    per100From: per100From, normalise: normalise, plausible: plausible };
})(window.NL = window.NL || {});
