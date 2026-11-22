// The value model, readable in the browser.
//
// This file recomputes every implied value on the board from the raw
// snapshot fields, in the open, and the page compares its answers against
// the values the build wrote. If the two disagree, the page says so.
//
//   implied = TVL x categoryAnchor x momentumFactor x tokenlessFactor
//             x airdrop share
//
// categoryAnchor is a mcap/TVL multiple learned from protocols whose token
// already trades, shrunk in log space from category to family to global so
// a category with one sample cannot shout. No protocol is named anywhere in
// this file: the model knows categories, never names.

window.RadarModel = (function () {
  var EXCLUDED = {
    'Bridge': 1, 'Canonical Bridge': 1, 'Liquid Staking': 1,
    'Liquid Restaking': 1, 'Restaked BTC': 1, 'CEX': 1
  };
  var K = 4; // shrinkage strength, the same K the build used

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function familyOf(params, category) {
    if (category === null || category === undefined) return 'other';
    return params.family_of_category[category] || 'other';
  }

  // Rebuild the anchors from the trading rows alone: each contributes
  // ln(clamp(mcap / TVL, 0.005, 5)); medians shrink category -> family ->
  // global with K pseudo-samples of the parent at each level.
  function computeAnchors(radar) {
    var params = radar.params;
    var catLogs = {}, famLogs = {}, allLogs = [];
    radar.trading.forEach(function (t) {
      if (t.category !== null && EXCLUDED[t.category]) return;
      var log = Math.log(clamp(t.mcap_usd / t.tvl_usd, 0.005, 5));
      var key = t.category === null ? '(none)' : t.category;
      (catLogs[key] = catLogs[key] || []).push(log);
      var fam = familyOf(params, t.category);
      (famLogs[fam] = famLogs[fam] || []).push(log);
      allLogs.push(log);
    });
    var globalLog = median(allLogs);
    var famLog = {}, famN = {};
    Object.keys(famLogs).forEach(function (fam) {
      var logs = famLogs[fam];
      famN[fam] = logs.length;
      famLog[fam] = (logs.length * median(logs) + K * globalLog) / (logs.length + K);
    });
    var categories = {};
    radar.rows.forEach(function (r) {
      var key = r.category === null ? '(none)' : r.category;
      if (categories[key]) return;
      var fam = familyOf(params, r.category);
      var parent = famLog[fam] !== undefined ? famLog[fam] : globalLog;
      var logs = catLogs[key] || [];
      var log = logs.length === 0
        ? parent
        : (logs.length * median(logs) + K * parent) / (logs.length + K);
      categories[key] = {
        anchor: clamp(Math.exp(log), 0.02, 1.5),
        n: logs.length,
        nFam: famN[fam] || 0,
        family: fam
      };
    });
    return { globalLog: globalLog, categories: categories };
  }

  function momentumFactor(change7d) {
    if (change7d === null || change7d === undefined) return 1;
    var g = clamp(change7d / 100, -0.30, 0.30);
    return clamp(Math.pow(1 + g, 1.5), 0.60, 1.50);
  }

  function tokenlessFactor(ageDays) {
    var t = Math.min(1, Math.log(1 + ageDays / 90) / Math.log(1 + 1095 / 90));
    return 0.70 + 0.45 * t;
  }

  // One row, recomputed end to end from its raw fields.
  function impliedFor(radar, anchors, row) {
    var key = row.category === null ? '(none)' : row.category;
    var cat = anchors.categories[key];
    var anchor = cat ? cat.anchor : Math.exp(anchors.globalLog);
    var fdv = row.tvl_usd * anchor * momentumFactor(row.change_7d) * tokenlessFactor(row.age_days);
    var pool = fdv * radar.params.airdrop_share[row.family];
    return { anchor: anchor, fdv: fdv, pool: pool, implied: Math.max(1, Math.round(pool)) };
  }

  // The page's honesty check: every row, recomputed, within one dollar of
  // the value the build wrote (the dollar is for rounding at the edges).
  function verifyAll(radar, anchors) {
    var bad = [];
    radar.rows.forEach(function (row) {
      var got = impliedFor(radar, anchors, row).implied;
      if (Math.abs(got - row.implied_value_usd) > 1) bad.push(row.slug);
    });
    return { ok: radar.rows.length - bad.length, total: radar.rows.length, bad: bad };
  }

  return {
    clamp: clamp,
    median: median,
    familyOf: familyOf,
    computeAnchors: computeAnchors,
    momentumFactor: momentumFactor,
    tokenlessFactor: tokenlessFactor,
    impliedFor: impliedFor,
    verifyAll: verifyAll
  };
})();
