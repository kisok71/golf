/* 문화체육관광부 「전국 골프장 현황」 데이터 (data/mcst-courses.json, tools/build-mcst.mjs로 생성)를
 * 참고용으로 검색하는 모듈. 앱에 포함된 파일을 읽으므로 인터넷 없이 동작한다.
 * 이 자료에는 골프장 이름·지역·주소·전체 홀 수·회원제 구분만 있고, 홀별 파나 코스 레이팅은 없다.
 * 코스 검색(js/coursesearch.js)과 KGA 레이팅 검색(js/kga.js)에 곁들이는 참고 정보로 쓴다. */
import { normGolfName } from './util.js';

let cache = null;

const REGION_FULL = {
  강원: ['강원특별자치도', '강원도'], 경기: ['경기도'], 경남: ['경상남도'], 경북: ['경상북도'],
  광주: ['광주광역시'], 대구: ['대구광역시'], 대전: ['대전광역시'], 부산: ['부산광역시'],
  서울: ['서울특별시'], 세종: ['세종특별자치시'], 울산: ['울산광역시'], 인천: ['인천광역시'],
  전남: ['전라남도'], 전북: ['전북특별자치도', '전라북도'], 제주: ['제주특별자치도', '제주도'],
  충남: ['충청남도'], 충북: ['충청북도']
};

/** "전남 전남 나주시 ..." 처럼 주소 앞에 지역명이 겹치면 지워 "나주시 ..."만 남긴다 */
function trimAddr(region, addr) {
  const a = String(addr || '').trim();
  // 긴 이름부터 검사한다: "제주"가 "제주특별자치도"의 앞부분과 같아서, 짧은 쪽을 먼저 보면 일부만 잘려 나간다
  const candidates = [...(REGION_FULL[region] || []), region].sort((x, y) => y.length - x.length);
  for (const full of candidates) {
    if (full && a.startsWith(full)) return a.slice(full.length).trim();
  }
  return a;
}

/** "태광컨트리클럽(회원제)" → { base: "태광컨트리클럽", note: "회원제" } */
function splitParen(name) {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
  return m ? { base: m[1].trim(), note: m[2].trim() } : { base: name.trim(), note: '' };
}

/**
 * 같은 이름이라도 실제로는 다른 골프장인 경우(예: 지역이 다른 동명 클럽)와, 한 골프장을 회원제·비회원제 등
 * 구분별로 나눠 등록한 경우(같은 주소)를 구분해 색인한다.
 * 반환: club = { name, key, sites: [ { region, addr, entries: [{ note, holes, type, area, op }] } ] }
 */
export function buildIndex(data) {
  const groups = new Map();
  for (const c of data.courses) {
    const { base, note } = splitParen(c.n);
    const key = normGolfName(base);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { name: base, key, sites: [] });
    const club = groups.get(key);
    const addr = trimAddr(c.region, c.addr);
    let site = club.sites.find(s => s.region === c.region && s.addr === addr);
    if (!site) { site = { region: c.region, addr, entries: [] }; club.sites.push(site); }
    site.entries.push({ note, holes: c.holes, type: c.type, area: c.area, op: c.op });
  }
  return { source: data.source, date: data.date, clubs: [...groups.values()] };
}

export async function loadMcst() {
  if (cache) return cache;
  const res = await fetch(new URL('../data/mcst-courses.json', import.meta.url));
  if (!res.ok) throw new Error('전국 골프장 현황 자료를 불러오지 못했어요');
  cache = buildIndex(await res.json());
  return cache;
}

/**
 * 이름으로 골프장을 찾는다. 점수가 낮을수록 잘 맞는다: 0 정확히 같음 · 1 앞부분 일치 · 2 포함 · 3 검색어가 이름을 포함
 * 반환: [{ club, score }]
 */
export function searchMcst(index, q, limit = 8) {
  const k = normGolfName(q);
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

/**
 * 이름 하나로 확실한 위치(지역·주소가 하나뿐인 경우)만 참고 정보로 붙일 때 쓴다.
 * 이름이 거의 같고(0~1점) 실제 장소가 한 곳뿐일 때만 알려주고, 동명이지만 다른 곳에 있는 골프장이면
 * null을 준다(엉뚱한 지역 정보를 잘못 붙이지 않기 위해서다).
 */
export function findSingleSite(index, name) {
  const hits = searchMcst(index, name, 3).filter(h => h.score <= 1);
  if (hits.length !== 1) return null;
  const { club } = hits[0];
  if (club.sites.length !== 1) return null;
  return { club, site: club.sites[0] };
}

/** 화면에 보여줄 요약 정보. site: { region, addr, entries } */
export function siteSummary(site) {
  const holes = [...new Set(site.entries.map(e => e.holes).filter(Boolean))].sort((a, b) => a - b);
  const types = [...new Set(site.entries.map(e => e.type).filter(Boolean))];
  return { region: site.region, addr: site.addr, holesText: holes.length ? `${holes.join('·')}홀` : '', typeText: types.join(' · ') };
}
