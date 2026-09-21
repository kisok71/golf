import { db } from '../db.js';
import { ic } from '../icons.js';
import { esc, parsMini, parGridHtml, cyclePar, sum } from '../util.js';
import { pageHead, sheet, confirmDialog, toast } from '../ui.js';

export async function mount(el) {
  const draw = async () => {
    const [courses, rounds] = await Promise.all([db.courses(), db.rounds()]);
    const count = name => rounds.filter(r => r.course === name).length;
    courses.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    el.innerHTML = pageHead({ title: '내 코스', sub: `${courses.length}개 저장됨` }) + (courses.length
      ? `<p class="small muted" style="margin:-6px 4px 12px">라운드를 저장하면 코스와 홀별 파가 자동으로 저장돼요. 코스를 눌러 파를 수정할 수 있어요.</p><div class="list">${courses.map(c =>
        `<button class="li" data-name="${esc(c.name)}"><span class="ico">${ic('flag')}</span><div class="grow"><b>${esc(c.name)}</b>
          <div class="small muted">${c.pars.length}홀 · 파 ${sum(c.pars)} · ${count(c.name)}회 라운드</div>${c.nines?.length ? `<div class="small" style="margin-top:2px">9홀 코스: <b>${c.nines.map(n => esc(n.name)).join(' · ')}</b></div>` : ''}${parsMini(c.pars)}</div>${ic('chev')}</button>`).join('')}</div>`
      : `<div class="card empty"><h2>저장된 코스가 없어요</h2><p>라운드를 기록하면 코스가 자동으로 추가돼요.</p></div>`);
  };
  await draw();

  el.onclick = e => {
    const b = e.target.closest('[data-name]');
    if (b) editCourse(b.dataset.name, draw);
  };
}

async function editCourse(name, done) {
  const c = (await db.courses()).find(x => x.name === name);
  if (!c) return;
  const pars = [...c.pars];
  let nines = [...(c.nines || [])];
  const s = sheet('');
  const render = () => {
    s.el.innerHTML = `<div class="grab"></div><h3>${esc(name)}</h3><p>홀별 파를 눌러 수정하세요 · 합계 <b class="num">${sum(pars)}</b></p>
      ${parGridHtml(pars)}
      ${nines.length ? `<div class="section-title" style="margin:16px 4px 8px"><span>9홀 코스 이름</span></div><div class="chips" style="flex-wrap:wrap">${nines.map((n, i) => `<span class="chip">${esc(n.name)} · 파 ${sum(n.pars)}<button data-a="del-nine" data-i="${i}" aria-label="${esc(n.name)} 삭제" style="margin-left:2px;font-weight:800">×</button></span>`).join('')}</div><p class="small muted" style="margin:6px 4px 0">잘못 입력한 이름은 ×로 지울 수 있어요. 이미 기록한 라운드는 그대로예요.</p>` : ''}
      <div class="btns" style="grid-template-columns:auto 1fr 1fr"><button class="btn danger" data-a="del" aria-label="코스 삭제">${ic('trash')}</button><button class="btn secondary" data-a="cancel">취소</button><button class="btn" data-a="save">저장</button></div>`;
  };
  render();
  s.el.onclick = async e => {
    const par = e.target.closest('[data-act="par"]');
    if (par) { const i = Number(par.dataset.i); pars[i] = cyclePar(pars[i]); render(); return; }
    const del = e.target.closest('[data-a="del-nine"]');
    if (del) { nines.splice(Number(del.dataset.i), 1); render(); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') s.close();
    if (a === 'save') {
      // 18홀 파를 고쳤다면 그 전반/후반에 해당하는 9홀 코스의 파도 함께 맞춘다
      const synced = nines.map(n => (n.name === c.front && pars.length >= 9 ? { ...n, pars: pars.slice(0, 9) } : n.name === c.back && pars.length >= 18 ? { ...n, pars: pars.slice(9, 18) } : n));
      await db.saveCourse({ ...c, pars, nines: synced }); s.close(); toast('코스를 수정했어요'); done();
    }
    if (a === 'del') {
      if (await confirmDialog({ title: `“${name}” 코스를 삭제할까요?`, message: '이미 기록한 라운드는 그대로 남아요.', ok: '삭제', danger: true })) {
        await db.deleteCourse(name); s.close(); toast('삭제했어요'); done();
      }
    }
  };
}
