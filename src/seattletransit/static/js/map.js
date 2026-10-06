// Main panel: Leaflet map with line shapes, stations and live train markers.
const TrainMap = (() => {
  const map = L.map('map', { zoomControl: false }).setView([47.61, -122.25], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  function addTiles(cartoKey) {
    const style = color('tiles').replace(/["']/g, '') || 'dark_all';
    if (cartoKey) {
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png?key=${cartoKey}`, {
        attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);
    } else {
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri', maxZoom: 16,
      }).addTo(map);
    }
  }

  const routes = {};   // route id -> {id, name, color}
  const layers = {};   // route id -> {lines, trains} layer groups
  const markers = {};  // "route:vehicle" -> L.marker (marker.train holds the latest data)
  let settings = { delay_s: 180, at_station_s: 30 };

  function init(stat) {
    addTiles(stat.carto_key);
    const bounds = L.latLngBounds([]);
    stat.routes.forEach(r => {
      routes[r.id] = { ...r, color: routeColor(r.id, r.color) };
      layers[r.id] = { lines: L.layerGroup().addTo(map), trains: L.layerGroup().addTo(map) };
    });
    stat.shapes.forEach(s => {
      const c = routes[s.route].color;
      // wide faint line underneath = glow
      L.polyline(s.coords, { color: c, weight: 9, opacity: 0.15, base: 0.15, interactive: false }).addTo(layers[s.route].lines);
      L.polyline(s.coords, { color: c, weight: 3, opacity: 0.9, base: 0.9, interactive: false }).addTo(layers[s.route].lines);
      bounds.extend(s.coords);
    });
    stat.stations.forEach(s => L.circleMarker([s.lat, s.lon], {
      radius: 4, weight: 1.5, color: color('bg'), fillColor: color('station'), fillOpacity: 1,
    }).bindTooltip(s.name, { direction: 'top' }).addTo(map));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    map.on('click', () => highlight(null));
    buildLegend();
  }

  function buildLegend() {
    const el = document.getElementById('legend');
    Object.values(routes).forEach(r => {
      const box = h('input', { type: 'checkbox', checked: '' });
      box.addEventListener('change', () => {
        for (const g of Object.values(layers[r.id])) box.checked ? g.addTo(map) : g.remove();
      });
      el.append(h('label', {}, box, h('span', { class: 'swatch', style: `background:${r.color}` }), r.name));
    });
    const dot = (cls, c) => h('span', { class: `train-dot ${cls}`, style: `--c:${c}` });
    el.append(
      h('div', { class: 'key small' }, dot('delayed', ''), `≥ ${settings.delay_s / 60} min late`),
      h('div', { class: 'key small' }, dot('delayed at-station', ''), 'late, at station'),
      h('div', { class: 'key small' }, dot('stale', ''), 'no realtime'),
    );
  }

  // dim every line except `routeId` (null = reset)
  function highlight(routeId) {
    for (const [id, g] of Object.entries(layers)) {
      g.lines.eachLayer(l => l.setStyle({ opacity: !routeId || id === routeId ? l.options.base : l.options.base * 0.2 }));
    }
  }

  function trainClass(t) {
    if (!t.predicted) return 'stale';
    if (t.delay < settings.delay_s) return '';
    return Math.abs(t.closest_offset) <= settings.at_station_s ? 'delayed at-station' : 'delayed';
  }

  function tooltip(t) {
    const where = Math.abs(t.closest_offset) <= settings.at_station_s ? `at ${esc(t.closest_stop)}` : `next: ${esc(t.next_stop)}`;
    return `<b>${routes[t.route].name}</b> → ${esc(t.headsign)}<br>` +
      `<span class="num">${t.predicted ? fmtDelay(t.delay) : 'scheduled'}</span> · ${where}<br>` +
      `<span class="dim small">vehicle ${esc(t.id.replace(/^\d+_/, ''))}</span>`;
  }

  function update(trains, newSettings) {
    settings = newSettings || settings;
    const seen = new Set();
    for (const t of trains) {
      if (!routes[t.route]) continue;
      const key = `${t.route}:${t.id}`;
      seen.add(key);
      const cls = `train-dot ${trainClass(t)}`;
      let m = markers[key];
      if (!m) {
        m = markers[key] = L.marker([t.lat, t.lon], {
          icon: L.divIcon({ className: 'train', html: `<div class="${cls}" style="--c:${routes[t.route].color}"></div>`, iconSize: [12, 12] }),
          zIndexOffset: t.delay >= settings.delay_s ? 1000 : 0,
        }).bindTooltip(() => tooltip(m.train), { direction: 'top', offset: [0, -8] })
          .on('click', e => { L.DomEvent.stopPropagation(e); highlight(m.train.route); })
          .addTo(layers[t.route].trains);
      } else {
        m.setLatLng([t.lat, t.lon]);  // CSS transition on .train makes this glide
        const dot = m.getElement()?.firstChild;
        if (dot) dot.className = cls;
        m.setZIndexOffset(t.delay >= settings.delay_s ? 1000 : 0);
      }
      m.train = t;
      if (m.isTooltipOpen()) m.setTooltipContent(tooltip(t));
    }
    for (const key of Object.keys(markers)) {
      if (!seen.has(key)) { markers[key].remove(); delete markers[key]; }
    }
  }

  // pan to a train and show its tooltip (used by the "most delayed" list)
  function focusTrain(route, id) {
    const m = markers[`${route}:${id}`];
    if (!m) return;
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.8 });
    highlight(route);
    map.once('moveend', () => m.openTooltip());
  }

  return { init, update, focusTrain, routes };
})();
