#!/usr/bin/env node
/**
 * 문화체육관광부 「전국 골프장 현황」 CSV를 앱에서 쓰는 data/mcst-courses.json 으로 변환한다.
 * Node만 있으면 되고 별도 패키지 설치가 필요 없다.
 *
 * 사용법:
 *   node tools/build-mcst.mjs "C:/Users/me/Downloads/문화체육관광부_전국 골프장 현황_20241231.csv" [기준일]
 *
 * CSV 컬럼(원본 그대로): 지역,이름,사업자,소재지,면적(제곱미터),홀,구분
 * 이 자료에는 골프장 이름·지역·주소·전체 홀 수·회원제 구분만 있고, 홀별 파나 코스 레이팅은 없다.
 * 코스 검색(js/coursesearch.js, OpenStreetMap)과 KGA 레이팅 검색(js/kga.js)에 곁들이는 참고 정보로 쓴다.
 *
 * 출력(JSON): { source, date, courses: [ { n(이름), region(지역), addr(소재지), op(사업자), area(㎡), holes, type } ] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseCsv(text) {
  // 이 자료는 필드 안에 쉼표·따옴표가 없는 단순 CSV라 줄 단위로 나눠도 안전하다
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

function main(csvPath, date, outPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const courses = rows.filter(r => r['이름']).map(r => ({
    n: r['이름'],
    region: r['지역'],
    addr: r['소재지'],
    op: r['사업자'],
    area: Number(r['면적(제곱미터)']) || null,
    holes: Number(r['홀']) || null,
    type: (r['구분'] || '').trim()
  }));
  const data = { source: '문화체육관광부 전국 골프장 현황', date, courses };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data), 'utf8');
  console.log(`골프장 ${courses.length}곳 (기준일 ${date}) → ${outPath}`);
}

const [csvPath, dateArg, outArg] = process.argv.slice(2);
if (!csvPath) {
  console.error('사용법: node tools/build-mcst.mjs "<CSV 경로>" [기준일 YYYY-MM-DD] [출력 경로]');
  process.exit(1);
}
// 파일명의 8자리 날짜(예: ..._20241231.csv)를 기준일로 자동 인식한다
const guessed = csvPath.match(/(\d{4})(\d{2})(\d{2})/);
const date = dateArg || (guessed ? `${guessed[1]}-${guessed[2]}-${guessed[3]}` : '');
const here = path.dirname(fileURLToPath(import.meta.url));
main(csvPath, date, outArg || path.join(here, '..', 'data', 'mcst-courses.json'));
