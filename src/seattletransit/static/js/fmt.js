// Small formatting + DOM helpers shared by the panels.

// 125 -> "+2:05", -40 -> "−0:40"
function fmtDelay(s) {
  if (s == null || s === '') return '–';
  const a = Math.abs(Math.round(s));
  return `${s < 0 ? '−' : '+'}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

const fmtPct = v => (v == null || v === '' ? '–' : `${Math.round(v)}%`);
const fmtTime = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// h('div', {class: 'x'}, 'text', child) — builds DOM without innerHTML (alert text is untrusted).
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...children.filter(c => c != null));
  return el;
}
