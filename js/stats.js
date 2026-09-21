import { CATS, catOf, mean, sortRounds, summarize, sum, fmtShort, expandNines, differential } from './util.js';

/**
 * 완성된 라운드만 대상으로 분석한다.
 * opts: { period: 'all'|'last10'|'year', course: 'all'|이름, mode: 18|9|undefined, nine: 9홀 코스 이름(지정하면 그 9홀만 분석) }
 */
export function analyze(all, opts = {}) {
  const { period = 'all', course = 'all' } = opts;
  const source = opts.nine ? expandNines(all).filter(r => r.nine === opts.nine) : all;
  let rs = sortRounds(source).map(r => ({ r, s: summarize(r) })).filter(x => x.s.complete);
  if (course !== 'all') rs = rs.filter(x => x.r.course === course);
  if (period === 'year') { const y = String(new Date().getFullYear()); rs = rs.filter(x => x.r.date.startsWith(y)); }

  const modes = [18, 9].filter(m => rs.some(x => x.r.holes.length === m));
  const mode = opts.mode && modes.includes(opts.mode) ? opts.mode : modes[0];
  if (!mode) return { empty: true, modes };
  rs = rs.filter(x => x.r.holes.length === mode);
  if (period === 'last10') rs = rs.slice(-10);

  const n = rs.length;
  const scores = rs.map(x => x.s.score);
  const avg = mean(scores);
  const avgDiff = mean(rs.map(x => x.s.diff));
  const bestIdx = scores.indexOf(Math.min(...scores));
  const best = { score: scores[bestIdx], round: rs[bestIdx].r, diff: rs[bestIdx].s.diff };
  const last5 = scores.slice(-5), prev5 = scores.slice(-10, -5);
  const trend = n > 5 && prev5.length ? mean(last5) - mean(prev5) : null;

  const holes = rs.flatMap(x => x.r.holes.map((h, i) => ({
    i, par: x.r.pars[i], score: h.score, putts: h.putts, ob: h.ob || 0, hz: h.hazard || 0, diff: h.score - x.r.pars[i], key: x.r.id
  })));

  const dist = Object.fromEntries(CATS.map(c => [c.k, 0]));
  holes.forEach(h => dist[catOf(h.diff)]++);

  const parType = [3, 4, 5].map(p => {
    const hs = holes.filter(h => h.par === p);
    return { par: p, n: hs.length, avg: mean(hs.map(h => h.diff)), parRate: hs.length ? hs.filter(h => h.diff <= 0).length / hs.length : null };
  }).filter(p => p.n > 0);

  // 퍼팅: 모든 홀의 퍼팅 수를 입력한 라운드만 라운드당 지표에 사용
  const puttRounds = rs.filter(x => x.s.puttsN === x.s.n);
  const holesWithPutts = holes.filter(h => h.putts != null);
  const putts = {
    rounds: puttRounds.length,
    perRound: puttRounds.length ? mean(puttRounds.map(x => x.s.putts)) : null,
    perHole: holesWithPutts.length ? mean(holesWithPutts.map(h => h.putts)) : null,
    threePerRound: puttRounds.length ? mean(puttRounds.map(x => x.r.holes.filter(h => h.putts >= 3).length)) : null,
    dist: {
      le1: holesWithPutts.filter(h => h.putts <= 1).length,
      two: holesWithPutts.filter(h => h.putts === 2).length,
      three: holesWithPutts.filter(h => h.putts >= 3).length
    },
    total: holesWithPutts.length
  };
  const girOK = sum(rs.map(x => x.s.gir)), girN = sum(rs.map(x => x.s.girN));
  const gir = girN ? girOK / girN : null;

  const obPer = mean(rs.map(x => x.s.ob)), hzPer = mean(rs.map(x => x.s.hz));
  const holeStats = Array.from({ length: mode }, (_, i) => {
    const hs = holes.filter(h => h.i === i);
    return { i, n: hs.length, avg: mean(hs.map(h => h.diff)), trouble: sum(hs.map(h => h.ob + h.hz)), par: hs[0]?.par };
  });
  const trouble = [...holeStats].filter(h => h.trouble >= 2).sort((a, b) => b.trouble - a.trouble).slice(0, 3);

  const half = mode === 18 ? {
    front: mean(rs.map(x => sum(x.r.holes.slice(0, 9).map((h, i) => h.score - x.r.pars[i])))),
    back: mean(rs.map(x => sum(x.r.holes.slice(9).map((h, i) => h.score - x.r.pars[i + 9]))))
  } : null;

  const group = keyFn => {
    const m = new Map();
    rs.forEach(x => { const k = keyFn(x.r); if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(x); });
    return [...m.entries()].map(([k, xs]) => ({ key: k, n: xs.length, avg: mean(xs.map(x => x.s.score)), diff: mean(xs.map(x => x.s.diff)), best: Math.min(...xs.map(x => x.s.score)) }))
      .sort((a, b) => a.diff - b.diff);
  };
  const byWeather = group(r => r.weather);
  const byCourse = group(r => r.course);

  const series = rs.map(x => ({
    id: x.r.id, date: x.r.date, course: x.r.course, score: x.s.score, diff: x.s.diff, par: x.s.parTotal,
    putts: x.s.puttsN === x.s.n ? x.s.putts : null, ob: x.s.ob, hz: x.s.hz
  }));

  const stats = { empty: false, mode, modes, n, avg, avgDiff, best, trend, dist, holeCount: holes.length, parType, putts, gir, obPer, hzPer, holeStats, trouble, half, byWeather, byCourse, series, opts };
  stats.insights = makeInsights(stats);
  return stats;
}

function makeInsights(s) {
  const out = [];
  const add = (tone, icon, text, sub = '') => out.push({ tone, icon, text, sub });

  if (s.trend != null) {
    const t = Math.round(s.trend * 10) / 10;
    if (t <= -1) add('good', 'spark', `최근 5라운드 평균이 이전보다 <b>${Math.abs(t).toFixed(1)}타 줄었어요</b>`, '꾸준히 좋아지고 있어요');
    else if (t >= 1) add('warn', 'alert', `최근 5라운드 평균이 이전보다 <b>${t.toFixed(1)}타 늘었어요</b>`, '최근 흐름이 조금 흔들려요');
  }

  const pts = s.parType.filter(p => p.n >= 5);
  if (pts.length >= 2) {
    const worst = [...pts].sort((a, b) => b.avg - a.avg)[0];
    const bestP = [...pts].sort((a, b) => a.avg - b.avg)[0];
    if (worst.par !== bestP.par && worst.avg - bestP.avg >= 0.25)
      add('warn', 'target', `<b>파${worst.par}</b>가 가장 약해요 (평균 ${fmt(worst.avg)}타)`, `파${bestP.par}는 ${fmt(bestP.avg)}타로 가장 안정적이에요`);
  }

  if (s.putts.perRound != null) {
    if (s.putts.threePerRound >= 1.5)
      add('warn', 'target', `3퍼트가 라운드당 <b>${s.putts.threePerRound.toFixed(1)}회</b> 나와요`, '롱퍼트 거리감 연습이 타수를 가장 빨리 줄여줘요');
    else if (s.putts.perRound <= 32 && s.mode === 18)
      add('good', 'check', `라운드당 퍼팅 <b>${s.putts.perRound.toFixed(1)}개</b>로 퍼팅이 안정적이에요`);
  }

  const penalty = (s.obPer || 0) + (s.hzPer || 0);
  if (penalty >= 2)
    add('warn', 'alert', `OB·해저드가 라운드당 <b>${penalty.toFixed(1)}회</b>`, '티샷 클럽을 한 단계 낮추는 것도 방법이에요');
  else if (s.n >= 3 && penalty < 1)
    add('good', 'check', `OB·해저드가 라운드당 <b>${penalty.toFixed(1)}회</b>로 매우 적어요`);

  if (s.half && Math.abs(s.half.back - s.half.front) >= 1) {
    const d = s.half.back - s.half.front;
    add(d > 0 ? 'warn' : 'info', 'clock', d > 0
      ? `후반 9홀이 전반보다 평균 <b>${d.toFixed(1)}타</b> 많아요`
      : `후반 9홀이 전반보다 평균 <b>${Math.abs(d).toFixed(1)}타</b> 적어요`,
    d > 0 ? '후반 체력 · 집중력 관리가 포인트예요' : '워밍업 시간을 늘려보세요');
  }

  const hard = [...s.holeStats].filter(h => h.n >= 3).sort((a, b) => b.avg - a.avg)[0];
  if (hard && hard.avg >= 1 && (s.opts.course !== 'all' || s.byCourse.length === 1))
    add('info', 'flag', `<b>${hard.i + 1}번 홀</b>(파${hard.par})이 가장 어려워요`, `평균 ${fmt(hard.avg)}타`);

  const w = s.byWeather.filter(x => x.n >= 2);
  if (w.length >= 2) {
    const bw = w[0], ww = w[w.length - 1];
    if (ww.diff - bw.diff >= 2) add('info', 'sun', `<b>${wname(bw.key)}</b> 날 성적이 가장 좋아요`, `${wname(ww.key)} 날은 평균 ${(ww.diff - bw.diff).toFixed(1)}타 더 나와요`);
  }

  if (s.gir != null && s.gir >= 0.4) add('good', 'target', `그린 적중률 <b>${Math.round(s.gir * 100)}%</b>`, '어프로치가 좋아요');
  if (!out.length) add('info', 'info', '라운드가 쌓이면 자동으로 강점과 약점을 짚어드려요');
  return out.slice(0, 6);
}

const fmt = n => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
const WN = { sunny: '맑은', partly: '구름조금', cloudy: '흐린', rain: '비 오는', windy: '바람 부는', snow: '눈 오는' };
const wname = k => WN[k] || k;
export const rangeLabel = s => `${fmtShort(s.series[0].date)} – ${fmtShort(s.series[s.series.length - 1].date)}`;

/**
 * 골프장의 9홀 코스(서/남/동 등)별 성적. 전반·후반 9홀을 각각 그 코스의 한 번으로 센다.
 * 이름이 없는 9홀은 제외한다. 반환: [{ course, nine, n, avg, diff, best }] (파 대비 좋은 순)
 */
export function analyzeNines(all, { period = 'all', course = 'all' } = {}) {
  let rs = sortRounds(all);
  if (course !== 'all') rs = rs.filter(r => r.course === course);
  if (period === 'year') { const y = String(new Date().getFullYear()); rs = rs.filter(r => r.date.startsWith(y)); }
  if (period === 'last10') rs = rs.slice(-10);
  const groups = new Map();
  for (const p of expandNines(rs)) {
    if (!p.nine) continue;
    const s = summarize(p);
    if (!s.complete) continue;
    const key = p.course + '\u0000' + p.nine;
    if (!groups.has(key)) groups.set(key, { course: p.course, nine: p.nine, scores: [], diffs: [] });
    const g = groups.get(key);
    g.scores.push(s.score); g.diffs.push(s.diff);
  }
  return [...groups.values()].map(g => ({ course: g.course, nine: g.nine, n: g.scores.length, avg: mean(g.scores), diff: mean(g.diffs), best: Math.min(...g.scores) }))
    .sort((a, b) => a.diff - b.diff);
}

/* WHS(세계 핸디캡 시스템)의 라운드 수별 산정표: [라운드 수 상한, 반영할 좋은 라운드 수, 조정값] */
const WHS_TABLE = [[3, 1, -2], [4, 1, -1], [5, 1, 0], [6, 2, -1], [8, 2, 0], [11, 3, 0], [14, 4, 0], [16, 5, 0], [18, 6, 0], [19, 7, 0], [20, 8, 0]];

/**
 * 추정 핸디캡. WHS 방식의 간이 계산:
 * 완성된 18홀 라운드의 최근 20개에서 핸디캡 차이(Differential)가 좋은 라운드들의 평균 (3라운드부터).
 * 라운드에 코스 레이팅·슬로프가 있으면 (스코어-레이팅)x113/슬로프, 없으면 (스코어-파)로 대신한다.
 * 홀별 스코어 상한(ESC)과 기상 보정(PCC)은 반영하지 않는다.
 * 반환: { index(없으면 null), n(18홀 라운드 수), used, adj, rated(레이팅·슬로프를 반영한 라운드 수) }
 */
export function estimateHandicap(all) {
  const rs = sortRounds(all).map(r => ({ r, s: summarize(r) })).filter(x => x.s.complete && x.s.n === 18);
  const last = rs.slice(-20);
  const n = last.length;
  const diffs = last.map(x => differential(x.r, x.s));
  const rated = diffs.filter(d => d != null).length;
  if (n < 3) return { index: null, n, used: 0, adj: 0, rated };
  const [, take, adj] = WHS_TABLE.find(([max]) => n <= max);
  const sorted = last.map((x, i) => diffs[i] ?? x.s.diff).sort((p, q) => p - q);
  const idx = mean(sorted.slice(0, take)) + adj;
  return { index: Math.min(54, Math.round(idx * 10) / 10), n, used: take, adj, rated };
}
