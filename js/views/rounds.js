import { db } from '../db.js';
import { ic } from '../icons.js';
import { esc, sortRounds, summarize, signed, diffClass, dow, weatherIcon, weatherLabel, parseDate, nineName } from '../util.js';
import { pageHead, newRoundSheet } from '../ui.js';

export async function mount(el) {
  const rounds = sortRounds(await db.rounds()).reverse();
  let html = pageHead({ title: '라운드 기록', sub: `총 ${rounds.length}회` });

  if (!rounds.length) {
    html += `<div class="card empty"><h2>아직 기록이 없어요</h2><p>오늘 라운드부터 기록을 시작해보세요.</p>
      <div class="btns"><button class="btn lime" data-new>${ic('plus')} 라운드 기록하기</button></div></div>`;
  } else {
    let month = '';
    for (const r of rounds) {
      const d = parseDate(r.date);
      const m = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      if (m !== month) { month = m; html += `<div class="month">${m}</div>`; }
      html += item(r);
    }
  }
  el.innerHTML = html;
  el.onclick = e => { if (e.target.closest('[data-new]')) newRoundSheet(); };
}

function item(r) {
  const s = summarize(r);
  const d = parseDate(r.date);
  const scoreBlock = s.complete
    ? `<div class="score"><b class="num">${s.score}</b><small class="${diffClass(s.diff)}">${signed(s.diff)}</small></div>`
    : `<div class="score"><span class="badge warn">${s.filled}/${s.n}홀</span></div>`;
  return `<a class="round-item" href="#/round/${r.id}">
    <div class="date"><b>${d.getDate()}</b><small>${dow(r.date)}</small></div>
    <div><div class="name">${esc(r.course || '코스 미입력')}${nineName(r, 0) || nineName(r, 1) ? ` <span class="badge">${esc(nineName(r, 0) || '전반')}${r.holes.length >= 18 ? `→${esc(nineName(r, 1) || '후반')}` : ''}</span>` : ''}${r.holes.length === 9 ? ' <span class="badge">9H</span>' : ''}${r.sample ? ' <span class="badge">샘플</span>' : ''}</div>
      <div class="meta"><span>${weatherIcon(r.weather)} ${weatherLabel(r.weather)}${r.temp != null ? ` ${r.temp}°` : ''}</span>
      <span>${r.time || ''}</span>${s.puttsN ? `<span>퍼팅 ${s.putts}</span>` : ''}${s.ob ? `<span>OB ${s.ob}</span>` : ''}${s.hz ? `<span>해저드 ${s.hz}</span>` : ''}</div></div>
    ${scoreBlock}</a>`;
}
