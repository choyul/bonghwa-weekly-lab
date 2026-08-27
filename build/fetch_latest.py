#!/usr/bin/env python3
"""fetch_latest.py — 봉화군 홈페이지에서 새 주간업무계획을 내려받아 md 로 변환
사용: python3 build/fetch_latest.py <hwp저장폴더> <md폴더>
- monthly/list/fetch.do 로 최근 2개월 목록 조회
- md 폴더에 없는 주차만 다운로드 (view.do 는 세션 일관성 필요 — 쿠키 유지)
- '주간업무계획' 첨부만 받아 kordoc 으로 변환 ('행사계획'은 대시보드 미사용)
"""
import subprocess, json, re, urllib.parse, os, sys, tempfile
from datetime import date

BASE = 'https://www.bonghwa.go.kr'
MID = '0201020000'

def main():
    if len(sys.argv) < 3:
        print('usage: fetch_latest.py <hwp저장폴더> <md폴더>'); sys.exit(1)
    hwp_dir, md_dir = sys.argv[1], sys.argv[2]
    os.makedirs(hwp_dir, exist_ok=True); os.makedirs(md_dir, exist_ok=True)
    cj = tempfile.mktemp(suffix='.cookies')

    def curl(url, data=None, out=None, head=False):
        cmd = ['curl', '-s', '-b', cj, '-c', cj, url]
        if data: cmd += ['--data', data]
        if head: cmd = ['curl', '-sI', '-b', cj, '-c', cj, url]
        if out: cmd += ['-o', out, '-w', '%{size_download} %{http_code}']
        r = subprocess.run(cmd, capture_output=True)
        return r.stdout.decode('utf-8', 'replace')

    # 세션 수립
    curl(f'{BASE}/portal/dytWrk/calendar.do?mid={MID}', out='/dev/null')

    # 최근 2개월 목록
    today = date.today()
    months = [today.replace(day=1)]
    prev = (today.replace(day=1).toordinal() - 1)
    months.insert(0, date.fromordinal(prev).replace(day=1))
    have = {m.group(1) for f in os.listdir(md_dir)
            if (m := re.match(r'^(\d{4}-\d{2}-\d{2})_', f))}

    new_files = []
    for m in months:
        raw = curl(f'{BASE}/portal/dytWrk/monthly/list/fetch.do', f'start={m:%Y-%m-%d}&mid={MID}')
        try: rows = json.loads(raw).get('list', [])
        except Exception: continue
        for r in rows:
            sday, idx = r.get('COL_SDAY'), r.get('IDX')
            if not sday or sday in have: continue
            have.add(sday)
            # 상세 → 첨부 목록 (동일 세션 유지)
            html = curl(f'{BASE}/portal/dytWrk/view.do?mid={MID}', f'idx={idx}&goTo={sday}')
            pairs = list(dict.fromkeys(re.findall(r"yhLib\.file\.download\('([^']+)','([^']*)'\)", html)))
            for a, fsn in pairs:
                url = f'{BASE}/common/file/download.do?atchFileId={a}&fileSn={fsn}'
                hdr = curl(url, head=True)
                fm = re.search(r'filename="?([^"\r\n]+)"?', hdr)
                fn = urllib.parse.unquote(fm.group(1)).strip() if fm else f'{idx}_{fsn[:8]}.hwp'
                if '주간업무계획' not in fn: continue  # 행사계획 등 스킵
                out = os.path.join(hwp_dir, f'{sday}_{fn}')
                res = curl(url, out=out)
                size, code = res.split()
                if code == '200' and int(size) > 0:
                    print(f'다운로드: {sday}_{fn} ({int(size)//1024}KB)')
                    new_files.append(out)
                else:
                    print(f'실패: {fn} (HTTP {code})');

    if not new_files:
        print('새 주차 없음 — md 최신 상태'); return 0
    # kordoc 변환
    r = subprocess.run(['npx', '-y', 'kordoc', *new_files, '-d', md_dir, '--silent'])
    if r.returncode != 0:
        print('kordoc 변환 실패'); return 2
    print(f'{len(new_files)}개 파일 변환 완료 → {md_dir}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
