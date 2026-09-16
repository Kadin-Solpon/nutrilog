/* units.js — quantity parsing and conversion to grams.
   Everything in the log is normalised to grams so that nutrient math is a
   single multiply against per-100 g values. Volume units need a density; each
   food may carry one (g/ml) and we fall back to water (1.0) with a UI note. */
(function (NL) {
  'use strict';

  var MASS = {            // -> grams
    g: 1, gram: 1, grams: 1,
    kg: 1000, kilogram: 1000,
    mg: 0.001,
    oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125,
    lb: 453.59237, lbs: 453.59237, pound: 453.59237
  };

  var VOLUME = {          // -> millilitres
    ml: 1, milliliter: 1, millilitre: 1,
    l: 1000, liter: 1000, litre: 1000,
    tsp: 4.92892159375, teaspoon: 4.92892159375,
    tbsp: 14.78676478125, tablespoon: 14.78676478125,
    'fl oz': 29.5735295625, floz: 29.5735295625,
    cup: 240, cups: 240,           // 240 ml = the US nutrition-labelling cup
    pint: 473.176473, pt: 473.176473,
    quart: 946.352946, qt: 946.352946,
    gallon: 3785.411784, gal: 3785.411784
  };

  // Units offered in the picker, in the order they appear.
  var PICKER = [
    { id: 'g', label: 'g', kind: 'mass' },
    { id: 'oz', label: 'oz', kind: 'mass' },
    { id: 'lb', label: 'lb', kind: 'mass' },
    { id: 'kg', label: 'kg', kind: 'mass' },
    { id: 'ml', label: 'ml', kind: 'volume' },
    { id: 'l', label: 'L', kind: 'volume' },
    { id: 'fl oz', label: 'fl oz', kind: 'volume' },
    { id: 'cup', label: 'cup', kind: 'volume' },
    { id: 'tbsp', label: 'tbsp', kind: 'volume' },
    { id: 'tsp', label: 'tsp', kind: 'volume' }
  ];

  function kindOf(unit) {
    if (!unit) return null;
    var u = String(unit).toLowerCase().trim();
    if (MASS[u] != null) return 'mass';
    if (VOLUME[u] != null) return 'volume';
    return 'serving';                 // food-defined portion, e.g. "1 slice"
  }

  var VULGAR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
    '⅕': 0.2, '⅙': 1 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

  /* Accepts "1.5", "1 1/2", "3/4", "1½". Returns null when unparseable. */
  function parseQuantity(input) {
    if (typeof input === 'number') return isFinite(input) ? input : null;
    if (input == null) return null;
    var s = String(input).trim();
    if (!s) return null;
    var total = 0, matched = false;
    // pull off any vulgar fraction characters first
    s = s.replace(/[½⅓⅔¼¾⅕⅙⅛⅜⅝⅞]/g, function (ch) {
      total += VULGAR[ch]; matched = true; return ' ';
    });
    s.trim().split(/\s+/).forEach(function (part) {
      if (!part) return;
      var frac = part.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (frac) {
        var den = parseFloat(frac[2]);
        if (den) { total += parseFloat(frac[1]) / den; matched = true; }
        return;
      }
      var num = parseFloat(part.replace(',', '.'));
      if (!isNaN(num)) { total += num; matched = true; }
    });
    if (!matched || !isFinite(total) || total < 0) return null;
    return total;
  }

  /* Convert a quantity+unit to grams.
     `food` supplies density (g/ml) and named servings when needed.
     Returns { grams, assumedDensity } — assumedDensity is true when we had to
     fall back to 1 g/ml, which the UI surfaces as a caveat. */
  function toGrams(qty, unit, food) {
    var n = parseQuantity(qty);
    if (n == null) return null;
    var u = String(unit || 'g').toLowerCase().trim();

    if (MASS[u] != null) return { grams: n * MASS[u], assumedDensity: false };

    if (VOLUME[u] != null) {
      var ml = n * VOLUME[u];
      var d = food && food.density;
      return { grams: ml * (d || 1), assumedDensity: !d };
    }

    // Named serving defined by the food itself ("slice", "medium", "serving").
    var servings = (food && food.servings) || [];
    for (var i = 0; i < servings.length; i++) {
      if (String(servings[i].id).toLowerCase() === u ||
          String(servings[i].label).toLowerCase() === u) {
        return { grams: n * servings[i].grams, assumedDensity: false };
      }
    }
    return null;
  }

  /* Units to offer for a given food: its own servings first, then mass,
     then volume only when we can convert it meaningfully. */
  function unitsFor(food) {
    var out = [];
    ((food && food.servings) || []).forEach(function (s) {
      out.push({ id: s.id, label: s.label, kind: 'serving', grams: s.grams });
    });
    PICKER.forEach(function (p) {
      if (p.kind === 'volume' && !(food && food.density) && !isLiquid(food)) return;
      out.push(p);
    });
    return out;
  }

  function isLiquid(food) {
    return !!(food && food.liquid);
  }

  function formatGrams(g) {
    if (g == null) return '';
    if (g >= 100) return Math.round(g) + ' g';
    if (g >= 10) return (Math.round(g * 10) / 10) + ' g';
    return (Math.round(g * 100) / 100) + ' g';
  }

  NL.units = {
    parseQuantity: parseQuantity, toGrams: toGrams, unitsFor: unitsFor,
    kindOf: kindOf, formatGrams: formatGrams, picker: PICKER,
    MASS: MASS, VOLUME: VOLUME
  };
})(window.NL = window.NL || {});
