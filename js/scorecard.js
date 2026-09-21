import { sum } from './util.js';

/* 스코어카드 OCR 결과(단어 목록)를 해석하는 순수 로직. DOM에 의존하지 않는다. */

const CONFUSE = { O: '0', o: '0', D: '0', l: '1', I: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', q: '9' };
const MINUS = /^[-–−—]/;

/** OCR 단어를 숫자로 정리 ("-1" 같은 음수 포함). 숫자가 아니면 null */
export function toNumber(text) {
  let t = String(text).trim();
  let neg = false;
  if (MINUS.test(t) && t.length > 1) { neg = true; t = t.slice(1); }
  t = t.replace(/[.,:;'"`~_]+$/g, '').replace(/^[.,:;'"`~_|]+/g, '');
  if (!t || t.length > 3) return null;
  if (!/^[0-9OoDlI|iSsBZzgq]+$/.test(t)) return null;
  t = [...t].map(c => CONFUSE[c] ?? c).join('');
  if (!/^\d{1,2}$/.test(t)) return null;
  return neg ? -Number(t) : Number(t);
}

const hasLetters = s => /[가-힣A-Za-z]/.test(s);

/** 단어들을 y좌표로 묶어 행으로 만든다. 각 행은 숫자 목록과 왼쪽 라벨(이름 등)을 가진다 */
export function buildRows(words) {
  const toks = [];
  for (const w of words) {
    const b = w.bbox, text = String(w.text).trim();
    if (!text) continue;
    toks.push({ text, n: toNumber(text), x: (b.x0 + b.x1) / 2, x0: b.x0, y: (b.y0 + b.y1) / 2, h: b.y1 - b.y0 });
  }
  const nums = toks.filter(t => t.n != null);
  if (!nums.length) return [];
  const hs = nums.map(t => t.h).sort((a, b) => a - b);
  const hMed = hs[hs.length >> 1] || 20;
  toks.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const t of toks) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(t.y - last.y) < hMed * 0.65) {
      last.toks.push(t);
      last.y = last.toks.reduce((s, k) => s + k.y, 0) / last.toks.length;
    } else rows.push({ y: t.y, toks: [t] });
  }
  return rows.map(r => {
    const sorted = r.toks.sort((a, b) => a.x - b.x);
    const numeric = sorted.filter(t => t.n != null);
    const firstX = numeric[0]?.x0 ?? Infinity;
    const label = sorted.filter(t => t.n == null && t.x < firstX && hasLetters(t.text)).map(t => t.text).join('');
    return { y: r.y, vals: numeric.map(t => t.n), label };
  });
}

/**
 * 한 줄의 숫자에서 홀별 값만 추린다.
 * 9칸마다 끼어 있는 소계(OUT/IN/합)와 총계는 건너뛰고 subs에 따로 담는다.
 */
export function holesFromRow(vals) {
  const n = vals.length;
  if (n < 7) return null;
  const out = [], subs = [];
  let i = 0;
  while (out.length < 18 && n - i >= 9) {
    const chunk = vals.slice(i, i + 9);
    out.push(...chunk);
    i += 9;
    // 홀 값은 20을 넘지 않으므로 그보다 큰 값이나 칸 합과 같은 값은 소계 칸이다
    if (i < n && (vals[i] > 20 || vals[i] === sum(chunk)) && n - i !== 9) { subs.push(vals[i]); i++; }
  }
  if (out.length) {
    const clean = out.map(v => (v > 20 || v < -5 ? null : v));
    return { vals: clean, subs, incomplete: clean.some(v => v == null) };
  }
  // 7~8개만 읽힌 경우: 9칸으로 맞추고 빈 곳은 직접 입력하게 둔다
  return { vals: [...vals, ...Array(9 - n).fill(null)].slice(0, 9), subs: [], incomplete: true };
}

const isSeq = (v, from) => v.length >= 9 && v.slice(0, 9).every((x, k) => x === from + k);
const isPar = v => {
  const a = v.filter(x => x != null);
  return a.length >= 8 && a.every(x => x >= 3 && x <= 6) && a.filter(x => x <= 5).length >= a.length - 1;
};
const isHdcp = v => {
  const a = v.filter(x => x != null);
  return a.length >= 9 && new Set(a).size === a.length && Math.max(...a) >= 10;
};
export const chunkSums = v => [0, 9].filter(s => s < v.length).map(s => sum(v.slice(s, s + 9).filter(x => x != null)));

const norm = s => String(s || '').replace(/[\s*＊·.]/g, '');
/** 라벨이 내 이름과 일치하는지 (마스킹된 * 는 무시하고, 앞부분이 같으면 일치) */
export function matchesName(label, name) {
  const a = norm(label), b = norm(name);
  if (!a || !b) return false;
  return a.includes(b) || (a.length >= 2 && b.startsWith(a));
}

/**
 * 스코어카드 파싱: 숫자 행을 찾아 파 / 스코어 / 스코어(파 대비) / 퍼팅 / 무시로 추정한다.
 * 파 대비 스코어는 0=파, 1=보기, -1=버디이고, 소계가 (칸 합 + 그 9홀의 파 합계)와 같으면 그렇게 본다.
 * 결과는 사용자가 확인·수정하는 화면의 초안이다.
 */
export function parseScorecard(data, { player = '' } = {}) {
  const rows = buildRows(data.words || []);
  const out = [];
  let range = 'front', parsSeen = 0, sawHeader = false, parSums = null, headers = 0;
  const parNine = {}; // 9칸짜리 파 줄의 합계 (전반/후반)
  const assigned = { front: {}, back: {}, all: {} };

  for (const row of rows) {
    const parsed = holesFromRow(row.vals);
    if (!parsed) continue;
    const v = parsed.vals;
    const item = { vals: v, subs: parsed.subs, label: row.label, incomplete: parsed.incomplete, role: 'ignore', range: v.length === 18 ? 'all' : range };

    if (isSeq(v, 1)) {
      sawHeader = true;
      if (v.length < 18) range = headers++ === 0 ? 'front' : 'back';
      item.range = v.length === 18 ? 'all' : range;
      out.push(item);
      continue;
    }
    if (isSeq(v, 10)) { range = 'back'; sawHeader = true; item.range = 'back'; out.push(item); continue; }
    if (isHdcp(v)) { out.push(item); continue; }

    item.range = v.length === 18 ? 'all' : range;
    if (isPar(v)) {
      if (!sawHeader && v.length === 9 && parsSeen === 1) { range = 'back'; item.range = 'back'; }
      parsSeen++;
      item.role = 'par';
      assigned[item.range].par = true;
      if (v.length === 18) { if (!parSums) parSums = chunkSums(v); } else parNine[item.range] = sum(v.filter(x => x != null));
      out.push(item);
      continue;
    }

    const sums = chunkSums(v);
    const expectPar = k => (v.length >= 18 ? parSums?.[k] : parNine[item.range]);
    const relBySubs = item.subs.length > 0 && item.subs.every((s, k) => expectPar(k) != null && s === sums[k] + expectPar(k));
    const rel = relBySubs || v.some(x => x != null && x < 0);
    const a = v.filter(x => x != null);
    const avg = sum(a) / Math.max(1, a.length);
    const puttLike = !rel && a.every(x => x <= 6) && avg <= 2.6;
    const slot = assigned[item.range];
    item.candidate = rel ? 'score_rel' : puttLike ? 'putts' : 'score';
    if (puttLike) { if (!slot.putts && slot.score) { item.role = 'putts'; slot.putts = true; } }
    else if (!slot.score) { item.role = item.candidate; slot.score = true; }
    out.push(item);
  }

  // 내 이름이 있으면 그 줄을 내 스코어로 고르고, 다른 사람의 스코어 줄은 제외한다
  const playerMatched = !!player && out.some(r => r.candidate && r.candidate !== 'putts' && matchesName(r.label, player));
  if (playerMatched) {
    const taken = new Set();
    for (const r of out) {
      // 라벨이 붙은 줄은 (숫자가 퍼팅처럼 보여도) 다른 사람 줄이므로 제외한다. 라벨이 없거나 '퍼팅/PUTT'인 줄만 퍼팅 줄로 남긴다
      if (r.candidate === 'putts') {
        if (r.label && !/퍼|putt/i.test(r.label) && !matchesName(r.label, player)) r.role = 'ignore';
        continue;
      }
      if (!r.candidate) continue;
      if (matchesName(r.label, player) && !taken.has(r.range)) { taken.add(r.range); r.role = r.candidate; }
      else r.role = 'ignore';
    }
  }
  return { rows: out, playerMatched, ...findMeta(data.text || '', { player }) };
}

/** 화면 제목·버튼처럼 골프장 이름이 아닌 문구 */
const NOT_TITLE = /스코어카드|스마트스코어|스코어|홀별|거리정보|보기|결과|공유|확인|닫기|등록|저장|뒤로/;

/** 골프장 이름 · 날짜 · 시간 · 전반/후반 9홀 코스 이름(예: "동-서")을 찾는다 */
export function findMeta(text, { player = '' } = {}) {
  const lines = String(text).split('\n');
  const dRe = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;
  let date = null, time = null;
  for (const ln of lines) {
    const m = ln.match(dRe);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const t = ln.slice(ln.indexOf(m[0]) + m[0].length).match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (t && Number(t[1]) < 24 && Number(t[2]) < 60) time = `${String(t[1]).padStart(2, '0')}:${t[2]}`;
    break;
  }
  // 표(HOLE 줄) 위쪽만 본다
  const holeAt = lines.findIndex(l => /\bHOLE\b/i.test(l));
  const head = lines.slice(0, holeAt > 0 ? holeAt : Math.min(lines.length, 12));

  // 골프장 이름: 화면 제목·버튼·내 이름을 뺀 첫 한글 덩어리
  let title = '';
  outer: for (const ln of head) {
    for (const run of ln.match(/[가-힣][가-힣\s]*[가-힣]/g) || []) {
      const r = run.replace(/\s+/g, '');
      if (r.length < 2 || NOT_TITLE.test(r) || (player && matchesName(r, player))) continue;
      title = r;
      break outer;
    }
  }

  // 전반/후반 9홀 코스 이름: "동-서" 처럼 한글 두 덩어리가 구분 기호로만 이어진 줄
  let front = '', back = '';
  for (const ln of head) {
    const t = ln.replace(/[^가-힣\-–—~→]/g, '');
    const m = t.match(/^([가-힣]{1,4})[-–—~→]([가-힣]{1,4})$/);
    if (m) { front = m[1]; back = m[2]; break; }
  }
  return { date, time, title, front, back };
}
