/* store.js — all persistence. Everything lives in localStorage under one key
   so export/import is a single JSON blob. Entries snapshot the food's per-100 g
   nutrients at log time, so editing or losing a food later never rewrites
   history, and the day log works fully offline. */
(function (NL) {
  'use strict';

  var KEY = 'nutrilog.v1';
  var listeners = [];

  function blank() {
    return {
      v: 1,
      profile: {
        sex: null, age: null, heightCm: null, weightKg: null,
        activity: 1.375, goal: 'maintain', rate: 0.5,
        unitSystem: 'imperial', state: 'none', bodyFat: null
      },
      goals: { mode: {}, manual: {} },
      days: {},
      customFoods: [],
      recent: [],
      barcodeCache: {},
      settings: { firstRun: true }
    };
  }

  var data = blank();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        data = merge(blank(), parsed);
      }
    } catch (e) {
      console.warn('Could not read saved data; starting fresh.', e);
    }
    return data;
  }

  function merge(base, over) {
    Object.keys(over || {}).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = merge(base[k], v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    });
    return base;
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 120);          // coalesce rapid edits
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function flush() {
    saveTimer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      // Most likely quota. Drop the barcode cache first, then warn.
      data.barcodeCache = {};
      try { localStorage.setItem(KEY, JSON.stringify(data)); }
      catch (e2) { alert('Storage is full — export your data from Settings.'); }
    }
  }

  function onChange(fn) { listeners.push(fn); }

  /* ------------------------------------------------------------ dates */
  function todayKey() { return dateKey(new Date()); }

  function dateKey(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function parseKey(k) {
    var p = String(k).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function shiftKey(k, days) {
    var d = parseKey(k);
    d.setDate(d.getDate() + days);
    return dateKey(d);
  }

  /* ------------------------------------------------------------ entries */
  function getDay(key) { return data.days[key] || []; }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addEntry(dayKey, entry) {
    if (!data.days[dayKey]) data.days[dayKey] = [];
    entry.id = entry.id || uid();
    entry.ts = entry.ts || Date.now();
    data.days[dayKey].push(entry);
    pushRecent(entry);
    save();
    return entry;
  }

  function updateEntry(dayKey, id, patch) {
    var list = data.days[dayKey] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        Object.keys(patch).forEach(function (k) { list[i][k] = patch[k]; });
        save();
        return list[i];
      }
    }
    return null;
  }

  function removeEntry(dayKey, id) {
    var list = data.days[dayKey] || [];
    var i = list.findIndex(function (e) { return e.id === id; });
    if (i < 0) return null;
    var gone = list.splice(i, 1)[0];
    if (!list.length) delete data.days[dayKey];
    save();
    return gone;
  }

  function moveEntry(fromKey, id, toKey) {
    var e = removeEntry(fromKey, id);
    if (e) addEntry(toKey, e);
    return e;
  }

  /* --------------------------------------------------- recents & foods */
  function pushRecent(entry) {
    var ref = {
      foodId: entry.foodId, source: entry.source, name: entry.name,
      brand: entry.brand || '', barcode: entry.barcode || '',
      per100: entry.per100, servings: entry.servings || [],
      density: entry.density || null, liquid: !!entry.liquid,
      unit: entry.unit, qty: entry.qty
    };
    data.recent = data.recent.filter(function (r) {
      return !(r.foodId === ref.foodId && r.source === ref.source);
    });
    data.recent.unshift(ref);
    if (data.recent.length > 60) data.recent.length = 60;
  }

  function recents() { return data.recent; }

  function customFoods() { return data.customFoods; }

  function saveCustomFood(food) {
    food.id = food.id || ('c:' + uid());
    food.source = 'custom';
    var i = data.customFoods.findIndex(function (f) { return f.id === food.id; });
    if (i >= 0) data.customFoods[i] = food; else data.customFoods.push(food);
    save();
    return food;
  }

  function deleteCustomFood(id) {
    data.customFoods = data.customFoods.filter(function (f) { return f.id !== id; });
    save();
  }

  function cacheBarcode(code, food) {
    data.barcodeCache[code] = food;
    save();
  }

  function cachedBarcode(code) { return data.barcodeCache[code] || null; }

  /* ------------------------------------------------------------- totals
     Returns totals plus honest data coverage: for each nutrient, the share of
     the day's logged mass that came from entries which actually had a value.
     Unknown is never silently counted as zero. */
  function dayTotals(key) {
    var entries = getDay(key);
    var totals = {}, withData = {}, allMass = 0, missing = {};

    NL.nutrients.keys.forEach(function (k) { totals[k] = 0; withData[k] = 0; });

    entries.forEach(function (e) {
      var factor = (e.grams || 0) / 100;
      allMass += e.grams || 0;
      NL.nutrients.keys.forEach(function (k) {
        var v = e.per100 ? e.per100[k] : undefined;
        if (v === null || v === undefined || isNaN(v)) {
          if (!missing[k]) missing[k] = [];
          if (missing[k].indexOf(e.name) < 0) missing[k].push(e.name);
          return;
        }
        totals[k] += v * factor;
        withData[k] += e.grams || 0;
      });
    });

    var coverage = {};
    NL.nutrients.keys.forEach(function (k) {
      coverage[k] = allMass > 0 ? withData[k] / allMass : 1;
    });

    return { totals: totals, coverage: coverage, missing: missing,
      entryCount: entries.length, grams: allMass };
  }

  function loggedDayKeys() {
    return Object.keys(data.days).filter(function (k) {
      return (data.days[k] || []).length > 0;
    }).sort();
  }

  /* ------------------------------------------------------ profile/goals */
  function profile() { return data.profile; }

  function setProfile(patch) {
    Object.keys(patch).forEach(function (k) { data.profile[k] = patch[k]; });
    save();
  }

  function goalConfig() { return data.goals; }

  function setManualGoal(key, value) {
    if (value === null || value === '' || value === undefined) {
      delete data.goals.manual[key];
      delete data.goals.mode[key];
    } else {
      data.goals.manual[key] = value;
      data.goals.mode[key] = 'manual';
    }
    save();
  }

  function settings() { return data.settings; }
  function setSetting(k, v) { data.settings[k] = v; save(); }

  function exportJSON() { return JSON.stringify(data, null, 2); }

  function importJSON(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.days) {
      throw new Error('That file does not look like a NutriLog export.');
    }
    data = merge(blank(), parsed);
    flush();
    return data;
  }

  function wipe() {
    data = blank();
    flush();
  }

  NL.store = {
    load: load, save: save, flush: flush, onChange: onChange, raw: function () { return data; },
    todayKey: todayKey, dateKey: dateKey, parseKey: parseKey, shiftKey: shiftKey,
    getDay: getDay, addEntry: addEntry, updateEntry: updateEntry,
    removeEntry: removeEntry, moveEntry: moveEntry, dayTotals: dayTotals,
    loggedDayKeys: loggedDayKeys, recents: recents,
    customFoods: customFoods, saveCustomFood: saveCustomFood,
    deleteCustomFood: deleteCustomFood,
    cacheBarcode: cacheBarcode, cachedBarcode: cachedBarcode,
    profile: profile, setProfile: setProfile, goalConfig: goalConfig,
    setManualGoal: setManualGoal, settings: settings, setSetting: setSetting,
    exportJSON: exportJSON, importJSON: importJSON, wipe: wipe, uid: uid
  };
})(window.NL = window.NL || {});
