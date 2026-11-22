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

  // Rebuild the anchors from the trading rows alone. A trading row only
  // teaches the anchors when its multiple is plausible and its TVL large
  // enough to mean anything: a mcap/TVL ratio outside the sample band is
  // dropped outright (never clamped into the sample — clamping a 400x
  // multiple to 5x still lets it shout), and so is a trading TVL under the
  // sample floor. The survivors contribute ln(mcap / TVL); medians shrink
  // category -> family -> global with K pseudo-samples of the parent.
  function computeAnchors(radar) {
    var params = radar.params;
    var rule = params.anchor_sample || { ratio_min: 0.005, ratio_max: 5, min_tvl_usd: 10000000 };
    var catLogs = {}, famLogs = {}, allLogs = [];
    var used = 0, dropped = 0;
    radar.trading.forEach(function (t) {
      if (t.category !== null && EXCLUDED[t.category]) return;
      var ratio = t.mcap_usd / t.tvl_usd;
      if (ratio < rule.ratio_min || ratio > rule.ratio_max || t.tvl_usd < rule.min_tvl_usd) {
        dropped++;
        return;
      }
      used++;
      var log = Math.log(ratio);
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
    return { globalLog: globalLog, categories: categories, used: used, dropped: dropped };
  }

  // Whole days between two UTC calendar dates given as YYYY-MM-DD.
  function daysBetween(fromDate, toDate) {
    function parse(s) {
      var p = s.split('-');
      return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    return Math.round((parse(toDate) - parse(fromDate)) / 86400000);
  }

  // The tokenless age, derived here from the listing date and the
  // snapshot's own as-of date — never read off the row's stored figure.
  // An unreported listing date counts as 180 days, as the build took it.
  function ageDaysFor(radar, row) {
    if (row.listed_at === null || row.listed_at === undefined) return 180;
    return daysBetween(row.listed_at, radar.meta.as_of);
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

  // One row, recomputed end to end from its raw fields: the family is
  // derived from its category, the tokenless age from its listing date,
  // so nothing the build precomputed is taken on trust.
  function impliedFor(radar, anchors, row) {
    var key = row.category === null ? '(none)' : row.category;
    var cat = anchors.categories[key];
    var anchor = cat ? cat.anchor : Math.exp(anchors.globalLog);
    var family = familyOf(radar.params, row.category);
    var fdv = row.tvl_usd * anchor * momentumFactor(row.change_7d) *
      tokenlessFactor(ageDaysFor(radar, row));
    var pool = fdv * radar.params.airdrop_share[family];
    return { anchor: anchor, fdv: fdv, pool: pool, implied: Math.max(1, Math.round(pool)) };
  }

  // The page's honesty check: every row, recomputed, within one dollar of
  // the value the build wrote (the dollar is for rounding at the edges),
  // and the board's order itself: implied value must never rise as the
  // rank number grows.
  function verifyAll(radar, anchors) {
    var bad = [];
    var ordered = true;
    var prev = Infinity;
    radar.rows.forEach(function (row) {
      var got = impliedFor(radar, anchors, row).implied;
      if (Math.abs(got - row.implied_value_usd) > 1) bad.push(row.slug);
      if (row.implied_value_usd > prev) ordered = false;
      prev = row.implied_value_usd;
    });
    return { ok: radar.rows.length - bad.length, total: radar.rows.length, bad: bad, ordered: ordered };
  }

  return {
    clamp: clamp,
    median: median,
    familyOf: familyOf,
    computeAnchors: computeAnchors,
    daysBetween: daysBetween,
    ageDaysFor: ageDaysFor,
    momentumFactor: momentumFactor,
    tokenlessFactor: tokenlessFactor,
    impliedFor: impliedFor,
    verifyAll: verifyAll
  };
})();
