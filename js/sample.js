import { db } from './db.js';
import { dateStr, uid } from './util.js';

/* 골프장마다 9홀 코스가 여러 개 있고, 라운드마다 전반/후반 코스를 조합해서 친다 */
const COURSES = [
  { name: '레이크사이드 CC', rating: 72.0, slope: 128, nines: [
    { name: '서', pars: [4, 4, 3, 5, 4, 4, 3, 4, 5] },
    { name: '남', pars: [4, 5, 3, 4, 4, 4, 3, 5, 4] },
    { name: '동', pars: [5, 4, 4, 3, 4, 4, 3, 5, 4] }
  ] },
  { name: '그린힐 CC', rating: 71.2, slope: 125, nines: [
    { name: '레이크', pars: [5, 4, 4, 3, 4, 4, 3, 5, 4] },
    { name: '밸리', pars: [4, 3, 5, 4, 4, 3, 4, 5, 4] }
  ] },
  { name: '파인밸리 CC', rating: 70.5, slope: 122, nines: [
    { name: '힐', pars: [4, 3, 5, 4, 4, 3, 4, 5, 4] },
    { name: '마운틴', pars: [4, 5, 3, 4, 4, 3, 5, 4, 4] }
  ] }
];
const WEATHERS = ['sunny', 'sunny', 'sunny', 'partly', 'partly', 'cloudy', 'cloudy', 'rain', 'windy'];
const TIMES = ['06:30', '07:12', '07:48', '08:24', '09:36', '11:00', '12:30'];
const MONTH_TEMP = [-1, 2, 8, 15, 20, 25, 28, 29, 23, 16, 8, 1];

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 최근 8개월, 실력이 서서히 늘어나는 22라운드 샘플 */
export async function loadSamples(count = 22) {
  const rand = rng(20260921);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * 1.2;
  const rounds = [];
  const today = new Date();
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const skill = 1.55 - 1.2 * t;
    const course = COURSES[Math.floor(rand() * COURSES.length)];
    const fi = Math.floor(rand() * course.nines.length);
    let bi = Math.floor(rand() * (course.nines.length - 1));
    if (bi >= fi) bi++;
    const front = course.nines[fi], back = course.nines[bi];
    const pars = [...front.pars, ...back.pars];
    const d = new Date(today); d.setDate(d.getDate() - Math.round((count - 1 - k) * 11 + rand() * 4));
    if (d > today) d.setTime(today.getTime());
    const weather = WEATHERS[Math.floor(rand() * WEATHERS.length)];
    const windy = weather === 'windy' || weather === 'rain' ? 0.18 : 0;
    const holes = pars.map((par, i) => {
      const parAdj = par === 5 ? 0.22 : par === 3 ? 0.05 : 0;
      const backAdj = i >= 9 ? 0.08 : 0;
      let diff = Math.round(skill + parAdj + backAdj + windy + gauss() * 1.0);
      diff = Math.max(-1, Math.min(4, diff));
      let ob = rand() < 0.045 + windy * 0.1 ? 1 : 0;
      let hazard = rand() < 0.06 ? 1 : 0;
      if (ob) diff = Math.max(diff, 2);
      if (hazard && !ob) diff = Math.max(diff, 1);
      const score = par + diff;
      let putts = diff <= -1 ? 1 : rand() < 0.11 ? 3 : rand() < 0.12 ? 1 : 2;
      if (diff >= 3 && rand() < 0.3) putts = 3;
      putts = Math.max(0, Math.min(putts, score - 1));
      return { score, putts, ob, hazard };
    });
    rounds.push({
      id: uid() + k, date: dateStr(d), time: TIMES[Math.floor(rand() * TIMES.length)], course: course.name,
      frontName: front.name, backName: back.name, tee: '화이트', rating: course.rating, slope: course.slope, weather,
      temp: Math.round(MONTH_TEMP[d.getMonth()] + (rand() - 0.5) * 6), pars, holes, memo: '',
      createdAt: Date.now() + k, sample: true
    });
  }
  await db.putMany(rounds, COURSES.map(c => ({
    name: c.name, pars: [...c.nines[0].pars, ...c.nines[1].pars], holes: 18,
    front: c.nines[0].name, back: c.nines[1].name, nines: c.nines,
    tees: [{ name: '화이트', holes: 18, rating: c.rating, slope: c.slope }], lastTee: '화이트'
  })));
  return rounds.length;
}
