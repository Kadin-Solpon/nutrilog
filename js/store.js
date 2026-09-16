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
        if (compact() > 0) flush();      // shrink a log from an older build
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
      // Almost certainly the quota. Shed the rebuildable caches first.
      data.barcodeCache = {};
      data.recent = (data.recent || []).slice(0, 10);
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e2) {
        alert('This device is out of storage for the app, so the last change ' +
          'was not saved. Open Goals \u2192 Settings & data \u2192 Export my ' +
          'data to keep a copy, then delete some older days.');
      }
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

  /* -------------------------------------------------------- entry slimming
     A built-in food's nutrient table ships with the app and is identical on
     every install, so snapshotting all 33 values onto each entry costs about
     1.6 kB a time — roughly 3.5 MB a year of daily logging, which overruns
     Safari's ~5 MB per-origin localStorage budget inside a year. Built-in
     entries therefore store just the reference plus a four-value fallback
     (used only if a later version drops the food), and are rehydrated from the
     table on read. Open Food Facts and custom foods still snapshot in full:
     that data can change or disappear, so history has to own a copy. */
  // Everything here is recoverable from foodId, so it is not written to disk.
  var DERIVED_KEYS = ['per100', 'servings', 'density', 'liquid', 'name',
    'brand', 'barcode', 'unitLabel', 'group'];

  function isSlim(entry) { return !entry.per100 && entry.kc !== undefined; }

  function slim(entry) {
    if (isSlim(entry)) return entry;                 // already compacted
    if (entry.source !== 'builtin') return entry;
    if (!NL.foods.byId(entry.foodId)) return entry;  // unknown: keep the copy

    var out = {};
    Object.keys(entry).forEach(function (k) {
      if (DERIVED_KEYS.indexOf(k) < 0) out[k] = entry[k];
    });
    // Single safety value, for the case where a later build drops the food:
    // the day's calorie total is the number worth protecting.
    out.kc = (entry.per100 && entry.per100.calories != null)
      ? entry.per100.calories : 0;
    return out;
  }

  function unitLabelFor(food, unitId) {
    var list = NL.units.unitsFor(food);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === unitId) return list[i].label;
    }
    return unitId;
  }

  function hydrate(entry) {
    if (!isSlim(entry)) return entry;
    var f = NL.foods.byId(entry.foodId);
    var out = {};
    Object.keys(entry).forEach(function (k) { if (k !== 'kc') out[k] = entry[k]; });
    if (f) {
      out.per100 = f.per100;
      out.servings = f.servings;
      out.density = f.density;
      out.liquid = f.liquid;
      out.name = f.name;
      out.brand = f.brand || '';
      out.group = f.group;
      out.unitLabel = unitLabelFor(f, entry.unit);
    } else {
      // Gone from a newer build. Keep the calories so the day still adds up,
      // and say plainly that the detail is missing rather than inventing it.
      out.per100 = { calories: entry.kc || 0 };
      out.servings = [];
      out.density = null;
      out.liquid = false;
      out.name = 'Food no longer in the app';
      out.brand = '';
      out.unitLabel = entry.unit;
      out.orphan = true;
    }
    return out;
  }

  /* One-time pass so a log written by an earlier build shrinks too. */
  function compact() {
    var saved = 0;
    Object.keys(data.days).forEach(function (k) {
      data.days[k] = data.days[k].map(function (e) {
        var before = JSON.stringify(e).length;
        var after = slim(e);
        saved += before - JSON.stringify(after).length;
        return after;
      });
    });
    data.recent = (data.recent || []).map(slim);
    return saved;
  }

  function usage() {
    var bytes = JSON.stringify(data).length;
    return { bytes: bytes, days: Object.keys(data.days).length,
      entries: Object.keys(data.days).reduce(function (n, k) {
        return n + data.days[k].length;
      }, 0) };
  }

  /* ------------------------------------------------------------ entries */
  function getDay(key) { return (data.days[key] || []).map(hydrate); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addEntry(dayKey, entry) {
    if (!data.days[dayKey]) data.days[dayKey] = [];
    entry.id = entry.id || uid();
    entry.ts = entry.ts || Date.now();
    data.days[dayKey].push(slim(entry));
    pushRecent(entry);
    save();
    return entry;
  }

  function updateEntry(dayKey, id, patch) {
    var list = data.days[dayKey] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        var merged = hydrate(list[i]);
        Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
        list[i] = slim(merged);
        save();
        return merged;
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
    var e = removeEntry(fromKey, id);   // already slim; addEntry leaves it be
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
    data.recent.unshift(slim(ref));
    if (data.recent.length > 40) data.recent.length = 40;
  }

  function recents() { return (data.recent || []).map(hydrate); }

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
    exportJSON: exportJSON, importJSON: importJSON, wipe: wipe, uid: uid,
    usage: usage, compact: compact, hydrate: hydrate
  };
})(window.NL = window.NL || {});
