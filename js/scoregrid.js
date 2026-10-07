/* 라벨이 붙은 표(PAR · 타수 · 퍼팅 · OB · 해저드 줄이 있는 스코어카드)를 글자 '위치'로 읽는 순수 로직. DOM에 의존하지 않는다.
 *
 * 줄마다 숫자를 순서대로 읽는 기존 방식(scorecard.js)은 OB·해저드처럼 빈 칸이 많은 줄이나, 파를 넘긴 홀을 상자로 둘러싼 표에서
 * 어느 홀의 값인지 알 수 없다. 여기서는 PAR 줄의 숫자 위치로 홀 칸(열)을 만들고, 줄 간격으로 각 줄의 종류를 정한 뒤,
 * 글자 하나하나를 가장 가까운 칸에 넣는다. 빈 칸·놓친 칸·의심스러운 칸은 칸 좌표(box)를 돌려줘서 칸만 잘라 다시 읽게 한다. */

const CONFUSE = { O: '0', o: '0', D: '0', l: '1', I: '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', q: '9' };

/** 줄 이름(라벨)으로 줄의 종류를 알아낸다. OB는 OCR이 08 · 0B 로 읽기도 한다 */
const KINDS = [
  ['score', /타\s*수|스\s*코\s*어|점\s*수|score|stroke/i],
  ['putts', /퍼\s*팅|퍼\s*트|putt/i],
  ['hazard', /해\s*저\s*드|벙\s*커|워\s*터|hazard/i],
  ['ob', /^\s*[o0]\s*[b8]\s*$|오\s*비/i]
];
export function classifyLabel(text) {
  const t = String(text || '').trim();
  for (const [kind, re] of KINDS) if (re.test(t)) return kind;
  return null;
}

/** 줄 종류별로 받아들이는 값의 범위 */
const RANGE = { par: [3, 6], score: [1, 20], putts: [0, 9], ob: [0, 9], hazard: [0, 9] };
const LABEL = { par: 'PAR', score: '타수', putts: '퍼팅', ob: 'OB', hazard: '해저드' };
const ORDER = ['score', 'putts', 'ob', 'hazard']; // PAR 줄 다음에 오는 줄의 기본 순서

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sum = a => a.reduce((s, v) => s + v, 0);
const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * 칸 안의 글자를 숫자로. 상자 테두리가 괄호나 | 로 붙은 "[5]" 도 벗겨서 읽는다.
 * weak: 읽은 글자를 그대로 믿기 어려운 경우(상자 테두리 · 헷갈리는 글자 · 낮은 신뢰도) - 칸만 잘라 다시 읽어 확인한다.
 */
export function cellNumber(text, conf = 100) {
  const raw = String(text ?? '').trim();
  if (!raw) return { n: null };
  if (/^[|!lI]$/.test(raw)) return { n: 1, weak: true }; // 가는 숫자 1이 막대로 읽힌 경우
  const bracketed = /[[\](){}<>|]/.test(raw);
  const core = raw.replace(/[[\](){}<>|]/g, '').replace(/^[.,:;'"`~_-]+|[.,:;'"`~_-]+$/g, '');
  if (!core || core.length > 2 || !/^[0-9OoDlIiSsBZzgq]+$/.test(core)) return { n: null };
  const confused = [...core].some(c => CONFUSE[c] != null);
  const digits = [...core].map(c => CONFUSE[c] ?? c).join('');
  if (!/^\d{1,2}$/.test(digits)) return { n: null };
  return { n: Number(digits), weak: bracketed || confused || conf < 55 };
}

function normTokens(words) {
  return (words || []).map(w => {
    const b = w.bbox || {};
    return {
      t: String(w.text ?? '').trim(), x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2,
      x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, h: b.y1 - b.y0, c: w.confidence ?? 100
    };
  }).filter(t => t.t && Number.isFinite(t.x) && Number.isFinite(t.y));
}

function clusterByY(toks, tol) {
  const rows = [];
  for (const t of [...toks].sort((a, b) => a.y - b.y)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(t.y - last.y) <= tol) { last.toks.push(t); last.y = mean(last.toks.map(k => k.y)); }
    else rows.push({ y: t.y, toks: [t] });
  }
  rows.forEach(r => r.toks.sort((a, b) => a.x - b.x));
  return rows;
}

function clusterX(toks, gap) {
  const cl = [];
  for (const t of [...toks].sort((a, b) => a.x - b.x)) {
    const last = cl[cl.length - 1];
    if (last && t.x - last.x <= gap) { last.toks.push(t); last.x = mean(last.toks.map(k => k.x)); }
    else cl.push({ x: t.x, toks: [t] });
  }
  return cl;
}

const isParLabel = t => /^p\s*a\s*r$/i.test(t);
const parTokens = r => r.toks.filter(t => { const c = cellNumber(t.t); return c.n != null && c.n >= 3 && c.n <= 6; });

/**
 * 이 글자 목록에 "PAR" 이름표가 2개 이상(전반 · 후반 표) 보이면 그 수를, 아니면 0.
 * 표를 다 못 읽었는지(표 수 < PAR 줄 수) 판단해 다른 방식으로 한 번 더 읽을지 정하는 데 쓴다.
 */
export function labeledParCount(data) {
  const toks = normTokens(data?.words);
  const pars = toks.filter(t => isParLabel(t.t)).length;
  return pars >= 2 ? pars : 0;
}

/** 헤더의 큰 글씨 총점("8 3" 처럼 떨어져 읽힌 숫자도 이어 붙인다). 표 위쪽에서만 찾는다 */
function findCardTotal(toks, numH, aboveY) {
  const big = toks.filter(t => t.y < aboveY && t.h >= numH * 1.6 && /^\d{1,3}$/.test(t.t));
  if (!big.length) return null;
  const rows = clusterByY(big, Math.max(...big.map(t => t.h)) * 0.5);
  let best = null;
  for (const r of rows) {
    const run = [];
    for (const t of r.toks) {
      const prev = run[run.length - 1];
      if (prev && t.x0 - prev.x1 > prev.h * 1.4) break;
      run.push(t);
    }
    const n = Number(run.map(t => t.t).join(''));
    const h = Math.max(...run.map(t => t.h));
    if (n >= 30 && n <= 250 && (!best || h > best.h)) best = { n, h };
  }
  return best ? best.n : null;
}

/**
 * 글자 단어 목록에서 라벨형 표를 찾는다. 못 찾으면 null (그러면 기존 줄 단위 해석을 쓴다).
 * 반환: { rows, cellsToRead, cardTotal }
 *  - rows: scorecard.js의 줄 형식과 같다 { vals(9칸), subs([계]), label, role, range, candidate, incomplete }
 *  - cellsToRead: 칸만 잘라 다시 읽을 칸들 [{ row, col, kind, blankOk, verify, box }]
 */
export function detectGrid(data, dbg = null) {
  const toks = normTokens(data?.words);
  if (toks.length < 20) return null;
  const numH = median(toks.filter(t => cellNumber(t.t).n != null).map(t => t.h));
  if (!numH) return null;
  const rows = clusterByY(toks, Math.max(14, numH * 0.5));

  // 칸 격자의 기준: PAR 숫자가 9개 또렷이 읽힌 첫 표. 다른 표는 같은 칸 간격 · 열 위치를 쓴다
  const parRows = rows.filter(r => r.toks.some(t => isParLabel(t.t)));
  const refRow = parRows.find(r => parTokens(r).length === 9);
  // PAR 줄: 글자가 "PAR"인 줄이면서 3~6 숫자가 6개 이상 읽힌 줄. 숫자를 못 읽은 PAR 줄은 기준 표가 있을 때만 받는다
  const anchors = parRows.filter(r => parTokens(r).length >= 6 || (refRow && r !== refRow));
  dbg?.push(`PAR 줄 ${anchors.length}개 (PAR 글자가 있는 줄 ${parRows.length}개)`);
  if (!anchors.length) return null;

  const refLat = refRow && (() => {
    const pt = parTokens(refRow), cols = pt.map(t => t.x), rough = median(pt.slice(1).map((t, i) => t.x - pt[i].x));
    const tail = refRow.toks.filter(t => t.x > cols[8] + rough * 0.6 && t.x < cols[8] + rough * 2.2 && (cellNumber(t.t).n ?? 0) >= 20);
    const label = refRow.toks.find(t => isParLabel(t.t));
    return { cols, rough, totalDx: tail.length ? tail[0].x - cols[8] : null, labelX: label.x };
  })();

  const outRows = [], cellsToRead = [];
  let labelHits = 0, strongHit = false, tableCount = 0;

  anchors.forEach((anchor, ai) => {
    const limitY = anchors[ai + 1]?.y ?? Infinity;

    // 줄 간격: PAR 줄 아래 줄들의 y 간격 중앙값 (글자 높이의 1.5~4.5배 범위만)
    const below = rows.filter(r => r.y >= anchor.y - 1 && r.y < limitY).slice(0, 8);
    const diffs = below.slice(1).map((r, i) => r.y - below[i].y).filter(d => d >= numH * 1.5 && d <= numH * 4.5);
    const pitch = median(diffs);
    if (!pitch) { dbg?.push(`표${ai + 1}: 줄 간격을 못 구함`); return; }

    // 칸 간격과 열 위치: PAR 숫자의 간격 → 표 전체 숫자를 같은 x끼리 묶는다
    const pt = parTokens(anchor);
    const borrowed = pt.length < 6; // PAR 숫자를 못 읽은 표: 기준 표의 칸 격자를 같은 간격으로 옮겨 쓴다
    const rough = borrowed ? refLat.rough : median(pt.slice(1).map((t, i) => t.x - pt[i].x));
    if (!rough || rough < numH * 0.8) { dbg?.push(`표${ai + 1}: 칸 간격을 못 구함 (PAR 숫자 ${pt.length}개)`); return; }
    const band = k => toks.filter(t => Math.abs(t.y - (anchor.y + k * pitch)) <= pitch * 0.3);
    let cols, totalX = null;
    if (borrowed) {
      const dx = anchor.toks.find(t => isParLabel(t.t)).x - refLat.labelX;
      cols = refLat.cols.map(x => x + dx);
      if (refLat.totalDx != null) totalX = cols[8] + refLat.totalDx;
    } else if (pt.length === 9) {
      cols = pt.map(t => t.x);
      const tail = anchor.toks.filter(t => t.x > cols[8] + rough * 0.6 && t.x < cols[8] + rough * 2.2 && (cellNumber(t.t).n ?? 0) >= 20);
      if (tail.length) totalX = tail[0].x;
    } else {
      const numeric = [];
      for (let k = 0; k <= 4; k++) for (const t of band(k)) if (cellNumber(t.t).n != null) numeric.push(t);
      const clusters = clusterX(numeric, rough * 0.4).filter(c => c.toks.length >= 2);
      while (clusters.length > 10) { // 잡음 묶음은 글자 수가 적은 것부터 버린다
        const lo = Math.min(...clusters.map(c => c.toks.length));
        clusters.splice(clusters.findIndex(c => c.toks.length === lo), 1);
      }
      if (clusters.length < 9) { dbg?.push(`표${ai + 1}: 열 묶음 ${clusters.length}개 (9개 필요)`); return; }
      cols = clusters.slice(0, 9).map(c => c.x);
      if (clusters.length === 10) totalX = clusters[9].x;
    }
    if (cols.slice(1).some((x, i) => Math.abs(x - cols[i] - rough) > rough * 0.35)) { dbg?.push(`표${ai + 1}: 칸 간격이 들쭉날쭉`); return; } // 칸 간격이 들쭉날쭉하면 믿지 않는다

    // 줄 이름(왼쪽 글자)으로 종류를 정하고, 못 읽은 줄은 기본 순서(타수 · 퍼팅 · OB · 해저드)로 채운다
    const labelOf = k => band(k).filter(t => t.x < cols[0] - rough * 0.75).sort((a, b) => a.x - b.x).map(t => t.t).join('');
    const kinds = {}, used = new Set();
    for (let k = 1; k <= 6; k++) {
      const kind = classifyLabel(labelOf(k));
      if (kind && !used.has(kind)) { kinds[k] = kind; used.add(kind); labelHits++; if (kind !== 'putts') strongHit = true; }
    }
    let next = 0;
    for (let k = 1; k <= 4; k++) {
      if (kinds[k]) continue;
      while (next < ORDER.length && used.has(ORDER[next])) next++;
      if (next < ORDER.length) { kinds[k] = ORDER[next]; used.add(ORDER[next]); }
    }
    if (![1, 2, 3, 4, 5, 6].some(k => kinds[k] === 'score')) { dbg?.push(`표${ai + 1}: 타수 줄을 못 정함`); return; }

    const range = tableCount === 0 ? 'front' : 'back';
    tableCount++;

    for (const k of [0, 1, 2, 3, 4, 5, 6]) {
      const kind = k === 0 ? 'par' : kinds[k];
      if (!kind) continue;
      const yk = anchor.y + k * pitch;
      const row = { vals: Array(9).fill(null), subs: [], label: LABEL[kind], role: kind, range, candidate: kind, incomplete: false, grid: true, repaired: [], geo: { cols, y: yk, rough, pitch }, verified: new Set() };
      const weak = new Set();
      const [lo, hi] = RANGE[kind];
      for (const t of band(k)) {
        const c = cellNumber(t.t, t.c);
        if (c.n == null) continue;
        if (totalX != null && Math.abs(t.x - totalX) <= rough * 0.6) { row.subs = [c.n]; continue; } // 계(합계) 칸
        let best = -1, bd = Infinity;
        cols.forEach((cx, i) => { const d = Math.abs(t.x - cx); if (d < bd) { bd = d; best = i; } });
        if (bd > rough * 0.5 || c.n < lo || c.n > hi) continue;
        if (row.vals[best] != null && !(weak.has(best) && !c.weak)) continue;
        row.vals[best] = c.n;
        if (c.weak) weak.add(best); else weak.delete(best);
      }
      outRows.push(row);
      if (borrowed && k === 0) cols.forEach((cx, i) => { if (row.vals[i] != null) weak.add(i); }); // 읽지 못한 PAR 줄은 숫자를 모두 칸별로 다시 읽는다
      cols.forEach((cx, i) => {
        const missing = row.vals[i] == null, verify = weak.has(i);
        if (!missing && !verify) return;
        row.verified.add(i);
        cellsToRead.push(cellEntry(row, i, verify));
      });
    }
  });

  // 줄 이름이 2개 이상 읽히고 그중 하나는 타수 · OB · 해저드여야 이 형식으로 본다
  // (선수 이름이 붙은 다른 카드나, PUTT 줄만 있는 카드와 구분한다)
  if (labelHits < 2 || !strongHit || !outRows.some(r => r.role === 'score')) return null;
  const cardTotal = findCardTotal(toks, numH, anchors[0].y);
  outRows.forEach(r => { r.incomplete = r.vals.some(v => v == null) && r.role !== 'ob' && r.role !== 'hazard'; });
  return { rows: outRows, cellsToRead, cardTotal, tables: tableCount };
}

/** 칸 하나를 잘라 읽기 위한 좌표 상자. 칸 안쪽만 자른다(상자·괘선은 읽기 단계에서 가장자리 선을 지워 제거) */
function cellEntry(row, col, verify) {
  const { cols, y, rough, pitch } = row.geo;
  return {
    row, col, kind: row.role, verify, blankOk: row.role === 'ob' || row.role === 'hazard',
    box: { x0: cols[col] - rough * 0.25, x1: cols[col] + rough * 0.25, y0: y - pitch * 0.3, y1: y + pitch * 0.3 }
  };
}

/**
 * 칸을 다시 읽고 난 뒤에도 줄 합계(계)와 읽은 값의 합이 안 맞는 줄이 있으면,
 * 아직 확인하지 않은 칸을 모두 칸별로 다시 읽도록 돌려준다. (줄 단위 인식이 조용히 틀린 숫자를 잡기 위함)
 */
export function suspectCells(grid) {
  const out = [];
  for (const row of grid.rows) {
    if (row.subs?.length !== 1 || row.rechecked) continue;
    const got = sum(row.vals.filter(v => v != null));
    if (got === row.subs[0]) continue;
    row.rechecked = true;
    for (let i = 0; i < 9; i++) if (!row.verified.has(i)) { row.verified.add(i); out.push(cellEntry(row, i, true)); }
  }
  return out;
}

/** 합계(계)가 있고 비어 있는 칸이 하나뿐이면 합계에서 그 칸을 복원한다 */
function repairByTotal(row) {
  if (row.subs?.length !== 1) return;
  const miss = row.vals.map((v, i) => (v == null ? i : -1)).filter(i => i >= 0);
  if (miss.length !== 1) return;
  const [lo, hi] = RANGE[row.role];
  const val = row.subs[0] - sum(row.vals.filter(v => v != null));
  if (val >= lo && val <= hi) { row.vals[miss[0]] = val; row.repaired = [miss[0]]; }
}

/**
 * 칸만 잘라 다시 읽은 결과를 반영한다. reads는 cellsToRead와 같은 순서 [{ text(숫자 문자열), ink(잉크 비율) }]
 *  - 놓친 칸: 읽힌 숫자가 범위 안이면 채운다. OB·해저드 칸은 숫자가 없으면(빈 칸) 0
 *  - 의심스러운 칸(verify): 칸만 잘라 읽은 값이 맞는 숫자면 그 값으로 바꾼다
 */
export function applyCellReads(grid, reads) {
  grid.cellsToRead.forEach((e, i) => {
    const digits = String(reads[i]?.text ?? '').replace(/\D/g, '');
    const [lo, hi] = RANGE[e.kind];
    const n = digits ? Number(digits) : null;
    const valid = n != null && n >= lo && n <= hi;
    if (e.verify) { if (valid && (reads[i]?.conf ?? 0) >= 60) e.row.vals[e.col] = n; } // 이미 읽은 값은 칸 인식이 확실할 때만 바꾼다
    else if (valid) e.row.vals[e.col] = n;
    else if (e.blankOk && !digits) e.row.vals[e.col] = 0;
  });
  for (const row of grid.rows) {
    repairByTotal(row);
    row.incomplete = row.vals.some(v => v == null) && row.role !== 'ob' && row.role !== 'hazard';
  }
}
