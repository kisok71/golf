import { ic } from '../icons.js';
import { esc } from '../util.js';
import { sheet } from '../ui.js';
import { searchCourses, fetchHoles, buildHoleSets, parsePastedPars } from '../coursesearch.js';

/**
 * 코스 검색 시트.
 * saved: 저장된 내 코스 [{ name, pars }]
 * onApply({ name, pars }) : 선택한 코스의 이름과 홀별 파(9 또는 18개, 비어 있으면 null)
 */
export function openCoursePicker({ query, saved = [], onApply }) {
  const q = query.trim();
  const ctl = new AbortController();
  const s = sheet('', { onClose: () => ctl.abort() });
  const el = s.el;
  const mine = q ? saved.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : saved;
  let results = null, error = '', mode = 'list', selected = null, sets = null, token = 0;

  const webUrl = `https://www.google.com/search?q=${encodeURIComponent(`${q} 골프장 홀별 파 스코어카드`)}`;

  const footer = () => `
    <div class="divider"></div>
    <p class="small muted" style="margin:0 0 10px">목록에 없으면 웹에서 홀별 파를 찾아 복사한 뒤 붙여넣을 수 있어요.</p>
    <div class="btns" style="margin-top:0">
      <a class="btn secondary" href="${webUrl}" target="_blank" rel="noopener noreferrer">웹에서 찾아보기</a>
      <button class="btn secondary" data-a="paste">붙여넣기로 입력</button>
    </div>
    <p class="small muted" style="margin:12px 0 0">검색어는 OpenStreetMap 서버로 전송돼요. 등록되지 않은 골프장은 찾을 수 없어요.</p>`;

  const savedHtml = () => mine.length ? `<div class="section-title" style="margin:6px 4px 8px"><span>내 코스</span></div>
    <div class="list">${mine.map((c, i) => `<button class="li" data-saved="${i}"><span class="ico">${ic('flag')}</span><div class="grow"><b>${esc(c.name)}</b><div class="small muted">${c.pars.length}홀 저장됨</div></div>${ic('chev')}</button>`).join('')}</div>` : '';

  const render = () => {
    let body = '';
    if (mode === 'list') {
      body = `<h3>코스 검색</h3><p>${q ? `“${esc(q)}”` : '코스 이름을 입력하세요'}</p>${savedHtml()}
        <div class="section-title" style="margin:14px 4px 8px"><span>인터넷 검색 결과</span></div>
        ${results === null && !error ? `<div class="searching"><span class="spin"></span>골프장을 찾는 중…</div>` : ''}
        ${error ? `<div class="banner" style="background:color-mix(in srgb,var(--over) 14%,transparent);color:var(--bad-text)">${ic('alert', 18)}<span class="grow">${esc(error)}</span><button data-a="retry">다시 시도</button></div>` : ''}
        ${results && !results.length ? `<p class="small muted" style="margin:0 0 4px">“${esc(q)}”에 해당하는 골프장을 찾지 못했어요. 이름을 줄이거나(예: “남서울”) 다르게 써보세요.</p>` : ''}
        ${results?.length ? `<p class="small muted" style="margin:0 0 8px">${results.length}곳이 검색됐어요. 맞는 곳을 선택하세요.</p><div class="list">${results.map((c, i) => `<button class="li" data-res="${i}"><span class="ico">${ic('pin')}</span><div class="grow"><b>${esc(c.name)}</b><div class="small muted">${esc(c.address)}</div></div>${ic('chev')}</button>`).join('')}</div>` : ''}
        ${footer()}`;
    } else if (mode === 'loading') {
      body = `<h3>${esc(selected.name)}</h3><div class="searching"><span class="spin"></span>홀별 파 정보를 가져오는 중…</div>
        <p class="small muted">처음에는 10~20초 걸릴 수 있어요.</p><div class="btns" style="grid-template-columns:1fr"><button class="btn secondary" data-a="back">뒤로</button></div>`;
    } else if (mode === 'none') {
      body = `<h3>${esc(selected.name)}</h3><div class="banner" style="background:color-mix(in srgb,#eda100 18%,transparent);color:var(--ink)">${ic('info', 18)}<span class="grow">이 골프장은 홀별 파 정보가 등록돼 있지 않아요.</span></div>
        <p class="small muted">아래 방법으로 파를 입력할 수 있어요. 스코어카드 사진을 불러오면 파도 함께 채워져요.</p>${footer()}
        <div class="btns" style="grid-template-columns:1fr"><button class="btn secondary" data-a="back">다른 코스 선택</button></div>`;
    } else if (mode === 'nines') {
      const opts = (withNone, sel) => `${withNone ? '<option value="-1">없음 (9홀만)</option>' : ''}${sets.nines.map((n, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(n.label)} · 파 ${n.pars.reduce((a, b) => a + (b || 0), 0)}</option>`).join('')}`;
      body = `<h3>${esc(selected.name)}</h3><p>이 골프장은 9홀 코스가 ${sets.nines.length}개예요. 오늘 친 코스를 골라주세요.</p>
        <div class="field"><label for="n-front">전반 9홀</label><select id="n-front" class="input">${opts(false, 0)}</select></div>
        <div class="field"><label for="n-back">후반 9홀</label><select id="n-back" class="input">${opts(true, 1)}</select></div>
        <div class="btns"><button class="btn secondary" data-a="back">뒤로</button><button class="btn" data-a="apply-nines">적용</button></div>`;
    } else if (mode === 'paste') {
      body = `<h3>붙여넣기로 입력</h3><p class="small muted">웹페이지의 홀별 파 표를 복사해 붙여넣으세요. 9개 또는 18개의 파(3~6) 줄을 찾아 입력해요.</p>
        <div class="field"><textarea id="paste-box" class="input" placeholder="HOLE 1 2 3 4 5 6 7 8 9 합&#10;PAR  4 5 3 4 4 3 5 4 4 36"></textarea></div>
        <div id="paste-msg" class="small" style="min-height:20px;margin-bottom:6px"></div>
        <div class="btns"><button class="btn secondary" data-a="back">뒤로</button><button class="btn" data-a="apply-paste">적용</button></div>`;
    }
    el.innerHTML = `<div class="grab"></div>${body}`;
  };

  const apply = (name, pars, extra = {}) => { s.close(); onApply({ name, pars, ...extra }); };

  async function runSearch() {
    results = null; error = ''; render();
    if (!q) { results = []; render(); return; }
    try { results = await searchCourses(q, { signal: ctl.signal }); }
    catch (e) { if (ctl.signal.aborted) return; error = e.message || '검색에 실패했어요. 인터넷 연결을 확인하세요'; }
    render();
  }

  async function choose(course) {
    selected = course; mode = 'loading'; render();
    const mineTok = ++token;
    try {
      const set = buildHoleSets(await fetchHoles(course, { signal: ctl.signal }));
      if (mineTok !== token) return; // 그 사이 '뒤로'를 눌렀다면 결과를 버린다
      if (set.kind === 'single') return apply(course.name, set.pars);
      if (set.kind === 'nines') { sets = set; mode = 'nines'; return render(); }
      mode = 'none';
    } catch (e) {
      if (ctl.signal.aborted || mineTok !== token) return;
      mode = 'list'; error = e.message || '홀 정보를 가져오지 못했어요';
    }
    render();
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-a],[data-res],[data-saved]');
    if (!b) return;
    if (b.dataset.saved != null) { const c = mine[Number(b.dataset.saved)]; return apply(c.name, c.pars); }
    if (b.dataset.res != null) return choose(results[Number(b.dataset.res)]);
    switch (b.dataset.a) {
      case 'retry': runSearch(); break;
      case 'back': token++; mode = 'list'; render(); break;
      case 'paste': mode = 'paste'; render(); break;
      case 'apply-nines': {
        const f = Number(el.querySelector('#n-front').value), k = Number(el.querySelector('#n-back').value);
        apply(selected.name, [...sets.nines[f].pars, ...(k >= 0 ? sets.nines[k].pars : [])], {
          frontName: sets.nines[f].label, backName: k >= 0 ? sets.nines[k].label : '',
          nines: sets.nines.map(n => ({ name: n.label, pars: n.pars.map(p => p ?? 4) }))
        });
        break;
      }
      case 'apply-paste': {
        const pars = parsePastedPars(el.querySelector('#paste-box').value);
        const msg = el.querySelector('#paste-msg');
        if (!pars) { msg.style.color = 'var(--bad-text)'; msg.textContent = '파 줄을 찾지 못했어요. 9개 또는 18개의 숫자(3~6)가 있는 줄이 필요해요.'; break; }
        apply(q || '', pars);
        break;
      }
    }
  });

  render();
  runSearch();
  return s;
}
