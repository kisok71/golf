import { db } from '../db.js';
import { ic } from '../icons.js';
import {
  esc, newRound, resizeRound, summarize, signed, clamp, sum, WEATHER, weatherIcon, scoreName, tClass,
  parGridHtml, cyclePar, todayStr, courseRecord, defaultPutts, splitNines
} from '../util.js';
import { toast, confirmDialog } from '../ui.js';
import { openCoursePicker } from './coursepicker.js';

const DRAFT = 'gn.draft';
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT)); } catch { return null; } };
const writeDraft = st => { try { localStorage.setItem(DRAFT, JSON.stringify(st)); } catch { /* 저장 불가 환경 */ } };
export const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch { /* noop */ } };

/** 스캔 화면 등에서 초안을 넘길 때 사용 */
export function setDraft(round, { step = 'info', cur = 0, fromScan = false } = {}) {
  writeDraft({ round, step, cur, fromScan });
}

export async function mount(el, { id: rawId }) {
  // 상세 화면에서 홀 번호를 눌러 들어오면 #/edit/<id>?hole=<번호(0부터)> 형태
  const [id, qs] = String(rawId || '').split('?');
  const holeParam = Number(new URLSearchParams(qs || '').get('hole'));
  const courses = await db.courses();
  let st;
  if (id) {
    const r = await db.round(id);
    if (!r) { location.hash = '#/rounds'; return; }
    st = { round: structuredClone(r), step: 'holes', cur: Number.isInteger(holeParam) && qs && holeParam >= 0 && holeParam < r.holes.length ? holeParam : firstEmpty(r), editing: true };
  } else {
    const d = readDraft();
    st = d?.round ? { ...d, resumed: !d.fromScan, editing: false } : { round: newRound(), step: 'info', cur: 0, editing: false };
  }
  const r = () => st.round;
  const courseRec = () => courses.find(x => x.name === r().course.trim());
  const nineNames = () => (courseRec()?.nines || []).map(n => n.name);
  const persist = () => { if (!st.editing) writeDraft({ round: st.round, step: st.step, cur: st.cur, fromScan: st.fromScan }); };

  const render = () => {
    el.classList.add('flow');
    document.getElementById('tabbar').hidden = true;
    const s = summarize(r());
    el.innerHTML = `
      <div class="flow-head">
        <div class="top">
          <button class="icon-btn" data-act="exit" aria-label="닫기">${ic('back')}</button>
          <h1>${st.editing ? '기록 수정' : '새 라운드'}</h1>
          <div class="seg" style="width:176px"><button data-act="tab" data-v="info" class="${st.step === 'info' ? 'on' : ''}">정보</button><button data-act="tab" data-v="holes" class="${st.step === 'holes' ? 'on' : ''}">홀별 입력</button></div>
        </div>
        ${st.step === 'holes' ? totals(s) : ''}
      </div>
      ${st.resumed && !st.editing ? `<div class="banner">${ic('info', 18)}<span class="grow">작성 중이던 기록을 불러왔어요</span><button data-act="restart">새로 시작</button></div>` : ''}
      ${st.step === 'info' ? infoHtml() : holesHtml()}`;
    if (st.step === 'holes') el.querySelector('.strip .cur')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  };

  const totals = s => `<div class="totals">
    <div><b class="num">${s.filled ? s.score : '–'}</b><span>타수</span></div>
    <div><b class="num">${s.filled ? signed(s.diff) : '–'}</b><span>파 대비</span></div>
    <div><b class="num">${s.puttsN ? s.putts : '–'}</b><span>퍼팅</span></div>
    <div><b class="num">${s.ob}<small style="opacity:.7"> / </small>${s.hz}</b><span>OB / 해저드</span></div></div>`;

  const infoHtml = () => {
    const rd = r();
    return `
      ${st.editing ? '' : `<button class="btn soft block" data-act="scan" style="margin-bottom:14px">${ic('camera')} 스코어카드 사진으로 채우기</button>`}
      ${st.fromScan ? `<div class="banner">${ic('check', 18)}<span class="grow">사진에서 읽은 값을 채웠어요. 퍼팅은 기본 2로 넣었으니 홀별 입력에서 퍼팅·OB·해저드를 수정하세요.</span></div>` : ''}
      <div class="card">
        <div class="two">
          <div class="field"><label for="f-date">날짜</label><input id="f-date" class="input" type="date" value="${esc(rd.date)}" max="${todayStr()}"></div>
          <div class="field"><label for="f-time">티오프 시간</label><input id="f-time" class="input" type="time" value="${esc(rd.time || '')}"></div>
        </div>
        <div class="field"><label for="f-course">코스</label>
          <div class="row" style="gap:8px"><input id="f-course" class="input" list="course-list" placeholder="코스 이름" value="${esc(rd.course)}" autocomplete="off" enterkeyhint="search">
            <button class="btn soft" data-act="search" style="flex:none;padding:0 16px" aria-label="코스 검색">${ic('search')} 검색</button></div>
          <span class="small muted">이름을 입력하고 검색하면 홀별 파를 가져와요</span>
          <datalist id="course-list">${courses.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></div>
        ${nineFields(rd)}
        <div class="field"><span class="lb">홀 수</span>
          <div class="seg"><button data-act="holes" data-v="18" class="${rd.holes.length === 18 ? 'on' : ''}">18홀</button><button data-act="holes" data-v="9" class="${rd.holes.length === 9 ? 'on' : ''}">9홀</button></div></div>
      </div>
      <div class="card">
        <div class="field"><span class="lb">날씨</span>
          <div class="weather">${Object.entries(WEATHER).map(([k, w]) => `<button data-act="weather" data-v="${k}" class="${rd.weather === k ? 'on' : ''}" aria-pressed="${rd.weather === k}">${weatherIcon(k)}${w.label}</button>`).join('')}</div></div>
        <div class="field" style="margin-bottom:0"><label for="f-temp">기온 (°C, 선택)</label><input id="f-temp" class="input" type="number" inputmode="numeric" placeholder="예: 22" value="${rd.temp ?? ''}"></div>
      </div>
      <div class="card">
        <h2>홀별 파</h2><p class="hint">숫자를 누르면 3 → 4 → 5 순서로 바뀌어요 · 합계 <b class="num">${sum(rd.pars)}</b></p>
        ${parGridHtml(rd.pars)}
      </div>
      <div class="card"><div class="field" style="margin-bottom:0"><label for="f-memo">메모 (선택)</label><textarea id="f-memo" class="input" placeholder="동반자, 컨디션, 잘된 샷 등">${esc(rd.memo)}</textarea></div></div>
      <button class="btn block lime" data-act="start" style="margin-top:14px">홀별 입력 시작 ${ic('chev')}</button>`;
  };

  const nineFields = rd => {
    const known = nineNames();
    const list = `<datalist id="nine-list">${known.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
    const hint = known.length
      ? `<span class="small muted">저장된 코스: ${known.map(esc).join(' · ')} — 이름을 고르면 그 코스의 파가 채워져요</span>`
      : '<span class="small muted">골프장에 9홀 코스가 여러 개면 이름을 적어두세요 (예: 서, 남). 코스별로 분석할 수 있어요</span>';
    if (rd.holes.length === 9) {
      return `<div class="field"><label for="f-front">9홀 코스 이름 (선택)</label><input id="f-front" class="input" list="nine-list" placeholder="예: 서" value="${esc(rd.frontName || '')}" autocomplete="off">${hint}${list}</div>`;
    }
    return `<div class="two" style="margin-bottom:0"><div class="field"><label for="f-front">전반 코스 이름</label><input id="f-front" class="input" list="nine-list" placeholder="예: 서" value="${esc(rd.frontName || '')}" autocomplete="off"></div>
      <div class="field"><label for="f-back">후반 코스 이름</label><input id="f-back" class="input" list="nine-list" placeholder="예: 남" value="${esc(rd.backName || '')}" autocomplete="off"></div></div>
      <div class="field" style="margin-top:-6px">${hint}${list}</div>`;
  };

  const holesHtml = () => {
    const rd = r(), i = st.cur, h = rd.holes[i], par = rd.pars[i];
    const chips = rd.holes.map((x, k) => {
      const d = x.score == null ? null : x.score - rd.pars[k];
      const done = d != null;
      return `<button data-act="chip" data-i="${k}" class="${k === i ? 'cur' : ''} ${done ? 'done' : ''} ${x.ob || x.hazard ? 'warn' : ''}" aria-label="${k + 1}번 홀${done ? ` ${x.score}타` : ''}"><small>${k + 1}</small><b class="${done ? tClass(d) : ''}">${done ? x.score : ''}</b></button>`;
    }).join('');
    const quick = [[-1, '버디'], [0, '파'], [1, '보기'], [2, '더블'], [3, '+3']].map(([d, l]) =>
      `<button data-act="quick" data-d="${d}" class="${h.score === par + d ? 'on' : ''}">${l}</button>`).join('');
    const last = i === rd.holes.length - 1;
    const puttWarn = h.score != null && h.putts != null && h.putts >= h.score && h.score > 1;
    const stepper = (act, v) => `<div class="stepper"><button data-act="${act}-" aria-label="줄이기">−</button><div class="v num${v == null ? ' empty' : ''}">${v ?? '–'}</div><button data-act="${act}+" aria-label="늘리기">+</button></div>`;
    return `
      <div class="strip" role="tablist">${chips}</div>
      <div class="card hole-card">
        <div class="hole-head"><div class="no"><small>HOLE</small>${i + 1}</div><div class="par-pill">PAR ${par}</div></div>
        <div class="score-name">${h.score != null ? scoreName(h.score, par) : '스코어를 입력하세요'}</div>
        <div class="quick">${quick}</div>
        <div class="counter big"><div class="nm"><span><b>스코어</b><small>총 타수</small></span></div>${stepper('sc', h.score)}</div>
        <div class="counter"><div class="nm"><span><b>퍼팅</b><small>퍼트 횟수</small></span></div>${stepper('pt', h.putts)}</div>
        ${puttWarn ? '<div class="warnline">퍼팅 수가 스코어와 같거나 더 커요. 확인해주세요.</div>' : ''}
        <div class="counter"><div class="nm"><i style="background:var(--over)"></i><span><b>OB</b><small>아웃오브바운즈</small></span></div>${stepper('ob', h.ob || 0)}</div>
        <div class="counter"><div class="nm"><i style="background:var(--under)"></i><span><b>해저드</b><small>워터 · 벙커 등</small></span></div>${stepper('hz', h.hazard || 0)}</div>
      </div>
      <div class="navbtns">
        <button class="btn secondary" data-act="prev" ${i === 0 ? 'disabled' : ''}>${ic('back')} 이전</button>
        ${last ? `<button class="btn lime" data-act="save">${ic('check')} 저장하기</button>` : `<button class="btn" data-act="next">다음 홀 ${ic('chev')}</button>`}
      </div>
      ${last ? '' : `<button class="btn secondary block" data-act="save" style="margin-top:10px">지금까지 저장하고 종료</button>`}`;
  };

  const mut = fn => { fn(); persist(); render(); };

  const setHole = patch => mut(() => {
    const h = r().holes[st.cur];
    Object.assign(h, patch);
    if (patch.score != null && h.putts == null) h.putts = defaultPutts(h.score); // 퍼팅은 기본 2, 아래 스테퍼로 수정
    if (h.score != null && h.putts != null) h.putts = Math.min(h.putts, Math.max(h.score, 0));
  });

  async function save() {
    const rd = r();
    if (!rd.course.trim()) { st.step = 'info'; render(); toast('코스 이름을 입력해주세요'); el.querySelector('#f-course')?.focus(); return; }
    const s = summarize(rd);
    if (!s.filled) { toast('스코어를 한 홀 이상 입력해주세요'); return; }
    if (!s.complete && !(await confirmDialog({ title: `${s.n - s.filled}홀이 비어 있어요`, message: '이대로 저장하면 미완료 기록으로 남고, 분석에는 포함되지 않아요. 나중에 이어서 입력할 수 있어요.', ok: '저장' }))) return;
    rd.course = rd.course.trim();
    rd.frontName = (rd.frontName || '').trim();
    rd.backName = rd.holes.length >= 18 ? (rd.backName || '').trim() : '';
    delete rd.sample;
    await db.saveRound(rd);
    await db.saveCourse(courseRecord(courseRec(), rd));
    clearDraft();
    toast('저장했어요');
    location.hash = `#/round/${rd.id}`;
  }

  async function exit() {
    if (st.editing) { history.length > 1 ? history.back() : (location.hash = '#/rounds'); return; }
    location.hash = '#/';
  }

  el.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, rd = r(), h = rd.holes[st.cur], par = rd.pars[st.cur];
    switch (a) {
      case 'exit': exit(); break;
      case 'tab': mut(() => (st.step = b.dataset.v)); break;
      case 'start': mut(() => { st.step = 'holes'; st.cur = firstEmpty(rd); st.fromScan = false; }); break;
      case 'restart': confirmDialog({ title: '새로 시작할까요?', message: '작성 중이던 내용은 사라져요.', ok: '새로 시작', danger: true }).then(ok => { if (ok) { clearDraft(); st = { round: newRound(), step: 'info', cur: 0, editing: false }; render(); } }); break;
      case 'scan': location.hash = '#/scan'; break;
      case 'search': searchCourse(); break;
      case 'weather': mut(() => (rd.weather = b.dataset.v)); break;
      case 'holes': mut(() => resizeRound(rd, Number(b.dataset.v))); if (st.cur >= rd.holes.length) mut(() => (st.cur = 0)); break;
      case 'par': mut(() => { const i = Number(b.dataset.i); rd.pars[i] = cyclePar(rd.pars[i]); }); break;
      case 'chip': mut(() => (st.cur = Number(b.dataset.i))); break;
      case 'prev': mut(() => (st.cur = Math.max(0, st.cur - 1))); break;
      case 'next': mut(() => (st.cur = Math.min(rd.holes.length - 1, st.cur + 1))); break;
      case 'quick': setHole({ score: Math.max(1, par + Number(b.dataset.d)) }); break;
      case 'sc+': setHole({ score: h.score == null ? par : clamp(h.score + 1, 1, 20) }); break;
      case 'sc-': setHole({ score: h.score == null ? par : clamp(h.score - 1, 1, 20) }); break;
      case 'pt+': setHole({ putts: h.putts == null ? 2 : clamp(h.putts + 1, 0, 9) }); break;
      case 'pt-': setHole({ putts: h.putts == null ? 2 : clamp(h.putts - 1, 0, 9) }); break;
      case 'ob+': setHole({ ob: clamp((h.ob || 0) + 1, 0, 9) }); break;
      case 'ob-': setHole({ ob: clamp((h.ob || 0) - 1, 0, 9) }); break;
      case 'hz+': setHole({ hazard: clamp((h.hazard || 0) + 1, 0, 9) }); break;
      case 'hz-': setHole({ hazard: clamp((h.hazard || 0) - 1, 0, 9) }); break;
      case 'save': save(); break;
    }
  };

  el.onkeydown = e => {
    if (e.key === 'Enter' && e.target.id === 'f-course') { e.preventDefault(); e.target.blur(); searchCourse(); }
  };

  function searchCourse() {
    openCoursePicker({
      query: r().course, saved: courses,
      onApply: async ({ name, pars, frontName, backName, nines }) => {
        const rd = r();
        if (nines?.length && name) {
          const base = courses.find(c => c.name === name) || { name, pars: [], holes: 18 };
          const map = new Map((base.nines || []).map(n => [n.name, n.pars]));
          nines.forEach(n => map.set(n.name, n.pars));
          const rec = { ...base, nines: [...map].map(([nm, ps]) => ({ name: nm, pars: ps })) };
          await db.saveCourse(rec);
          const i = courses.findIndex(c => c.name === name);
          if (i >= 0) courses[i] = rec; else courses.push(rec);
        }
        const n = pars.length <= 9 ? 9 : 18;
        const missing = pars.filter(p => p == null).length;
        mut(() => {
          resizeRound(rd, n);
          rd.pars = Array.from({ length: n }, (_, i) => pars[i] ?? rd.pars[i] ?? 4);
          if (name) rd.course = name;
          if (frontName !== undefined) { rd.frontName = frontName; rd.backName = n === 18 ? backName || '' : ''; }
          st.cur = Math.min(st.cur, n - 1);
        });
        toast(missing ? `${n}홀 파를 채웠어요 · ${missing}홀은 정보가 없어 기본값이에요. 확인해주세요` : `${n}홀 파 정보를 채웠어요. 맞는지 확인해주세요`, 3600);
      }
    });
  }

  /** 저장된 9홀 코스 이름과 같으면 그 코스의 파를 해당 9홀에 채운다 */
  function fillNinePars(rd) {
    let filled = false;
    [[0, rd.frontName], [1, rd.backName]].forEach(([half, name]) => {
      const nine = name && courseRec()?.nines?.find(n => n.name === String(name).trim());
      const at = half * 9;
      if (nine && rd.holes.length >= at + 9) nine.pars.forEach((p, i) => { if (rd.pars[at + i] !== p) { rd.pars[at + i] = p; filled = true; } });
    });
    return filled;
  }

  // "동-서" 처럼 하이픈으로 쓰면 전반/후반 코스로 나눈다 (입력을 마친 뒤 적용)
  el.onchange = e => {
    const t = e.target, rd = r();
    if (t.id !== 'f-course' && t.id !== 'f-front') return;
    const sp = splitNines(t.value);
    if (!sp || (t.id === 'f-course' && !sp.rest)) return;
    if (t.id === 'f-course') rd.course = sp.rest;
    rd.frontName = sp.front;
    if (rd.holes.length >= 18) rd.backName = sp.back;
    const filled = fillNinePars(rd);
    persist(); render();
    toast(rd.holes.length >= 18 ? `코스를 나눴어요 (전반 ${sp.front} · 후반 ${sp.back})${filled ? ' · 저장된 파를 불러왔어요' : ''}` : `9홀 코스 이름: ${sp.front}`);
  };

  el.oninput = e => {
    const rd = r(), t = e.target;
    if (t.id === 'f-date') rd.date = t.value || todayStr();
    else if (t.id === 'f-time') rd.time = t.value;
    else if (t.id === 'f-course') {
      rd.course = t.value;
      const c = courses.find(x => x.name === t.value.trim());
      if (c && c.pars?.length) {
        // 저장된 코스를 고르면 홀 수와 파를 그대로 가져온다
        const n = c.pars.length;
        resizeRound(rd, n);
        rd.pars = [...c.pars];
        rd.frontName = c.front || ''; rd.backName = n >= 18 ? c.back || '' : '';
        persist(); render();
        el.querySelector('#f-course')?.focus();
        toast('저장된 코스의 파 정보를 불러왔어요');
        return;
      }
    } else if (t.id === 'f-front' || t.id === 'f-back') {
      const half = t.id === 'f-front' ? 0 : 1;
      if (half === 0) rd.frontName = t.value; else rd.backName = t.value;
      // 저장된 9홀 코스 이름과 정확히 같으면 그 코스의 파를 해당 9홀에 채운다
      const nine = courseRec()?.nines?.find(n => n.name === t.value.trim());
      const at = half * 9;
      if (nine && rd.holes.length >= at + 9 && nine.pars.some((p, i) => p !== rd.pars[at + i])) {
        nine.pars.forEach((p, i) => { rd.pars[at + i] = p; });
        persist(); render();
        el.querySelector('#' + t.id)?.focus();
        toast(`“${nine.name}” 코스의 파를 불러왔어요`);
        return;
      }
    } else if (t.id === 'f-temp') rd.temp = t.value === '' ? null : Number(t.value);
    else if (t.id === 'f-memo') rd.memo = t.value;
    persist();
  };

  render();
  return () => { el.classList.remove('flow'); document.getElementById('tabbar').hidden = false; el.onclick = el.oninput = null; };
}

function firstEmpty(r) {
  const i = r.holes.findIndex(h => h.score == null);
  return i < 0 ? 0 : i;
}
