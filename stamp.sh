#!/bin/bash
# ── 배포 도장 ──
# 화면 파일(js·css)의 주소 뒤에 내용 해시(?v=…)를 찍는다.
#
# 왜 필요한가 — GitHub Pages 는 cache-control: max-age=600 으로 내려준다.
# 도장이 없으면 파일을 고쳐도 브라우저가 열 시간 동안 옛것을 쓴다.
# 휴대폰에서 시험하다 "안 고쳐졌는데?" 가 되는 원인이 이것이다.
# 해시는 내용에서 나오므로, 안 바뀐 파일은 도장도 그대로여서 캐시가 계속 듣는다.
#
#   ./stamp.sh          찍기
#   ./stamp.sh --check   안 찍힌 것이 있으면 알려 주고 1 로 끝난다
set -e
cd "$(dirname "$0")"
python3 - "$@" <<'PY'
import hashlib, pathlib, re, sys
check = '--check' in sys.argv
root = pathlib.Path('.')
h = {}
def stamp(name):
    if name not in h:
        p = root / name
        h[name] = hashlib.sha256(p.read_bytes()).hexdigest()[:8] if p.exists() else None
    return h[name]

# 자료 파일은 안 찍는다 — 화면이 ?v=Date.now() 로 직접 받는다(자동 갱신이라 늘 바뀐다)
SKIP = {'data.js', 'notices.js', 'events.js', 'news.js', 'notice_links.js'}
pat = re.compile(r'(<(?:script|link)\b[^>]*?(?:src|href)=")([A-Za-z0-9_.-]+\.(?:js|css))(\?v=[0-9a-f]+)?(")')
bad, hit = [], 0
for page in sorted(root.glob('*.html')):
    src = page.read_text(encoding='utf-8')
    def fix(m):
        global hit
        name = m.group(2)
        if name in SKIP: return m.group(0)
        v = stamp(name)
        if not v:
            bad.append(f'{page.name} → {name} (파일이 없음)')
            return m.group(0)
        want = f'{m.group(1)}{name}?v={v}{m.group(4)}'
        if want != m.group(0): hit += 1
        return want
    out = pat.sub(fix, src)
    if out != src:
        if check: bad.append(f'{page.name} — 도장이 낡았습니다')
        else: page.write_text(out, encoding='utf-8')

if bad:
    print('⚠️  ' + '\n⚠️  '.join(bad)); sys.exit(1)
print('도장 확인 완료 — 고칠 것 없음' if check else f'도장 {hit}곳 찍음')
PY
