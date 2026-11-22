// The scatter: every ranked protocol as one point. The x axis is how long
// it has run with no token recorded, the y axis is its TVL on a log scale,
// a point's area is its implied value and its colour is its family. A gold
// ring marks a watchlist protocol. Hand-written SVG, no chart library.

window.RadarChart = (function () {
  var FAMILY_COLORS = {
    capital: '#7FB8FF', dex: '#C6F432', derivs: '#FF7A45', credit: '#B79CFF',
    rwa: '#5ED6B0', btc: '#F5A623', infra: '#E66FB0', other: '#8A8F98'
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtUsd(x) {
    return '$' + String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // container: a div the SVG fills. rows: board rows. onPick(slug) on click.
  function buildScatter(container, rows, onPick) {
    var W = 880, H = 248, L = 66, R = 14, T = 10, B = 30;
    var iw = W - L - R, ih = H - T - B;
    // The x axis ends at the oldest board row, rounded up to the next
    // 250 days, so the long-lived protocols spread across the plot
    // instead of piling onto its right edge.
    var maxAge = 0;
    rows.forEach(function (r) { if (r.age_days > maxAge) maxAge = r.age_days; });
    var xMax = Math.max(500, Math.ceil(maxAge / 250) * 250);
    var yLo = Math.log10(5e6), yHi = Math.log10(5e9);
    var maxImplied = 0;
    rows.forEach(function (r) { if (r.implied_value_usd > maxImplied) maxImplied = r.implied_value_usd; });

    function X(age) { return L + (Math.min(age, xMax) / xMax) * iw; }
    function Y(tvl) { return T + (1 - (Math.log10(tvl) - yLo) / (yHi - yLo)) * ih; }

    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="scatter" role="img">'];
    [[5e6, '$5M'], [5e7, '$50M'], [5e8, '$500M'], [5e9, '$5B']].forEach(function (pair) {
      var y = Y(pair[0]).toFixed(1);
      out.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="grid"/>');
      out.push('<text x="' + (L - 8) + '" y="' + (Number(y) + 4) + '" class="axis" text-anchor="end">' + pair[1] + '</text>');
    });
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var d = Math.round(xMax * f);
      var anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
      var x = f === 0 ? L : f === 1 ? W - R : X(d);
      out.push('<text x="' + x + '" y="' + (H - 12) + '" class="axis" text-anchor="' + anchor + '">' + d + 'd</text>');
    });

    // Non-watchlist points first, so the ringed ones sit on top.
    var ordered = rows.slice().sort(function (a, b) {
      return (a.watchlist ? 1 : 0) - (b.watchlist ? 1 : 0);
    });
    ordered.forEach(function (r) {
      var radius = 2.5 + 6.5 * Math.sqrt(r.implied_value_usd / maxImplied);
      out.push('<circle data-slug="' + esc(r.slug) + '" cx="' + X(r.age_days).toFixed(1) +
        '" cy="' + Y(r.tvl_usd).toFixed(1) + '" r="' + radius.toFixed(1) +
        '" fill="' + (FAMILY_COLORS[r.family] || FAMILY_COLORS.other) +
        '" fill-opacity="' + (r.watchlist ? '0.95' : '0.62') +
        '" class="pt' + (r.watchlist ? ' wl' : '') + '"/>');
    });
    out.push('</svg>');
    container.innerHTML = out.join('');

    var tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    container.appendChild(tip);

    var bySlug = {};
    rows.forEach(function (r) { bySlug[r.slug] = r; });
    container.querySelectorAll('circle.pt').forEach(function (c) {
      var r = bySlug[c.getAttribute('data-slug')];
      if (!r) return;
      c.addEventListener('mouseenter', function (ev) {
        tip.hidden = false;
        tip.innerHTML = '<b>#' + r.rank + ' ' + esc(r.name) + '</b> · TVL ' + fmtUsd(r.tvl_usd) +
          ' · ' + r.age_days + 'd tokenless · implied ' + fmtUsd(r.implied_value_usd);
        var box = container.getBoundingClientRect();
        tip.style.left = (ev.clientX - box.left + 12) + 'px';
        tip.style.top = (ev.clientY - box.top - 8) + 'px';
      });
      c.addEventListener('mouseleave', function () { tip.hidden = true; });
      c.addEventListener('click', function () { onPick(r.slug); });
    });
  }

  // The family anchors as a small bar chart under the scatter: each
  // family's learned mcap/TVL multiple on the same log band the anchors
  // are clamped to, with the number of trading samples behind it. A
  // family with no surviving sample borrows the global median and says so.
  function buildAnchorBars(container, radar) {
    var W = 880, rowH = 15, T = 16, B = 14, L = 66, R = 120;
    var fams = Object.keys(FAMILY_COLORS);
    var H = T + B + fams.length * rowH;
    var iw = W - L - R;
    var lo = Math.log10(0.02), hi = Math.log10(1.5);
    function X(v) { return L + ((Math.log10(Math.max(v, 0.02)) - lo) / (hi - lo)) * iw; }
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" class="anchors" role="img">'];
    [0.05, 0.1, 0.25, 0.5, 1].forEach(function (v) {
      var x = X(v).toFixed(1);
      out.push('<line x1="' + x + '" x2="' + x + '" y1="' + (T - 4) + '" y2="' + (H - B) + '" class="grid"/>');
      out.push('<text x="' + x + '" y="' + (H - 3) + '" class="axis" text-anchor="middle">' + v + '×</text>');
    });
    fams.forEach(function (fam, i) {
      var f = radar.anchors.families[fam];
      if (!f) return;
      var y = T + i * rowH;
      var w = Math.max(2, X(f.anchor) - L);
      out.push('<text x="' + (L - 8) + '" y="' + (y + 10) + '" class="axis" text-anchor="end">' + fam + '</text>');
      out.push('<rect x="' + L + '" y="' + (y + 2) + '" width="' + w.toFixed(1) + '" height="9" rx="2" fill="' +
        FAMILY_COLORS[fam] + '" fill-opacity="0.85"/>');
      out.push('<text x="' + (L + w + 6).toFixed(1) + '" y="' + (y + 10) + '" class="axis">' +
        f.anchor.toFixed(3) + '× · n=' + f.n + (f.n === 0 ? ' (global median)' : '') + '</text>');
    });
    out.push('</svg>');
    container.innerHTML = out.join('');
  }

  return {
    buildScatter: buildScatter,
    buildAnchorBars: buildAnchorBars,
    FAMILY_COLORS: FAMILY_COLORS,
    esc: esc
  };
})();
