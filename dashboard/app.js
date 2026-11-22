// Pre-Token Radar — page logic. Renders the board from window.RADAR,
// recomputes every value with RadarModel and reports the match in the
// header, and drives the scatter, filters, sorting, tabs and the detail
// drawer. No network, no framework.

(function () {
  var R = window.RADAR;
  var M = window.RadarModel;
  var C = window.RadarChart;
  var esc = C.esc;
  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  function fmtUsd(x) { return '$' + String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtPct(x) {
    if (x === null || x === undefined) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  }
  function fmtCost(x) { return x < 10 ? '$' + x.toFixed(2) : fmtUsd(x); }
  function $(id) { return document.getElementById(id); }

  // ---- header: KPIs and the recompute verdict -----------------------------
  var anchors = M.computeAnchors(R);
  var verdict = M.verifyAll(R, anchors);
  $('asof').textContent = R.meta.as_of;
  $('kpi-rows').textContent = R.meta.board_count;
  $('kpi-watch').textContent = R.meta.watchlist_covered + '/' + R.meta.watchlist_count;
  $('kpi-early').textContent = R.meta.early_count;
  $('kpi-verify').textContent = verdict.bad.length === 0
    ? '✓ recomputed ' + verdict.ok + '/' + verdict.total
    : '✗ recompute mismatch on ' + verdict.bad.length;

  // ---- formula chips -------------------------------------------------------
  var CHIP_TEXT = {
    tvl: '<b>TVL</b> — the protocol\'s total value locked in the snapshot, in dollars. The size a launch would be valued against; it is the snapshot\'s own figure, not an estimate.',
    anchor: '<b>anchor</b> — the mcap/TVL multiple of protocols whose token already trades, learned per category and shrunk in log space from category to family to global (K = 4) so a category with one sample borrows its family\'s strength. See <b>computeAnchors</b> in model.js.',
    momentum: '<b>momentum</b> — (1 + the 7-day TVL change, clamped to ±30%) raised to 1.5, itself clamped to [0.60, 1.50]. A protocol growing into its launch counts for more; an unreported change counts as exactly 1. See <b>momentumFactor</b>.',
    tokenless: '<b>tokenless</b> — 0.70 plus a log curve over the days the protocol has run with no token recorded, reaching 1.15 at three years. The longer the record without a token, the less of its use is mercenary. See <b>tokenlessFactor</b>.',
    share: '<b>airdrop share</b> — the slice of implied FDV a launch is assumed to hand to its users, set per family between 5% and 12%. A stated assumption of this board, in line with the range historical DeFi launches have used — a knob, not a measurement.'
  };
  var pop = $('chip-pop');
  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-chip');
      if (!pop.hidden && pop.getAttribute('data-for') === key) { pop.hidden = true; return; }
      pop.innerHTML = CHIP_TEXT[key];
      pop.setAttribute('data-for', key);
      pop.hidden = false;
    });
  });

  // ---- scatter, top 10, legend --------------------------------------------
  C.buildScatter($('chart'), R.rows, openDrawer);
  $('top10').innerHTML = R.rows.slice(0, 10).map(function (r) {
    return '<li data-slug="' + esc(r.slug) + '"><span class="rk">' + r.rank + '</span>' +
      '<span><span class="nm">' + esc(r.name) + '</span><span class="ct">' +
      esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains[0] || '') + ' · per $1k ' + fmtUsd(r.per_1k_usd) + '</span></span>' +
      '<span class="val">' + fmtUsd(r.implied_value_usd) + '</span></li>';
  }).join('');
  $('top10').querySelectorAll('li').forEach(function (li) {
    li.addEventListener('click', function () { openDrawer(li.getAttribute('data-slug')); });
  });
  var famCount = {};
  R.rows.forEach(function (r) { famCount[r.family] = (famCount[r.family] || 0) + 1; });
  $('legend').innerHTML = Object.keys(C.FAMILY_COLORS).filter(function (f) { return famCount[f]; }).map(function (f) {
    return '<span class="row"><span class="dot" style="background:' + C.FAMILY_COLORS[f] + '"></span>' +
      f + ' <b>' + famCount[f] + '</b></span>';
  }).join('') + '<span class="row"><span class="dot" style="background:none;border:2px solid #F5C451"></span>gold ring = watchlist</span>';

  // ---- board table ----------------------------------------------------------
  var COLS = [
    { k: 'rank', label: '#', num: 1, get: function (r) { return r.rank; } },
    { k: 'name', label: 'Protocol', get: function (r) { return r.name; } },
    { k: 'family', label: 'Family', get: function (r) { return r.family; } },
    { k: 'chain', label: 'Chain', get: function (r) { return r.chains[0] || ''; } },
    { k: 'tvl', label: 'TVL', num: 1, get: function (r) { return r.tvl_usd; } },
    { k: 'chg', label: '7d', num: 1, get: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; } },
    { k: 'age', label: 'Tokenless', num: 1, get: function (r) { return r.age_days; } },
    { k: 'anchor', label: 'Anchor', num: 1, get: function (r) { return r.anchor; } },
    { k: 'fdv', label: 'FDV', num: 1, get: function (r) { return r.fdv_usd; } },
    { k: 'pool', label: 'Pool', num: 1, get: function (r) { return r.pool_usd; } },
    { k: 'implied', label: 'Implied', num: 1, get: function (r) { return r.implied_value_usd; } },
    { k: 'per1k', label: 'per $1k', num: 1, get: function (r) { return r.per_1k_usd; } }
  ];
  var state = { q: '', fams: {}, chain: '', tier: '', wl: false, dir: '', min: 0, sort: 'rank', sortDir: 1 };
  Object.keys(C.FAMILY_COLORS).forEach(function (f) { state.fams[f] = true; });
  var maxImplied = R.rows[0].implied_value_usd;

  $('board-head').innerHTML = COLS.map(function (c) {
    return '<th data-k="' + c.k + '"' + (c.num ? ' class="num"' : '') + '>' + c.label + ' <span class="dir"></span></th>';
  }).join('');
  $('board-head').querySelectorAll('th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      if (state.sort === k) state.sortDir *= -1;
      else { state.sort = k; state.sortDir = k === 'rank' || k === 'name' ? 1 : -1; }
      renderTable();
    });
  });

  function badges(r) {
    var out = '';
    if (r.watchlist) out += '<span class="badge wl">WATCHLIST</span>';
    if (r.tier === 'early') out += '<span class="badge early">EARLY</span>';
    return out;
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (!state.fams[r.family]) return false;
      if (state.chain && (r.chains[0] || '') !== state.chain) return false;
      if (state.tier && r.tier !== state.tier) return false;
      if (state.wl && !r.watchlist) return false;
      if (state.dir === 'up' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.dir === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (r.implied_value_usd < state.min) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderTable() {
    var col = COLS.filter(function (c) { return c.k === state.sort; })[0];
    var list = visibleRows().slice().sort(function (a, b) {
      var va = col.get(a), vb = col.get(b);
      if (va < vb) return -1 * state.sortDir;
      if (va > vb) return 1 * state.sortDir;
      return a.rank - b.rank;
    });
    $('board-head').querySelectorAll('th').forEach(function (th) {
      var d = th.querySelector('.dir');
      d.textContent = th.getAttribute('data-k') === state.sort ? (state.sortDir === 1 ? '▲' : '▼') : '';
    });
    $('board-body').innerHTML = list.map(function (r) {
      var chgCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badges(r) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="fam-dot" style="background:' + C.FAMILY_COLORS[r.family] + '"></span>' + r.family + '</td>' +
        '<td>' + esc(r.chains[0] || '—') + (r.chains.length > 1 ? ' <span class="anchor-n">+' + (r.chains.length - 1) + '</span>' : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + r.age_days + 'd</td>' +
        '<td class="num">' + r.anchor.toFixed(3) + ' <span class="anchor-n">n=' + r.n_cat + '</span></td>' +
        '<td class="num">' + fmtUsd(r.fdv_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.pool_usd) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + fmtUsd(r.per_1k_usd) + '</td></tr>';
    }).join('');
    $('board-body').querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDrawer(tr.getAttribute('data-slug')); });
    });
    $('f-count').textContent = list.length + ' of ' + R.rows.length + ' shown';
  }

  // ---- filters ---------------------------------------------------------------
  $('f-fams').innerHTML = Object.keys(C.FAMILY_COLORS).filter(function (f) { return famCount[f]; }).map(function (f) {
    return '<button class="fam-chip on" data-fam="' + f + '" style="background:' + C.FAMILY_COLORS[f] + '22;border-color:' +
      C.FAMILY_COLORS[f] + ';color:' + C.FAMILY_COLORS[f] + '">' + f + '</button>';
  }).join('');
  $('f-fams').querySelectorAll('.fam-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var f = chip.getAttribute('data-fam');
      state.fams[f] = !state.fams[f];
      chip.classList.toggle('on', state.fams[f]);
      chip.style.opacity = state.fams[f] ? '1' : '0.35';
      renderTable();
    });
  });
  var chains = {};
  R.rows.forEach(function (r) { if (r.chains[0]) chains[r.chains[0]] = 1; });
  $('f-chain').innerHTML = '<option value="">All main chains</option>' + Object.keys(chains).sort().map(function (ch) {
    return '<option>' + esc(ch) + '</option>';
  }).join('');
  $('f-q').addEventListener('input', function () { state.q = this.value; renderTable(); });
  $('f-chain').addEventListener('change', function () { state.chain = this.value; renderTable(); });
  $('f-tier').addEventListener('change', function () { state.tier = this.value; renderTable(); });
  $('f-dir').addEventListener('change', function () { state.dir = this.value; renderTable(); });
  $('f-wl').addEventListener('change', function () { state.wl = this.checked; renderTable(); });
  $('f-min').addEventListener('input', function () {
    var t = Number(this.value) / 100;
    state.min = Math.round(maxImplied * t * t);
    $('f-min-out').textContent = fmtUsd(state.min);
    renderTable();
  });

  // ---- trading view ------------------------------------------------------------
  $('trading-body').innerHTML = R.trading.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).map(function (t) {
    return '<tr><td><span class="pname">' + esc(t.name) + '</span><span class="slug">' + esc(t.slug) + '</span></td>' +
      '<td>' + esc(t.category || '—') + '</td>' +
      '<td><span class="fam-dot" style="background:' + C.FAMILY_COLORS[t.family] + '"></span>' + t.family + '</td>' +
      '<td class="num">' + fmtUsd(t.tvl_usd) + '</td><td class="num">' + fmtUsd(t.mcap_usd) + '</td>' +
      '<td class="num">' + t.ratio.toFixed(3) + '×</td></tr>';
  }).join('');
  $('tab-board').addEventListener('click', function () { switchTab(false); });
  $('tab-trading').addEventListener('click', function () { switchTab(true); });
  function switchTab(trading) {
    $('view-board').hidden = trading;
    $('view-trading').hidden = !trading;
    $('tab-board').classList.toggle('active', !trading);
    $('tab-trading').classList.toggle('active', trading);
  }

  // ---- drawer ------------------------------------------------------------------
  function wfRow(label, val, tvl, final) {
    var w = Math.max(3, 100 * Math.log10(Math.max(val, 1)) / Math.log10(Math.max(tvl, 10)));
    return '<div class="wf-row"><span class="lab">' + label + '</span><div class="bar' +
      (final ? ' f' : '') + '" style="width:' + w.toFixed(1) + '%"></div><span class="val">' + fmtUsd(val) + '</span></div>';
  }

  function openDrawer(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var afterAnchor = r.tvl_usd * r.anchor;
    var afterMom = afterAnchor * r.momentum;
    var famTrading = R.trading.filter(function (t) { return t.family === r.family; })
      .sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 5);
    var re = M.impliedFor(R, anchors, r);
    var reOk = Math.abs(re.implied - r.implied_value_usd) <= 1;
    var ratio = r.plan.total_cost_usd > 0 ? (r.plan.expected_usd / r.plan.total_cost_usd).toFixed(1) : '0.0';
    var notes = [];
    if (r.flags.g_missing) notes.push('Its 7-day change is unreported in the snapshot, so its momentum factor is exactly 1.');
    if (r.flags.age_missing) notes.push('The snapshot gives no listing date, so its tokenless age is taken as 180 days.');
    $('drawer').innerHTML =
      '<button class="close" id="d-close" aria-label="Close">×</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">#' + r.rank + ' of ' + R.rows.length + badges(r) + '<br>' +
      esc(r.category || 'Uncategorised') + ' · ' + r.family + ' family · main chain ' + esc(r.chains[0] || '—') +
      (r.chains.length > 1 ? ' · runs on ' + r.chains.length + ' chains' : '') +
      ' · listed in the snapshot ' + (r.listed_at || 'date unreported') + '</p>' +
      '<h3>How its implied value is built</h3><div class="wf">' +
      wfRow('TVL', r.tvl_usd, r.tvl_usd, false) +
      wfRow('× anchor ' + r.anchor.toFixed(3), afterAnchor, r.tvl_usd, false) +
      wfRow('× momentum ' + r.momentum.toFixed(3), afterMom, r.tvl_usd, false) +
      wfRow('× tokenless ' + r.tokenless.toFixed(3), r.fdv_usd, r.tvl_usd, false) +
      wfRow('× share ' + Math.round(r.airdrop_share * 100) + '%', r.pool_usd, r.tvl_usd, true) +
      '</div>' +
      '<p class="prov">Anchor provenance: the ' + esc(r.category || 'uncategorised') + ' category contributes ' + r.n_cat +
      ' trading samples, its ' + r.family + ' family ' + r.n_fam + '; shrinkage weight n/(n+K) = ' +
      (r.n_cat / (r.n_cat + 4)).toFixed(2) + ' on its own evidence, the rest borrowed from the family and the global median. ' +
      notes.join(' ') + '</p>' +
      '<h3>Trading multiples in its family</h3>' +
      (famTrading.length
        ? '<table class="mult">' + famTrading.map(function (t) {
            return '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.category || '—') + '</td><td>' + t.ratio.toFixed(3) + '×</td></tr>';
          }).join('') + '</table>'
        : '<p class="prov">No protocol in this family has a trading token in the snapshot; the anchor falls back to the global median.</p>') +
      '<h3>Farm plan — ' + r.plan.steps.length + ' steps</h3>' +
      r.plan.steps.map(function (s) {
        return '<div class="plan-step"><div class="act"><b>Step ' + s.n + '.</b> ' + esc(s.action) + '</div>' +
          '<div class="tags"><span class="tag">cost ' + fmtCost(s.cost_usd) + '</span>' +
          (s.capital_usd > 0 ? '<span class="tag">capital ' + fmtUsd(s.capital_usd) + '</span>' : '') +
          '<span class="tag">' + esc(s.time) + '</span>' +
          '<span class="tag risk">' + esc(s.risk) + '</span></div></div>';
      }).join('') +
      '<p class="totals">Payback: put <b>' + fmtUsd(r.plan.capital_usd) + '</b> in for <b>' + r.plan.hold_days +
      ' days</b> — all-in cost ≈ <b>' + fmtUsd(r.plan.total_cost_usd) + '</b> (gas and fees plus a 5%/yr opportunity cost), ' +
      'model expectation <b>' + fmtUsd(r.plan.expected_usd) + '</b>, a ratio of <b>' + ratio + '×</b>.</p>' +
      '<p class="verify-line">' + (reOk
        ? '✓ recomputed on this page: ' + fmtUsd(re.implied) + ' — matches the board'
        : '✗ recomputed on this page: ' + fmtUsd(re.implied) + ' — differs from the board\'s ' + fmtUsd(r.implied_value_usd)) + '</p>';
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    $('d-close').addEventListener('click', closeDrawer);
  }
  function closeDrawer() { $('drawer').hidden = true; $('scrim').hidden = true; }
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDrawer(); });

  // ---- deep links for the three captured views --------------------------------
  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var kv = {};
    h.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) kv[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
    });
    if (kv.fam) {
      var want = kv.fam.split(',');
      Object.keys(state.fams).forEach(function (f) { state.fams[f] = want.indexOf(f) >= 0; });
      $('f-fams').querySelectorAll('.fam-chip').forEach(function (chip) {
        var on = state.fams[chip.getAttribute('data-fam')];
        chip.classList.toggle('on', on);
        chip.style.opacity = on ? '1' : '0.35';
      });
    }
    if (kv.tier) { state.tier = kv.tier; $('f-tier').value = kv.tier; }
    if (kv.chain) { state.chain = kv.chain; $('f-chain').value = kv.chain; }
    if (kv.sort) {
      state.sort = kv.sort;
      state.sortDir = kv.sort === 'rank' || kv.sort === 'name' ? 1 : -1;
    }
    renderTable();
    if (kv.detail) openDrawer(kv.detail);
  }

  renderTable();
  applyHash();
})();
