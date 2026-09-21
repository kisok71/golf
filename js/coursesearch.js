/* 코스 이름으로 인터넷에서 홀별 파 정보를 찾아오는 모듈.
 * 데이터 출처: OpenStreetMap (Nominatim 검색 + Overpass 홀 데이터). 브라우저에서 바로 호출할 수 있는 무료 공개 API다.
 * 등록되지 않은 골프장은 찾을 수 없으므로 호출하는 쪽에서 대체 수단(붙여넣기·직접 입력)을 함께 제공한다. */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const GOLF_NAME = /골프|컨트리|country|golf|\bcc\b|cc$/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function withTimeout(ms, outer) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  outer?.addEventListener('abort', () => ctl.abort());
  return { signal: ctl.signal, done: () => clearTimeout(t), abort: () => ctl.abort() };
}

const isGolfResult = r =>
  (r.category === 'leisure' && r.type === 'golf_course') ||
  (GOLF_NAME.test(r.name || '') && ['leisure', 'landuse', 'tourism', 'sport'].includes(r.category));

function shortAddress(display, name) {
  const parts = String(display).split(',').map(s => s.trim()).filter(Boolean);
  if (parts[0] === name) parts.shift();
  return parts.filter(p => !/^\d/.test(p) && p !== '대한민국' && p !== 'South Korea').slice(-3).join(' ');
}

async function nominatim(q, { korea, signal }) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=10&accept-language=ko${korea ? '&countrycodes=kr' : ''}`;
  const t = withTimeout(12000, signal);
  try {
    const res = await fetch(url, { signal: t.signal });
    if (!res.ok) throw new Error(`검색 서버 오류 (${res.status})`);
    return await res.json();
  } finally { t.done(); }
}

/**
 * 골프장 이름으로 검색한다. 결과: [{ key, type, osmId, name, address, lat, lon }]
 * 이름만으로 안 나오면 "컨트리클럽"을 붙여 다시 찾고, 그래도 없으면 국내 제한을 풀어 찾는다.
 */
export async function searchCourses(query, { signal } = {}) {
  const q = query.trim();
  if (!q) return [];
  const plans = [[q, true], [`${q} 컨트리클럽`, true], [q, false]];
  const found = new Map();
  for (let i = 0; i < plans.length; i++) {
    if (i) await sleep(1100); // Nominatim 이용 정책: 초당 1회 이하
    const rows = await nominatim(plans[i][0], { korea: plans[i][1], signal });
    for (const r of rows) {
      if (!isGolfResult(r) || !['way', 'relation', 'node'].includes(r.osm_type)) continue;
      const key = `${r.osm_type}/${r.osm_id}`;
      if (found.has(key)) continue;
      const name = r.name || String(r.display_name).split(',')[0].trim();
      found.set(key, { key, type: r.osm_type, osmId: r.osm_id, name, address: shortAddress(r.display_name, name), lat: Number(r.lat), lon: Number(r.lon) });
    }
    if (found.size) break;
  }
  return [...found.values()];
}

/** Overpass 서버는 자주 바쁘므로 여러 서버에 시차를 두고 요청해 먼저 성공한 응답을 쓴다 */
async function overpass(query, signal) {
  const controllers = [];
  let finished = false;
  const attempt = (url, delay) => (async () => {
    if (delay) await sleep(delay);
    if (finished) throw new Error('cancelled');
    const t = withTimeout(25000, signal);
    controllers.push(t);
    try {
      const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(query)}`, signal: t.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { t.done(); }
  })();
  try {
    return await Promise.any(OVERPASS.map((u, i) => attempt(u, i * 4000)));
  } catch {
    throw new Error('홀 정보 서버가 지금 바빠요. 잠시 뒤 다시 시도해 주세요');
  } finally { finished = true; controllers.forEach(c => c.abort()); }
}

/** 선택한 골프장 안의 홀(golf=hole) 태그를 가져온다 */
export async function fetchHoles(course, { signal } = {}) {
  const around = `way["golf"="hole"](around:1500,${course.lat},${course.lon});`;
  const q = course.type === 'node'
    ? `[out:json][timeout:25];${around}out tags;`
    : `[out:json][timeout:25];${course.type === 'way' ? 'way' : 'rel'}(${course.osmId});map_to_area->.a;way["golf"="hole"](area.a);out tags;`;
  const data = await overpass(q, signal);
  return data.elements || [];
}

/**
 * 홀 태그에서 홀별 파를 만든다.
 * - 홀 번호가 겹치지 않으면 하나의 코스로 본다 (1~9 → 9홀, 10~18 → 18홀)
 * - 번호가 겹치거나 18을 넘으면 9홀 묶음 여러 개(서/남/동 등)로 보고 고르게 한다
 * 반환: { kind: 'single', pars: [..null 가능] } | { kind: 'nines', nines: [{ label, pars }] } | { kind: 'none' }
 */
export function buildHoleSets(elements) {
  const holes = [];
  for (const e of elements || []) {
    const t = e.tags || {};
    const par = Number.parseInt(t.par, 10);
    if (!(par >= 3 && par <= 6)) continue;
    const name = String(t.name || '').trim();
    const num = Number.parseInt(t.ref, 10) || Number.parseInt((name.match(/(\d{1,2})\s*$/) || [])[1], 10);
    if (!(num >= 1 && num <= 36)) continue;
    const group = String(t['golf:course'] || name.replace(/[\s\-_:]*\d{1,2}\s*(번)?\s*(홀|hole)?\s*$/i, '')).trim();
    holes.push({ num, par, group });
  }
  if (!holes.length) return { kind: 'none' };

  const byGroup = new Map();
  for (const h of holes) {
    if (!byGroup.has(h.group)) byGroup.set(h.group, new Map());
    byGroup.get(h.group).set(h.num, h.par);
  }
  const all = new Map();
  let collide = false;
  for (const m of byGroup.values()) for (const [n, p] of m) { if (all.has(n)) collide = true; all.set(n, p); }
  const max = Math.max(...all.keys());

  if (!collide && max <= 18 && all.size >= 5) {
    const n = max <= 9 ? 9 : 18;
    return { kind: 'single', pars: Array.from({ length: n }, (_, i) => all.get(i + 1) ?? null) };
  }

  // 9홀 묶음으로 나눈다: 그룹 이름이 있으면 그룹별로, 없고 번호가 이어지면 9개씩 끊는다
  const nines = [];
  const named = [...byGroup.entries()].filter(([g]) => g);
  if (named.length >= 2 && collide) {
    for (const [g, m] of named) {
      const start = Math.min(...m.keys()) > 9 ? Math.floor((Math.min(...m.keys()) - 1) / 9) * 9 : 0;
      const pars = Array.from({ length: 9 }, (_, i) => m.get(start + i + 1) ?? null);
      if (pars.filter(p => p != null).length >= 7) nines.push({ label: g, pars });
    }
  } else {
    for (let s = 0; s < max; s += 9) {
      const pars = Array.from({ length: 9 }, (_, i) => all.get(s + i + 1) ?? null);
      if (pars.filter(p => p != null).length >= 7) nines.push({ label: `${s + 1}~${s + 9}번 홀`, pars });
    }
  }
  if (nines.length >= 2) return { kind: 'nines', nines };
  if (nines.length === 1) return { kind: 'single', pars: nines[0].pars };
  return { kind: 'none' };
}

/**
 * 웹에서 복사해 붙여넣은 표에서 홀별 파를 뽑는다.
 * 줄마다 숫자를 읽고, 합계(27 이상)를 뺀 값이 9개/18개이면서 모두 3~6인 줄을 파 줄로 본다.
 */
export function parsePastedPars(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    let nums = (line.match(/\d+/g) || []).map(Number);
    if (nums.length === 1 && /^\d{9}$|^\d{18}$/.test(String(line.trim()))) nums = [...line.trim()].map(Number);
    nums = nums.filter(n => n < 27);
    if ((nums.length === 9 || nums.length === 18) && nums.every(n => n >= 3 && n <= 6)) rows.push(nums);
  }
  if (!rows.length) return null;
  if (rows[0].length === 18) return rows[0];
  if (rows.length >= 2 && rows[1].length === 9) return [...rows[0], ...rows[1]];
  return rows[0];
}
