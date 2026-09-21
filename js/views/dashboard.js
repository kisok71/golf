import { db } from '../db.js';
import { ic } from '../icons.js';
import { analyze, analyzeNines, estimateHandicap, rangeLabel } from '../stats.js';
import { trendChart, penaltyChart, distBar, stackBar, hbars, heatmap } from '../charts.js';
import { esc, f1, signed, fmtShort, weatherLabel, summarize, expandNines, nineName } from '../util.js';
import { pageHead, newRoundSheet } from '../ui.js';
import { loadSamples } from '../sample.js';

const KEY = 'gn.dash';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = f => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* 저장 불가 환경 */ } };

export async function mount(el) {
  const [rounds, saved] = await Promise.all([db.rounds(), db.courses()]);
  if (!rounds.length) return renderEmpty(el);

  const filters = { period: 'all', course: 'all', mode: undefined, heatCourse: '', heatNine: '', heatMode: 'diff', ...load() };
  const courses = [...new Set(rounds.map(r => r.course).filter(Boolean))];
  if (filters.course !== 'all' && !courses.includes(filters.course)) filters.course = 'all';

  const draw = () => {
    const s = analyze(rounds, filters);
    el.innerHTML = pageHead({ title: '스코어 분석', sub: greeting(), right: '' }) + filterBar(filters, courses, s) + (s.empty ? emptyFiltered(rounds) : body(s, { heat: heatCard(rounds, saved, filters), nine: nineCard(rounds, filters), hcp: estimateHandicap(rounds) }));
    if (s.empty) return;
  };
  draw();

  const redrawHeat = () => { const c = el.querySelector('#heat-card'); if (c) c.outerHTML = heatCard(rounds, saved, filters); };
  el.onclick = e => {
    const hm = e.target.closest('[data-heat]');
    if (hm) { filters.heatMode = hm.dataset.heat; save(filters); redrawHeat(); return; }
    const c = e.target.closest('[data-f]');
    if (c) {
      const [k, v] = [c.dataset.f, c.dataset.v];
      filters[k] = k === 'mode' ? Number(v) : v;
      save(filters); draw();
    }
    if (e.target.closest('[data-new]')) newRoundSheet();
  };
  el.onchange = e => {
    if (e.target.matches('#heat-course')) { filters.heatCourse = e.target.value; filters.heatNine = ''; save(filters); redrawHeat(); return; }
    if (e.target.matches('#heat-nine')) { filters.heatNine = e.target.value; save(filters); redrawHeat(); return; }
    if (e.target.matches('#course-filter')) { filters.course = e.target.value; save(filters); draw(); }
  };
}

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? '늦은 밤이에요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '오늘도 굿샷!' : '수고했어요';
}

function renderEmpty(el) {
  el.innerHTML = `<div class="empty" style="padding-top:60px">
    <img src="icons/icon-192.png" alt="">
    <h2>첫 라운드를 기록해보세요</h2>
    <p>스코어 · 퍼팅 · OB · 해저드를 기록하면<br>강점과 약점을 대시보드로 분석해드려요.</p>
    <div class="btns">
      <button class="btn lime" data-new>${ic('plus')} 라운드 기록하기</button>
      <button class="btn secondary" data-sample>샘플 데이터로 미리 보기</button>
    </div></div>`;
  el.onclick = async e => {
    if (e.target.closest('[data-new]')) newRoundSheet();
    if (e.target.closest('[data-sample]')) { await loadSamples(); location.reload(); }
  };
}

function emptyFiltered(rounds) {
  const inProgress = rounds.filter(r => r.holes.some(h => h.score == null)).length;
  return `<div class="card empty"><h2>조건에 맞는 라운드가 없어요</h2><p>필터를 바꾸거나 새 라운드를 기록해보세요.${inProgress ? `<br><span class="small muted">미완료 라운드 ${inProgress}개는 분석에서 제외돼요</span>` : ''}</p></div>`;
}

function filterBar(f, courses, s) {
  const chip = (k, v, label, on) => `<button class="chip${on ? ' on' : ''}" data-f="${k}" data-v="${v}">${label}</button>`;
  return `<div class="filters">
    <div class="chips">
      ${chip('period', 'all', '전체', f.period === 'all')}${chip('period', 'last10', '최근 10회', f.period === 'last10')}${chip('period', 'year', '올해', f.period === 'year')}
      ${s.modes?.length > 1 ? s.modes.map(m => chip('mode', m, `${m}홀`, s.mode === m)).join('') : ''}
    </div>
    ${courses.length > 1 ? `<select id="course-filter" class="input" aria-label="코스 선택" style="min-height:44px">
      <option value="all">모든 코스</option>${courses.map(c => `<option${c === f.course ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
  </div>`;
}

const trendBadge = t => {
  if (t == null) return '';
  const v = Math.round(t * 10) / 10;
  if (v === 0) return '<span class="trend">– 변화 없음</span>';
  return `<span class="trend ${v < 0 ? 'good' : 'bad'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v).toFixed(1)}타 ${v < 0 ? '개선' : '증가'}</span>`;
};

/** 핸디캡 표기: 0 미만(플러스 핸디캡)은 +2.1 처럼 */
const fmtHcp = v => (v < 0 ? `+${Math.abs(v).toFixed(1)}` : v.toFixed(1));

function hcpBadge(h) {
  if (h.index == null) {
    return `<div class="hcp dim" data-tip="<b>추정 핸디캡</b><br>18홀을 끝까지 기록한 라운드가 3회 이상 있으면 계산해요."><small>추정 핸디캡</small><b>–</b><small>18홀 ${h.n}/3회</small></div>`;
  }
  const how = `최근 ${h.n}개 18홀 라운드 중 핸디캡 차이가 좋은 ${h.used}개의 평균${h.adj ? ` ${h.adj > 0 ? '+' : ''}${h.adj.toFixed(1)}` : ''}`;
  const basis = h.rated === h.n ? '모든 라운드에 코스 레이팅·슬로프를 반영했어요.' : h.rated === 0 ? '코스 레이팅·슬로프가 없어 파를 기준으로 계산했어요. 라운드에 입력하면 더 정확해져요.' : `${h.n}개 중 ${h.rated}개만 레이팅·슬로프를 반영했고 나머지는 파 기준이에요.`;
  const estNote = h.est ? ` 그중 ${h.est}개는 KGA 자료가 없어 평균 임시값을 썼어요.` : '';
  return `<div class="hcp" data-tip="<b>추정 핸디캡</b><br>${how}<br>${basis}${estNote}<br>홀별 스코어 상한 등은 반영하지 않아 공식 핸디캡과 다를 수 있어요."><small>추정 핸디캡</small><b>${fmtHcp(h.index)}</b></div>`;
}

function body(s, { heat, nine, hcp }) {
  const p = s.putts;
  const kpis = `<div class="kpis">
    <div class="card kpi hero">
      <div class="label">평균 타수 · ${s.mode}홀 ${s.n}라운드</div>
      <div class="value-row"><div class="value num">${f1(s.avg)}<small>타</small></div>${hcpBadge(hcp)}</div>
      <div class="foot"><span>파 대비 ${signed(s.avgDiff, 1)}</span>${trendBadge(s.trend)}${s.trend != null ? '<span>(최근 5 vs 이전 5)</span>' : ''}</div>
    </div>
    <div class="card kpi"><div class="label">베스트</div><div class="value num">${s.best.score}<small>타</small></div>
      <div class="foot">${fmtShort(s.best.round.date)} · ${esc(s.best.round.course)}</div></div>
    <div class="card kpi"><div class="label">평균 퍼팅</div><div class="value num">${p.perRound == null ? '–' : f1(p.perRound)}<small>${p.perRound == null ? '' : '개'}</small></div>
      <div class="foot">${p.perHole == null ? '퍼팅 수를 입력하면 표시돼요' : `홀당 ${p.perHole.toFixed(2)}개`}</div></div>
  </div>`;

  const mini = `<div class="card" style="margin-top:12px"><div class="mini-stats">
    <div><div class="v">${s.gir == null ? '–' : Math.round(s.gir * 100) + '%'}</div><div class="l">그린적중</div></div>
    <div><div class="v">${p.threePerRound == null ? '–' : f1(p.threePerRound)}</div><div class="l">3퍼트/R</div></div>
    <div><div class="v">${f1(s.obPer)}</div><div class="l">OB/R</div></div>
    <div><div class="v">${f1(s.hzPer)}</div><div class="l">해저드/R</div></div>
  </div></div>`;

  const insights = `<div class="section-title"><span>인사이트</span></div><div class="insights">${s.insights.map(i =>
    `<div class="insight ${i.tone}"><span class="dot">${ic(i.icon, 18)}</span><div><p>${i.text}</p>${i.sub ? `<small>${i.sub}</small>` : ''}</div></div>`).join('')}</div>`;

  const trend = `<div class="card wide"><h2>스코어 추이</h2><p class="hint">${rangeLabel(s)} · 점선은 코스 파</p>${trendChart(s.series, { mode: s.mode })}</div>`;

  const dist = `<div class="card"><h2>스코어 분포</h2><p class="hint">전체 ${s.holeCount}홀 기준</p>${distBar(s.dist, s.holeCount)}</div>`;

  const pt = `<div class="card"><h2>파 타입별 평균</h2><p class="hint">홀당 파 대비 타수 (낮을수록 좋아요)</p>${hbars(
    s.parType.map(t => ({ name: `파${t.par}`, sub: `${t.n}홀`, v: t.avg, label: signed(t.avg, 2) })), { signedScale: true })}
    <p class="small muted" style="margin:12px 0 0">파 이하 성공률 ${s.parType.map(t => `파${t.par} ${Math.round(t.parRate * 100)}%`).join(' · ')}</p></div>`;

  const putt = p.total ? `<div class="card"><h2>퍼팅</h2><p class="hint">홀별 퍼팅 수 분포 (${p.total}홀)</p>${stackBar([
    { label: '1퍼트 이하', t: 't-b1', v: p.dist.le1 }, { label: '2퍼트', t: 't-0', v: p.dist.two }, { label: '3퍼트 이상', t: 't-r3', v: p.dist.three }], p.total)}</div>` : '';

  const pen = `<div class="card"><h2>OB · 해저드</h2><p class="hint">최근 ${Math.min(12, s.series.length)}라운드 · 라운드당 OB ${f1(s.obPer)} / 해저드 ${f1(s.hzPer)}</p>${penaltyChart(s.series)}
    ${s.trouble.length ? `<p class="small" style="margin:10px 0 0">트러블이 잦은 홀: ${s.trouble.map(h => `<b>${h.i + 1}번</b>(${h.trouble}회)`).join(', ')}</p>` : ''}</div>`;


  const half = s.half ? `<div class="card"><h2>전반 vs 후반</h2><p class="hint">9홀 평균 파 대비</p>${hbars([
    { name: '전반 1-9', v: s.half.front, label: signed(s.half.front, 1) }, { name: '후반 10-18', v: s.half.back, label: signed(s.half.back, 1) }], { signedScale: true })}</div>` : '';

  const weather = s.byWeather.length ? `<div class="card"><h2>날씨별 평균 타수</h2><p class="hint">파 대비 평균</p>${hbars(
    s.byWeather.map(w => ({ name: weatherLabel(w.key), sub: `${w.n}회`, v: w.diff, label: f1(w.avg) + '타', cls: '' })), { signedScale: true })}</div>` : '';

  const course = s.byCourse.length > 1 ? `<div class="card"><h2>코스별 평균 타수</h2><p class="hint">파 대비 평균 · 베스트</p>${hbars(
    s.byCourse.map(c => ({ name: c.key, sub: `${c.n}회 · 베스트 ${c.best}`, v: c.diff, label: f1(c.avg) + '타' })), { signedScale: true, wide: true })}</div>` : '';

  return kpis + mini + insights + `<div class="section-title"><span>상세 분석</span></div><div class="dash-grid">${trend}${dist}${pt}${putt}${pen}${half}${weather}${course}${nine}${heat}</div>`;
}

/** 홀별 평균 스코어 카드: 저장된 코스를 드롭다운으로 골라 그 코스만 분석한다 */
function heatCard(rounds, saved, f) {
  const done = rounds.filter(r => summarize(r).complete);
  const counts = new Map();
  done.forEach(r => counts.set(r.course, (counts.get(r.course) || 0) + 1));
  const names = [...new Set([...saved.map(c => c.name), ...counts.keys()])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  if (!names.length) return '';
  const mostPlayed = [...names].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))[0];
  const pick = names.includes(f.heatCourse) ? f.heatCourse : names.includes(f.course) ? f.course : mostPlayed;
  // 이 골프장에서 쓴 9홀 코스 이름들 (저장된 코스 + 기록에서 나온 이름)
  const nineCount = new Map();
  expandNines(done.filter(r => r.course === pick)).forEach(p => { if (p.nine) nineCount.set(p.nine, (nineCount.get(p.nine) || 0) + 1); });
  (saved.find(c => c.name === pick)?.nines || []).forEach(n => { if (!nineCount.has(n.name)) nineCount.set(n.name, 0); });
  const nineNames = [...nineCount.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  const nine = nineNames.includes(f.heatNine) ? f.heatNine : '';
  const hs = analyze(rounds, { period: f.period, course: pick, mode: nine ? 9 : f.mode, nine: nine || undefined });

  const select = `<select id="heat-course" class="input" aria-label="분석할 코스" style="min-height:44px">${names.map(n =>
    `<option value="${esc(n)}"${n === pick ? ' selected' : ''}>${esc(n)} · ${counts.get(n) ? `${counts.get(n)}회` : '기록 없음'}</option>`).join('')}</select>`;
  const nineSelect = nineNames.length ? `<select id="heat-nine" class="input" aria-label="9홀 코스" style="min-height:44px;margin-top:8px">
    <option value="">전체 · 전반+후반 통합</option>${nineNames.map(n => `<option value="${esc(n)}"${n === nine ? ' selected' : ''}>${esc(n)} 코스 · ${nineCount.get(n) ? `${nineCount.get(n)}회` : '기록 없음'}</option>`).join('')}</select>` : '';
  const toggle = `<div class="seg" role="group" aria-label="표시 방식" style="margin-top:8px">
    <button data-heat="diff" class="${f.heatMode !== 'strokes' ? 'on' : ''}">파 대비</button><button data-heat="strokes" class="${f.heatMode === 'strokes' ? 'on' : ''}">평균 타수</button></div>`;

  let inner;
  if (hs.empty) {
    inner = `<p class="small muted" style="margin:14px 0 0">이 코스는 아직 분석할 완성된 라운드가 없어요. 라운드를 기록하면 홀별 평균이 나와요.</p>`;
  } else {
    const ranked = hs.holeStats.filter(h => h.n >= 2 && h.avg != null);
    const hard = [...ranked].sort((a, b) => b.avg - a.avg).slice(0, 3);
    const good = [...ranked].sort((a, b) => a.avg - b.avg).slice(0, 3);
    const line = (label, list) => list.length ? `<div class="small" style="margin-top:6px"><span class="muted">${label}</span> ${list.map(h => `<b>${h.i + 1}번</b>(파${h.par}, ${signed(h.avg, 1)})`).join(' · ')}</div>` : '';
    inner = `<p class="small muted" style="margin:12px 0 10px">${hs.n}회 라운드 · 평균 <b>${f1(hs.avg)}타</b> · 베스트 <b>${hs.best.score}타</b> (${hs.mode}홀 기준${nine ? ` · ${esc(nine)} 코스` : ''})</p>
      ${heatmap(hs.holeStats, f.heatMode)}
      ${hs.n < 3 ? '<p class="small muted" style="margin:10px 0 0">라운드가 3회 이상 쌓이면 홀별 경향이 더 정확해져요.</p>' : ''}
      ${line('어려운 홀', hard)}${line('잘 치는 홀', good)}`;
  }
  return `<div class="card wide" id="heat-card"><h2>홀별 평균 스코어</h2><p class="hint">골프장과 9홀 코스(서·남 등)를 골라 홀마다 얼마나 어려운지 확인하세요</p>${select}${nineSelect}${toggle}${inner}</div>`;
}

/** 9홀 코스(서/남/동 등)별 평균: 전반·후반 9홀을 각각 그 코스의 한 번으로 센다 */
function nineCard(rounds, f) {
  const list = analyzeNines(rounds, { period: f.period, course: f.course });
  const anyNamed = rounds.some(r => nineName(r, 0) || nineName(r, 1));
  if (!list.length) {
    return anyNamed ? '' : `<div class="card"><h2>9홀 코스별 평균</h2><p class="hint" style="margin:0">라운드에 전반·후반 코스 이름(예: 서, 남)을 입력하면 코스별로 평균을 비교해요.</p></div>`;
  }
  const clubs = new Set(list.map(x => x.course));
  return `<div class="card"><h2>9홀 코스별 평균</h2><p class="hint">코스별 9홀 평균 타수 · 막대는 파 대비 (${list.reduce((a, b) => a + b.n, 0)}회)</p>${hbars(
    list.map(x => ({ name: x.nine, sub: (clubs.size > 1 ? `${x.course} · ` : '') + `${x.n}회 · 베스트 ${x.best}`, v: x.diff, label: f1(x.avg) + '타' })), { signedScale: true, wide: true })}</div>`;
}
