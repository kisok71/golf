import { ic } from './icons.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENT[c]);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const pad = n => String(n).padStart(2, '0');
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sum = a => a.reduce((s, v) => s + v, 0);
export const mean = a => (a.length ? sum(a) / a.length : null);

export const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => dateStr(new Date());
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const parseDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const fmtDate = s => { const d = parseDate(s); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${DOW[d.getDay()]})`; };
export const fmtShort = s => { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
export const dow = s => DOW[parseDate(s).getDay()];

export const f1 = n => (n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1));
export const signed = (n, digits = 0) => {
  if (n == null) return '–';
  const k = 10 ** digits;
  const v = Math.round(n * k) / k;
  const t = digits ? v.toFixed(digits) : String(v);
  return v > 0 ? `+${t}` : t;
};
export const diffClass = d => (d > 0 ? 'over-t' : d < 0 ? 'under-t' : 'even-t');

export const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];

export const WEATHER = {
  sunny: { label: '맑음', icon: 'sun' },
  partly: { label: '구름조금', icon: 'partly' },
  cloudy: { label: '흐림', icon: 'cloud' },
  rain: { label: '비', icon: 'rain' },
  windy: { label: '바람', icon: 'wind' },
  snow: { label: '눈', icon: 'snow' }
};
export const weatherIcon = k => ic(WEATHER[k]?.icon || 'sun');
export const weatherLabel = k => WEATHER[k]?.label || '';

export const CATS = [
  { k: 'eagle', label: '이글 이하', t: 't-b2' },
  { k: 'birdie', label: '버디', t: 't-b1' },
  { k: 'par', label: '파', t: 't-0' },
  { k: 'bogey', label: '보기', t: 't-r1' },
  { k: 'double', label: '더블보기', t: 't-r3' },
  { k: 'triple', label: '트리플 이상', t: 't-r4' }
];
export const catOf = d => (d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'triple');
export const tClass = d => CATS.find(c => c.k === catOf(d)).t;
export function scoreName(score, par) {
  if (score == null) return '';
  if (score === 1) return '홀인원';
  const d = score - par;
  if (d <= -3) return '알바트로스';
  return ['이글', '버디', '파', '보기', '더블보기', '트리플보기'][d + 2] || `+${d}`;
}

export function newRound(n = 18) {
  return {
    id: uid(), date: todayStr(), time: nowTime(), course: '', weather: 'sunny', temp: null,
    pars: DEFAULT_PARS.slice(0, n),
    holes: Array.from({ length: n }, () => ({ score: null, putts: null, ob: 0, hazard: 0 })),
    memo: '', createdAt: Date.now()
  };
}
export function resizeRound(r, n) {
  if (r.holes.length === n) return;
  if (n < r.holes.length) { r.holes.length = n; r.pars.length = n; return; }
  while (r.holes.length < n) {
    r.holes.push({ score: null, putts: null, ob: 0, hazard: 0 });
    r.pars.push(DEFAULT_PARS[r.pars.length] ?? 4);
  }
}

export const roundKey = r => `${r.date} ${r.time || '00:00'}`;
export const sortRounds = a => [...a].sort((x, y) => (roundKey(x) < roundKey(y) ? -1 : roundKey(x) > roundKey(y) ? 1 : 0));

export function summarize(r) {
  const n = r.holes.length;
  let score = 0, par = 0, putts = 0, puttsN = 0, ob = 0, hz = 0, filled = 0, gir = 0, girN = 0;
  r.holes.forEach((h, i) => {
    ob += h.ob || 0; hz += h.hazard || 0;
    if (h.score == null) return;
    filled++; score += h.score; par += r.pars[i];
    if (h.putts != null) { puttsN++; putts += h.putts; girN++; if (h.score - h.putts <= r.pars[i] - 2) gir++; }
  });
  return { n, score, par, diff: score - par, putts, puttsN, ob, hz, filled, complete: filled === n, gir, girN, parTotal: sum(r.pars) };
}

export function downloadFile(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const parsMini = pars => `<div class="pars-mini">${pars.map(p => `<i class="p${p}">${p}</i>`).join('')}</div>`;

export function parGridHtml(pars) {
  return `<div class="pargrid">${pars.map((p, i) => `<button type="button" data-act="par" data-i="${i}" class="p${p}" aria-label="${i + 1}번 홀 파 ${p}"><small>${i + 1}</small><b>${p}</b></button>`).join('')}</div>`;
}
export const cyclePar = p => (p >= 5 ? 3 : p + 1);
