import { db } from '../db.js';
import { ic } from '../icons.js';
import { esc, summarize, signed, fmtDate, weatherIcon, weatherLabel, sum, tClass, catOf, scoreName, nineName, differential } from '../util.js';
import { pageHead, confirmDialog, toast } from '../ui.js';

const shapeOf = d => {
  const c = catOf(d);
  return c === 'eagle' ? 'rnd ring' : c === 'birdie' ? 'rnd' : c === 'par' ? 'plain' : c === 'bogey' ? '' : c === 'double' ? 'ring' : 'ring';
};
const cell = (score, par) => {
  if (score == null) return '<span class="muted">–</span>';
  const d = score - par;
  return `<span class="cellscore ${tClass(d)} ${shapeOf(d)}" title="${scoreName(score, par)}">${score}</span>`;
};

function nineTable(r, from) {
  const to = Math.min(from + 9, r.holes.length);
  const idx = Array.from({ length: to - from }, (_, k) => from + k);
  const hs = idx.map(i => r.holes[i]);
  const parSum = sum(idx.map(i => r.pars[i]));
  const played = hs.filter(h => h.score != null);
  const sc = sum(played.map(h => h.score));
  const putted = hs.filter(h => h.putts != null);
  const row = (label, fn, total) => `<tr><th class="rl">${label}</th>${idx.map(fn).join('')}<td class="tot">${total}</td></tr>`;
  const tsIdx = idx.filter(i => r.holes[i].teeShot != null);
  const tsHit = tsIdx.filter(i => r.holes[i].teeShot === 1).length;
  const label = from === 0 ? (r.holes.length === 9 ? 'TOTAL' : 'OUT') : 'IN';
  return `<div class="sc-wrap"><table class="sc">
    <thead><tr><th class="rl" title="${esc(nineName(r, from / 9))}">${esc(nineName(r, from / 9)) || '홀'}</th>${idx.map(i => `<th><a class="holelink" href="#/edit/${r.id}?hole=${i}" aria-label="${i + 1}번 홀 수정">${i + 1}</a></th>`).join('')}<th class="tot">${label}</th></tr></thead>
    <tbody>
      ${row('파', i => `<td>${r.pars[i]}</td>`, parSum)}
      ${row('스코어', i => `<td>${cell(r.holes[i].score, r.pars[i])}</td>`, played.length ? sc : '–')}
      ${row('퍼팅', i => `<td>${r.holes[i].putts ?? '–'}</td>`, putted.length ? sum(putted.map(h => h.putts)) : '–')}
      ${row('OB', i => `<td>${r.holes[i].ob || '·'}</td>`, sum(hs.map(h => h.ob || 0)))}
      ${row('해저드', i => `<td>${r.holes[i].hazard || '·'}</td>`, sum(hs.map(h => h.hazard || 0)))}
      ${row('티샷', i => `<td>${r.holes[i].teeShot === 1 ? '<span class="fw-ok" aria-label="안착">✓</span>' : r.holes[i].teeShot === 0 ? '<span class="fw-no" aria-label="실패">✗</span>' : '–'}</td>`, tsIdx.length ? `${tsHit}/${tsIdx.length}` : '–')}
    </tbody></table></div>`;
}

export async function mount(el, { id }) {
  const r = await db.round(id);
  if (!r) { location.hash = '#/rounds'; return; }
  const s = summarize(r);
  const diff = differential(r, s);

  el.innerHTML = pageHead({ title: r.course || '코스 미입력', sub: '라운드 상세', back: '#/rounds' }) + `
  <div class="detail-hero">
    <div><span class="big num">${s.filled ? s.score : '–'}</span>${s.filled ? `<span class="diff">${signed(s.diff)}</span>` : ''}</div>
    <div class="info">
      <span>${ic('calendar', 16)} ${fmtDate(r.date)}</span>
      ${r.time ? `<span>${ic('clock', 16)} ${r.time} 티오프</span>` : ''}
      <span>${weatherIcon(r.weather)} ${weatherLabel(r.weather)}${r.temp != null ? ` · ${r.temp}°C` : ''}</span>
      <span>${ic('flag', 16)} ${r.holes.length}홀 · 파 ${s.parTotal}</span>
      ${r.rating != null && r.slope != null ? `<span>${ic('target', 16)} ${r.tee ? `${esc(r.tee)} · ` : ''}레이팅 ${r.rating} / 슬로프 ${r.slope}${r.ratingEst ? ' (평균 임시값)' : ''}${diff != null ? ` · 핸디캡 차이 ${diff.toFixed(1)}` : ''}</span>` : ''}
      ${nineName(r, 0) || nineName(r, 1) ? `<span>${ic('pin', 16)} ${esc(nineName(r, 0) || '전반')}${r.holes.length >= 18 ? ` → ${esc(nineName(r, 1) || '후반')}` : ''}</span>` : ''}
    </div>
    ${s.complete ? '' : `<div class="info"><span class="badge warn">${s.filled}/${s.n}홀 입력됨 · 미완료 라운드는 분석에서 제외돼요</span></div>`}
  </div>

  <div class="card" style="margin-top:12px"><div class="stat-tiles">
    <div class="stat-tile"><b class="num">${s.puttsN ? s.putts : '–'}</b><span>퍼팅</span></div>
    <div class="stat-tile"><b class="num">${s.girN ? Math.round((s.gir / s.girN) * 100) + '%' : '–'}</b><span>그린적중</span></div>
    <div class="stat-tile"><b class="num">${s.fwN ? Math.round((s.fwHit / s.fwN) * 100) + '%' : '–'}</b><span>페어웨이</span></div>
    <div class="stat-tile"><b class="num">${s.ob}</b><span>OB</span></div>
    <div class="stat-tile"><b class="num">${s.hz}</b><span>해저드</span></div>
  </div></div>

  <div class="section-title"><span>스코어카드</span></div>
  <div class="card">${nineTable(r, 0)}${r.holes.length > 9 ? `<div style="height:14px"></div>${nineTable(r, 9)}` : ''}
    <p class="small muted" style="margin:10px 0 0">티샷 ✓ = 페어웨이 안착(파4·5) · 온그린(파3). 홀 번호를 누르면 그 홀의 스코어 · 퍼팅 · OB · 해저드를 수정할 수 있어요.</p>
    <div class="legend" style="margin-top:8px"><span><i class="t-b1" style="border-radius:50%"></i>버디↓</span><span><i class="t-0"></i>파</span><span><i class="t-r1"></i>보기</span><span><i class="t-r3"></i>더블↑</span></div></div>

  ${r.memo ? `<div class="section-title"><span>메모</span></div><div class="card"><p style="margin:0;white-space:pre-wrap">${esc(r.memo)}</p></div>` : ''}
  ${r.image ? `<div class="section-title"><span>스코어카드 사진</span></div><img class="photo" src="${r.image}" alt="스코어카드 사진">` : ''}

  <div class="grid-2" style="margin-top:20px">
    <a class="btn secondary" href="#/edit/${r.id}">${ic('edit')} 수정</a>
    <button class="btn danger" id="del">${ic('trash')} 삭제</button>
  </div>`;

  el.querySelector('#del').onclick = async () => {
    if (await confirmDialog({ title: '이 라운드를 삭제할까요?', message: `${fmtDate(r.date)} ${r.course || ''} 기록이 기기에서 완전히 삭제돼요.`, ok: '삭제', danger: true })) {
      await db.deleteRound(r.id); toast('삭제했어요'); location.hash = '#/rounds';
    }
  };
}
