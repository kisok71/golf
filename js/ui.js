import { ic } from './icons.js';
import { esc } from './util.js';

let toastTimer;
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

/** 하단 시트. content는 HTML 문자열, 반환값은 { el, close } */
export function sheet(content, { onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${content}</div>`;
  const close = () => { if (!ov.isConnected) return; ov.remove(); onClose?.(); };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  return { el: ov.firstElementChild, close };
}

export function confirmDialog({ title, message = '', ok = '확인', cancel = '취소', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const s = sheet(`<h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="btns"><button class="btn secondary" data-v="0">${esc(cancel)}</button>
      <button class="btn ${danger ? 'danger' : ''}" data-v="1">${esc(ok)}</button></div>`, { onClose: () => { if (!answered) resolve(false); } });
    s.el.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      answered = true;
      resolve(b.dataset.v === '1');
      s.close();
    });
  });
}

export function newRoundSheet() {
  const s = sheet(`<h3>새 라운드 기록</h3><p>어떤 방식으로 시작할까요?</p>
    <div class="opts">
      <button class="opt" data-go="#/new"><span class="ico">${ic('edit', 22)}</span><div><b>직접 입력</b><span>홀별로 스코어 · 퍼팅 · OB · 해저드 기록</span></div></button>
      <button class="opt lime" data-go="#/scan"><span class="ico">${ic('camera', 22)}</span><div><b>스코어카드 사진으로</b><span>사진을 읽어 자동으로 채워요</span></div></button>
    </div>`);
  s.el.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) { s.close(); location.hash = b.dataset.go; }
  });
}

/* 차트 툴팁 (data-tip 요소에 호버/탭) */
export function initTooltip() {
  const tip = document.getElementById('tip');
  const hide = () => (tip.hidden = true);
  const show = el => {
    tip.innerHTML = el.dataset.tip; tip.hidden = false;
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    const x = Math.max(8, Math.min(innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2));
    let y = r.top - tr.height - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  document.addEventListener('pointerover', e => { const t = e.target.closest?.('[data-tip]'); t ? show(t) : hide(); });
  document.addEventListener('pointerdown', e => { const t = e.target.closest?.('[data-tip]'); t ? show(t) : hide(); });
  addEventListener('scroll', hide, { passive: true });
}

export const pageHead = ({ title, sub = '', back = '', right = '' }) => `
  <header class="page-head">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="뒤로">${ic('back')}</a>` : ''}
    <h1>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}${esc(title)}</h1>${right}
  </header>`;
