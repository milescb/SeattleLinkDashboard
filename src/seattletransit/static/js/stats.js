// Bottom panel: KPI tiles, on-time by line, delay histogram, history, most-delayed list.
const Stats = (() => {
  let routes = [];
  let metric = 'on_time_pct';
  let last = null;
  const charts = {};

  Chart.defaults.color = color('text-dim');
  Chart.defaults.borderColor = color('grid');
  Chart.defaults.font.family = color('mono');
  Chart.defaults.font.size = 10;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 400;

  const bar = { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36 };

  function init(routeList) {
    routes = routeList.map(r => ({ ...r, color: routeColor(r.id, r.color) }));

    charts.lines = new Chart('ch-lines', {
      type: 'bar',
      data: { labels: routes.map(r => r.name), datasets: [{ data: [], backgroundColor: routes.map(r => r.color), ...bar }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtPct(c.raw)} on time` } } },
        scales: { y: { min: 0, max: 100, ticks: { callback: v => `${v}%` } }, x: { grid: { display: false } } },
      },
    });

    charts.hist = new Chart('ch-hist', {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], ...bar, borderSkipped: 'start' }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => `${c[0].label} min`, label: c => `${c.raw} trains` } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      },
    });

    const series = [{ id: 'all', name: 'All lines', color: color('route-all') }, ...routes];
    charts.time = new Chart('ch-time', {
      type: 'line',
      data: {
        datasets: series.map(s => ({
          key: s.id, label: s.name, data: [], borderColor: s.color, backgroundColor: s.color,
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, spanGaps: true,
          borderDash: s.id === 'all' ? [4, 3] : [],
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 2 } },
          tooltip: { callbacks: {
            title: c => fmtTime(c[0].parsed.x),
            label: c => `${c.dataset.label}: ${metric === 'on_time_pct' ? fmtPct(c.parsed.y) : fmtDelay(c.parsed.y)}`,
          } },
        },
        scales: {
          x: { type: 'linear', ticks: { callback: fmtTime, maxTicksLimit: 6 }, grid: { display: false } },
          y: { ticks: { callback: v => (metric === 'on_time_pct' ? `${v}%` : fmtDelay(v)) } },
        },
      },
    });

    document.querySelectorAll('#hist-toggle button').forEach(b => b.addEventListener('click', () => {
      metric = b.dataset.metric;
      document.querySelectorAll('#hist-toggle button').forEach(x => x.classList.toggle('on', x === b));
      if (last) renderHistory(last.history);
    }));
  }

  function renderHistory(history) {
    const num = v => (v === '' || v == null ? null : Number(v));
    charts.time.data.datasets.forEach(ds => {
      ds.data = history.filter(r => r.route === ds.key).map(r => ({ x: Number(r.ts), y: num(r[metric]) }));
    });
    const y = charts.time.options.scales.y;
    [y.min, y.max] = metric === 'on_time_pct' ? [0, 100] : [undefined, undefined];
    charts.time.update();
  }

  function render(live) {
    last = live;
    const s = live.stats;
    const delayMin = live.settings.delay_s / 60;

    document.getElementById('k-ontime').textContent = fmtPct(s.all.on_time_pct);
    document.getElementById('k-median').textContent = fmtDelay(s.all.median_delay);
    const worst = s.worst[0];
    document.getElementById('k-worst').textContent = worst ? fmtDelay(worst.delay) : '–';
    document.getElementById('k-worst-who').textContent = worst ? `${TrainMap.routes[worst.route]?.name} → ${worst.headsign}` : '';

    charts.lines.data.datasets[0].data = routes.map(r => s.routes[r.id]?.on_time_pct ?? 0);
    charts.lines.update();

    const bins = s.hist.bins;
    charts.hist.data.labels = bins.map((b, i) => (i === 0 ? `≤${b}` : i === bins.length - 1 ? `≥${b}` : `${b}`));
    charts.hist.data.datasets[0].data = s.hist.counts;
    charts.hist.data.datasets[0].backgroundColor = bins.map(b => (b >= delayMin ? color('bad') : color('route-all')));
    charts.hist.update();

    renderHistory(live.history);

    document.getElementById('worst').replaceChildren(...s.worst.map(t => h('li',
      { onclick: () => TrainMap.focusTrain(t.route, t.id), title: 'Show on map' },
      h('span', { class: 'who' },
        h('span', { class: 'swatch', style: `display:inline-block;width:4px;height:14px;border-radius:2px;background:${TrainMap.routes[t.route]?.color}` }),
        h('span', {}, `${t.headsign || TrainMap.routes[t.route]?.name}`)),
      h('span', { class: `num ${t.delay >= live.settings.delay_s ? 'bad' : ''}` }, fmtDelay(t.delay)),
    )));
  }

  return { init, render };
})();
