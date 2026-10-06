// Wires the panels together: loads static data once, then polls /api/live.
const REFRESH_MS = 15000;
let lastUpdated = 0;
let pollSeconds = 30;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function setText(id, v) { document.getElementById(id).textContent = v; }

async function refresh() {
  try {
    const live = await getJSON('/api/live');
    lastUpdated = live.updated;
    pollSeconds = live.settings.poll_s;
    TrainMap.update(live.trains, live.settings);
    Alerts.render(live.alerts);
    Stats.render(live);

    setText('c-trains', live.stats.in_service);
    setText('c-ontime', fmtPct(live.stats.all.on_time_pct));
    setText('c-delayed', live.trains.filter(t => t.predicted && t.delay >= live.settings.delay_s).length);
    setText('c-alerts', live.alerts.length);
    document.querySelector('.live-dot').title = live.error ? `last poll failed: ${live.error}` : 'live';
    tick();
  } catch (e) {
    console.warn(e);
  }
}

function tick() {
  setText('clock', new Date().toLocaleTimeString([], { hour12: false }));
  const age = Math.round(Date.now() / 1000 - lastUpdated);
  setText('updated', lastUpdated ? `updated ${age}s ago` : 'waiting for data…');
  document.querySelector('.live-dot').classList.toggle('stale', !lastUpdated || age > pollSeconds * 3);
}

(async () => {
  tick();
  setInterval(tick, 1000);
  const stat = await getJSON('/api/static');
  TrainMap.init(stat);
  Stats.init(stat.routes);
  await refresh();
  setInterval(refresh, REFRESH_MS);
})();
