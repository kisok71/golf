import { sum } from './util.js';

const abs = p => new URL(p, document.baseURI).href;
let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('OCR 엔진을 불러오지 못했어요'));
    document.head.appendChild(s);
  });
}

async function getWorker() {
  await loadScript(abs('vendor/tesseract/tesseract.min.js'));
  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker('eng', 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract/'),
      langPath: abs('vendor/tesseract/lang'),
      logger: m => progressCb?.(m)
    }).catch(err => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

export async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return await createImageBitmap(file); }
}

/** 인식률을 높이기 위한 전처리: 크기 정규화 + 흑백 + 대비 늘리기 (+ 선택: 적응형 이진화) */
export function preprocess(bmp, { binarize = false, removeLines = false, thr = 0.8, blur = true } = {}) {
  const long = Math.max(bmp.width, bmp.height);
  const scale = Math.min(3, 2400 / long);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, w, h);
  sctx.drawImage(bmp, 0, 0, w, h);

  // 사진이 살짝 기울어 있으면 표의 가로줄이 수평이 되도록 바로잡는다
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const angle = estimateSkew(src);
  if (Math.abs(angle) >= 0.3) {
    ctx.translate(w / 2, h / 2); ctx.rotate((-angle * Math.PI) / 180); ctx.translate(-w / 2, -h / 2);
  }
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const gray = new Uint8ClampedArray(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    gray[p] = g; hist[g]++;
  }
  // 상하위 1% 를 잘라 대비를 늘린다
  const cut = w * h * 0.01;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let p = 0; p < gray.length; p++) gray[p] = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / range));

  if (removeLines && blur) blur3(gray, w, h); // 촬영 노이즈 완화

  let out = gray;
  if (binarize || removeLines) {
    // 적분 영상 기반 지역 평균 임계값
    const win = Math.max(15, (w / 18) | 0), half = win >> 1;
    const integ = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + (x - 1)]; integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x] + row; }
    }
    out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        const s = integ[y1 * (w + 1) + x1] - integ[y0 * (w + 1) + x1] - integ[y1 * (w + 1) + x0] + integ[y0 * (w + 1) + x0];
        const m = s / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = gray[y * w + x] < m * thr ? 0 : 255;
      }
    }
  }
  if (removeLines) eraseGridLines(out, w, h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { d[i] = d[i + 1] = d[i + 2] = out[p]; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function blur3(g, w, h) {
  const t = new Uint8ClampedArray(g);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      g[i] = (t[i - w - 1] + t[i - w] + t[i - w + 1] + t[i - 1] + t[i] + t[i + 1] + t[i + w - 1] + t[i + w] + t[i + w + 1]) / 9;
    }
  }
}

/** 어두운 픽셀의 가로 투영이 가장 뾰족해지는 각도를 찾는다 (도 단위, -8~8) */
function estimateSkew(canvas) {
  const s = Math.min(1, 700 / Math.max(canvas.width, canvas.height));
  const w = Math.round(canvas.width * s), h = Math.round(canvas.height * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(canvas, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  let mean = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) { gray[p] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; mean += gray[p]; }
  mean /= gray.length;
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (gray[y * w + x] < mean * 0.7) pts.push(x, y);
  if (pts.length < 200) return 0;
  const bins = new Float64Array(w + h + 4);
  const score = deg => {
    const r = (deg * Math.PI) / 180, sin = Math.sin(r), cos = Math.cos(r), off = w * 0.5 + 2;
    bins.fill(0);
    for (let k = 0; k < pts.length; k += 2) bins[((pts[k + 1] * cos - pts[k] * sin + off) | 0)]++;
    let sum2 = 0;
    for (let i = 0; i < bins.length; i++) sum2 += bins[i] * bins[i];
    return sum2;
  };
  let best = 0, bestScore = score(0);
  for (let a = -8; a <= 8; a += 0.5) { const v = score(a); if (v > bestScore) { bestScore = v; best = a; } }
  const center = best;
  for (let a = center - 0.5; a <= center + 0.5; a += 0.1) { const v = score(a); if (v > bestScore) { bestScore = v; best = a; } }
  return best;
}

/** 표의 가로·세로 괘선(길게 이어진 어두운 픽셀)을 지워 숫자만 남긴다 */
function eraseGridLines(bin, w, h) {
  const minRun = Math.round(Math.min(w, h) * 0.06);
  const kill = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const dark = x < w && bin[y * w + x] === 0;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) { if (x - start >= minRun) for (let k = start; k < x; k++) kill[y * w + k] = 1; start = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const dark = y < h && bin[y * w + x] === 0;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) { if (y - start >= minRun) for (let k = start; k < y; k++) kill[k * w + x] = 1; start = -1; }
    }
  }
  // 괘선 주변 1픽셀까지 함께 지운다
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (kill[i] || kill[i - 1] || kill[i + 1] || kill[i - w] || kill[i + w]) bin[i] = 255;
    }
  }
}

export function thumbnail(bmp, max = 1000) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.7);
}

export async function recognize(canvas, onProgress, { psm = '11' } = {}) {
  progressCb = onProgress;
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1', user_defined_dpi: '300' });
  const { data } = await worker.recognize(canvas);
  return data;
}

/* ───────── 결과 해석 ───────── */

const CONFUSE = { O: '0', o: '0', D: '0', l: '1', I: '1', '|': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2', g: '9', q: '9' };

/** OCR 단어를 숫자로 정리. 숫자가 아니면 null */
export function toNumber(text) {
  let t = String(text).trim().replace(/[.,:;'"`~_]+$/g, '').replace(/^[.,:;'"`~_|]+/g, '');
  if (!t || t.length > 3) return null;
  if (!/^[0-9OoDlI|iSsBZzgq]+$/.test(t)) return null;
  t = [...t].map(c => CONFUSE[c] ?? c).join('');
  if (!/^\d{1,2}$/.test(t)) return null;
  return Number(t);
}

/** 단어들을 y좌표로 묶어 행으로 만든다 */
export function buildRows(words) {
  const toks = [];
  for (const w of words) {
    const n = toNumber(w.text);
    if (n == null) continue;
    const b = w.bbox;
    toks.push({ n, x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, h: b.y1 - b.y0, conf: w.confidence });
  }
  if (!toks.length) return [];
  const hs = toks.map(t => t.h).sort((a, b) => a - b);
  const hMed = hs[hs.length >> 1] || 20;
  toks.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const t of toks) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(t.y - last.y) < hMed * 0.65) { last.toks.push(t); last.y = last.toks.reduce((s, k) => s + k.y, 0) / last.toks.length; }
    else rows.push({ y: t.y, toks: [t] });
  }
  return rows.map(r => ({ y: r.y, vals: r.toks.sort((a, b) => a.x - b.x).map(t => t.n), xs: r.toks.sort((a, b) => a.x - b.x).map(t => t.x) }));
}

/** 한 줄의 숫자에서 홀별 값만 추린다. OUT/IN/TOTAL 같은 합계 칸은 건너뛴다 */
export function holesFromRow(vals) {
  const n = vals.length;
  if (n < 7) return null;
  const out = [];
  let i = 0;
  while (out.length < 18 && n - i >= 9) {
    const chunk = vals.slice(i, i + 9);
    out.push(...chunk);
    i += 9;
    if (i < n && vals[i] === sum(chunk)) i++;          // 소계 칸
    else if (i < n && n - i === 1 && vals[i] === sum(out)) i++; // 총계 칸
  }
  if (out.length) {
    // 20을 넘는 값은 합계 칸이 섞였거나 잘못 읽은 것이므로 비워서 직접 확인하게 한다
    const clean = out.map(v => (v > 20 ? null : v));
    return { vals: clean, incomplete: clean.some(v => v == null) };
  }
  // 7~8개만 읽힌 경우 : 9칸으로 맞추고 빈 곳은 직접 입력하게 둔다
  return { vals: [...vals, ...Array(9 - n).fill(null)].slice(0, 9), incomplete: true };
}

const isSeq = (v, from) => v.length >= 9 && v.slice(0, 9).every((x, k) => x === from + k);
const isPar = v => { const a = v.filter(x => x != null); return a.length >= 8 && a.every(x => x >= 3 && x <= 6) && a.filter(x => x >= 3 && x <= 5).length >= a.length - 1; };
const isHdcp = v => { const a = v.filter(x => x != null); return a.length >= 9 && new Set(a).size === a.length && Math.max(...a) >= 10; };

/**
 * 스코어카드 파싱: 숫자 행을 찾아 파 / 스코어 / 퍼팅 / 무시로 추정한다.
 * 결과는 사용자가 확인·수정하는 화면의 초안이다.
 */
export function parseScorecard(data) {
  const words = data.words || [];
  const rows = buildRows(words);
  const out = [];
  let range = 'front', parsSeen = 0, sawHeader = false;
  const assigned = { front: {}, back: {}, all: {} };

  for (const row of rows) {
    const parsed = holesFromRow(row.vals);
    if (!parsed) continue;
    const v = parsed.vals;
    const item = { vals: v, incomplete: parsed.incomplete, role: 'ignore', range: v.length === 18 ? 'all' : range, y: row.y };

    if (isSeq(v, 1) || (v.length === 18 && isSeq(v, 1))) { range = 'front'; sawHeader = true; item.range = v.length === 18 ? 'all' : 'front'; out.push(item); continue; }
    if (isSeq(v, 10)) { range = 'back'; sawHeader = true; item.range = 'back'; out.push(item); continue; }
    if (isHdcp(v)) { out.push(item); continue; }

    if (isPar(v)) {
      if (!sawHeader && v.length === 9 && parsSeen === 1) { range = 'back'; }
      parsSeen++;
      item.range = v.length === 18 ? 'all' : range;
      item.role = 'par';
      assigned[item.range].par = true;
    } else {
      item.range = v.length === 18 ? 'all' : range;
      const a = v.filter(x => x != null);
      const avg = sum(a) / Math.max(1, a.length);
      const puttLike = a.every(x => x <= 6) && avg <= 2.6;
      const slot = assigned[item.range];
      if (puttLike) { if (!slot.putts && slot.score) { item.role = 'putts'; slot.putts = true; } }
      else if (!slot.score) { item.role = 'score'; slot.score = true; }
    }
    out.push(item);
  }
  return { rows: out, date: findDate(data.text || '') };
}

export function findDate(text) {
  const m = String(text).match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
