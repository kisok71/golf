import { db } from '../db.js';
import { ic } from '../icons.js';
import { pageHead, toast, confirmDialog, sheet } from '../ui.js';
import { downloadFile, todayStr, esc } from '../util.js';
import { loadSamples } from '../sample.js';
import { getPlayer, setPlayer } from './scan.js';

const THEME = 'gn.theme';
export function applyTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME); } catch { /* noop */ }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? '#0b110e' : '#0f5c3f';
}

/** 합치기 / 교체 / 취소 중 하나를 고르게 한다. 바깥을 눌러 닫으면 취소로 처리 */
function askImportMode(count) {
  return new Promise(resolve => {
    let picked = null;
    const s = sheet(`<h3>어떻게 불러올까요?</h3><p>백업 파일에 라운드 ${count}개가 들어 있어요.</p>
      <div class="opts">
        <button class="opt" data-m="merge"><div><b>기존 기록에 합치기</b><span>같은 기록은 덮어쓰고 나머지는 그대로 둬요</span></div></button>
        <button class="opt" data-m="replace"><div><b>모두 교체</b><span>지금 기록을 지우고 백업 내용으로 바꿔요</span></div></button>
      </div>`, { onClose: () => resolve(picked) });
    s.el.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      if (b) { picked = b.dataset.m; s.close(); }
    });
  });
}

export async function mount(el) {
  const draw = async () => {
    const rounds = await db.rounds();
    const hasSample = rounds.some(r => r.sample);
    let theme = 'auto';
    try { theme = localStorage.getItem(THEME) || 'auto'; } catch { /* noop */ }
    let persisted = null;
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* noop */ }

    el.innerHTML = pageHead({ title: '설정' }) + `
    <div class="section-title" style="margin-top:0"><span>화면</span></div>
    <div class="card"><div class="seg" role="group" aria-label="화면 테마">
      ${[['auto', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([k, l]) => `<button data-theme="${k}" class="${theme === k ? 'on' : ''}">${l}</button>`).join('')}
    </div></div>

    <div class="section-title"><span>스코어카드 인식</span></div>
    <div class="card"><div class="field" style="margin-bottom:0"><label for="p-name">내 이름</label>
      <input id="p-name" class="input" placeholder="스코어카드에 표시되는 이름" value="${esc(getPlayer())}" autocomplete="off">
      <span class="small muted">사진에 여러 명이 있을 때 이 이름의 줄만 자동으로 골라요.</span></div></div>

    <div class="section-title"><span>내 데이터 · ${rounds.length}라운드</span></div>
    <div class="card"><p class="hint" style="margin-bottom:12px">모든 기록은 <b>이 기기 안</b>에만 저장돼요. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 꼭 백업하세요.</p>
      <div class="grid-2">
        <button class="btn soft" id="export">${ic('download')} 백업 저장</button>
        <label class="btn soft" style="cursor:pointer">${ic('upload')} 백업 불러오기<input type="file" id="import" accept="application/json,.json" hidden></label>
      </div>
      <p class="small muted" style="margin:12px 0 0">${persisted ? '✓ 브라우저가 이 앱의 저장 공간을 보호하고 있어요.' : '홈 화면에 추가하면 저장 공간이 더 안전하게 유지돼요.'}</p></div>

    <div class="section-title"><span>샘플 · 초기화</span></div>
    <div class="list">
      ${hasSample ? `<button class="li" id="rm-sample"><span class="ico">${ic('trash')}</span><div class="grow"><b>샘플 데이터 지우기</b><div class="small muted">내가 입력한 기록은 그대로 둬요</div></div></button>`
        : `<button class="li" id="add-sample"><span class="ico">${ic('spark')}</span><div class="grow"><b>샘플 데이터 추가</b><div class="small muted">대시보드를 미리 체험해볼 수 있어요 (22라운드)</div></div></button>`}
      <button class="li" id="wipe"><span class="ico" style="background:color-mix(in srgb,var(--over) 14%,transparent);color:var(--bad-text)">${ic('alert')}</span><div class="grow"><b style="color:var(--bad-text)">모든 데이터 삭제</b><div class="small muted">되돌릴 수 없어요</div></div></button>
    </div>
    <p class="small muted" style="text-align:center;margin-top:28px">그린노트 · 기록은 기기 밖으로 나가지 않아요 (코스 검색 시 코스 이름만 OpenStreetMap으로 전송)</p>`;
  };
  await draw();

  try { navigator.storage?.persist?.(); } catch { /* noop */ }

  el.onclick = async e => {
    const t = e.target.closest('[data-theme]');
    if (t) { try { t.dataset.theme === 'auto' ? localStorage.removeItem(THEME) : localStorage.setItem(THEME, t.dataset.theme); } catch { /* noop */ } applyTheme(); draw(); return; }
    if (e.target.closest('#export')) {
      const data = await db.exportAll();
      downloadFile(`green-note-backup-${todayStr()}.json`, JSON.stringify(data));
      toast('백업 파일을 저장했어요');
    }
    if (e.target.closest('#add-sample')) { const n = await loadSamples(); toast(`샘플 ${n}라운드를 추가했어요`); draw(); }
    if (e.target.closest('#rm-sample')) { const n = await db.removeSamples(); toast(`샘플 ${n}라운드를 지웠어요`); draw(); }
    if (e.target.closest('#wipe') && await confirmDialog({ title: '모든 데이터를 삭제할까요?', message: '라운드 기록과 코스 정보가 모두 사라지고 되돌릴 수 없어요. 먼저 백업하는 것을 권장해요.', ok: '모두 삭제', danger: true })) {
      await db.clearAll(); try { localStorage.removeItem('gn.draft'); } catch { /* noop */ } toast('삭제했어요'); draw();
    }
  };
  el.onchange = async e => {
    if (e.target.id === 'p-name') { setPlayer(e.target.value.trim()); toast('저장했어요'); return; }
    if (e.target.id !== 'import') return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const mode = await askImportMode(data.rounds?.length ?? 0);
      if (!mode) { e.target.value = ''; return; }
      const n = await db.importAll(data, { replace: mode === 'replace' });
      toast(`${n}라운드를 불러왔어요`); draw();
    } catch (err) { toast(err.message || '파일을 읽지 못했어요'); }
    e.target.value = '';
  };
}
