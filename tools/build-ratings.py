#!/usr/bin/env python3
"""대한골프협회(KGA) '코스레이팅 현황' PDF를 앱에서 쓰는 data/kga-ratings.json 으로 변환한다.

사용법:
    pip install pdfplumber
    python tools/build-ratings.py "C:/Users/me/Downloads/AllRatings_17.pdf"

PDF의 각 행 형식:
    골프장  코스사용  티세트  남자|여자  레이팅/슬로프  코스길이(야드)
    예) 화성상록 동+서 BACK 남자 74.5/146 6,973

출력(JSON, 용량을 줄이려고 배열로 저장):
    { "source": "...", "date": "2024-03-07",
      "clubs": [ { "n": "화성상록", "r": [ ["동+서", "BACK", 0, 74.5, 146, 6973], ... ] } ] }
    r 배열: [코스사용, 티, 성별(0=남자,1=여자), 코스레이팅, 슬로프, 코스길이]
"""
import io
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

import pdfplumber

ROW = re.compile(r'^(?P<left>.+?)\s+(?P<sex>남자|여자)\s+(?P<rating>\d{2}\.\d)/(?P<slope>\d{2,3})\s+(?P<yd>[\d,]+)$')
STAR = re.compile(r'^(.+?)\s+(\S+\s\*\s\d)\s+(.+)$')       # "글렌로스 9홀 * 2 WHITE" 처럼 코스사용에 '* 2'가 들어간 형태
DATE = re.compile(r'(\d{4}-\d{2}-\d{2})')


def split_left(left: str):
    """왼쪽 덩어리를 (골프장, 코스사용, 티)로 나눈다. 코스사용은 대개 '동+서' 처럼 '+'가 들어 있다."""
    toks = left.split(' ')
    m = STAR.match(left)
    if m:
        return m.group(1), m.group(2), m.group(3)
    plus = [i for i, t in enumerate(toks) if '+' in t and i < len(toks) - 1]   # 마지막 토큰은 티라서 제외
    if plus:
        i = plus[0]
        return ' '.join(toks[:i]), toks[i], ' '.join(toks[i + 1:])
    return ' '.join(toks[:-2]), toks[-2], toks[-1]                             # '설해원 더레전드 BLACK' 같은 예외


def main(pdf_path: str, out_path: str):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    rows, skipped, date = [], [], ''
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for ln in (page.extract_text() or '').split('\n'):
                ln = ln.strip()
                if not ln:
                    continue
                if ln.startswith('KGA '):
                    d = DATE.search(ln)
                    if d and not date:
                        date = d.group(1)
                    continue
                m = ROW.match(ln)
                if not m:
                    if '코스레이팅' not in ln and not ln.startswith('골프장 '):
                        skipped.append(ln)
                    continue
                club, course, tee = split_left(m.group('left'))
                rows.append((club, course, tee, 0 if m.group('sex') == '남자' else 1,
                             float(m.group('rating')), int(m.group('slope')), int(m.group('yd').replace(',', ''))))
    clubs = OrderedDict()
    for club, course, tee, sex, rating, slope, yd in rows:
        clubs.setdefault(club, []).append([course, tee, sex, rating, slope, yd])
    data = {'source': '대한골프협회(KGA) 코스레이팅 현황', 'date': date,
            'clubs': [{'n': n, 'r': r} for n, r in clubs.items()]}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'행 {len(rows)}개 · 골프장 {len(clubs)}곳 · 기준일 {date or "?"} → {out_path}')
    if skipped:
        print(f'해석하지 못한 줄 {len(skipped)}개 (앞 5개):')
        for s in skipped[:5]:
            print('  ', s)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    default_out = Path(__file__).resolve().parent.parent / 'data' / 'kga-ratings.json'
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else str(default_out))
