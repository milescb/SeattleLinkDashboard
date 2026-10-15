// History panel: persisted stats from /api/history for a chosen range of service days.
// One metric toggle (on-time % / avg delay) drives every chart except trains-in-service.
const History = (() => {
  const REFRESH_MS = 60000;      // only while the range includes today
  const DAY_START_MIN = 3 * 60;  // service day starts 03:00 (config.SERVICE_DAY_START_HOUR)
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let series = [];   // [{id, name, color}], 'all' first
  let range = { days: 7 };
  let metric = 'on_time_pct';
  let data = null;
  const charts = {};

  const isPct = () => metric === 'on_time_pct';
  const fmtVal = v => (isPct() ? fmtPct(v) : fmtDelay(v));
  const parseDay = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const fmtDay = d => parseDay(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const fmtDayLong = d => parseDay(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const serviceMin = tod => (tod < DAY_START_MIN ? tod + 1440 : tod);  // 00:30 sorts after 23:30

  function lineDs(s) {
    return {
      key: s.id, label: s.name, data: [], borderColor: s.color, backgroundColor: s.color,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25,
      borderDash: s.id === 'all' ? [4, 3] : [],
    };
  }
  // routes as bars, "all lines" as a dashed line drawn on top
  function barDs(s) {
    if (s.id === 'all') return { ...lineDs(s), type: 'line', order: 0, pointRadius: 2, tension: 0 };
    return { key: s.id, label: s.name, data: [], backgroundColor: s.color, order: 1,
             borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 };
  }

  const legend = { position: 'bottom', labels: { boxWidth: 12, boxHeight: 2 } };
  const valueY = () => ({ ticks: { callback: v => (isPct() ? `${v}%` : fmtDelay(v)) } });

  function chart(id, type, datasets, x, extra = {}) {
    return new Chart(id, {
      type,
      data: { labels: [], datasets },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { legend, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtVal(c.parsed.y)}` } } },
        scales: { x: { grid: { display: false }, ...x }, y: valueY() },
        ...extra,
      },
    });
  }

  // x ticks on local clock boundaries: midnights for multi-day ranges, every 3 h within a day
  function clockTicks(axis) {
    const span = axis.max - axis.min;
    const ticks = [];
    if (span > 1.5 * 86400) {
      const every = Math.ceil(span / 86400 / 8);
      const d = new Date(axis.min * 1000); d.setHours(24, 0, 0, 0);
      for (let i = 0; d.getTime() / 1000 <= axis.max; i++, d.setDate(d.getDate() + 1)) {
        if (i % every === 0) ticks.push({ value: d.getTime() / 1000 });
      }
    } else {
      const d = new Date(axis.min * 1000); d.setHours(Math.ceil((d.getHours() + 1e-9) / 3) * 3, 0, 0, 0);
      for (; d.getTime() / 1000 <= axis.max; d.setHours(d.getHours() + 3)) ticks.push({ value: d.getTime() / 1000 });
    }
    axis.ticks = ticks;
  }

  function init(routeList) {
    series = [{ id: 'all', name: 'All lines', color: color('route-all') },
              ...routeList.map(r => ({ ...r, color: routeColor(r.id, r.color) }))];

    charts.time = chart('ch-time', 'line', series.map(lineDs), { type: 'linear', afterBuildTicks: clockTicks });
    charts.day = chart('ch-day', 'bar', series.map(barDs), {});
    charts.tod = chart('ch-tod', 'line', series.map(lineDs), {
      type: 'linear', min: DAY_START_MIN, max: DAY_START_MIN + 1440, ticks: { stepSize: 180, callback: fmtMin },
    });
    charts.dow = chart('ch-dow', 'bar', series.map(barDs), {});
    charts.service = chart('ch-service', 'line', series.map(lineDs), {
      type: 'linear', min: DAY_START_MIN, max: DAY_START_MIN + 1440, ticks: { stepSize: 180, callback: fmtMin },
    });
    charts.service.options.scales.y = { beginAtZero: true, ticks: { precision: 0 } };
    charts.service.options.plugins.tooltip.callbacks.label = c => `${c.dataset.label}: ${c.parsed.y} trains`;
    charts.tod.options.plugins.tooltip.callbacks.title = c => `${fmtMin(c[0].parsed.x)} (${data.tod_bucket_min} min)`;
    charts.service.options.plugins.tooltip.callbacks.title = charts.tod.options.plugins.tooltip.callbacks.title;
    charts.day.options.plugins.tooltip.callbacks.title = c => fmtDayLong(data.days[c[0].dataIndex]);

    wireControls();
    load();
    setInterval(() => { if (data && data.end >= data.today) load(); }, REFRESH_MS);
  }

  function wireControls() {
    const presets = document.querySelectorAll('#range-presets button');
    presets.forEach(b => b.addEventListener('click', () => {
      presets.forEach(x => x.classList.toggle('on', x === b));
      range = b.dataset.days === 'all' ? { start: '2000-01-01' } : { days: b.dataset.days };
      load();
    }));
    const start = document.getElementById('range-start');
    const end = document.getElementById('range-end');
    [start, end].forEach(inp => inp.addEventListener('change', () => {
      if (!start.value || !end.value) return;
      presets.forEach(x => x.classList.remove('on'));
      range = { start: start.value, end: end.value };
      load();
    }));
    const metricBtns = document.querySelectorAll('#metric-toggle button');
    metricBtns.forEach(b => b.addEventListener('click', () => {
      metric = b.dataset.metric;
      metricBtns.forEach(x => x.classList.toggle('on', x === b));
      if (data) render();
    }));
  }

  async function load() {
    try {
      const r = await fetch(`/api/history?${new URLSearchParams(range)}`);
      if (!r.ok) throw new Error(`/api/history: ${r.status}`);
      data = await r.json();
      data.days = [...new Set(data.by_day.map(r => r.day))];
      render();
    } catch (e) {
      console.warn(e);
    }
  }

  // rows -> {route: [{x, y}]}
  function byRoute(rows, x, y) {
    const out = {};
    for (const r of rows) (out[r.route] ??= []).push({ x: x(r), y: y(r) });
    return out;
  }

  function setLines(ch, rows, x, y = r => r[metric]) {
    const g = byRoute(rows, x, y);
    ch.data.datasets.forEach(ds => { ds.data = g[ds.key] || []; });
  }

  function setCategories(ch, labels, rows, keyOf) {
    const idx = new Map(labels.map((l, i) => [l, i]));
    ch.data.labels = labels;
    ch.data.datasets.forEach(ds => {
      ds.data = labels.map(() => null);
      rows.filter(r => r.route === ds.key).forEach(r => { ds.data[idx.get(keyOf(r))] = r[metric]; });
    });
  }

  function fitY(ch) {
    const y = ch.options.scales.y;
    Object.assign(y, valueY(), isPct() ? { min: 0, max: 100 } : { min: undefined, max: undefined });
  }

  function render() {
    const multiDay = data.start !== data.end;

    // controls
    const start = document.getElementById('range-start');
    const end = document.getElementById('range-end');
    start.value = data.start; end.value = data.end;
    start.min = end.min = data.first || '';
    start.max = end.max = data.today;
    renderSummary();

    // over time
    setLines(charts.time, data.series, r => r.ts);
    charts.time.data.datasets.forEach(ds => { ds.spanGaps = data.bucket_s * 3; });  // break lines overnight
    const tx = charts.time.options.scales.x;
    const ts = data.series.map(r => r.ts);
    [tx.min, tx.max] = ts.length ? [Math.min(...ts), Math.max(...ts)] : [undefined, undefined];
    tx.ticks.callback = multiDay
      ? t => new Date(t * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
      : fmtTime;
    charts.time.options.plugins.tooltip.callbacks.title = c =>
      new Date(c[0].parsed.x * 1000).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    setCategories(charts.day, data.days, data.by_day, r => r.day);
    charts.day.data.labels = data.days.map(fmtDay);

    const tod = rows => [...rows].sort((a, b) => serviceMin(a.tod) - serviceMin(b.tod));
    setLines(charts.tod, tod(data.by_tod), r => serviceMin(r.tod));
    setLines(charts.service, tod(data.by_tod), r => serviceMin(r.tod), r => r.count);

    setCategories(charts.dow, DOW, data.by_dow, r => DOW[r.dow]);

    for (const k of ['time', 'day', 'tod', 'dow']) fitY(charts[k]);
    Object.values(charts).forEach(c => c.update());
    renderHeat();
  }

  function renderSummary() {
    const el = document.getElementById('range-summary');
    const s = Object.fromEntries(data.summary.map(r => [r.route, r]));
    if (!s.all) { el.replaceChildren('no data in this range'); return; }
    const parts = series.filter(x => s[x.id]).map(x =>
      h('span', {}, `${x.id === 'all' ? 'all' : x.name} `, h('b', {}, fmtPct(s[x.id].on_time_pct))));
    el.replaceChildren(
      'on time: ', ...parts.flatMap((p, i) => (i ? [' · ', p] : [p])),
      ' · avg delay ', h('b', {}, fmtDelay(s.all.avg_delay)),
      ` · ${s.all.days} service day${s.all.days === 1 ? '' : 's'}`,
    );
  }

  // Day x hour grid for all lines. Sequential: dim = good, bright red = late / low on-time.
  function renderHeat() {
    const el = document.getElementById('heat');
    const intensity = r => (isPct()
      ? Math.min(1, Math.max(0, (100 - r.on_time_pct) / 50))   // 100% -> 0, <=50% -> 1
      : Math.min(1, Math.max(0, r.avg_delay / 300)));          // on time/early -> 0, >=+5 min -> 1
    const fill = t => `color-mix(in oklab, ${color('bad')} ${Math.round(t * 100)}%, ${color('grid')})`;

    const days = data.days;
    const cells = new Map(data.heat.map(r => [`${r.day}|${r.hour}`, r]));
    const hours = [...new Set(data.heat.map(r => r.hour))].sort((a, b) => serviceMin(a * 60) - serviceMin(b * 60));
    if (!days.length || !hours.length) { el.replaceChildren(h('p', { class: 'dim' }, 'No data in this range.')); return; }

    el.style.gridTemplateColumns = `34px repeat(${days.length}, minmax(0, 1fr))`;
    el.style.gridTemplateRows = `repeat(${hours.length}, minmax(0, 1fr)) auto`;
    const kids = [];
    hours.forEach((hr, i) => {
      kids.push(h('span', { class: 'rowlab' }, i % 3 === 0 ? fmtMin(hr * 60) : ''));
      for (const d of days) {
        const r = cells.get(`${d}|${hr}`);
        kids.push(r
          ? h('span', { class: 'cell', style: `background:${fill(intensity(r))}`,
                        title: `${fmtDayLong(d)} ${fmtMin(hr * 60)}–${fmtMin(hr * 60 + 60)}\n` +
                               `${fmtPct(r.on_time_pct)} on time · avg ${fmtDelay(r.avg_delay)} · ${Math.round(r.count)} trains` })
          : h('span', { class: 'cell empty' }));
      }
    });
    const every = Math.ceil(days.length / 14);
    kids.push(h('span', {}), ...days.map((d, i) => h('span', { class: 'collab' }, i % every === 0 ? fmtDay(d) : '')));
    el.replaceChildren(...kids);

    const key = document.getElementById('heat-key');
    const [lo, hi] = isPct() ? ['100%', '≤50% on time'] : ['≤0:00', '≥+5:00 avg'];
    key.replaceChildren(lo, ...[0, 0.25, 0.5, 0.75, 1].map(t => h('i', { style: `background:${fill(t)}` })), hi);
  }

  return { init };
})();
