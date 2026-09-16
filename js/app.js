/* app.js — views, rendering and interaction.
   Rendering is deliberately plain: each view returns an HTML string, #app gets
   innerHTML, and clicks are handled by one delegated listener. No framework,
   no build step, nothing to keep in sync. */
(function (NL) {
  'use strict';

  var MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  var app = document.getElementById('app');

  var state = {
    tab: 'today',
    day: null,
    query: '',
    results: null,        // {builtin:[], off:[], loading:bool, error:string}
    sheet: null,
    goalsOpen: {}
  };

  /* -------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function round(v, dp) {
    if (v == null || isNaN(v)) return null;
    var f = Math.pow(10, dp || 0);
    return Math.round(v * f) / f;
  }

  function num(v, dp) {
    var r = round(v, dp);
    if (r == null) return '—';
    return r.toLocaleString(undefined, {
      minimumFractionDigits: 0, maximumFractionDigits: dp || 0
    });
  }

  /* Drop trailing zeros so "1.50 cup" reads as "1.5 cup". */
  function qtyText(q) {
    var n = Number(q);
    if (!isFinite(n)) return String(q);
    return String(Math.round(n * 1000) / 1000);
  }

  /* "80 g · 80 g" is noise, so the gram figure is only appended when the
     logged unit was something other than grams. */
  function portionText(e) {
    var label = e.unitLabel || e.unit;
    var lead = qtyText(e.qty) + ' ' + label;
    if (e.unit === 'g') return lead;
    return lead + ' \u00b7 ' + NL.units.formatGrams(e.grams);
  }

  function pct(value, target) {
    if (!target || target <= 0 || value == null) return null;
    return (value / target) * 100;
  }

  var toastTimer = null;
  function toast(msg) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2600);
  }

  function dayLabel(key) {
    var today = NL.store.todayKey();
    if (key === today) return 'Today';
    if (key === NL.store.shiftKey(today, -1)) return 'Yesterday';
    if (key === NL.store.shiftKey(today, 1)) return 'Tomorrow';
    var d = NL.store.parseKey(key);
    var sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      year: sameYear ? undefined : 'numeric'
    });
  }

  /* ------------------------------------------------------------ meter bits
     One place decides fill colour and status, so Today and Nutrients can
     never disagree about whether something is met or over. */
  function meterState(key, value, target) {
    var meta = NL.nutrients.byKey[key];
    var ul = NL.nutrients.UL[key];
    var p = pct(value, target);
    var out = { pct: p, fill: 'var(--s1)', status: null, statusClass: null };

    if (meta && meta.dir === 'limit') {
      if (p != null && p > 100) {
        out.fill = 'var(--critical)';
        out.status = 'Over limit';
        out.statusClass = 'critical';
      }
      return out;
    }

    if (ul && value != null && value > ul) {
      if (NL.nutrients.ulSupplementalOnly[key]) {
        // Recorded on the row, but it never colours the bar or raises a chip:
        // clearing these limits from whole food is normal and not a concern.
        out.softUL = ul;
      } else {
        var ratio = value / ul;
        out.fill = ratio >= 1.5 ? 'var(--critical)' : 'var(--warning)';
        out.status = ratio >= 1.5 ? 'Well above upper limit' : 'Above upper limit';
        out.statusClass = ratio >= 1.5 ? 'critical' : 'warning';
        return out;
      }
    }

    if (p != null && p >= 100) {
      out.fill = 'var(--good)';
      out.status = 'Met';
      out.statusClass = 'good';
    }
    return out;
  }

  function meterHTML(st, opts) {
    opts = opts || {};
    var w = st.pct == null ? 0 : Math.max(0, Math.min(100, st.pct));
    var cls = 'meter' + (opts.tall ? ' tall' : '');
    return '<div class="' + cls + '" style="--fill:' + st.fill + '"' +
      ' role="img" aria-label="' + esc(opts.aria || '') + '">' +
      '<i class="' + (w >= 100 ? 'full' : '') + '" style="width:' + w.toFixed(1) + '%"></i></div>';
  }

  function chipHTML(st) {
    if (!st.status) return '';
    return '<span class="chip ' + st.statusClass + '"><span class="dot"></span>' +
      esc(st.status) + '</span>';
  }

  /* --------------------------------------------------------- coverage note
     Three tiers, so an honest caveat does not turn into wallpaper: nothing at
     all above 99.9% coverage, a quiet asterisk from 90% to 99.9%, and a full
     "which foods" note below 90% or when no food carries the nutrient. */
  function coverageTier(cov) {
    if (cov == null || cov > 0.999) return 'full';
    if (cov === 0) return 'none';
    return cov >= 0.9 ? 'minor' : 'major';
  }

  function coverageNote(key, cov, missing) {
    var tier = coverageTier(cov);
    if (tier === 'full' || tier === 'minor') return '';
    var names = missing[key] || [];
    if (!names.length) return '';
    var shown = names.slice(0, 2).map(esc).join(', ');
    var more = names.length > 2 ? ' +' + (names.length - 2) + ' more' : '';
    var label = tier === 'none'
      ? 'Nothing you logged today records this nutrient'
      : Math.round((1 - cov) * 100) + '% of what you logged has no value for this';
    return '<div class="nnote">' + esc(label) + ': ' + shown + more + '</div>';
  }

  /* ============================================================== TODAY */
  function viewToday() {
    var key = state.day;
    var res = NL.store.dayTotals(key);
    var g = NL.goals.targets();
    var T = g.targets;
    var t = res.totals;
    var need = NL.goals.missingProfile();

    var html = topbarDate('NutriLog');

    // --- hero: calories left (exactly one hero figure per view)
    var calGoal = T.calories.value;
    var eaten = t.calories;
    html += '<div class="card">';
    if (calGoal) {
      var left = calGoal - eaten;
      var over = left < 0;
      html += '<div class="hero' + (over ? ' over' : '') + '">' +
        '<span class="value">' + num(Math.abs(left), 0) + '</span>' +
        '<span class="unit">kcal</span></div>' +
        '<div class="hero-label">' + (over ? 'over your goal' : 'left today') +
        ' &middot; ' + num(eaten, 0) + ' of ' + num(calGoal, 0) + ' eaten</div>';
      html += meterHTML({ pct: pct(eaten, calGoal), fill: over ? 'var(--critical)' : 'var(--s1)' },
        { tall: true, aria: num(eaten, 0) + ' of ' + num(calGoal, 0) + ' kcal' });
    } else {
      html += '<div class="hero"><span class="value">' + num(eaten, 0) +
        '</span><span class="unit">kcal</span></div>' +
        '<div class="hero-label">eaten today &middot; no calorie goal set yet</div>';
    }

    // --- macro tiles (swatch + label = the legend; values direct-labelled)
    var tileKeys = [
      { key: 'protein', color: 'var(--s1)' },
      { key: 'carbs', color: 'var(--s2)' },
      { key: 'fat', color: 'var(--s3)' }
    ];
    html += '<div class="tiles">';
    tileKeys.forEach(function (tk) {
      var meta = NL.nutrients.byKey[tk.key];
      var tgt = T[tk.key].value;
      var st = meterState(tk.key, t[tk.key], tgt);
      st.fill = st.statusClass === 'good' ? 'var(--good)' : tk.color;
      html += '<div class="tile">' +
        '<div class="tile-label"><span class="swatch" style="background:' + tk.color +
        '"></span>' + esc(meta.label) + '</div>' +
        '<div class="tile-value">' + num(t[tk.key], 0) + '<span class="tile-of"> g</span></div>' +
        '<div class="tile-of">' + (tgt ? 'of ' + num(tgt, 0) + ' g' : 'no target') + '</div>' +
        meterHTML(st, { aria: meta.label + ' ' + num(t[tk.key], 0) + ' of ' + num(tgt, 0) + ' g' }) +
        '</div>';
    });
    html += '</div>';

    // --- fiber gets its own line: asked for by name, and easy to miss
    var fSt = meterState('fiber', t.fiber, T.fiber.value);
    html += '<div style="margin-top:14px">' +
      '<div class="row between"><span class="sub">Fiber</span>' +
      '<span class="sub" style="font-variant-numeric:tabular-nums"><b style="color:var(--text-primary)">' +
      num(t.fiber, 1) + '</b> / ' + (T.fiber.value ? num(T.fiber.value, 0) + ' g' : '— g') +
      '</span></div>' +
      meterHTML(fSt, { aria: 'Fiber ' + num(t.fiber, 1) + ' g' }) + '</div>';
    html += '</div>'; // card

    if (need.length) {
      html += '<div class="card"><div class="notice info"><span class="dot"></span>' +
        '<div>Add your ' + esc(need.join(', ')) +
        ' in the Goals tab and every target on this screen fills in automatically.' +
        '<div style="margin-top:9px"><button class="btn sm" data-act="go-goals">' +
        'Open Goals</button></div></div></div></div>';
    }

    // --- the day's entries, grouped by meal
    html += '<div class="card flush">';
    var entries = NL.store.getDay(key);
    if (!entries.length) {
      html += '<div class="empty-state"><div class="big">\u{1F374}</div>' +
        '<div>Nothing logged ' + (key === NL.store.todayKey() ? 'yet today' : 'for this day') +
        '.</div><div style="margin-top:14px"><button class="btn primary" data-act="go-add">' +
        'Add food</button></div></div>';
    } else {
      MEALS.forEach(function (meal) {
        var list = entries.filter(function (e) { return (e.meal || 'Snacks') === meal; });
        if (!list.length) return;
        var mkcal = list.reduce(function (s, e) {
          return s + (e.per100 && e.per100.calories ? e.per100.calories * e.grams / 100 : 0);
        }, 0);
        html += '<div class="meal-head"><span class="mname">' + meal + '</span>' +
          '<span class="mkcal">' + num(mkcal, 0) + ' kcal</span></div>';
        list.forEach(function (e) {
          var kcal = e.per100 && e.per100.calories != null
            ? e.per100.calories * e.grams / 100 : null;
          html += '<button class="entry" data-act="edit-entry" data-id="' + esc(e.id) + '">' +
            '<span class="grow"><span class="ename truncate" style="display:block">' +
            esc(e.name) + (e.brand ? ' <span class="emeta">' + esc(e.brand) + '</span>' : '') +
            '</span><span class="emeta">' + esc(portionText(e)) + '</span></span>' +
            '<span class="ekcal">' + (kcal == null ? '—' : num(kcal, 0)) + '</span></button>';
        });
      });
      html += '<div style="padding:12px 16px;border-top:1px solid var(--grid)">' +
        '<button class="btn block" data-act="go-add">+ Add food to ' +
        esc(dayLabel(key).toLowerCase()) + '</button></div>';
    }
    html += '</div>';

    // --- shortfalls / excesses worth knowing about
    html += gapsCard(t, T, res);

    // --- 7 days ending on the day in view
    html += weekCard(key, calGoal);

    return html;
  }

  /* A short, honest read-out of what is notably low or over. */
  function gapsCard(t, T, res) {
    if (!res.entryCount) return '';
    var low = [], over = [];
    NL.nutrients.list.forEach(function (m) {
      if (m.group === 'macro' && m.key !== 'fiber') return;
      var tgt = T[m.key] && T[m.key].value;
      if (!tgt) return;
      var p = pct(t[m.key], tgt);
      if (p == null) return;
      if (m.dir === 'limit') {
        if (p > 100) over.push({ m: m, p: p });
      } else if (p < 50 && res.coverage[m.key] > 0.5) {
        // Only claim a shortfall when most of the day's food actually reports
        // the nutrient; otherwise it is missing data, not a real gap.
        low.push({ m: m, p: p });
      }
      var ul = NL.nutrients.UL[m.key];
      if (ul && t[m.key] > ul && m.dir !== 'limit' &&
          !NL.nutrients.ulSupplementalOnly[m.key]) {
        over.push({ m: m, p: p, ul: true });
      }
    });
    low.sort(function (a, b) { return a.p - b.p; });
    if (!low.length && !over.length) return '';

    var html = '<div class="card"><h2>Worth a look</h2><div class="stack">';
    if (over.length) {
      html += '<div class="notice bad"><span class="dot"></span><div>' +
        '<b>Over: </b>' + over.slice(0, 4).map(function (o) {
          return esc(o.m.label) + (o.ul ? ' (upper limit)' : ' (' + Math.round(o.p) + '%)');
        }).join(', ') + '</div></div>';
    }
    if (low.length) {
      html += '<div class="notice warn"><span class="dot"></span><div>' +
        '<b>Under half your target: </b>' + low.slice(0, 5).map(function (o) {
          return esc(o.m.label) + ' (' + Math.round(o.p) + '%)';
        }).join(', ') +
        (low.length > 5 ? ' and ' + (low.length - 5) + ' more' : '') + '</div></div>';
    }
    html += '<button class="btn block sm" data-act="go-nutrients">' +
      'See every nutrient</button></div></div>';
    return html;
  }

  /* 7 columns, single series, so no legend box — the heading names it. */
  function weekCard(key, calGoal) {
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var k = NL.store.shiftKey(key, -i);
      days.push({ key: k, kcal: NL.store.dayTotals(k).totals.calories });
    }
    var maxVal = Math.max.apply(null, days.map(function (d) { return d.kcal; }).concat([0]));
    var scale = Math.max(maxVal, calGoal || 0) * 1.12 || 1;
    var peak = days.reduce(function (a, b) { return b.kcal > a.kcal ? b : a; }, days[0]);

    var html = '<div class="card"><h2>Last 7 days &middot; calories</h2>' +
      '<div class="week">';
    if (calGoal) {
      var top = (1 - calGoal / scale) * 100;
      html += '<div class="goalline" style="top:' + top.toFixed(1) + '%">' +
        '<span>goal ' + num(calGoal, 0) + '</span></div>';
    }
    days.forEach(function (d) {
      var h = d.kcal > 0 ? Math.max(2, (d.kcal / scale) * 100) : 0;
      var isSel = d.key === key;
      var label = (d.kcal > 0 && (d.key === peak.key || isSel)) ? num(d.kcal, 0) : '';
      html += '<button class="col" data-act="pick-day" data-day="' + d.key + '" ' +
        'aria-label="' + esc(dayLabel(d.key)) + ': ' + num(d.kcal, 0) + ' kcal">' +
        (label ? '<span class="muted" style="font-size:10px;margin-bottom:2px">' +
          label + '</span>' : '') +
        '<span class="bar' + (d.kcal > 0 ? '' : ' empty') + '" style="height:' +
        h.toFixed(1) + '%;' + (isSel ? '' : 'opacity:.55') + '"></span></button>';
    });
    html += '</div><div class="week-axis">';
    days.forEach(function (d) {
      var dt = NL.store.parseKey(d.key);
      html += '<span class="' + (d.key === key ? 'is-today' : '') + '">' +
        dt.toLocaleDateString(undefined, { weekday: 'narrow' }) + '<br>' +
        dt.getDate() + '</span>';
    });
    html += '</div><div class="muted" style="margin-top:8px">Tap a day to open it.</div></div>';
    return html;
  }

  function topbarDate(title) {
    var key = state.day;
    var isToday = key === NL.store.todayKey();
    return '<div class="topbar">' +
      '<button class="iconbtn" data-act="day-prev" aria-label="Previous day">&#8249;</button>' +
      '<h1>' + esc(dayLabel(key)) + '</h1>' +
      '<button class="iconbtn" data-act="day-next" aria-label="Next day">&#8250;</button>' +
      '</div>' +
      (isToday ? '' : '<div style="margin:-2px 0 10px"><button class="btn sm block" ' +
        'data-act="day-today">Jump back to today</button></div>');
  }

  /* ================================================================ ADD */
  function viewAdd() {
    var html = '<div class="topbar">' +
      '<button class="iconbtn" data-act="day-prev" aria-label="Previous day">&#8249;</button>' +
      '<h1>Add to ' + esc(dayLabel(state.day)) + '</h1>' +
      '<button class="iconbtn" data-act="day-next" aria-label="Next day">&#8250;</button>' +
      '</div>';

    html += '<div class="card"><div class="row" style="gap:8px">' +
      '<button class="btn primary grow" data-act="scan">' +
      '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M3 7V5.5A2.5 2.5 0 015.5 3H7M17 3h1.5A2.5 2.5 0 0121 5.5V7M21 17v1.5' +
      'a2.5 2.5 0 01-2.5 2.5H17M7 21H5.5A2.5 2.5 0 013 18.5V17M7 8v8M11 8v8M15 8v8"/></svg>' +
      'Scan barcode</button>' +
      '<button class="btn" data-act="type-barcode">Type code</button></div></div>';

    html += '<div class="searchwrap"><input type="search" id="q" ' +
      'placeholder="Search foods (e.g. chicken breast)" autocomplete="off" ' +
      'autocorrect="off" spellcheck="false" enterkeyhint="search" value="' +
      esc(state.query) + '"></div>';

    html += '<div id="results"></div>';
    return html;
  }

  function resultRow(food, act) {
    var kcal = food.per100 && food.per100.calories;
    var badge = food.source === 'off' ? '<span class="badge">scanned db</span>'
      : food.source === 'custom' ? '<span class="badge">mine</span>' : '';
    var meta = [food.brand, food.group].filter(Boolean).join(' &middot; ');
    return '<button class="result" data-act="' + act + '" data-food="' + esc(food.id) + '">' +
      '<span class="grow"><span class="rname truncate" style="display:block">' +
      esc(food.name) + ' ' + badge + '</span>' +
      (meta ? '<span class="rmeta truncate" style="display:block">' + meta + '</span>' : '') +
      '</span><span class="rkcal">' + (kcal == null ? '—' : num(kcal, 0) + ' kcal<br>' +
        '<span class="rmeta">per 100 ' + (food.liquid ? 'ml' : 'g') + '</span>') +
      '</span></button>';
  }

  var offCache = {};   // id -> food, so a tap after search can find it again

  function renderResults() {
    var box = document.getElementById('results');
    if (!box) return;
    var q = state.query.trim();
    var html = '';

    if (q) {
      var local = NL.foods.search(q, 30);
      var mine = NL.store.customFoods().filter(function (f) {
        return f.name.toLowerCase().indexOf(q.toLowerCase()) >= 0;
      });
      var all = mine.concat(local);
      html += '<div class="card flush"><h2>Foods (' + all.length + ')</h2>';
      html += all.length
        ? all.map(function (f) { return resultRow(f, 'pick-food'); }).join('')
        : '<div class="empty-state">No built-in match. Try the packaged-food search below, ' +
          'or create a custom food.</div>';
      html += '</div>';

      var r = state.results;
      html += '<div class="card flush"><h2>Packaged products &middot; Open Food Facts</h2>';
      if (q.length < 3) {
        html += '<div class="empty-state">Type at least three letters to search ' +
          'packaged products — or just scan the barcode.</div>';
      } else if (!r || r.query !== q) {
        html += '<div class="empty-state"><span class="spinner"></span> Searching…</div>';
      } else if (r.error) {
        html += '<div class="empty-state">' + esc(r.error) + '</div>';
      } else if (!r.list.length) {
        html += '<div class="empty-state">Nothing found. Scanning the barcode usually ' +
          'works better than the name.</div>';
      } else {
        r.list.forEach(function (f) { offCache[f.id] = f; });
        html += r.list.map(function (f) { return resultRow(f, 'pick-off'); }).join('');
      }
      html += '</div>';
    } else {
      var rec = NL.store.recents();
      if (rec.length) {
        html += '<div class="card flush"><h2>Recent</h2>' +
          rec.slice(0, 12).map(function (r, i) {
            return '<button class="result" data-act="pick-recent" data-i="' + i + '">' +
              '<span class="grow"><span class="rname truncate" style="display:block">' +
              esc(r.name) + '</span><span class="rmeta">' +
              esc(qtyText(r.qty) + ' ' + r.unit) + (r.brand ? ' &middot; ' + esc(r.brand) : '') +
              '</span></span><span class="rkcal">' +
              (r.per100 && r.per100.calories != null
                ? num(r.per100.calories, 0) + ' kcal<br><span class="rmeta">per 100 g</span>' : '—') +
              '</span></button>';
          }).join('') + '</div>';
      }

      var mine2 = NL.store.customFoods();
      html += '<div class="card flush"><h2>My foods</h2>';
      html += mine2.length
        ? mine2.map(function (f) { return resultRow(f, 'pick-food'); }).join('')
        : '<div class="empty-state">Nothing here yet. Create a food once and it stays ' +
          'available offline forever.</div>';
      html += '<div style="padding:12px 16px;border-top:1px solid var(--grid)">' +
        '<button class="btn block" data-act="new-food">+ Create a custom food</button></div></div>';

      html += '<div class="card"><h2>Browse whole foods</h2><div class="row" ' +
        'style="flex-wrap:wrap;gap:7px">' +
        NL.foods.groups().map(function (gname) {
          return '<button class="btn sm" data-act="browse" data-group="' + esc(gname) + '">' +
            esc(gname) + '</button>';
        }).join('') + '</div></div>';
    }
    box.innerHTML = html;
  }

  var searchTimer = null, offTimer = null;

  function onQuery(value) {
    state.query = value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 120);

    if (offTimer) clearTimeout(offTimer);
    var q = value.trim();
    if (q.length < 3) { state.results = { query: q, list: [], error: null }; return; }
    state.results = null;
    offTimer = setTimeout(function () {
      NL.off.search(q).then(function (list) {
        state.results = { query: q, list: list, error: null };
        if (state.query.trim() === q) renderResults();
      }).catch(function (e) {
        state.results = { query: q, list: [],
          error: 'Could not reach Open Food Facts (' + e.message + '). ' +
            'Built-in foods still work offline.' };
        if (state.query.trim() === q) renderResults();
      });
    }, 550);
  }

  /* ========================================================== NUTRIENTS */
  function viewNutrients() {
    var key = state.day;
    var res = NL.store.dayTotals(key);
    var T = NL.goals.targets().targets;
    var t = res.totals;

    var html = topbarDate();
    html += '<div class="card"><div class="row between">' +
      '<div><div class="sub">Logged</div><div style="font-size:22px;font-weight:650">' +
      num(t.calories, 0) + ' kcal</div></div>' +
      '<div class="center"><div class="sub">Items</div>' +
      '<div style="font-size:22px;font-weight:650">' + res.entryCount + '</div></div>' +
      '<div style="text-align:right"><div class="sub">Total weight</div>' +
      '<div style="font-size:22px;font-weight:650">' + num(res.grams, 0) + ' g</div></div>' +
      '</div></div>';

    if (!res.entryCount) {
      html += '<div class="card"><div class="empty-state">Log something and every ' +
        'nutrient below fills in.<div style="margin-top:14px">' +
        '<button class="btn primary" data-act="go-add">Add food</button></div></div></div>';
      return html;
    }

    var groups = [
      { id: 'macro', title: 'Energy & macronutrients' },
      { id: 'vitamin', title: 'Vitamins' },
      { id: 'mineral', title: 'Minerals' }
    ];

    groups.forEach(function (grp) {
      var body = '', usedStar = false;
      NL.nutrients.list.filter(function (m) { return m.group === grp.id; })
        .forEach(function (m) {
          var cov = res.coverage[m.key];
          var tier = coverageTier(cov);
          // No food logged today carries this nutrient, so there is no number
          // to show. Printing "0" here would be a confident lie.
          var unknown = tier === 'none';
          var value = unknown ? null : t[m.key];
          var tgt = T[m.key] && T[m.key].value;
          var st = meterState(m.key, value, tgt);
          var p = unknown ? null : st.pct;
          if (tier === 'minor') usedStar = true;

          var right = unknown
            ? '<b>\u2014</b> ' + esc(m.unit)
            : '<b>' + num(value, m.dp) + (tier === 'minor' ? '*' : '') + '</b> ' + esc(m.unit);
          if (tgt) {
            right += ' <span style="color:var(--text-muted)">/ ' +
              num(tgt, m.dp) + '</span>';
          }

          var note = '';
          if (st.status) note += '<div class="nnote">' + chipHTML(st) + '</div>';
          if (st.softUL) {
            note += '<div class="nnote">Past the ' + num(st.softUL, m.dp) + ' ' +
              esc(m.unit) + ' upper limit \u2014 but that limit covers supplements ' +
              'and fortified foods, not what you get from food itself.</div>';
          }
          note += coverageNote(m.key, cov, res.missing);

          body += '<div class="nrow">' +
            '<div class="nname">' + esc(m.label) +
            (m.dir === 'limit' && tgt ? ' <span class="badge">limit</span>' : '') + '</div>' +
            '<div class="nval">' + right +
            (p != null ? '<br><span style="color:var(--text-muted)">' +
              Math.round(p) + '%</span>' : '') + '</div>' +
            (tgt && !unknown
              ? meterHTML(st, { aria: m.label + ' ' + num(value, m.dp) + ' of ' +
                num(tgt, m.dp) + ' ' + m.unit })
              : '') +
            note + '</div>';
        });
      html += '<div class="card flush"><h2>' + esc(grp.title) + '</h2>' + body +
        (usedStar
          ? '<div class="nrow"><div class="nnote">* a small part of what you ' +
            'logged has no value recorded for that nutrient, so the real figure ' +
            'is a little higher.</div></div>'
          : '') +
        '</div>';
    });

    html += '<div class="card"><h2>About these numbers</h2><div class="sub">' +
      'Targets come from your Goals tab: energy and macros from your own figures, ' +
      'vitamins and minerals from the US DRI tables for your age and sex. ' +
      '"Incomplete" means a food you logged had no value recorded for that nutrient — ' +
      'it is counted as unknown, never as zero, so a low reading may just be missing data.' +
      '</div></div>';
    return html;
  }

  /* Browsers give a page a few megabytes of local storage. At ~240 bytes an
     entry that is years of logging, but it is finite, so it is shown rather
     than left to fail silently one day. */
  var STORAGE_BUDGET = 5 * 1024 * 1024;

  function storageHTML() {
    var u = NL.store.usage();
    var used = u.bytes / STORAGE_BUDGET;
    var kb = u.bytes < 1024 * 1024
      ? (u.bytes / 1024).toFixed(0) + ' KB'
      : (u.bytes / 1048576).toFixed(2) + ' MB';
    var perDay = u.days > 0 ? u.bytes / u.days : 0;
    var yearsLeft = perDay > 0
      ? (STORAGE_BUDGET - u.bytes) / (perDay * 365) : null;

    var st = { pct: used * 100, fill: used > 0.85 ? 'var(--critical)'
      : used > 0.7 ? 'var(--warning)' : 'var(--s1)' };

    var html = '<div style="margin-top:16px">' +
      '<div class="row between"><span class="sub">Storage used</span>' +
      '<span class="sub" style="font-variant-numeric:tabular-nums">' + kb +
      ' of ~5 MB</span></div>' +
      meterHTML(st, { aria: 'Storage ' + kb + ' of about 5 MB' }) +
      '<div class="muted" style="margin-top:6px">' + u.entries +
      ' item' + (u.entries === 1 ? '' : 's') + ' across ' + u.days + ' day' +
      (u.days === 1 ? '' : 's') +
      (yearsLeft != null && u.days >= 5
        ? ' · about ' + (yearsLeft >= 1 ? Math.round(yearsLeft) + ' more years'
            : Math.round(yearsLeft * 12) + ' more months') + ' at this rate'
        : '') +
      '</div>';

    if (used > 0.7) {
      html += '<div class="notice ' + (used > 0.85 ? 'bad' : 'warn') +
        '" style="margin-top:10px"><span class="dot"></span><div>Storage is ' +
        Math.round(used * 100) + '% full. Export a backup, then erase the ' +
        'oldest days you no longer need.</div></div>';
    }
    return html + '</div>';
  }

  /* ============================================================== GOALS */
  function viewGoals() {
    var p = NL.store.profile();
    var imp = p.unitSystem !== 'metric';
    var g = NL.goals.targets();
    var manual = NL.store.goalConfig().manual;
    var T = g.targets;

    var html = '<div class="topbar"><h1>Goals</h1></div>';

    /* --- about you ------------------------------------------------- */
    html += '<div class="card"><h2>About you</h2>';
    html += '<label class="field"><span>Units</span><div class="segmented">' +
      '<button data-act="units" data-v="imperial" aria-pressed="' + (imp) + '">lb / ft / oz</button>' +
      '<button data-act="units" data-v="metric" aria-pressed="' + (!imp) + '">kg / cm / g</button>' +
      '</div></label>';

    html += '<label class="field"><span>Sex (used to pick the DRI reference values)</span>' +
      '<div class="segmented">' +
      '<button data-act="sex" data-v="male" aria-pressed="' + (p.sex === 'male') + '">Male</button>' +
      '<button data-act="sex" data-v="female" aria-pressed="' + (p.sex === 'female') + '">Female</button>' +
      '</div></label>';

    html += '<div class="qtyrow">' +
      '<label class="field"><span>Age</span><input type="number" inputmode="numeric" ' +
      'min="9" max="120" data-field="age" value="' + (p.age || '') + '" placeholder="years"></label>';

    if (imp) {
      var totalIn = p.heightCm ? NL.goals.cmToIn(p.heightCm) : null;
      var ft = totalIn ? Math.floor(totalIn / 12) : '';
      var inch = totalIn ? Math.round(totalIn - ft * 12) : '';
      html += '<label class="field"><span>Height</span><div class="qtyrow">' +
        '<input type="number" inputmode="numeric" data-field="heightFt" value="' + ft +
        '" placeholder="ft"><input type="number" inputmode="numeric" data-field="heightIn" value="' +
        inch + '" placeholder="in"></div></label>';
    } else {
      html += '<label class="field"><span>Height (cm)</span><input type="number" ' +
        'inputmode="decimal" data-field="heightCm" value="' +
        (p.heightCm ? round(p.heightCm, 1) : '') + '" placeholder="cm"></label>';
    }
    html += '</div>';

    html += '<div class="qtyrow">' +
      '<label class="field"><span>Weight (' + (imp ? 'lb' : 'kg') + ')</span>' +
      '<input type="number" inputmode="decimal" step="0.1" data-field="weight" value="' +
      (p.weightKg ? round(imp ? NL.goals.kgToLb(p.weightKg) : p.weightKg, 1) : '') +
      '" placeholder="' + (imp ? 'lb' : 'kg') + '"></label>' +
      '<label class="field"><span>Body fat % (optional)</span>' +
      '<input type="number" inputmode="decimal" step="0.1" data-field="bodyFat" value="' +
      (p.bodyFat || '') + '" placeholder="skip if unsure"></label></div>';

    html += '<label class="field"><span>Activity level</span><select data-field="activity">' +
      NL.goals.ACTIVITY.map(function (a) {
        return '<option value="' + a.id + '"' + (p.activity == a.id ? ' selected' : '') + '>' +
          esc(a.label) + ' — ' + esc(a.hint) + '</option>';
      }).join('') + '</select></label>';

    if (p.sex === 'female') {
      html += '<label class="field"><span>Pregnancy / breastfeeding</span>' +
        '<select data-field="state">' +
        [['none', 'Neither'], ['pregnant', 'Pregnant'], ['lactating', 'Breastfeeding']]
          .map(function (o) {
            return '<option value="' + o[0] + '"' + (p.state === o[0] ? ' selected' : '') +
              '>' + o[1] + '</option>';
          }).join('') + '</select>' +
        '<span class="muted">Raises several vitamin and mineral targets, per the DRI tables.</span>' +
        '</label>';
    }
    html += '</div>';

    /* --- weight goal ---------------------------------------------- */
    html += '<div class="card"><h2>Weight goal</h2>' +
      '<div class="segmented" style="margin-bottom:12px">' +
      NL.goals.GOAL_TYPES.map(function (t) {
        return '<button data-act="goaltype" data-v="' + t.id + '" aria-pressed="' +
          (p.goal === t.id) + '">' + esc(t.label) + '</button>';
      }).join('') + '</div>';

    if (p.goal !== 'maintain') {
      var word = p.goal === 'lose' ? 'lose' : 'gain';
      html += '<label class="field"><span>Rate</span><select data-field="rate">' +
        [0.25, 0.5, 0.75, 1].map(function (r) {
          var shown = imp ? r + ' lb' : round(NL.goals.lbToKg(r), 2) + ' kg';
          return '<option value="' + r + '"' + (p.rate == r ? ' selected' : '') + '>' +
            word + ' ' + shown + ' per week</option>';
        }).join('') + '</select></label>';
    }

    var e = g.energy;
    if (e.value == null) {
      html += '<div class="notice info"><span class="dot"></span><div>Fill in sex, age, ' +
        'height and weight above and your calorie target appears here.</div></div>';
    } else {
      html += '<div class="row between" style="margin-bottom:6px">' +
        '<span class="sub">Resting burn (BMR)</span><span style="font-variant-numeric:tabular-nums">' +
        num(e.bmr, 0) + ' kcal</span></div>' +
        '<div class="row between" style="margin-bottom:6px">' +
        '<span class="sub">With activity (TDEE)</span>' +
        '<span style="font-variant-numeric:tabular-nums">' + num(e.tdee, 0) + ' kcal</span></div>' +
        '<div class="row between" style="margin-bottom:6px">' +
        '<span class="sub">Goal adjustment</span>' +
        '<span style="font-variant-numeric:tabular-nums">' +
        (e.delta > 0 ? '+' : '') + num(e.delta, 0) + ' kcal</span></div>' +
        '<div class="row between" style="padding-top:8px;border-top:1px solid var(--grid)">' +
        '<b>Daily calorie target</b><b style="font-variant-numeric:tabular-nums">' +
        num(T.calories.value, 0) + ' kcal</b></div>';
      if (T.calories.note) {
        html += '<div class="notice warn" style="margin-top:10px"><span class="dot"></span>' +
          '<div>' + esc(T.calories.note) + '</div></div>';
      }
      if (g.bmi) {
        html += '<div class="muted" style="margin-top:10px">BMI ' + num(g.bmi, 1) +
          ' — ' + esc(g.bmiLabel) + '. BMI ignores muscle mass, so treat it as a rough marker.</div>';
      }
    }
    html += '</div>';

    /* --- headline targets, overridable --------------------------- */
    html += '<div class="card"><h2>Your daily targets</h2>' +
      '<div class="sub" style="margin-bottom:12px">Leave a box empty to use the ' +
      'calculated value. Anything you type in wins.</div>';
    [['calories', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g'], ['fiber', 'g']]
      .forEach(function (pair) {
        var k = pair[0], meta = NL.nutrients.byKey[k], tg = T[k];
        html += '<label class="field"><span>' + esc(meta.label) + ' (' + pair[1] + ')' +
          (tg.source === 'manual' ? ' — set by you' : tg.note ? ' — ' + esc(tg.note) : '') +
          '</span><input type="number" inputmode="decimal" step="any" data-goal="' + k +
          '" value="' + (manual[k] != null ? manual[k] : '') +
          '" placeholder="' + (tg.value != null ? round(tg.value, 1) : 'not set') + '"></label>';
      });
    if (Object.keys(manual).length) {
      html += '<button class="btn sm" data-act="clear-overrides">Clear all my overrides</button>';
    }
    html += '</div>';

    /* --- every other target -------------------------------------- */
    html += '<div class="card"><details' + (state.goalsOpen.all ? ' open' : '') +
      ' data-det="all"><summary style="cursor:pointer;font-size:13px;font-weight:600;' +
      'letter-spacing:.02em;text-transform:uppercase;color:var(--text-secondary)">' +
      'All vitamin &amp; mineral targets</summary>' +
      '<div class="sub" style="margin:12px 0">Defaults are the US DRI (RDA where one ' +
      'exists, otherwise AI) for your age and sex. Type a number to override one.</div>' +
      '<table class="dri"><thead><tr><th>Nutrient</th><th class="num">Target</th>' +
      '<th class="num">Override</th></tr></thead><tbody>';
    NL.nutrients.list.filter(function (m) {
      return m.group === 'vitamin' || m.group === 'mineral';
    }).forEach(function (m) {
      var tg = T[m.key];
      html += '<tr><td>' + esc(m.label) + '</td>' +
        '<td class="num">' + (tg.value == null ? '—' : num(tg.value, m.dp)) + ' ' +
        esc(m.unit) + '</td>' +
        '<td class="num" style="width:96px"><input type="number" inputmode="decimal" ' +
        'step="any" data-goal="' + m.key + '" style="min-height:34px;padding:4px 7px;' +
        'text-align:right;font-size:14px" value="' +
        (manual[m.key] != null ? manual[m.key] : '') + '" placeholder="—"></td></tr>';
    });
    html += '</tbody></table></details></div>';

    /* --- settings ------------------------------------------------- */
    html += '<div class="card"><h2>Settings &amp; data</h2>' +
      '<label class="field"><span>Appearance</span><div class="segmented">' +
      ['auto', 'light', 'dark'].map(function (th) {
        var cur = NL.store.settings().theme || 'auto';
        return '<button data-act="theme" data-v="' + th + '" aria-pressed="' +
          (cur === th) + '">' + th[0].toUpperCase() + th.slice(1) + '</button>';
      }).join('') + '</div></label>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
      '<button class="btn sm" data-act="export">Export my data</button>' +
      '<button class="btn sm" data-act="import">Import a backup</button>' +
      '<button class="btn sm danger" data-act="wipe">Erase everything</button></div>' +
      '<input type="file" id="importfile" accept="application/json,.json" class="hidden">' +
      storageHTML() +
      '<div class="muted" style="margin-top:12px">Everything stays on this device — ' +
      'nothing is uploaded, and there is no account. Barcode lookups are the one ' +
      'network call, and they go to Open Food Facts. Export a backup now and then; ' +
      'clearing Safari website data would otherwise take your log with it.</div></div>';

    html += '<div class="card"><h2>Where the numbers come from</h2><div class="sub">' +
      'Whole foods: USDA FoodData Central values, rounded. Packaged foods: Open Food ' +
      'Facts, which is crowd-sourced from product labels — spot-check anything that ' +
      'looks odd. Energy needs: Mifflin-St Jeor, or Katch-McArdle when you supply body ' +
      'fat %. Vitamin and mineral targets: Institute of Medicine DRI tables. ' +
      'This is a tracking tool, not medical advice.</div></div>';

    return html;
  }

  /* =============================================================== SHEET */
  function closeSheet() {
    if (state.sheet && state.sheet.onClose) state.sheet.onClose();
    state.sheet = null;
    var el = document.querySelector('.sheet-backdrop');
    if (el) el.remove();
  }

  function openSheet(html, opts) {
    closeSheet();
    opts = opts || {};
    state.sheet = opts;
    var back = document.createElement('div');
    back.className = 'sheet-backdrop';
    back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="sheet-grip"></div>' + html + '</div>';
    back.addEventListener('click', function (ev) {
      if (ev.target === back) closeSheet();
    });
    document.body.appendChild(back);
    if (opts.onOpen) opts.onOpen(back);
    return back;
  }

  function setSheetBody(html) {
    var s = document.querySelector('.sheet');
    if (s) s.innerHTML = '<div class="sheet-grip"></div>' + html;
  }

  /* ------------------------------------------------------ portion picker */
  var portion = null;   // {food, qty, unit, meal, entryId}

  function defaultUnit(food) {
    if (food.servings && food.servings.length) return food.servings[0].id;
    return food.liquid ? 'ml' : 'g';
  }

  function openPortion(food, opts) {
    opts = opts || {};
    portion = {
      food: food,
      qty: opts.qty != null ? opts.qty : (food.servings && food.servings.length ? 1 : 100),
      unit: opts.unit || defaultUnit(food),
      meal: opts.meal || guessMeal(),
      entryId: opts.entryId || null
    };
    openSheet(portionHTML(), { onOpen: bindPortion });
  }

  function guessMeal() {
    var h = new Date().getHours();
    if (h < 10.5) return 'Breakfast';
    if (h < 15) return 'Lunch';
    if (h < 21) return 'Dinner';
    return 'Snacks';
  }

  function portionHTML() {
    var f = portion.food;
    var units = NL.units.unitsFor(f);
    var hasUnit = units.some(function (u) { return u.id === portion.unit; });
    if (!hasUnit) portion.unit = defaultUnit(f);

    var html = '<h2>' + esc(f.name) + '</h2>' +
      '<div class="sub" style="margin-bottom:14px">' +
      esc([f.brand, f.group].filter(Boolean).join(' · ')) +
      (f.barcode ? ' · ' + esc(f.barcode) : '') + '</div>';

    if (f.servingNote) {
      html += '<div class="muted" style="margin:-8px 0 14px">Label serving: ' +
        esc(f.servingNote) + '</div>';
    }

    if (f.per100 && f.per100.calories == null) {
      html += '<div class="notice bad" style="margin-bottom:12px"><span class="dot"></span>' +
        '<div>This product has no calorie data in Open Food Facts. You can still log ' +
        'it, but it will not count toward your calories — better to create a custom ' +
        'food from the label.</div></div>';
    }

    if (f.servings && f.servings.length) {
      html += '<div class="row" style="flex-wrap:wrap;gap:7px;margin-bottom:12px">' +
        f.servings.map(function (s) {
          return '<button class="btn sm" data-act="quick-serving" data-u="' + esc(s.id) +
            '">1 ' + esc(s.label) + ' (' + NL.units.formatGrams(s.grams) + ')</button>';
        }).join('') + '</div>';
    }

    html += '<div class="qtyrow">' +
      '<label class="field"><span>Amount</span><input type="text" id="pqty" ' +
      'inputmode="decimal" autocomplete="off" value="' + esc(qtyText(portion.qty)) +
      '" placeholder="e.g. 1 1/2"></label>' +
      '<label class="field"><span>Unit</span><select id="punit">' +
      units.map(function (u) {
        return '<option value="' + esc(u.id) + '"' +
          (u.id === portion.unit ? ' selected' : '') + '>' + esc(u.label) + '</option>';
      }).join('') + '</select></label></div>';

    html += '<label class="field"><span>Meal</span><select id="pmeal">' +
      MEALS.map(function (m) {
        return '<option' + (m === portion.meal ? ' selected' : '') + '>' + m + '</option>';
      }).join('') + '</select></label>';

    html += '<div id="ppreview"></div>';

    html += '<div class="row" style="gap:8px;margin-top:16px">' +
      '<button class="btn primary grow" data-act="' +
      (portion.entryId ? 'save-entry' : 'add-entry') + '">' +
      (portion.entryId ? 'Save changes' : 'Add to ' + esc(dayLabel(state.day).toLowerCase())) +
      '</button>' +
      (portion.entryId
        ? '<button class="btn danger" data-act="delete-entry">Delete</button>'
        : '<button class="btn" data-act="close-sheet">Cancel</button>') +
      '</div>';

    if (f.source === 'custom') {
      html += '<div style="margin-top:10px"><button class="btn sm block" ' +
        'data-act="edit-custom">Edit this food’s nutrition</button></div>';
    }
    return html;
  }

  function bindPortion() {
    var q = document.getElementById('pqty');
    var u = document.getElementById('punit');
    var m = document.getElementById('pmeal');
    if (q) q.addEventListener('input', function () { portion.qty = q.value; renderPreview(); });
    if (u) u.addEventListener('change', function () { portion.unit = u.value; renderPreview(); });
    if (m) m.addEventListener('change', function () { portion.meal = m.value; });
    renderPreview();
  }

  function portionGrams() {
    var r = NL.units.toGrams(portion.qty, portion.unit, portion.food);
    return r;
  }

  function renderPreview() {
    var box = document.getElementById('ppreview');
    if (!box) return;
    var conv = portionGrams();
    if (!conv) {
      box.innerHTML = '<div class="notice bad"><span class="dot"></span>' +
        '<div>That amount could not be read. Try a plain number like 1.5, or a ' +
        'fraction like 1 1/2.</div></div>';
      return;
    }
    var f = portion.food, factor = conv.grams / 100;
    var rows = [['calories', 0], ['protein', 1], ['carbs', 1], ['fiber', 1], ['fat', 1]];
    var html = '<div class="card" style="margin:4px 0 0;background:var(--surface-2)">' +
      '<div class="row between" style="margin-bottom:10px">' +
      '<span class="sub">That works out to</span>' +
      '<b style="font-variant-numeric:tabular-nums">' + NL.units.formatGrams(conv.grams) +
      '</b></div><div class="tiles" style="grid-template-columns:repeat(5,1fr);margin:0">';
    rows.forEach(function (r) {
      var meta = NL.nutrients.byKey[r[0]];
      var v = f.per100 && f.per100[r[0]] != null ? f.per100[r[0]] * factor : null;
      html += '<div class="tile" style="background:var(--surface-1);padding:8px 6px">' +
        '<div class="tile-label" style="font-size:10px">' +
        esc(r[0] === 'calories' ? 'kcal' : meta.label) + '</div>' +
        '<div class="tile-value" style="font-size:16px">' +
        (v == null ? '—' : num(v, r[1])) + '</div></div>';
    });
    html += '</div>';
    if (conv.assumedDensity) {
      html += '<div class="muted" style="margin-top:10px">Converted at 1 g per ml ' +
        '(water). For thick or airy foods, weighing in grams is more accurate.</div>';
    }
    html += '</div>';
    box.innerHTML = html;
  }

  function commitPortion(isEdit) {
    var conv = portionGrams();
    if (!conv) { toast('Check the amount'); return; }
    var f = portion.food;
    var unitMeta = NL.units.unitsFor(f).filter(function (u) {
      return u.id === portion.unit;
    })[0];
    var payload = {
      foodId: f.id, source: f.source, name: f.name, brand: f.brand || '',
      barcode: f.barcode || '', qty: NL.units.parseQuantity(portion.qty),
      unit: portion.unit, unitLabel: unitMeta ? unitMeta.label : portion.unit,
      grams: conv.grams, per100: f.per100, servings: f.servings || [],
      density: f.density || null, liquid: !!f.liquid, meal: portion.meal
    };
    if (isEdit) {
      NL.store.updateEntry(state.day, portion.entryId, payload);
      toast('Updated');
    } else {
      NL.store.addEntry(state.day, payload);
      if (f.source === 'off') NL.store.cacheBarcode(f.barcode || f.id, f);
      toast('Added to ' + dayLabel(state.day).toLowerCase());
    }
    closeSheet();
    state.tab = 'today';
    render();
  }

  /* ------------------------------------------------------------- scanner */
  var stopScan = null;

  function openScanner() {
    var html = '<h2>Scan a barcode</h2>' +
      '<div class="sub" style="margin-bottom:12px">Hold the barcode inside the frame. ' +
      'Good light helps; so does holding still for a beat.</div>' +
      '<div class="scanstage"><video id="scanvid" playsinline muted></video>' +
      '<div class="reticle"></div><div class="scanhint" id="scanhint">Looking…</div></div>' +
      '<div id="scanmsg" style="margin-top:12px"></div>' +
      '<div class="row" style="gap:8px;margin-top:12px">' +
      '<button class="btn grow" data-act="type-barcode">Type the number</button>' +
      '<button class="btn" data-act="close-sheet">Close</button></div>';

    openSheet(html, {
      onOpen: function () {
        var vid = document.getElementById('scanvid');
        stopScan = NL.scanner.start(vid, onBarcode, function (err) {
          var msg = document.getElementById('scanmsg');
          if (msg) {
            msg.innerHTML = '<div class="notice bad"><span class="dot"></span><div>' +
              esc(err.message) + '</div></div>';
          }
          var hint = document.getElementById('scanhint');
          if (hint) hint.textContent = '';
        });
      },
      onClose: function () { if (stopScan) { stopScan(); stopScan = null; } }
    });
  }

  function onBarcode(code) {
    if (stopScan) { stopScan(); stopScan = null; }
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
    lookupBarcode(code);
  }

  function lookupBarcode(code) {
    setSheetBody('<h2>Looking up ' + esc(code) + '</h2>' +
      '<div class="empty-state"><span class="spinner"></span> Checking Open Food Facts…</div>');
    NL.off.byBarcode(code).then(function (food) {
      openPortion(food, {});
    }).catch(function (e) {
      var notFound = e.code === 'notfound';
      setSheetBody('<h2>' + (notFound ? 'Not in the database' : 'Lookup failed') + '</h2>' +
        '<div class="sub" style="margin:8px 0 14px">' +
        (notFound
          ? 'Barcode <b>' + esc(code) + '</b> is not in Open Food Facts yet. Create it ' +
            'once from the label and it is yours offline from then on.'
          : esc(e.message) + ' You can still add it by hand.') + '</div>' +
        '<div class="row" style="gap:8px">' +
        '<button class="btn primary grow" data-act="new-food" data-barcode="' + esc(code) +
        '">Create from the label</button>' +
        '<button class="btn" data-act="scan">Scan again</button></div>');
    });
  }

  function openTypeBarcode() {
    if (stopScan) { stopScan(); stopScan = null; }
    openSheet('<h2>Type a barcode</h2>' +
      '<div class="sub" style="margin-bottom:12px">The digits printed under the bars.</div>' +
      '<label class="field"><span>Barcode</span><input type="text" id="bcode" ' +
      'inputmode="numeric" autocomplete="off" placeholder="e.g. 0038000138416"></label>' +
      '<div id="bcmsg"></div>' +
      '<div class="row" style="gap:8px;margin-top:8px">' +
      '<button class="btn primary grow" data-act="lookup-typed">Look it up</button>' +
      '<button class="btn" data-act="close-sheet">Cancel</button></div>', {
      onOpen: function () {
        var i = document.getElementById('bcode');
        if (i) i.focus();
      }
    });
  }

  /* --------------------------------------------------- custom food editor */
  var CORE_FIELDS = ['calories', 'protein', 'carbs', 'fiber', 'sugar', 'addedSugar',
    'fat', 'satFat', 'transFat', 'cholesterol', 'sodium', 'potassium'];

  var editing = null;   // {food, basis, servingGrams}

  function openCustomFood(existing, barcode) {
    var f = existing || {
      name: '', brand: '', barcode: barcode || '', group: 'My foods',
      source: 'custom', density: null, liquid: false, servings: [], per100: {}
    };
    editing = {
      food: JSON.parse(JSON.stringify(f)),
      basis: f.servings && f.servings.length && !existing ? 'serving' : '100',
      servingGrams: f.servings && f.servings[0] ? f.servings[0].grams : ''
    };
    openSheet(customHTML(), { onOpen: bindCustom });
  }

  function fieldRow(key) {
    var m = NL.nutrients.byKey[key];
    var v = editing.food.per100[key];
    // Shown in the chosen basis, converted back on save.
    var shown = v == null ? '' : round(basisFactor() ? v * basisFactor() : v, 3);
    return '<label class="field" style="margin-bottom:9px"><span>' + esc(m.label) +
      ' (' + esc(m.unit) + ')</span><input type="number" inputmode="decimal" step="any" ' +
      'data-nut="' + key + '" value="' + shown + '" placeholder="leave blank if unknown">' +
      '</label>';
  }

  function basisFactor() {
    if (editing.basis !== 'serving') return 1;
    var g = parseFloat(editing.servingGrams);
    return isFinite(g) && g > 0 ? g / 100 : 1;
  }

  function customHTML() {
    var f = editing.food;
    var html = '<h2>' + (f.id ? 'Edit food' : 'Create a food') + '</h2>' +
      '<div class="sub" style="margin-bottom:14px">Copy the numbers off the label. ' +
      'Leave anything you do not have blank — blank means "unknown", which keeps your ' +
      'daily totals honest instead of pretending it is zero.</div>';

    html += '<label class="field"><span>Name</span><input type="text" data-cf="name" ' +
      'value="' + esc(f.name) + '" placeholder="e.g. Trader Joe’s tortillas"></label>' +
      '<div class="qtyrow">' +
      '<label class="field"><span>Brand (optional)</span><input type="text" data-cf="brand" ' +
      'value="' + esc(f.brand) + '"></label>' +
      '<label class="field"><span>Barcode (optional)</span><input type="text" ' +
      'inputmode="numeric" data-cf="barcode" value="' + esc(f.barcode) + '"></label></div>';

    html += '<label class="field"><span>The numbers below are per…</span>' +
      '<div class="segmented">' +
      '<button data-act="basis" data-v="100" aria-pressed="' + (editing.basis === '100') +
      '">100 g / 100 ml</button>' +
      '<button data-act="basis" data-v="serving" aria-pressed="' +
      (editing.basis === 'serving') + '">one serving</button></div></label>';

    html += '<div class="qtyrow">' +
      '<label class="field"><span>Serving weight (g)' +
      (editing.basis === 'serving' ? ' — required' : ' — optional') + '</span>' +
      '<input type="number" inputmode="decimal" step="any" data-cf="servingGrams" value="' +
      esc(editing.servingGrams) + '" placeholder="e.g. 30"></label>' +
      '<label class="field"><span>Serving name</span><input type="text" data-cf="servingLabel" ' +
      'value="' + esc(f.servings && f.servings[0] ? f.servings[0].label : '') +
      '" placeholder="e.g. slice, scoop, bar"></label></div>';

    html += '<label class="field"><span>Measured by volume? (lets you log ml, cups, ' +
      'fl oz)</span><div class="segmented">' +
      '<button data-act="liquid" data-v="0" aria-pressed="' + (!f.liquid) + '">No, weight</button>' +
      '<button data-act="liquid" data-v="1" aria-pressed="' + (!!f.liquid) + '">Yes, liquid</button>' +
      '</div></label>';

    html += '<div class="card" style="background:var(--surface-2);margin:4px 0 12px">' +
      '<h2>Label values</h2>' + CORE_FIELDS.map(fieldRow).join('') + '</div>';

    html += '<div class="card" style="background:var(--surface-2);margin:0 0 12px">' +
      '<details><summary style="cursor:pointer;font-size:13px;font-weight:600;' +
      'text-transform:uppercase;letter-spacing:.02em;color:var(--text-secondary)">' +
      'Vitamins, minerals &amp; the rest</summary><div style="margin-top:12px">' +
      NL.nutrients.list.filter(function (m) {
        return CORE_FIELDS.indexOf(m.key) < 0;
      }).map(function (m) { return fieldRow(m.key); }).join('') +
      '</div></details></div>';

    html += '<div id="cfmsg"></div>' +
      '<div class="row" style="gap:8px">' +
      '<button class="btn primary grow" data-act="save-custom">Save food</button>' +
      (f.id ? '<button class="btn danger" data-act="delete-custom">Delete</button>'
            : '<button class="btn" data-act="close-sheet">Cancel</button>') +
      '</div>';
    return html;
  }

  function bindCustom() {
    var sheet = document.querySelector('.sheet');
    if (!sheet) return;
    sheet.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.dataset.cf) {
        if (t.dataset.cf === 'servingGrams') editing.servingGrams = t.value;
        else if (t.dataset.cf === 'servingLabel') editing.servingLabel = t.value;
        else editing.food[t.dataset.cf] = t.value;
      }
    });
  }

  function readCustomInputs() {
    var sheet = document.querySelector('.sheet');
    if (!sheet) return;
    var factor = basisFactor();
    sheet.querySelectorAll('[data-nut]').forEach(function (inp) {
      var key = inp.dataset.nut;
      var raw = inp.value.trim();
      if (raw === '') { delete editing.food.per100[key]; return; }
      var v = parseFloat(raw);
      if (!isFinite(v)) { delete editing.food.per100[key]; return; }
      editing.food.per100[key] = v / factor;     // store per 100 g
    });
    sheet.querySelectorAll('[data-cf]').forEach(function (inp) {
      var k = inp.dataset.cf;
      if (k === 'servingGrams') editing.servingGrams = inp.value;
      else if (k === 'servingLabel') editing.servingLabel = inp.value;
      else editing.food[k] = inp.value.trim();
    });
  }

  function saveCustom() {
    readCustomInputs();
    var f = editing.food;
    var msg = document.getElementById('cfmsg');
    function fail(text) {
      if (msg) {
        msg.innerHTML = '<div class="notice bad" style="margin-bottom:12px">' +
          '<span class="dot"></span><div>' + esc(text) + '</div></div>';
        msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return false;
    }
    if (!f.name.trim()) return fail('Give the food a name.');
    var sg = parseFloat(editing.servingGrams);
    if (editing.basis === 'serving' && !(isFinite(sg) && sg > 0)) {
      return fail('You chose "per serving", so the serving weight in grams is needed ' +
        'to convert the numbers.');
    }
    if (f.per100.calories == null) return fail('Calories are required.');

    f.servings = [];
    if (isFinite(sg) && sg > 0) {
      // Bare label only. The gram figure is appended wherever it is displayed,
      // so baking it in here would double up each time the food was re-saved.
      var label = (editing.servingLabel || '').trim().replace(/\s*\([^)]*\)\s*$/, '');
      f.servings.push({ id: 'serving', label: label || 'serving', grams: sg });
    }
    f.liquid = !!f.liquid;
    if (f.liquid && !f.density) f.density = 1;
    f.group = 'My foods';
    var saved = NL.store.saveCustomFood(f);
    toast('Saved to My foods');
    openPortion(saved, {});
  }

  /* ========================================================== dispatch */
  var ACTIONS = {
    'day-prev': function () { state.day = NL.store.shiftKey(state.day, -1); render(); },
    'day-next': function () { state.day = NL.store.shiftKey(state.day, 1); render(); },
    'day-today': function () { state.day = NL.store.todayKey(); render(); },
    'pick-day': function (el) { state.day = el.dataset.day; state.tab = 'today'; render(); },
    'go-add': function () { state.tab = 'add'; render(); },
    'go-goals': function () { state.tab = 'goals'; render(); },
    'go-nutrients': function () { state.tab = 'nutrients'; render(); },
    'close-sheet': closeSheet,
    'scan': openScanner,
    'type-barcode': openTypeBarcode,

    'lookup-typed': function () {
      var i = document.getElementById('bcode');
      var code = (i ? i.value : '').replace(/\D/g, '');
      var msg = document.getElementById('bcmsg');
      if (code.length < 8) {
        if (msg) {
          msg.innerHTML = '<div class="notice bad"><span class="dot"></span>' +
            '<div>A barcode is at least 8 digits.</div></div>';
        }
        return;
      }
      if (!NL.scanner.validChecksum(code) && msg) {
        msg.innerHTML = '<div class="notice warn"><span class="dot"></span>' +
          '<div>That number’s check digit does not add up — looking anyway.</div></div>';
      }
      lookupBarcode(code);
    },

    'pick-food': function (el) {
      var id = el.dataset.food;
      var food = NL.foods.byId(id) ||
        NL.store.customFoods().filter(function (f) { return f.id === id; })[0];
      if (food) openPortion(food, {});
    },
    'pick-off': function (el) {
      var food = offCache[el.dataset.food];
      if (food) openPortion(food, {});
    },
    'pick-recent': function (el) {
      var r = NL.store.recents()[+el.dataset.i];
      if (!r) return;
      openPortion({
        id: r.foodId, source: r.source, name: r.name, brand: r.brand,
        barcode: r.barcode, per100: r.per100, servings: r.servings || [],
        density: r.density, liquid: r.liquid, group: ''
      }, { qty: r.qty, unit: r.unit });
    },
    'browse': function (el) {
      var gname = el.dataset.group;
      openSheet('<h2>' + esc(gname) + '</h2><div class="card flush">' +
        NL.foods.inGroup(gname).map(function (f) {
          return resultRow(f, 'pick-food');
        }).join('') + '</div>');
    },
    'new-food': function (el) { openCustomFood(null, el.dataset.barcode || ''); },
    'edit-custom': function () {
      var f = portion.food;
      openCustomFood(f, '');
    },
    'save-custom': saveCustom,
    'delete-custom': function () {
      if (!confirm('Delete this food? Days you already logged it on keep their numbers.')) return;
      NL.store.deleteCustomFood(editing.food.id);
      closeSheet();
      toast('Deleted');
      render();
    },
    'basis': function (el) {
      readCustomInputs();
      editing.basis = el.dataset.v;
      setSheetBody(customHTML());
      bindCustom();
    },
    'liquid': function (el) {
      readCustomInputs();
      editing.food.liquid = el.dataset.v === '1';
      setSheetBody(customHTML());
      bindCustom();
    },

    'quick-serving': function (el) {
      portion.unit = el.dataset.u;
      portion.qty = 1;
      setSheetBody(portionHTML());
      bindPortion();
    },
    'add-entry': function () { commitPortion(false); },
    'save-entry': function () { commitPortion(true); },
    'delete-entry': function () {
      NL.store.removeEntry(state.day, portion.entryId);
      closeSheet();
      toast('Removed');
      render();
    },
    'edit-entry': function (el) {
      var e = NL.store.getDay(state.day).filter(function (x) {
        return x.id === el.dataset.id;
      })[0];
      if (!e) return;
      openPortion({
        id: e.foodId, source: e.source, name: e.name, brand: e.brand,
        barcode: e.barcode, per100: e.per100, servings: e.servings || [],
        density: e.density, liquid: e.liquid, group: ''
      }, { qty: e.qty, unit: e.unit, meal: e.meal, entryId: e.id });
    },

    'units': function (el) { NL.store.setProfile({ unitSystem: el.dataset.v }); render(); },
    'sex': function (el) { NL.store.setProfile({ sex: el.dataset.v }); render(); },
    'goaltype': function (el) { NL.store.setProfile({ goal: el.dataset.v }); render(); },
    'theme': function (el) {
      NL.store.setSetting('theme', el.dataset.v);
      applyTheme();
      render();
    },
    'clear-overrides': function () {
      var m = NL.store.goalConfig().manual;
      Object.keys(m).forEach(function (k) { NL.store.setManualGoal(k, null); });
      toast('Back to calculated targets');
      render();
    },

    'export': function () {
      var text = NL.store.exportJSON();
      var name = 'nutrilog-backup-' + NL.store.todayKey() + '.json';
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      openSheet('<h2>Backup</h2><div class="sub" style="margin-bottom:12px">' +
        'A file called <b>' + esc(name) + '</b> should be downloading. If Safari did ' +
        'not offer it, copy the text below into a note instead.</div>' +
        '<textarea readonly rows="8" id="exporttext" style="font-size:12px;' +
        'font-family:ui-monospace,monospace">' + esc(text) + '</textarea>' +
        '<div class="row" style="gap:8px;margin-top:10px">' +
        '<button class="btn grow" data-act="copy-export">Copy to clipboard</button>' +
        '<button class="btn" data-act="close-sheet">Done</button></div>');
    },
    'copy-export': function () {
      var t = document.getElementById('exporttext');
      if (!t) return;
      t.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(t.value).then(function () { toast('Copied'); });
      } else {
        document.execCommand('copy');
        toast('Copied');
      }
    },
    'import': function () {
      var inp = document.getElementById('importfile');
      if (inp) inp.click();
    },
    'wipe': function () {
      if (!confirm('Erase every logged day, custom food and goal on this device? ' +
        'This cannot be undone.')) return;
      if (!confirm('Really erase everything?')) return;
      NL.store.wipe();
      state.day = NL.store.todayKey();
      state.tab = 'goals';
      toast('Erased');
      render();
    }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    ev.preventDefault();
    fn(el);
  });

  /* profile + goal inputs commit on change, so typing is never interrupted */
  document.addEventListener('change', function (ev) {
    var t = ev.target;

    if (t.id === 'importfile' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          NL.store.importJSON(String(fr.result));
          state.day = NL.store.todayKey();
          applyTheme();
          toast('Backup restored');
          render();
        } catch (e) {
          alert('That file could not be read: ' + e.message);
        }
      };
      fr.readAsText(t.files[0]);
      return;
    }

    if (t.dataset.field) { onProfileField(t); return; }

    if (t.dataset.goal) {
      var raw = t.value.trim();
      NL.store.setManualGoal(t.dataset.goal, raw === '' ? null : parseFloat(raw));
      if (['calories', 'protein', 'fat'].indexOf(t.dataset.goal) >= 0) render();
      return;
    }
  });

  function onProfileField(t) {
    var p = NL.store.profile();
    var imp = p.unitSystem !== 'metric';
    var v = parseFloat(t.value);
    var f = t.dataset.field;

    if (f === 'age') NL.store.setProfile({ age: isFinite(v) ? Math.round(v) : null });
    else if (f === 'heightCm') NL.store.setProfile({ heightCm: isFinite(v) ? v : null });
    else if (f === 'heightFt' || f === 'heightIn') {
      var sheetRoot = document.getElementById('app');
      var ftEl = sheetRoot.querySelector('[data-field="heightFt"]');
      var inEl = sheetRoot.querySelector('[data-field="heightIn"]');
      var ft = parseFloat(ftEl && ftEl.value) || 0;
      var inch = parseFloat(inEl && inEl.value) || 0;
      var total = ft * 12 + inch;
      NL.store.setProfile({ heightCm: total > 0 ? NL.goals.inToCm(total) : null });
    } else if (f === 'weight') {
      NL.store.setProfile({
        weightKg: isFinite(v) ? (imp ? NL.goals.lbToKg(v) : v) : null
      });
    } else if (f === 'bodyFat') {
      NL.store.setProfile({ bodyFat: isFinite(v) && v > 0 ? v : null });
    } else if (f === 'activity') {
      NL.store.setProfile({ activity: parseFloat(t.value) });
    } else if (f === 'rate') {
      NL.store.setProfile({ rate: parseFloat(t.value) });
    } else if (f === 'state') {
      NL.store.setProfile({ state: t.value });
    }
    render();
  }

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'q') onQuery(ev.target.value);
  });

  document.addEventListener('toggle', function (ev) {
    if (ev.target.dataset && ev.target.dataset.det) {
      state.goalsOpen[ev.target.dataset.det] = ev.target.open;
    }
  }, true);

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  /* ============================================================== boot */
  function applyTheme() {
    var th = NL.store.settings().theme || 'auto';
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }

  function render() {
    var views = {
      today: viewToday, add: viewAdd, nutrients: viewNutrients, goals: viewGoals
    };
    var scrollTop = state.tab === state.lastTab ? window.scrollY : 0;
    app.innerHTML = (views[state.tab] || viewToday)();
    state.lastTab = state.tab;

    document.querySelectorAll('.tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
    });

    if (state.tab === 'add') {
      // Returning to the tab with a query still in the box but no result and
      // no request in flight would otherwise spin forever.
      if (state.query.trim() && !state.results) onQuery(state.query);
      renderResults();
    }
    window.scrollTo(0, scrollTop);
  }

  function boot() {
    NL.store.load();
    applyTheme();
    state.day = NL.store.todayKey();

    // First launch with nothing set up: start where the setup is.
    if (NL.goals.missingProfile().length === 4 && !NL.store.loggedDayKeys().length) {
      state.tab = 'goals';
    }
    NL.store.setSetting('firstRun', false);
    render();

    // Coming back after midnight should land on the new day, not the old one.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var t = NL.store.todayKey();
      if (state.day !== t && !state.sheet && state.tab === 'today') {
        state.day = t;
        render();
      }
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  boot();
})(window.NL = window.NL || {});
