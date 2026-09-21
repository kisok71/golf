import { esc, fmtShort, signed, CATS } from './util.js';

const W = 360;

function niceStep(range) {
  if (range <= 6) return 1;
  if (range <= 12) return 2;
  if (range <= 30) return 5;
  return 10;
}

/** 스코어 추이 선 차트 (기준선 = 코스 파) */
export function trendChart(series, { mode }) {
  const H = 190, L = 32, R = 46, T = 16, B = 26;
  const n = series.length;
  const ys = series.map(p => p.score);
  const par = series[n - 1].par;
  let lo = Math.min(...ys, par), hi = Math.max(...ys, par);
  const step = niceStep(hi - lo + 2);
  lo = Math.floor((lo - 1) / step) * step; hi = Math.ceil((hi + 1) / step) * step;
  const x = i => (n === 1 ? (L + W - R) / 2 : L + ((W - L - R) * i) / (n - 1));
  const y = v => T + ((hi - v) / (hi - lo)) * (H - T - B);

  let grid = '';
  for (let v = lo; v <= hi; v += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;

  const idxs = n <= 6 ? series.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1];
  const xl = [...new Set(idxs)].map(i => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtShort(series[i].date)}</text>`).join('');

  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join('');
  const bestI = ys.indexOf(Math.min(...ys));
  const dots = series.map((p, i) => {
    const tip = `<b>${fmtShort(p.date)} ${esc(p.course)}</b><br>${p.score}타 (${signed(p.diff)})${p.putts != null ? ` · 퍼팅 ${p.putts}` : ''}`;
    return `<circle class="hit" cx="${x(i)}" cy="${y(p.score)}" r="16" data-tip="${esc(tip)}"/><circle class="dot${i === n - 1 ? ' hl' : ''}" cx="${x(i)}" cy="${y(p.score)}" r="${n > 24 ? 2.5 : 3.5}" pointer-events="none"/>`;
  }).join('');

  const bx = x(bestI), by = y(ys[bestI]);
  const anchor = bx > W - R - 30 ? 'end' : bx < L + 30 ? 'start' : 'middle';
  const best = `<text class="lbl" x="${bx}" y="${by - 10}" text-anchor="${anchor}">베스트 ${ys[bestI]}</text>`;
  const parLine = `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(par)}" y2="${y(par)}"/><text x="${W - R + 6}" y="${y(par) + 4}">파 ${par}</text>`;

  const table = `<details class="tbl"><summary>표로 보기</summary><table><thead><tr><th>날짜</th><th>코스</th><th>타수</th><th>파 대비</th></tr></thead><tbody>${
    [...series].reverse().map(p => `<tr><td>${fmtShort(p.date)}</td><td>${esc(p.course)}</td><td>${p.score}</td><td>${signed(p.diff)}</td></tr>`).join('')}</tbody></table></details>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${mode}홀 스코어 추이">${grid}${parLine}<path class="line" d="${path}"/>${dots}${best}${xl}</svg>${table}`;
}

/** 라운드별 OB(주황/빨강) + 해저드(파랑) 누적 막대 */
export function penaltyChart(series) {
  const data = series.slice(-12);
  const H = 150, L = 24, R = 6, T = 10, B = 24;
  const max = Math.max(2, ...data.map(d => d.ob + d.hz));
  const top = Math.ceil(max / 2) * 2;
  const slot = (W - L - R) / data.length, bw = Math.min(22, slot * 0.62);
  const y = v => T + ((top - v) / top) * (H - T - B);
  let g = '';
  for (let v = 0; v <= top; v += top / 2) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const bars = data.map((d, i) => {
    const cx = L + slot * i + slot / 2, x0 = cx - bw / 2;
    const tip = `<b>${fmtShort(d.date)}</b><br>OB ${d.ob}회 · 해저드 ${d.hz}회`;
    const obH = (d.ob / top) * (H - T - B), hzH = (d.hz / top) * (H - T - B);
    let s = `<rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" data-tip="${esc(tip)}"/>`;
    if (d.ob) s += `<rect class="bar-ob" x="${x0}" y="${y(0) - obH}" width="${bw}" height="${obH}" rx="3" pointer-events="none"/>`;
    if (d.hz) s += `<rect class="bar-hz" x="${x0}" y="${y(0) - obH - hzH - (d.ob ? 2 : 0)}" width="${bw}" height="${hzH}" rx="3" pointer-events="none"/>`;
    const showX = data.length <= 8 || i % 2 === (data.length - 1) % 2;
    return s + (showX ? `<text x="${cx}" y="${H - 6}" text-anchor="middle">${fmtShort(d.date)}</text>` : '');
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="라운드별 OB와 해저드 횟수">${g}${bars}</svg>
    <div class="legend"><span><i style="background:var(--over)"></i>OB</span><span><i style="background:var(--under)"></i>해저드</span></div>`;
}

/** 100% 누적 가로 막대 + 범례 행 */
export function stackBar(items, total) {
  const segs = items.filter(i => i.v > 0);
  const bar = segs.map(i => {
    const p = (i.v / total) * 100;
    return `<span class="${i.t}" style="flex:${i.v} 1 0" title="${esc(i.label)} ${i.v}">${p >= 9 ? `${Math.round(p)}%` : ''}</span>`;
  }).join('');
  const rows = items.map(i => `<div class="r"><i class="${i.t}"></i><span>${esc(i.label)}</span><b>${i.v}</b><span>${total ? Math.round((i.v / total) * 100) : 0}%</span></div>`).join('');
  return `<div class="stackbar" role="img" aria-label="비율 막대">${bar}</div><div class="legend-rows">${rows}</div>`;
}

export const distBar = (dist, total) => stackBar(CATS.map(c => ({ ...c, v: dist[c.k] })), total);

/** 가로 막대 목록. items: { name, sub, v, label, cls } */
export function hbars(items, { wide = false, signedScale = false } = {}) {
  if (!items.length) return '';
  const vals = items.map(i => i.v);
  const max = Math.max(...vals.map(Math.abs), 0.01);
  return `<div class="hbars">${items.map(i => {
    let style, cls = i.cls || '';
    if (signedScale) {
      const min = Math.min(0, ...vals), mx = Math.max(0, ...vals), span = mx - min || 1;
      const zero = ((0 - min) / span) * 100;
      const a = ((Math.min(0, i.v) - min) / span) * 100, b = ((Math.max(0, i.v) - min) / span) * 100;
      style = `left:${a}%;width:${Math.max(b - a, 1.5)}%`;
      cls += i.v > 0 ? ' over' : i.v < 0 ? ' under' : '';
      return `<div class="hbar${wide ? ' wide' : ''}"><div class="name">${esc(i.name)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>
        <div class="track"><div class="fill ${cls}" style="${style}"></div><span style="position:absolute;left:${zero}%;top:-2px;bottom:-2px;width:1px;background:var(--muted);opacity:.5"></span></div><div class="val">${esc(i.label)}</div></div>`;
    }
    style = `left:0;width:${Math.max((Math.abs(i.v) / max) * 100, 3)}%`;
    return `<div class="hbar${wide ? ' wide' : ''}"><div class="name">${esc(i.name)}${i.sub ? `<small>${esc(i.sub)}</small>` : ''}</div>
      <div class="track"><div class="fill ${cls}" style="${style}"></div></div><div class="val">${esc(i.label)}</div></div>`;
  }).join('')}</div>`;
}

/** 홀별 평균(파 대비) 히트맵 - 셀에 항상 수치를 표기한다 */
export function heatmap(holeStats) {
  const cls = v => (v == null ? 'none' : v <= -0.5 ? 't-b2' : v < -0.15 ? 't-b1' : v < 0.25 ? 't-0' : v < 0.6 ? 't-r1' : v < 1.0 ? 't-r2' : v < 1.5 ? 't-r3' : 't-r4');
  const rows = [];
  for (let s = 0; s < holeStats.length; s += 9) rows.push(holeStats.slice(s, s + 9));
  const cell = h => `<div class="cell ${cls(h.avg)}" data-tip="<b>${h.i + 1}번 홀 (파${h.par})</b><br>평균 ${h.avg == null ? '-' : signed(h.avg, 1)}타 · ${h.n}회${h.trouble ? `<br>OB·해저드 ${h.trouble}회` : ''}"><small>${h.i + 1}</small><b>${h.avg == null ? '–' : signed(h.avg, 1)}</b></div>`;
  return rows.map(r => `<div class="heat" style="margin-bottom:6px">${r.map(cell).join('')}</div>`).join('') +
    `<div class="heat-legend"><i class="t-b2"></i>잘 침 <i class="t-b1"></i><i class="t-0"></i><i class="t-r1"></i><i class="t-r2"></i><i class="t-r3"></i><i class="t-r4"></i>어려움</div>`;
}
