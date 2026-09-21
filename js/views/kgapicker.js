import { ic } from '../icons.js';
import { esc } from '../util.js';
import { sheet } from '../ui.js';
import { loadKga, searchClubs, rankCombos, teesOf, averages } from '../kga.js';

const SEX = 'gn.gender';
export const getSex = () => { try { return localStorage.getItem(SEX) === '1' ? 1 : 0; } catch { return 0; } };
const setSex = v => { try { localStorage.setItem(SEX, String(v)); } catch { /* noop */ } };

/**
 * KGA 코스 레이팅 선택 시트: 골프장 → 코스 조합 → 티를 골라 레이팅·슬로프를 채운다.
 * 자료에 없는 골프장이면 평균값으로 임시 입력할 수 있다 (est: true).
 * onApply({ club, course, tee, rating, slope, yd, front, back, est })
 */
export function openKgaPicker({ query = '', front = '', back = '', onApply }) {
  const ctl = new AbortController();
  const s = sheet('', { onClose: () => ctl.abort() });
  const el = s.el;
  let data = null, error = '', sex = getSex(), q = query.trim(), club = null, course = null;

  const skeleton = () => {
    el.innerHTML = `<div class="grab"></div><h3>KGA 공식 레이팅</h3>
      <p class="small muted" style="margin:0 0 10px">대한골프협회 코스레이팅 현황${data?.date ? ` (${esc(data.date)} 기준)` : ''}에서 골프장과 티를 골라요.</p>
      <div class="seg" role="group" aria-label="성별" style="margin-bottom:10px"><button data-sex="0" class="${sex === 0 ? 'on' : ''}">남자 티</button><button data-sex="1" class="${sex === 1 ? 'on' : ''}">여자 티</button></div>
      <div class="field"><input id="kga-q" class="input" placeholder="골프장 이름 (예: 화성상록)" value="${esc(q)}" autocomplete="off"></div>
      <div id="kga-res"></div>
      <div class="divider"></div>
      <p class="small muted" style="margin:0 0 8px">목록에 없는 골프장이면 평균값으로 임시 입력할 수 있어요. 나중에 정확한 값으로 고치세요.</p>
      <button class="btn secondary block" data-a="avg" style="min-height:44px">평균값으로 임시 입력</button>`;
  };

  const tag = t => `<span class="badge">${t}</span>`;

  const renderResults = () => {
    const box = el.querySelector('#kga-res');
    if (!box) return;
    if (error) { box.innerHTML = `<div class="banner" style="background:color-mix(in srgb,var(--over) 14%,transparent);color:var(--bad-text)">${ic('alert', 18)}<span class="grow">${esc(error)}</span></div>`; return; }
    if (!data) { box.innerHTML = '<div class="searching"><span class="spin"></span>레이팅 자료를 불러오는 중…</div>'; return; }

    if (club) {
      const combos = rankCombos(club, front, back);
      if (!course || !combos.some(c => c.course === course)) course = combos[0]?.course;
      const tees = teesOf(club, course, sex);
      box.innerHTML = `<div class="row between" style="margin:4px 0 8px"><b>${esc(club.name)}</b><button class="chip" data-a="back" style="min-height:32px">다른 골프장</button></div>
        <div class="chips" style="margin-bottom:10px;flex-wrap:wrap">${combos.map(c => `<button class="chip${c.course === course ? ' on' : ''}" data-course="${esc(c.course)}">${esc(c.course)}${c.rank <= 1 ? ' ★' : ''}</button>`).join('')}</div>
        ${combos.some(c => c.rank <= 1) ? '<p class="small muted" style="margin:-4px 0 8px">★ 입력하신 전반·후반 코스와 맞는 조합이에요</p>' : ''}
        ${tees.length ? `<div class="list">${tees.map((t, i) => `<button class="li" data-tee="${i}"><div class="grow"><b>${esc(t.tee)}</b><div class="small muted">${t.yd.toLocaleString()}야드</div></div><div style="text-align:right"><b class="num" style="font-size:18px">${t.rating.toFixed(1)}</b><span class="muted"> / </span><b class="num" style="font-size:18px">${t.slope}</b></div></button>`).join('')}</div>`
          : `<p class="small muted">이 조합에는 ${sex ? '여자' : '남자'} 티 자료가 없어요. ${sex ? '남자' : '여자'} 티를 확인해 보세요.</p>`}`;
      box._tees = tees;
      return;
    }

    if (!q.trim()) { box.innerHTML = '<p class="small muted" style="margin:6px 0">골프장 이름을 입력하면 찾아요.</p>'; return; }
    const found = searchClubs(data, q, 8);
    box.innerHTML = found.length
      ? `<div class="list">${found.map((m, i) => `<button class="li" data-club="${i}"><span class="ico">${ic('flag')}</span><div class="grow"><b>${esc(m.club.name)}</b><div class="small muted">코스 조합 ${new Set(m.club.rows.map(r => r.course)).size}개</div></div>${ic('chev')}</button>`).join('')}</div>`
      : `<div class="banner" style="background:color-mix(in srgb,#eda100 18%,transparent);color:var(--ink)">${ic('info', 18)}<span class="grow">“${esc(q)}”는 KGA 자료에 없어요. 아래 <b>평균값으로 임시 입력</b>을 쓰거나 직접 입력하세요.</span></div>`;
    box._found = found;
  };

  const applyAverage = () => {
    if (!data) return;
    const a = averages(data, sex);
    s.close();
    onApply({ est: true, tee: '', rating: a.rating, slope: a.slope });
  };

  el.addEventListener('input', e => {
    if (e.target.id !== 'kga-q') return;
    q = e.target.value; club = null; course = null;
    renderResults();
  });
  el.addEventListener('click', e => {
    const box = el.querySelector('#kga-res');
    const b = e.target.closest('[data-sex],[data-a],[data-club],[data-course],[data-tee]');
    if (!b) return;
    if (b.dataset.sex != null) { sex = Number(b.dataset.sex); setSex(sex); el.querySelectorAll('[data-sex]').forEach(x => x.classList.toggle('on', Number(x.dataset.sex) === sex)); renderResults(); return; }
    if (b.dataset.a === 'avg') return applyAverage();
    if (b.dataset.a === 'back') { club = null; course = null; return renderResults(); }
    if (b.dataset.club != null) { club = box._found[Number(b.dataset.club)].club; course = null; return renderResults(); }
    if (b.dataset.course != null) { course = b.dataset.course; return renderResults(); }
    if (b.dataset.tee != null) {
      const t = box._tees[Number(b.dataset.tee)];
      // "동+서" 같은 조합이면 전반/후반 코스 이름도 함께 넘긴다 ("동(아웃+인)" 같은 형태는 제외)
      const m = /^([^+()]+)\+([^+()]+)$/.exec(t.course);
      s.close();
      onApply({ club: club.name, course: t.course, tee: t.tee, rating: t.rating, slope: t.slope, yd: t.yd, front: m?.[1] || '', back: m?.[2] || '', est: false });
    }
  });

  skeleton();
  renderResults();
  loadKga().then(d => {
    if (ctl.signal.aborted) return;
    data = d;
    skeleton();
    const top = searchClubs(data, q, 1)[0];
    if (top && top.score <= 2) club = top.club; // 이름이 잘 맞으면 바로 조합·티 선택으로
    renderResults();
  }).catch(err => { error = err.message || '레이팅 자료를 불러오지 못했어요'; renderResults(); });
  return s;
}

/** 자료를 불러올 수 있으면 KGA 등록 여부와 평균값을 알려준다 (편집 화면의 안내 문구용) */
export async function kgaLookup(name, sex = getSex()) {
  const data = await loadKga();
  const top = searchClubs(data, name, 1)[0];
  return { found: top && top.score <= 2 ? top.club.name : null, avg: averages(data, sex) };
}
