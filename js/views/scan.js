import { ic } from '../icons.js';
import { esc, newRound, DEFAULT_PARS, todayStr } from '../util.js';
import { loadBitmap, preprocess, recognize, parseScorecard, thumbnail } from '../ocr.js';
import { pageHead, toast } from '../ui.js';
import { setDraft } from './editor.js';

const ROLES = [['ignore', '사용 안 함'], ['par', '파'], ['score', '내 스코어'], ['putts', '퍼팅']];
const RANGES = [['front', '전반 1-9'], ['back', '후반 10-18']];

const STATUS = {
  'loading tesseract core': '인식 엔진 준비 중…',
  'initializing tesseract': '인식 엔진 준비 중…',
  'loading language traineddata': '언어 데이터 불러오는 중…',
  'initializing api': '인식 엔진 준비 중…',
  'recognizing text': '스코어카드 읽는 중…'
};

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
      // 표의 괘선을 지우고 읽는 방식이 가장 정확하다. 실패하면 다른 방식으로 다시 시도해 가장 많이 읽은 결과를 쓴다.
      const attempts = [
        [{ removeLines: true }, '6'],
        [{ removeLines: true, thr: 0.9 }, '6'],
        [{}, '6'],
        [{ removeLines: true }, '11']
      ];
      const used = r => r.filter(x => x.role !== 'ignore').length;
      let parsed = null, date = null;
      for (let k = 0; k < attempts.length; k++) {
        if (k) { state.status = '한 번 더 선명하게 처리하는 중…'; state.progress = 0.3; update({}); }
        const [pre, psm] = attempts[k];
        const data = await recognize(preprocess(bmp, pre), update, { psm });
        const p = parseScorecard(data);
        date ||= p.date;
        if (!parsed || used(p.rows) > used(parsed.rows)) parsed = p;
        if (parsed.rows.some(r => r.role === 'score') && parsed.rows.some(r => r.role === 'par')) break;
      }
      parsed.date = parsed.date || date;
      state = { phase: 'review', preview: prevUrl, image, rows: parsed.rows, date: parsed.date || todayStr(), dateFound: !!parsed.date };
    } catch (err) {
      console.error(err);
      state = { phase: 'pick', error: err?.message || '이미지를 읽지 못했어요' };
      toast('이미지를 읽는 중 문제가 생겼어요');
    }
    draw();
  }

  el.onchange = e => {
    if (e.target.matches('input[type=file]')) handleFile(e.target.files[0]);
    else if (e.target.matches('[data-role]')) { state.rows[Number(e.target.dataset.role)].role = e.target.value; draw(); }
    else if (e.target.matches('[data-range]')) { state.rows[Number(e.target.dataset.range)].range = e.target.value; draw(); }
    else if (e.target.id === 's-date') state.date = e.target.value;
  };
  el.oninput = e => {
    const t = e.target;
    if (t.matches('[data-cell]')) {
      const [ri, ci] = t.dataset.cell.split(',').map(Number);
      const raw = t.value.trim();
      const v = raw === '' ? null : Number(raw);
      const ok = raw === '' || (Number.isInteger(v) && v >= 0 && v <= 20);
      t.classList.toggle('bad', !ok);
      if (ok) state.rows[ri].vals[ci] = v;
    }
  };
  el.onclick = e => {
    if (e.target.closest('#retry')) { state = { phase: 'pick' }; draw(); }
    if (e.target.closest('#apply')) apply();
  };

  function apply() {
    const rows = state.rows.filter(r => r.role !== 'ignore');
    if (!rows.some(r => r.role === 'score')) { toast('“내 스코어”로 사용할 줄을 하나 골라주세요'); return; }
    const pars = Array(18).fill(null), scores = Array(18).fill(null), putts = Array(18).fill(null);
    let n = 9;
    for (const r of rows) {
      const base = r.vals.length > 9 ? 0 : r.range === 'back' ? 9 : 0;
      r.vals.forEach((v, k) => {
        const idx = base + k;
        if (idx >= 18) return;
        if (idx >= 9 && v != null) n = 18;
        const target = r.role === 'par' ? pars : r.role === 'score' ? scores : putts;
        if (v != null) target[idx] = v;
      });
      if (r.vals.length > 9 || r.range === 'back') n = 18;
    }
    const round = newRound(n);
    round.date = state.date || todayStr();
    round.pars = Array.from({ length: n }, (_, i) => (pars[i] >= 3 && pars[i] <= 6 ? pars[i] : DEFAULT_PARS[i]));
    round.holes = Array.from({ length: n }, (_, i) => ({ score: scores[i] >= 1 ? scores[i] : null, putts: putts[i], ob: 0, hazard: 0 }));
    round.holes.forEach(h => { if (h.score != null && h.putts != null && h.putts > h.score) h.putts = null; });
    round.image = state.image;
    setDraft(round, { step: 'info', fromScan: true });
    toast('스코어를 채웠어요. 나머지 정보를 확인하세요');
    location.hash = '#/new';
  }
}

function pickHtml(s) {
  return `${pageHead({ title: '스코어카드 불러오기', sub: '사진으로 자동 입력', back: '#/' })}
    ${s.error ? `<div class="banner" style="background:color-mix(in srgb,var(--over) 14%,transparent);color:var(--bad-text)">${ic('alert', 18)}<span class="grow">${esc(s.error)}</span></div>` : ''}
    <div class="drop">
      <div class="big-ic">${ic('camera')}</div>
      <div><b style="font-size:17px">스코어카드 사진을 골라주세요</b><br><span class="muted small">인식은 이 기기 안에서만 이루어지고, 사진은 밖으로 전송되지 않아요</span></div>
      <label class="btn lime block" style="max-width:320px;cursor:pointer">${ic('camera')} 카메라로 촬영<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn secondary block" style="max-width:320px;cursor:pointer">${ic('image')} 앨범에서 선택<input type="file" accept="image/*" hidden></label>
    </div>
    <div class="card" style="margin-top:14px"><h2>잘 읽히는 요령</h2>
      <ul class="tips">
        <li>표 전체가 화면에 꽉 차게, 정면에서 찍어주세요</li>
        <li>그림자와 빛 반사를 피하고 밝은 곳에서 촬영하세요</li>
        <li>숫자 칸이 흐리게 나오면 가까이 다시 찍어보세요</li>
        <li>읽은 뒤 <b>확인·수정 화면</b>이 나오니 틀린 칸만 고치면 돼요</li>
      </ul></div>`;
}

function busyHtml(s) {
  return `${pageHead({ title: '읽는 중…', sub: '스코어카드 인식' })}
    <img class="photo" src="${s.preview}" alt="선택한 스코어카드" style="max-height:38vh;object-fit:contain;background:var(--surface-2)">
    <div class="card" style="margin-top:14px"><div id="status" style="font-weight:700;margin-bottom:10px">${esc(s.status)}</div>
      <div class="progress"><i style="width:${Math.round(s.progress * 100)}%"></i></div>
      <p class="hint" style="margin:10px 0 0">처음 한 번은 엔진을 준비하느라 조금 더 걸려요.</p></div>`;
}

function reviewHtml(s) {
  const hasRows = s.rows.length > 0;
  const rowsHtml = s.rows.map((r, ri) => {
    const nine = r.vals.length <= 9;
    return `<div class="scanrow ${r.role === 'ignore' ? 'ignored' : ''}">
      <div class="rh">
        <select data-role="${ri}" aria-label="줄 ${ri + 1} 용도">${ROLES.map(([k, l]) => `<option value="${k}"${r.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${nine ? `<select data-range="${ri}" aria-label="줄 ${ri + 1} 범위">${RANGES.map(([k, l]) => `<option value="${k}"${r.range === k ? ' selected' : ''}>${l}</option>`).join('')}</select>` : '<span class="muted small" style="align-self:center">18홀 전체</span>'}
      </div>
      <div class="cells">${r.vals.map((v, ci) => `<input inputmode="numeric" data-cell="${ri},${ci}" value="${v ?? ''}" aria-label="${ci + 1}번째 칸">`).join('')}</div>
      ${r.incomplete ? '<div class="small over-t" style="margin-top:6px">일부 칸을 못 읽었어요. 빈 칸을 채워주세요.</div>' : ''}
    </div>`;
  }).join('');

  return `${pageHead({ title: '인식 결과 확인', sub: '읽은 숫자를 확인하세요', back: '#/scan' })}
    <details class="card" style="padding:12px 16px"><summary style="cursor:pointer;font-weight:700">원본 사진 보기</summary><img class="photo" src="${s.preview}" alt="스코어카드" style="margin-top:10px"></details>
    <div class="card" style="margin-top:12px">
      <div class="field" style="margin-bottom:0"><label for="s-date">라운드 날짜 ${s.dateFound ? '<span class="badge">사진에서 인식</span>' : '<span class="badge warn">오늘 날짜로 설정</span>'}</label>
      <input id="s-date" class="input" type="date" value="${esc(s.date)}"></div>
    </div>
    <div class="section-title"><span>인식된 숫자 줄 ${s.rows.length}개</span></div>
    ${hasRows ? `<p class="hint small muted" style="margin:0 4px 10px">각 줄의 용도를 확인하세요. 같은 스코어카드에 여러 명이 있으면 <b>내 줄</b>만 “내 스코어”로 지정하세요.</p>${rowsHtml}`
      : `<div class="card empty" style="padding:24px"><h2>숫자 줄을 찾지 못했어요</h2><p>표가 화면에 꽉 차게, 더 선명하게 다시 찍어보세요.</p></div>`}
    <div class="grid-2" style="margin-top:16px">
      <button class="btn secondary" id="retry">${ic('camera')} 다시 선택</button>
      <button class="btn lime" id="apply" ${hasRows ? '' : 'disabled'}>${ic('check')} 적용하기</button>
    </div>`;
}
