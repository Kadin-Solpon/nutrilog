/* goals.js — turns the profile into a full set of daily targets.
   Energy: Mifflin-St Jeor (or Katch-McArdle when body fat % is known), times an
   activity factor. Macros are derived from the calorie goal; vitamins and
   minerals come from the DRI tables in nutrients.js. Any target the user types
   in manually wins over all of it. */
(function (NL) {
  'use strict';

  var ACTIVITY = [
    { id: 1.2,   label: 'Sedentary',        hint: 'desk job, little exercise' },
    { id: 1.375, label: 'Lightly active',   hint: 'light exercise 1–3 days/wk' },
    { id: 1.55,  label: 'Moderately active',hint: 'exercise 3–5 days/wk' },
    { id: 1.725, label: 'Very active',      hint: 'hard exercise 6–7 days/wk' },
    { id: 1.9,   label: 'Athlete',          hint: 'twice-daily training, physical job' }
  ];

  var GOAL_TYPES = [
    { id: 'lose',     label: 'Lose weight' },
    { id: 'maintain', label: 'Maintain' },
    { id: 'gain',     label: 'Gain weight' }
  ];

  var lbToKg = function (lb) { return lb * 0.45359237; };
  var kgToLb = function (kg) { return kg / 0.45359237; };
  var inToCm = function (i) { return i * 2.54; };
  var cmToIn = function (c) { return c / 2.54; };

  function bmr(p) {
    if (!p.weightKg || !p.heightCm || !p.age || !p.sex) return null;
    if (p.bodyFat != null && p.bodyFat > 0 && p.bodyFat < 70) {
      var lean = p.weightKg * (1 - p.bodyFat / 100);   // Katch-McArdle
      return 370 + 21.6 * lean;
    }
    var base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
    return p.sex === 'female' ? base - 161 : base + 5;
  }

  function tdee(p) {
    var b = bmr(p);
    return b == null ? null : b * (p.activity || 1.375);
  }

  /* Calorie goal, plus a flag when we had to clamp it to a safe floor. */
  function calorieGoal(p) {
    var t = tdee(p);
    if (t == null) return { value: null, floored: false, tdee: null };
    var delta = 0;
    var rate = p.rate == null ? 0.5 : p.rate;          // lb per week
    if (p.goal === 'lose') delta = -rate * 500;
    if (p.goal === 'gain') delta = rate * 500;
    var target = t + delta;
    var floor = p.sex === 'female' ? 1200 : 1500;
    var floored = false;
    if (target < floor) { target = floor; floored = true; }
    return { value: Math.round(target), floored: floored, tdee: Math.round(t),
      bmr: Math.round(bmr(p)), delta: Math.round(delta) };
  }

  function bmi(p) {
    if (!p.weightKg || !p.heightCm) return null;
    var m = p.heightCm / 100;
    return p.weightKg / (m * m);
  }

  function bmiLabel(v) {
    if (v == null) return '';
    if (v < 18.5) return 'underweight';
    if (v < 25) return 'healthy range';
    if (v < 30) return 'overweight';
    return 'obese';
  }

  /* Protein per kg of bodyweight, biased up when cutting to protect lean mass
     and up when bulking to support growth. */
  function proteinPerKg(p) {
    if (p.goal === 'lose') return 2.0;
    if (p.goal === 'gain') return 1.8;
    return 1.6;
  }

  /* Full target set: { key: {value, dir, source, note} }.
     source is 'manual' | 'energy' (derived from calories) | 'dri' | 'advisory'. */
  function targets() {
    var p = NL.store.profile();
    var manual = NL.store.goalConfig().manual || {};
    var out = {};
    var N = NL.nutrients;

    var cal = calorieGoal(p);
    var kcal = manual.calories != null ? manual.calories : cal.value;

    function set(key, value, source, note) {
      var meta = N.byKey[key];
      if (!meta) return;
      if (manual[key] != null) { value = manual[key]; source = 'manual'; note = null; }
      out[key] = {
        value: value == null ? null : value,
        dir: meta.dir, unit: meta.unit, label: meta.label,
        source: source, note: note || null
      };
    }

    set('calories', kcal, cal.value == null ? 'none' : 'energy',
      cal.floored ? 'Raised to a ' + (p.sex === 'female' ? '1200' : '1500') +
        ' kcal floor — the deficit you picked is steeper than is safe.' : null);

    if (kcal != null) {
      var protG = p.weightKg
        ? Math.round(p.weightKg * proteinPerKg(p))
        : Math.round(kcal * 0.20 / 4);
      set('protein', protG, 'energy',
        p.weightKg ? proteinPerKg(p).toFixed(1) + ' g per kg bodyweight' :
          '20% of calories — add your weight for a better figure');

      var fatG = Math.round(kcal * 0.275 / 9);
      if (p.weightKg) fatG = Math.max(fatG, Math.round(p.weightKg * 0.5));
      set('fat', fatG, 'energy', '27.5% of calories');

      var carbKcal = kcal - (manual.protein != null ? manual.protein : protG) * 4
                          - (manual.fat != null ? manual.fat : fatG) * 9;
      set('carbs', Math.max(0, Math.round(carbKcal / 4)), 'energy',
        'whatever calories are left after protein and fat');

      set('fiber', Math.round(kcal / 1000 * 14), 'dri', '14 g per 1000 kcal (DRI)');
      set('satFat', Math.round(kcal * 0.10 / 9), 'advisory', 'under 10% of calories');
      set('addedSugar', Math.round(kcal * 0.10 / 4), 'advisory', 'under 10% of calories');
    } else {
      ['protein', 'fat', 'carbs', 'fiber', 'satFat', 'addedSugar']
        .forEach(function (k) { set(k, null, 'none'); });
    }

    set('transFat', 0, 'advisory', 'as little as possible');
    set('cholesterol', 300, 'advisory', 'common advisory ceiling; not a DRI');

    var dri = N.driFor(p.sex, p.age, p.state);
    Object.keys(dri).forEach(function (k) {
      if (out[k]) return;                       // already set from calories
      set(k, dri[k], 'dri');
    });
    set('sodium', dri.sodium, 'dri', 'chronic-disease risk-reduction level');

    // Nutrients with no target at all — still shown, just untargeted.
    N.list.forEach(function (m) { if (!out[m.key]) set(m.key, null, 'none'); });

    return { targets: out, energy: cal, bmi: bmi(p), bmiLabel: bmiLabel(bmi(p)) };
  }

  /* Profile fields still needed before targets mean anything. */
  function missingProfile() {
    var p = NL.store.profile(), need = [];
    if (!p.sex) need.push('sex');
    if (!p.age) need.push('age');
    if (!p.heightCm) need.push('height');
    if (!p.weightKg) need.push('weight');
    return need;
  }

  NL.goals = {
    ACTIVITY: ACTIVITY, GOAL_TYPES: GOAL_TYPES, bmr: bmr, tdee: tdee,
    calorieGoal: calorieGoal, bmi: bmi, bmiLabel: bmiLabel, targets: targets,
    missingProfile: missingProfile,
    lbToKg: lbToKg, kgToLb: kgToLb, inToCm: inToCm, cmToIn: cmToIn
  };
})(window.NL = window.NL || {});
