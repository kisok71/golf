/* 대한골프협회(KGA) 코스레이팅 현황 데이터 (data/kga-ratings.json, tools/build-ratings.py로 생성)를
 * 검색하는 모듈. 앱에 포함된 파일을 읽으므로 인터넷 없이 동작한다. */

/** KGA 핸디캡 계산기 페이지 — 앱 자료에 없는 골프장은 여기서 코스레이팅·슬로프를 찾아볼 수 있다 */
export const KGA_CALC_URL = 'https://www.kgagolf.or.kr/web/handicap/calculator';

let cache = null;

/** JSON을 골프장 이름 정규화 키와 함께 색인한다 (테스트에서도 직접 쓸 수 있게 분리) */
export function buildIndex(data) {
  return {
    source: data.source, date: data.date,
    clubs: data.clubs.map(c => ({
      name: c.n, key: normClub(c.n),
      rows: c.r.map(([course, tee, sex, rating, slope, yd]) => ({ course, tee, sex, rating, slope, yd }))
    }))
  };
}

export async function loadKga() {
  if (cache) return cache;
  const res = await fetch(new URL('../data/kga-ratings.json', import.meta.url));
  if (!res.ok) throw new Error('레이팅 데이터를 불러오지 못했어요');
  cache = buildIndex(await res.json());
  return cache;
}

/** 공백·기호와 "CC/컨트리클럽/골프클럽" 같은 꼬리표를 떼어 비교용 키로 만든다 */
export function normClub(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_.()·]/g, '').replace(/(컨트리클럽|골프클럽|골프장|골프앤리조트|cc)$/g, '');
}

/**
 * 이름으로 골프장을 찾는다. 점수가 낮을수록 잘 맞는다: 0 정확히 같음 · 1 앞부분 일치 · 2 포함 · 3 검색어가 이름을 포함
 * 반환: [{ club, score }]
 */
export function searchClubs(index, q, limit = 8) {
  const k = normClub(q);
  if (!k) return [];
  const out = [];
  for (const club of index.clubs) {
    let score = 9;
    if (club.key === k) score = 0;
    else if (club.key.startsWith(k)) score = 1;
    else if (club.key.includes(k)) score = 2;
    else if (club.key.length >= 3 && k.includes(club.key)) score = 3;
    if (score < 9) out.push({ club, score });
  }
  return out.sort((a, b) => a.score - b.score || a.club.name.length - b.club.name.length || a.club.name.localeCompare(b.club.name, 'ko')).slice(0, limit);
}

/** 이 골프장의 코스 조합(예: 동+서, 남(아웃+인)) 목록 */
export function combosOf(club) {
  const m = new Map();
  for (const r of club.rows) m.set(r.course, (m.get(r.course) || 0) + 1);
  return [...m].map(([course, n]) => ({ course, n }));
}

/** 오늘 친 전반/후반 코스 이름과 가장 잘 맞는 조합 순서로 정렬한다 (동+서 → 서+동 → 동(아웃+인) …) */
export function rankCombos(club, front = '', back = '') {
  const f = String(front || '').trim(), b = String(back || '').trim();
  const rank = course => {
    if (f && b && course === `${f}+${b}`) return 0;
    if (f && b && course === `${b}+${f}`) return 1;
    if (f && (course.startsWith(`${f}(`) || course === f)) return 2;
    if (f && (course.startsWith(`${f}+`) || course.endsWith(`+${f}`))) return 3;
    return 9;
  };
  return combosOf(club).map(c => ({ ...c, rank: rank(c.course) })).sort((x, y) => x.rank - y.rank);
}

/** 조합·성별로 걸러 긴 티(챔피언/백)부터 정렬한 티 목록 */
export function teesOf(club, course, sex) {
  return club.rows.filter(r => r.course === course && r.sex === sex).sort((a, b) => b.yd - a.yd);
}

/**
 * 자료에 없는 코스에 임시로 쓸 평균 레이팅·슬로프.
 * 코스 조합마다 일반 아마추어가 치는 중간 길이의 티를 하나씩 골라(티가 4개면 세 번째 등) 평균낸다.
 * 반환: { rating(소수 1자리), slope(정수), n(평균에 쓴 조합 수) }
 */
export function averages(index, sex = 0) {
  const ratings = [], slopes = [];
  for (const c of index.clubs) {
    const byCourse = new Map();
    for (const r of c.rows) if (r.sex === sex) (byCourse.get(r.course) || byCourse.set(r.course, []).get(r.course)).push(r);
    for (const list of byCourse.values()) {
      list.sort((a, b) => b.yd - a.yd);
      const mid = list[Math.floor(list.length / 2)];
      ratings.push(mid.rating); slopes.push(mid.slope);
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  return { rating: Math.round(mean(ratings) * 10) / 10, slope: Math.round(mean(slopes)), n: ratings.length };
}
