import { ic } from '../icons.js';
import { esc, newRound, DEFAULT_PARS, todayStr, sum, defaultPutts, splitNines } from '../util.js';
import { loadBitmap, preprocess, recognize, thumbnail, ocrLabels } from '../ocr.js';
import { parseScorecard, chunkSums, matchesName, selectMyRows, dropOthers } from '../scorecard.js';
import { pageHead, toast } from '../ui.js';
import { setDraft } from './editor.js';

const PLAYER = 'gn.player';
export const getPlayer = () => { try { return localStorage.getItem(PLAYER) || ''; } catch { return ''; } };
export const setPlayer = v => { try { v ? localStorage.setItem(PLAYER, v) : localStorage.removeItem(PLAYER); } catch { /* noop */ } };

const ALIASES = 'gn.playerAliases', PIDX = 'gn.playerIdx';
export const getAliases = () => { try { return JSON.parse(localStorage.getItem(ALIASES)) || []; } catch { return []; } };
const addAlias = a => { try { const l = getAliases(); if (a && !l.includes(a)) localStorage.setItem(ALIASES, JSON.stringify([...l, a].slice(-8))); } catch { /* noop */ } };
const getIdx = () => { try { const v = localStorage.getItem(PIDX); return v == null ? null : Number(v); } catch { return null; } };
const setIdx = v => { try { localStorage.setItem(PIDX, String(v)); } catch { /* noop */ } };

const ROLES = [['ignore', '사용 안 함'], ['par', '파'], ['score', '내 스코어'], ['score_rel', '내 스코어 (파 대비)'], ['putts', '퍼팅']];
const RANGES = [['front', '전반 1-9'], ['back', '후반 10-18']];

const STATUS = {
  'loading tesseract core': '인식 엔진 준비 중…',
  'initializing tesseract': '인식 엔진 준비 중…',
  'loading language traineddata': '언어 데이터 불러오는 중…',
  'initializing api': '인식 엔진 준비 중…',
  'recognizing text': '스코어카드 읽는 중…'
};

/* 첫 시도는 한글·영문을 함께 읽어 코스명·날짜·이름까지 얻고, 실패하면 표 괘선을 지우는 방식 등으로 다시 시도한다 */
const ATTEMPTS = [
  [{}, '6', 'kor+eng'],
  [{ removeLines: true }, '6', 'eng'],
  [{ removeLines: true, thr: 0.9 }, '6', 'eng'],
  [{ polar: true }, '6', 'eng']
];

/** 행들에서 홀 번호(0~17)별 파 / 스코어 / 파대비 / 퍼팅 배열을 만든다 */
function collect(rows) {
  const pars = Array(18).fill(null), score = Array(18).fill(null), rel = Array(18).fill(null), putts = Array(18).fill(null);
  let n = 9;
  for (const r of rows) {
    if (r.role === 'ignore') continue;
    const base = r.vals.length > 9 ? 0 : r.range === 'back' ? 9 : 0;
    const target = r.role === 'par' ? pars : r.role === 'score' ? score : r.role === 'score_rel' ? rel : putts;
    r.vals.forEach((v, k) => {
      const idx = base + k;
      if (idx >= 18 || v == null) return;
      if (idx >= 9) n = 18;
      target[idx] = v;
    });
    if (r.vals.length > 9 || r.range === 'back') n = 18;
  }
  return { pars, score, rel, putts, n };
}

/** 소계(합계) 칸과 읽은 숫자의 합이 맞는지 검사한다 */
function checkRow(r, allPars) {
  if (!r.subs?.length || r.role === 'ignore') return null;
  const base = r.vals.length > 9 ? 0 : r.range === 'back' ? 9 : 0;
  const sums = chunkSums(r.vals.map(v => v ?? 0));
  const parts = r.subs.map((sub, k) => {
    let calc = sums[k];
    if (r.role === 'score_rel') {
      const ps = allPars.slice(base + k * 9, base + k * 9 + 9);
      if (ps.some(p => p == null)) return null;
      calc += sum(ps);
    }
    return { sub, calc, ok: sub === calc };
  }).filter(Boolean);
  return parts.length ? parts : null;
}

export async function mount(el) {
  let state = { phase: 'pick' };

  const draw = () => {
    if (state.phase === 'pick') el.innerHTML = pickHtml(state);
    else if (state.phase === 'busy') el.innerHTML = busyHtml(state);
    else el.innerHTML = reviewHtml(state);
  };
  draw();

  async function handleFile(file) {
    if (!file) return;
    const prevUrl = URL.createObjectURL(file);
    const player = getPlayer();
    state = { phase: 'busy', preview: prevUrl, status: '이미지 준비 중…', progress: 0.02 };
    draw();
    const update = m => {
      if (state.phase !== 'busy') return;
      const label = STATUS[m.status];
      if (label) state.status = label;
      if (typeof m.progress === 'number') state.progress = m.status === 'recognizing text' ? 0.25 + m.progress * 0.7 : Math.min(0.25, 0.02 + m.progress * 0.23);
      const bar = el.querySelector('.progress > i'), st = el.querySelector('#status');
      if (bar) bar.style.width = `${Math.round(state.progress * 100)}%`;
      if (st) st.textContent = state.status;
    };
    try {
      const bmp = await loadBitmap(file);
      const image = thumbnail(bmp);
      const used = r => r.filter(x => x.role !== 'ignore').length;
      const aliases = getAliases(), playerIdx = getIdx();
      let parsed = null, parsedCv = null, meta = { date: null, time: null, title: '', front: '', back: '' };
      for (let k = 0; k < ATTEMPTS.length; k++) {
        if (k) { state.status = '다른 방식으로 한 번 더 읽는 중…'; state.progress = 0.3; update({}); }
        const [pre, psm, lang] = ATTEMPTS[k];
        const cv = preprocess(bmp, pre);
        const data = await recognize(cv, update, { psm, lang });
        const p = parseScorecard(data, { player, aliases, playerIdx });
        meta = { date: meta.date || p.date, time: meta.time || p.time, title: meta.title || p.title, front: meta.front || p.front, back: meta.back || p.back };
        if (!parsed || used(p.rows) > used(parsed.rows)) { parsed = p; parsedCv = cv; }
        if (parsed.rows.some(r => r.role === 'par') && parsed.rows.some(r => r.role === 'score' || r.role === 'score_rel')) break;
      }
      // 이름을 못 찾았으면 각 줄의 이름 칸만 크게 잘라 다시 읽어 본다
      if (player && parsed.matchedBy !== 'name') {
        try {
          state.status = '이름을 다시 읽는 중…'; state.progress = 0.9; update({});
          const cands = parsed.rows.filter(r => r.candidate && r.box).slice(0, 10);
          const labels = await ocrLabels(parsedCv, cands.map(r => r.box), { lang: 'kor+eng' });
          cands.forEach((r, i) => { r.labelAlt = labels[i] || ''; });
          parsed.matchedBy = selectMyRows(parsed.rows, { player, aliases, playerIdx });
          parsed.playerMatched = parsed.matchedBy === 'name';
          parsed.rows = dropOthers(parsed.rows, parsed.matchedBy);
        } catch (e) { console.warn('이름 재인식 실패', e); }
      }
      state = {
        phase: 'review', matchedBy: parsed.matchedBy, preview: prevUrl, image, rows: parsed.rows, player, playerMatched: parsed.playerMatched,
        date: meta.date || todayStr(), dateFound: !!meta.date, time: meta.time || '', title: meta.title || '', front: meta.front || '', back: meta.back || ''
      };
    } catch (err) {
      console.error(err);
      state = { phase: 'pick', error: err?.message || '이미지를 읽지 못했어요' };
      toast('이미지를 읽는 중 문제가 생겼어요');
    }
    draw();
  }

  el.onchange = e => {
    const t = e.target;
    if (t.matches('input[type=file]')) handleFile(t.files[0]);
    else if (t.id === 'p-name') setPlayer(t.value.trim());
    else if (t.matches('[data-role]')) { state.rows[Number(t.dataset.role)].role = t.value; draw(); }
    else if (t.matches('[data-range]')) { state.rows[Number(t.dataset.range)].range = t.value; draw(); }
    else if (t.matches('[data-cell]')) draw();
    else if (t.id === 's-date') state.date = t.value;
    else if (t.id === 's-time') state.time = t.value;
    else if (t.id === 's-title') {
      // "화성상록 동-서" 처럼 쓰면 골프장 이름과 전반/후반 코스로 나눈다
      const sp = splitNines(t.value);
      if (sp && sp.rest) { state.title = sp.rest; state.front = sp.front; state.back = sp.back; toast(`코스를 나눴어요 (전반 ${sp.front} · 후반 ${sp.back})`); draw(); }
      else state.title = t.value.trim();
    } else if (t.id === 's-front') {
      const sp = splitNines(t.value);
      if (sp) { state.front = sp.front; state.back = sp.back; toast(`코스를 나눴어요 (전반 ${sp.front} · 후반 ${sp.back})`); draw(); }
      else state.front = t.value.trim();
    } else if (t.id === 's-back') state.back = t.value.trim();
  };
  el.oninput = e => {
    const t = e.target;
    if (!t.matches('[data-cell]')) return;
    const [ri, ci] = t.dataset.cell.split(',').map(Number);
    const raw = t.value.trim();
    const v = raw === '' ? null : Number(raw);
    const ok = raw === '' || (Number.isInteger(v) && v >= -5 && v <= 20);
    t.classList.toggle('bad', !ok);
    if (ok) state.rows[ri].vals[ci] = v;
  };
  el.onclick = e => {
    if (e.target.closest('#retry')) { state = { phase: 'pick' }; draw(); }
    if (e.target.closest('#apply')) apply();
    const mine = e.target.closest('[data-mine]');
    if (mine) pickMine(Number(mine.dataset.mine));
  };

  /** 이 줄을 내 줄로 선택: 같은 표의 다른 사람 줄은 제외하고, 다른 쪽 표(전반/후반)에서도 같은 순서의 줄을 고른다 */
  function pickMine(ri) {
    const row = state.rows[ri];
    const cands = state.rows.filter(r => r.candidate);
    const order = cands.filter(r => r.range === row.range);
    const idx = Math.max(0, order.indexOf(row));
    const cardRel = state.rows.some(r => r.candidate === 'score_rel');
    const asScore = r => (r.candidate === 'putts' ? (cardRel ? 'score_rel' : 'score') : r.candidate);
    for (const r of cands) {
      const sameIdx = cands.filter(x => x.range === r.range).indexOf(r) === idx;
      r.role = sameIdx ? asScore(r) : 'ignore';
    }
    // 다음부터 자동으로 찾도록: 이 줄의 이름 표기와 순서를 기억한다
    const label = row.label || row.labelAlt;
    if (label && !matchesName(label, state.player || '')) addAlias(label);
    setIdx(idx);
    state.matchedBy = 'manual';
    toast('내 줄로 선택했어요. 다음부터 기억해요');
    draw();
  }

  function apply() {
    const rows = state.rows.filter(r => r.role !== 'ignore');
    if (!rows.some(r => r.role === 'score' || r.role === 'score_rel')) { toast('“내 스코어”로 사용할 줄을 하나 골라주세요'); return; }
    const { pars, score, rel, putts, n } = collect(rows);
    const parAt = i => (pars[i] >= 3 && pars[i] <= 6 ? pars[i] : DEFAULT_PARS[i]);
    const round = newRound(n);
    round.date = state.date || todayStr();
    if (state.time) round.time = state.time;
    if (state.title) round.course = state.title;
    round.frontName = state.front || '';
    round.backName = n >= 18 ? state.back || '' : '';
    round.pars = Array.from({ length: n }, (_, i) => parAt(i));
    round.holes = Array.from({ length: n }, (_, i) => {
      const s = score[i] != null ? score[i] : rel[i] != null ? parAt(i) + rel[i] : null;
      const p = putts[i];
      const ok = s != null && s >= 1;
      return { score: ok ? s : null, putts: !ok ? null : p != null && p <= s ? p : defaultPutts(s), ob: 0, hazard: 0 };
    });
    round.image = state.image;
    setDraft(round, { step: 'info', fromScan: true });
    toast('스코어를 채웠어요. 나머지 정보를 확인하세요');
    location.hash = '#/new';
  }
}

function pickHtml(s) {
  return `${pageHead({ title: '스코어카드 불러오기', sub: '사진으로 자동 입력', back: '#/' })}
    ${s.error ? `<div class="banner" style="background:color-mix(in srgb,var(--over) 14%,transparent);color:var(--bad-text)">${ic('alert', 18)}<span class="grow">${esc(s.error)}</span></div>` : ''}
    <div class="card" style="margin-bottom:12px">
      <div class="field" style="margin-bottom:0"><label for="p-name">내 이름 (스코어카드에 표시되는 이름)</label>
        <input id="p-name" class="input" placeholder="예: 홍길동" value="${esc(getPlayer())}" autocomplete="off">
        <span class="small muted">여러 명이 적힌 카드에서 이 이름의 줄만 자동으로 골라요. 한 번만 입력하면 기억해요.</span></div>
    </div>
    <div class="drop">
      <div class="big-ic">${ic('camera')}</div>
      <div><b style="font-size:17px">스코어카드 사진을 골라주세요</b><br><span class="muted small">인식은 이 기기 안에서만 이루어지고, 사진은 밖으로 전송되지 않아요</span></div>
      <label class="btn lime block" style="max-width:320px;cursor:pointer">${ic('camera')} 카메라로 촬영<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn secondary block" style="max-width:320px;cursor:pointer">${ic('image')} 앨범 · 스크린샷 선택<input type="file" accept="image/*" hidden></label>
    </div>
    <div class="card" style="margin-top:14px"><h2>잘 읽히는 요령</h2>
      <ul class="tips">
        <li>스마트스코어 같은 앱의 <b>결과 화면 스크린샷</b>이 가장 정확해요</li>
        <li>종이 카드는 표 전체가 꽉 차게, 정면에서 밝게 찍어주세요</li>
        <li>코스명 · 날짜 · 시간 · 홀별 파 · 내 스코어를 읽어와요</li>
        <li>읽은 뒤 <b>확인·수정 화면</b>이 나오니 틀린 칸만 고치면 돼요</li>
      </ul></div>`;
}

function busyHtml(s) {
  return `${pageHead({ title: '읽는 중…', sub: '스코어카드 인식' })}
    <img class="photo" src="${s.preview}" alt="선택한 스코어카드" style="max-height:38vh;object-fit:contain;background:var(--surface-2)">
    <div class="card" style="margin-top:14px"><div id="status" style="font-weight:700;margin-bottom:10px">${esc(s.status)}</div>
      <div class="progress"><i style="width:${Math.round(s.progress * 100)}%"></i></div>
      <p class="hint" style="margin:10px 0 0">처음 한 번은 엔진을 준비하느라 조금 더 걸려요. (한글 인식 포함)</p></div>`;
}

function reviewHtml(s) {
  const hasRows = s.rows.length > 0;
  const { pars } = collect(s.rows.filter(r => r.role === 'par'));
  const rowsHtml = s.rows.map((r, ri) => {
    const nine = r.vals.length <= 9;
    const chk = checkRow(r, pars);
    const chkHtml = chk ? `<div class="small" style="margin-top:6px;color:${chk.every(c => c.ok) ? 'var(--good-text)' : 'var(--bad-text)'}">${
      chk.every(c => c.ok) ? `✓ 카드의 합계(${chk.map(c => c.sub).join(' · ')})와 일치해요`
        : `합계가 달라요 · 카드 ${chk.map(c => c.sub).join(' / ')} ↔ 읽은 값 ${chk.map(c => c.calc).join(' / ')} — 숫자를 확인하세요`}</div>` : '';
    return `<div class="scanrow ${r.role === 'ignore' ? 'ignored' : ''}">
      <div class="row between" style="margin-bottom:6px">
        <div class="small" style="font-weight:700">${r.label ? esc(r.label) : '<span class="muted">이름 없음</span>'}${r.labelAlt && r.labelAlt !== r.label ? ` <span class="muted" style="font-weight:500">(다시 읽음: ${esc(r.labelAlt)})</span>` : ''}${r.role === 'score' || r.role === 'score_rel' ? ' <span class="badge">내 줄</span>' : ''}</div>
        ${r.candidate && r.role === 'ignore' ? `<button class="chip" data-mine="${ri}" style="min-height:32px">내 줄로 선택</button>` : ''}
      </div>
      <div class="rh">
        <select data-role="${ri}" aria-label="줄 ${ri + 1} 용도">${ROLES.map(([k, l]) => `<option value="${k}"${r.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${nine ? `<select data-range="${ri}" aria-label="줄 ${ri + 1} 범위">${RANGES.map(([k, l]) => `<option value="${k}"${r.range === k ? ' selected' : ''}>${l}</option>`).join('')}</select>` : '<span class="muted small" style="align-self:center">18홀 전체</span>'}
      </div>
      <div class="cells">${r.vals.map((v, ci) => `<input inputmode="numeric" data-cell="${ri},${ci}" value="${v ?? ''}" aria-label="${ci + 1}번째 칸"${r.repaired?.includes(ci) ? ' class="fixed"' : ''}>`).join('')}</div>
      ${r.role === 'score_rel' ? '<div class="small muted" style="margin-top:6px">파 대비 값이에요 (0=파, 1=보기, -1=버디). 파를 더해 타수로 바꿔요.</div>' : ''}
      ${chkHtml}
      ${r.repaired?.length ? `<div class="small" style="margin-top:6px;color:var(--good-text)">잘못 읽힌 칸을 카드 합계에 맞춰 채웠어요 (${r.repaired.map(i => `${i + 1}번째`).join(', ')}). 맞는지 확인하세요.</div>` : ''}
      ${r.incomplete ? '<div class="small over-t" style="margin-top:6px">일부 칸을 못 읽었어요. 빈 칸을 채워주세요.</div>' : ''}
    </div>`;
  }).join('');

  const warn = t => `<div class="banner" style="background:color-mix(in srgb,#eda100 18%,transparent);color:var(--ink)">${ic('alert', 18)}<span class="grow">${t}</span></div>`;
  const notice = s.matchedBy === 'name' || s.matchedBy === 'manual' ? ''
    : s.matchedBy === 'index' ? warn('이름은 못 찾았지만 지난번에 고른 위치의 줄을 선택했어요. 맞는지 확인하세요.')
    : s.player ? warn(`“${esc(s.player)}” 이름을 찾지 못했어요. 첫 번째 줄을 임시로 골랐어요. 내 줄이 아니면 그 줄의 <b>내 줄로 선택</b>을 눌러주세요. 한 번 고르면 다음부터 기억해요.`)
    : warn('내 이름이 저장돼 있지 않아요. 설정에서 이름을 저장하거나, 내 줄의 <b>내 줄로 선택</b>을 눌러주세요.');

  return `${pageHead({ title: '인식 결과 확인', sub: '읽은 내용을 확인하세요', back: '#/scan' })}
    <details class="card" style="padding:12px 16px"><summary style="cursor:pointer;font-weight:700">원본 사진 보기</summary><img class="photo" src="${s.preview}" alt="스코어카드" style="margin-top:10px"></details>
    <div class="card" style="margin-top:12px">
      <div class="field"><label for="s-title">코스명 ${s.title ? '<span class="badge">사진에서 인식</span>' : '<span class="badge warn">직접 입력</span>'}</label>
        <input id="s-title" class="input" value="${esc(s.title)}" placeholder="코스 이름"></div>
      <div class="two">
        <div class="field"><label for="s-front">전반 코스 ${s.front ? '<span class="badge">인식</span>' : ''}</label>
          <input id="s-front" class="input" value="${esc(s.front)}" placeholder="예: 동 (또는 동-서)"></div>
        <div class="field"><label for="s-back">후반 코스 ${s.back ? '<span class="badge">인식</span>' : ''}</label>
          <input id="s-back" class="input" value="${esc(s.back)}" placeholder="예: 서"></div>
      </div>
      <div class="two" style="margin-bottom:0">
        <div class="field" style="margin-bottom:0"><label for="s-date">날짜 ${s.dateFound ? '<span class="badge">인식</span>' : '<span class="badge warn">직접 선택</span>'}</label>
          <input id="s-date" class="input" type="date" value="${esc(s.date)}"></div>
        <div class="field" style="margin-bottom:0"><label for="s-time">시간</label>
          <input id="s-time" class="input" type="time" value="${esc(s.time)}"></div>
      </div>
    </div>
    <div class="section-title"><span>인식된 숫자 줄 ${s.rows.length}개</span></div>
    ${notice}
    ${hasRows ? `<p class="hint small muted" style="margin:0 4px 10px">각 줄의 용도를 확인하세요. 같은 카드에 여러 명이 있으면 <b>내 줄</b>만 “내 스코어”로 지정하세요.</p>${rowsHtml}`
      : `<div class="card empty" style="padding:24px"><h2>숫자 줄을 찾지 못했어요</h2><p>표가 화면에 꽉 차게, 더 선명하게 다시 찍어보세요.</p></div>`}
    <div class="grid-2" style="margin-top:16px">
      <button class="btn secondary" id="retry">${ic('camera')} 다시 선택</button>
      <button class="btn lime" id="apply" ${hasRows ? '' : 'disabled'}>${ic('check')} 적용하기</button>
    </div>`;
}
