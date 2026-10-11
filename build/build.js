/* ═══════════════════════════════════════════════════════════════
   build.js — 주간업무계획 md 폴더 → data.js 단일 파일 생성
   사용: node build/build.js <md폴더> [출력경로=./data.js]
   - merge-rules.json 이 build/ 에 있으면 함께 담는다 (§4.3 예외 규칙)
   - data.js 는 세 화면(mayor/staff/public)과 verify 가 공유한다 (§5.1)
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
const BW = require('../core.js');
const { parseWeekMd, weekOfFilename } = require('./parse.js');

const mdDir = process.argv[2];
const outPath = process.argv[3] || path.join(__dirname, '..', 'data.js');
if (!mdDir || !fs.existsSync(mdDir)) { console.error('usage: node build/build.js <md폴더> [출력 data.js]'); process.exit(1); }

/* 병합 예외 규칙 (검증 화면에서 내보낸 파일) */
const rulesPath = path.join(__dirname, 'merge-rules.json');
let rules = { same: [], never: [] };
if (fs.existsSync(rulesPath)) {
  try { rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')); console.log(`merge-rules.json 적용: same ${rules.same.length} / never ${rules.never.length}`); }
  catch (e) { console.error('merge-rules.json 파싱 실패 — 규칙 없이 진행:', e.message); }
}

/* 부서 대표번호 — 공개 정보이므로 data.js 포함 가능 (§5.5). 봉화군 대표번호 기반. */
const deptPhonesPath = path.join(__dirname, 'dept-phones.json');
let deptPhones = {};
if (fs.existsSync(deptPhonesPath)) { try { deptPhones = JSON.parse(fs.readFileSync(deptPhonesPath, 'utf-8')); } catch (e) { } }

const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md')).sort();
const occ = [];
const weeks = [];
/* 파싱 바닥 점검 — kordoc 출력 형식이 바뀌면 파서가 조용히 깨져 한 주가 통째로
   비거나(2026-09-07, 0건) 부서불명으로 버려진(2026-09-28, 71건) 일이 실제로 있었다.
   93주 실측 최솟값이 업무 45건·부서 21개이므로, 그보다 한참 아래면 데이터 이상이다.
   깨진 data.js 를 조용히 배포하느니 빌드를 멈추는 편이 낫다 (Actions 실패로 드러남). */
const MIN_ITEMS = 25, MIN_DEPTS = 15;
const bad = [];
for (const f of files) {
  const week = weekOfFilename(f);
  if (!week) continue;
  const r = parseWeekMd(fs.readFileSync(path.join(mdDir, f), 'utf-8'), week);
  const nDepts = new Set(r.entries.map(e => e.dept)).size;
  if (r.entries.length < MIN_ITEMS || nDepts < MIN_DEPTS) {
    bad.push(`${week}: 업무 ${r.entries.length}건 / 부서 ${nDepts} / 부서불명 ${r.skipped.noDept}건 (${f})`);
  }
  weeks.push(week);
  for (const e of r.entries) {
    occ.push({ week, dept: e.dept, sec: e.sec, item: e.item, prog: BW.parseProg(e.item) });
  }
}
if (bad.length) {
  console.error(`파싱 바닥 미달 — md 변환 형식이 바뀌었는지 확인 필요 (기준: 업무 ${MIN_ITEMS}건·부서 ${MIN_DEPTS}개):`);
  bad.forEach(b => console.error('  ' + b));
  process.exit(3);
}
occ.sort((a, b) => a.week < b.week ? -1 : 1);
const latest = weeks[weeks.length - 1];

const data = {
  /* 최신 주차를 기준으로 둔다(고정값). 실행 시각을 넣으면 내용이 같아도 매번 달라져
     새 주차가 없는데도 매일 커밋되므로, 데이터에서 결정되는 값만 쓴다. */
  builtAt: latest,
  weekStart: latest,                       /* 데이터 기준 주차 — 화면 상단 상시 표시 (§5.6) */
  weeks: [...new Set(weeks)].sort(),
  depts: [...new Set(occ.map(o => o.dept))],
  deptPhones,
  rules,
  occ
};

const js = '/* 자동 생성 파일 — build/build.js 로 재생성. 직접 수정 금지 */\n' +
  'window.BW_DATA=' + JSON.stringify(data) + ';';
fs.writeFileSync(outPath, js);

const kb = Math.round(Buffer.byteLength(js) / 1024);
console.log(`data.js 생성: ${outPath}`);
console.log(`  기준 주차 ${latest} / ${data.weeks.length}주 / ${occ.length}건 / ${data.depts.length}부서 / ${kb}KB`);
