// "Now" panel: KPI tiles, on-time by line, delay histogram, most-delayed list.
// Chart.js defaults set here are shared with history.js.
const Stats = (() => {
  let routes = [];
  const charts = {};

  Chart.defaults.color = color('text-dim');
  Chart.defaults.borderColor = color('grid');
  Chart.defaults.font.family = color('mono');
  Chart.defaults.font.size = 10;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 400;
  Chart.defaults.scale.ticks.maxRotation = 0;  // autoSkip thins labels instead of tilting them

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
  }

  function render(live) {
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
