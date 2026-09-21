import { ic } from './icons.js';
import { initTooltip, newRoundSheet } from './ui.js';
import { applyTheme } from './views/settings.js';

const routes = [
  [/^#\/?$/, () => import('./views/dashboard.js'), 'dash'],
  [/^#\/rounds$/, () => import('./views/rounds.js'), 'rounds'],
  [/^#\/round\/(.+)$/, () => import('./views/detail.js'), 'rounds'],
  [/^#\/new$/, () => import('./views/editor.js'), 'flow'],
  [/^#\/edit\/(.+)$/, () => import('./views/editor.js'), 'flow'],
  [/^#\/scan$/, () => import('./views/scan.js'), 'flow'],
  [/^#\/courses$/, () => import('./views/courses.js'), 'courses'],
  [/^#\/settings$/, () => import('./views/settings.js'), 'settings']
];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
let cleanup = null;
let seq = 0;

function drawTabs(active) {
  const tab = (href, key, icon, label) => `<a href="${href}" class="${active === key ? 'on' : ''}" ${active === key ? 'aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></a>`;
  tabbar.innerHTML = `${tab('#/', 'dash', 'chart', '분석')}${tab('#/rounds', 'rounds', 'list', '기록')}
    <div class="fab-wrap"><button class="fab" id="fab" aria-label="새 라운드 기록">${ic('plus')}</button></div>
    ${tab('#/courses', 'courses', 'flag', '코스')}${tab('#/settings', 'settings', 'settings', '설정')}`;
  tabbar.querySelector('#fab').onclick = newRoundSheet;
}

async function route() {
  const my = ++seq;
  const hash = location.hash || '#/';
  const hit = routes.map(([re, loader, tab]) => [hash.match(re), loader, tab]).find(([m]) => m);
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* noop */ } }
  cleanup = null;
  app.className = ''; app.onclick = app.onchange = app.oninput = null;
  document.querySelectorAll('.overlay').forEach(o => o.remove());

  if (!hit) { location.hash = '#/'; return; }
  const [m, loader, tab] = hit;
  tabbar.hidden = tab === 'flow';
  if (tab !== 'flow') drawTabs(tab);
  app.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    const mod = await loader();
    if (my !== seq) return;
    cleanup = await mod.mount(app, { id: m[1] ? decodeURIComponent(m[1]) : undefined });
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="card empty" style="margin-top:40px"><h2>화면을 불러오지 못했어요</h2><p>${String(err?.message || err)}</p><a class="btn" href="#/">처음으로</a></div>`;
  }
}

applyTheme();
initTooltip();
addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
