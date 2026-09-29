import { db } from '../db.js';
import { ic } from '../icons.js';
import {
  esc, summarize, signed, fmtDate, weatherIcon, weatherLabel, sum, tClass, catOf, scoreName, nineName
} from '../util.js';
import { pageHead } from '../ui.js';
import { getPlayer } from './scan.js';

/** 통상적인 골프 스코어카드 형식: HOLE · PAR · 내 스코어 행만 보여준다 (퍼팅·OB·해저드 같은 세부 기록은 라운드 상세 화면에 있음) */
const shapeOf = d => {
  const c = catOf(d);
  return c === 'eagle' ? 'rnd ring' : c === 'birdie' ? 'rnd' : c === 'par' ? 'plain' : c === 'bogey' ? '' : c === 'double' ? 'ring' : 'ring';
};
const cell = (score, par) => {
  if (score == null) return '<span class="muted">–</span>';
  const d = score - par;
  return `<span class="cellscore ${tClass(d)} ${shapeOf(d)}" title="${scoreName(score, par)}">${score}</span>`;
};

function nineTable(r, from, player) {
  const to = Math.min(from + 9, r.holes.length);
  const idx = Array.from({ length: to - from }, (_, k) => from + k);
  const hs = idx.map(i => r.holes[i]);
  const parSum = sum(idx.map(i => r.pars[i]));
  const played = hs.filter(h => h.score != null);
  const scSum = sum(played.map(h => h.score));
  const label = from === 0 ? (r.holes.length === 9 ? 'TOTAL' : 'OUT') : 'IN';
  const row = (name, fn, total, cls = '') => `<tr><th class="rl ${cls}">${esc(name)}</th>${idx.map(fn).join('')}<td class="tot ${cls}">${total}</td></tr>`;
  return `<div class="sc-wrap"><table class="sc">
    <thead><tr><th class="rl" title="${esc(nineName(r, from / 9))}">${esc(nineName(r, from / 9)) || 'HOLE'}</th>${idx.map(i => `<th>${i + 1}</th>`).join('')}<th class="tot">${label}</th></tr></thead>
    <tbody>
      ${row('PAR', i => `<td>${r.pars[i]}</td>`, parSum)}
      ${row(player, i => `<td>${cell(r.holes[i].score, r.pars[i])}</td>`, played.length ? scSum : '–', 'score-row')}
    </tbody></table></div>`;
}

export async function mount(el, { id }) {
  const r = await db.round(id);
  if (!r) { location.hash = '#/rounds'; return; }
  const s = summarize(r);
  const player = getPlayer().trim();
  const nine = nineName(r, 0) || nineName(r, 1)
    ? `${esc(nineName(r, 0) || '전반')}${r.holes.length >= 18 ? ` - ${esc(nineName(r, 1) || '후반')}` : ''}`
    : '';

  el.innerHTML = pageHead({ title: r.course || '코스 미입력', sub: '스코어카드', back: `#/round/${r.id}`, right: `<button class="icon-btn plain" id="print" aria-label="인쇄">${ic('printer', 18)}</button>` }) + `
  <div class="detail-hero score-card-hero">
    <div class="row between" style="align-items:flex-start;gap:16px">
      <div><span class="big num">${s.filled ? s.score : '–'}</span>${s.filled ? `<span class="diff">${signed(s.diff)}</span>` : ''}</div>
      <div style="text-align:right;min-width:0">
        <div class="player-name">${player ? esc(player) : '이름 미입력'}</div>
        ${nine ? `<div class="small" style="opacity:.85;margin-top:2px">${nine}</div>` : ''}
      </div>
    </div>
    <div class="info">
      <span>${ic('calendar', 16)} ${fmtDate(r.date)}</span>
      ${r.time ? `<span>${ic('clock', 16)} ${r.time} 티오프</span>` : ''}
      <span>${weatherIcon(r.weather)} ${weatherLabel(r.weather)}${r.temp != null ? ` ${r.temp}°C` : ''}</span>
      <span>${ic('flag', 16)} ${r.holes.length}홀 · 파 ${s.parTotal}</span>
    </div>
    ${!player ? `<div class="info no-print"><a href="#/settings" style="color:inherit;text-decoration:underline">설정에서 이름을 입력하면 여기 표시돼요</a></div>` : ''}
    ${s.complete ? '' : `<div class="info"><span class="badge warn">${s.filled}/${s.n}홀 입력됨 · 미완료</span></div>`}
  </div>

  <div class="card score-card-sheet" style="margin-top:12px">
    ${nineTable(r, 0, player || '스코어')}
    ${r.holes.length > 9 ? `<div style="height:14px"></div>${nineTable(r, 9, player || '스코어')}` : ''}
    <div class="score-total-line">
      <span>OUT <b class="num">${sumRange(r, 0, 9)}</b></span>
      ${r.holes.length > 9 ? `<span>IN <b class="num">${sumRange(r, 9, 18)}</b></span>` : ''}
      <span>TOTAL <b class="num">${s.filled ? s.score : '–'}</b></span>
      <span>파 대비 <b class="num">${s.filled ? signed(s.diff) : '–'}</b></span>
    </div>
    <div class="legend" style="margin-top:12px"><span><i class="t-b1" style="border-radius:50%"></i>버디↓</span><span><i class="t-0"></i>파</span><span><i class="t-r1"></i>보기</span><span><i class="t-r3"></i>더블↑</span></div>
  </div>

  <p class="small muted no-print" style="text-align:center;margin-top:14px">퍼팅 · OB · 해저드 등 자세한 기록은 <a href="#/round/${r.id}">라운드 상세</a>에서 볼 수 있어요.</p>`;

  el.querySelector('#print').onclick = () => window.print();
}

function sumRange(r, from, to) {
  const idx = Array.from({ length: Math.min(to, r.holes.length) - from }, (_, k) => from + k);
  const played = idx.filter(i => r.holes[i].score != null);
  return played.length ? sum(played.map(i => r.holes[i].score)) : '–';
}
