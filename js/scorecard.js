import { sum, splitNines } from './util.js';

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

/** 이름 글자와 숫자가 붙어서 한 단어로 읽힌 경우("정경화0", "함**1")를 나눈다 */
function splitGlued(w) {
  const text = String(w.text).trim();
  const m = text.match(/^([가-힣A-Za-z*＊]{1,8}[*＊]?)(-?\d{1,2})$/);
  const b = w.bbox;
  if (!m || toNumber(text) != null) return [{ text, bbox: b }];
  const cut = b.x0 + ((b.x1 - b.x0) * m[1].length) / text.length;
  return [{ text: m[1], bbox: { ...b, x1: cut } }, { text: m[2], bbox: { ...b, x0: cut } }];
}

/** 단어들을 y좌표로 묶어 행으로 만든다. 각 행은 숫자 목록과 왼쪽 라벨(이름 등), 라벨 영역 좌표를 가진다 */
export function buildRows(words) {
  const toks = [];
  for (const w0 of words) {
    for (const w of splitGlued(w0)) {
      const b = w.bbox, text = String(w.text).trim();
      if (!text) continue;
      toks.push({ text, n: toNumber(text), x: (b.x0 + b.x1) / 2, x0: b.x0, y: (b.y0 + b.y1) / 2, y0: b.y0, y1: b.y1, h: b.y1 - b.y0 });
    }
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
    const ys = numeric.length ? numeric : sorted;
    return { y: r.y, vals: numeric.map(t => t.n), label, box: { firstX, y0: Math.min(...ys.map(t => t.y0)), y1: Math.max(...ys.map(t => t.y1)) } };
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

/* ── 이름 비교: 한글을 자모로 풀어 1~2글자 정도 틀리게 읽힌 것도 같은 이름으로 본다 ── */
const norm = s => String(s || '').replace(/[\s*＊·.\-_|]/g, '');

function jamo(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) { const k = c - 0xac00; out.push(Math.floor(k / 588), 100 + Math.floor((k % 588) / 28), 200 + (k % 28)); }
    else out.push(ch);
  }
  return out;
}
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

/** 라벨이 이름과 일치하는지: 포함 / 마스킹된 이름(김**)의 앞부분 / 자모 유사(오인식) */
export function matchesName(label, name) {
  const a = norm(label), b = norm(name);
  if (!a || !b) return false;
  if (a.includes(b) || (a.length >= 2 && b.startsWith(a))) return true;
  if (a.length < 2 || b.length < 2) return false;
  const limit = b.length >= 3 ? 2 : 1;
  const jb = jamo(b);
  for (let len = Math.max(2, b.length - 1); len <= b.length + 1; len++) {
    for (let s = 0; s + len <= a.length; s++) {
      const win = a.slice(s, s + len);
      if (b.length === 2 && win[0] !== b[0]) continue; // 두 글자 이름은 첫 글자가 같아야 한다
      if (editDistance(jamo(win), jb) <= limit) return true;
    }
  }
  return false;
}

/**
 * 내 줄 고르기. 우선순위: ① 이름(저장한 이름 + 이전에 고른 표기들) 일치 ② 이전에 고른 위치(N번째 줄) ③ 기본(각 표의 첫 스코어 줄)
 * rows의 role을 직접 바꾸고, 어떤 방식으로 골랐는지 반환한다: 'name' | 'index' | 'default'
 */
export function selectMyRows(rows, opts = {}) {
  const by = pickRows(rows, opts);
  // 18홀이 한 줄인 줄이 선택됐다면, 9홀짜리 다른 줄이 함께 선택돼 홀을 덮어쓰지 않도록 제외한다
  const chosen = rows.filter(r => r.candidate && r.candidate !== 'putts' && (r.role === 'score' || r.role === 'score_rel'));
  if (chosen.some(r => r.range === 'all')) chosen.forEach(r => { if (r.range !== 'all') r.role = 'ignore'; });
  return by;
}

function pickRows(rows, { player = '', aliases = [], playerIdx = null } = {}) {
  const names = [player, ...aliases].filter(Boolean);
  const labelsOf = r => [r.label, r.labelAlt].filter(Boolean);
  const mine = r => labelsOf(r).some(l => names.some(n => matchesName(l, n)));
  const scoreRows = rows.filter(r => r.candidate && r.candidate !== 'putts');
  const byName = names.length > 0 && scoreRows.some(mine);
  const asScore = r => (r.candidate === 'putts' ? 'score' : r.candidate);

  if (byName) {
    const taken = new Set();
    for (const r of rows) {
      if (r.candidate === 'putts') {
        // 라벨이 붙은 줄은 다른 사람 줄이므로 제외한다. 라벨이 없거나 '퍼팅/PUTT'인 줄만 퍼팅 줄로 남긴다
        if (labelsOf(r).length && !labelsOf(r).some(l => /퍼|putt/i.test(l)) && !mine(r)) r.role = 'ignore';
        continue;
      }
      if (!r.candidate) continue;
      if (mine(r) && !taken.has(r.range)) { taken.add(r.range); r.role = asScore(r); } else r.role = 'ignore';
    }
    // 한쪽 표에서만 이름이 맞았다면(다른 쪽은 이름이 다르게 읽힘), 그 줄과 같은 순서의 줄을 나머지 표에서도 고른다
    const ref = scoreRows.find(r => r.range !== 'all' && taken.has(r.range) && r.role !== 'ignore');
    if (ref) {
      const k = scoreRows.filter(x => x.range === ref.range).indexOf(ref);
      for (const rg of new Set(scoreRows.map(r => r.range))) {
        if (rg === 'all' || taken.has(rg)) continue;
        scoreRows.filter(x => x.range === rg).forEach((r, i) => { r.role = i === k ? asScore(r) : 'ignore'; });
      }
    }
    return 'name';
  }
  if (playerIdx != null) {
    const seen = {};
    let used = false;
    for (const r of scoreRows) {
      const k = seen[r.range] = (seen[r.range] ?? -1) + 1;
      if (k === playerIdx) { r.role = asScore(r); used = true; } else r.role = 'ignore';
    }
    if (used) return 'index';
  }
  return 'default';
}

/**
 * 내 줄을 이름(또는 기억한 위치)으로 확실히 찾았다면, 다른 플레이어의 줄은 인식 결과에서 아예 뺀다.
 * 찾지 못한 경우에는 사용자가 직접 고를 수 있도록 모든 후보 줄을 남긴다.
 */
export function dropOthers(rows, matchedBy) {
  if (matchedBy !== 'name' && matchedBy !== 'index') return rows;
  return rows.filter(r => r.role !== 'ignore');
}

/**
 * 스코어카드 파싱: 숫자 행을 찾아 파 / 스코어 / 스코어(파 대비) / 퍼팅 / 무시로 추정한다.
 * 파 대비 스코어는 0=파, 1=보기, -1=버디이며, 소계(합계 칸)가 (칸 합 + 그 9홀의 파 합계)에 가까우면 그렇게 본다.
 * 숫자 한두 개를 잘못 읽어도 합계가 크게 다르지 않도록 ±3까지 허용한다.
 * 결과는 사용자가 확인·수정하는 화면의 초안이다.
 */
export function parseScorecard(data, { player = '', aliases = [], playerIdx = null } = {}) {
  const rows = buildRows(data.words || []);
  const out = [];
  let range = 'front', parsSeen = 0, sawHeader = false, parSums = null, headers = 0, cardRel = false;
  const parNine = {}; // 9칸짜리 파 줄의 합계 (전반/후반)
  const assigned = { front: {}, back: {}, all: {} };
  const names = [player, ...aliases].filter(Boolean);

  for (const row of rows) {
    const parsed = holesFromRow(row.vals);
    if (!parsed) continue;
    const v = parsed.vals;
    const item = { vals: v, subs: parsed.subs, label: row.label, box: row.box, incomplete: parsed.incomplete, role: 'ignore', range: v.length === 18 ? 'all' : range };

    if (isSeq(v, 1)) {
      sawHeader = true;
      if (v.length < 18) range = headers++ === 0 ? 'front' : 'back';
      item.range = v.length === 18 ? 'all' : range;
      out.push(item);
      continue;
    }
    if (isSeq(v, 10)) { range = 'back'; sawHeader = true; item.range = 'back'; out.push(item); continue; }
    if (isHdcp(v)) { out.push(item); continue; }
    // 라벨이 HOLE/PAR/홀인 줄은 (숫자를 잘못 읽었더라도) 표 머리글이므로 스코어 후보로 보지 않는다
    if (/^(hole|par|홀|파)$/i.test(row.label) && !isPar(v)) { out.push(item); continue; }

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
    const relBySubs = item.subs.length > 0 && item.subs.every((s, k) => expectPar(k) != null && Math.abs(s - (sums[k] + expectPar(k))) <= 3);
    // 파 합계를 모르는 경우: 소계와 칸 합의 차이가 한 9홀의 파 합계(대개 33~40)쯤이면 파 대비 값
    const relByGap = item.subs.length > 0 && item.subs.every((s, k) => s - sums[k] >= 28 && s - sums[k] <= 45);
    const rel = relBySubs || relByGap || v.some(x => x != null && x < 0) || (cardRel && item.subs.length === 0 && v.every(x => x == null || x <= 6));
    if (rel) cardRel = true;
    const a = v.filter(x => x != null);
    const avg = sum(a) / Math.max(1, a.length);
    const nameHit = names.some(n => matchesName(row.label, n));
    const puttLike = !rel && !nameHit && a.every(x => x <= 6) && avg <= 2.6;
    const slot = assigned[item.range];
    item.candidate = rel ? 'score_rel' : puttLike ? 'putts' : 'score';
    if (puttLike) { if (!slot.putts && slot.score) { item.role = 'putts'; slot.putts = true; } }
    else if (!slot.score) { item.role = item.candidate; slot.score = true; }
    out.push(item);
  }

  const matchedBy = selectMyRows(out, { player, aliases, playerIdx });
  return { rows: dropOthers(out, matchedBy), playerMatched: matchedBy === 'name', matchedBy, ...findMeta(data.text || '', { player }) };
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

  // 전반-후반 9홀 코스 이름("동-서")을 먼저 떼어내고, 남은 글자에서 골프장 이름을 찾는다.
  // 같은 줄에 "화성상록 동-서"처럼 함께 있어도 나뉜다.
  let front = '', back = '';
  const rest = head.map(ln => {
    if (front) return ln;
    const sp = splitNines(ln);
    if (!sp || NOT_TITLE.test(sp.front + sp.back)) return ln;
    front = sp.front; back = sp.back;
    return sp.rest;
  });

  // 골프장 이름: 화면 제목·버튼·내 이름을 뺀 첫 한글 덩어리
  let title = '';
  outer: for (const ln of rest) {
    for (const run of ln.match(/[가-힣][가-힣\s]*[가-힣]/g) || []) {
      const r = run.replace(/\s+/g, '');
      if (r.length < 2 || NOT_TITLE.test(r) || (player && matchesName(r, player))) continue;
      title = r;
      break outer;
    }
  }
  return { date, time, title, front, back };
}
