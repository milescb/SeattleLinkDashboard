// Side panel: service alerts. Expanded alerts stay expanded across refreshes.
const Alerts = (() => {
  const list = document.getElementById('alerts');
  const open = new Set();

  function render(alerts) {
    document.getElementById('alert-count').textContent = alerts.length;
    if (!alerts.length) {
      list.replaceChildren(h('p', { class: 'dim' }, 'All clear — no active alerts.'));
      return;
    }
    list.replaceChildren(...alerts.map(a => {
      const chips = a.routes.length
        ? a.routes.map(id => h('span', { class: 'chip', style: `background:${TrainMap.routes[id]?.color}` }, TrainMap.routes[id]?.name || id))
        : [h('span', { class: 'chip', style: `background:${color('stale')}` }, 'Systemwide')];
      const period = a.end ? `until ${new Date(a.end * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
      const d = h('details', { class: 'alert' },
        h('summary', {}, h('div', {}, a.header), h('div', {}, ...chips, h('span', { class: 'dim small' }, period))),
        a.description ? h('p', {}, a.description) : null,
        a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener' }, 'More info ↗') : null,
      );
      d.open = open.has(a.id);
      d.addEventListener('toggle', () => (d.open ? open.add(a.id) : open.delete(a.id)));
      return d;
    }));
  }

  return { render };
})();
