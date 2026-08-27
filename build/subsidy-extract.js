#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   subsidy-extract.js — 보조사업 후보와 조건 초안을 뽑아 subsidy-data.js 를 만든다.

   사용:  node build/subsidy-extract.js
   입력:  data.js(고정 스냅샷) + core.js(무수정 재사용) + build/subsidy-review.json(있으면)
   출력:  subsidy-data.js (window.BW_SUBSIDY)

   설계 원칙 — 무응답은 미게시다.
   자동 추출값의 status 기본은 반드시 "draft"다. 담당자가 subsidy-review.json 에
   "reviewed" 라고 적기 전에는 화면이 판정 문답을 열지 않는다.
   담당자가 아무것도 하지 않았을 때의 기본 동작이 안전해야 한다 —
   무응답이 자동 게시로 이어지면 추출 오류가 그대로 군민 안내가 된다.
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = {};
require(path.join(ROOT, 'data.js'));
const BW = require(path.join(ROOT, 'core.js'));
const D = global.window.BW_DATA;

const CAND_RE = /지원사업|보조사업|바우처|직불/;

/* ── 라벨 후보 (공백 제거 후 앞부분과 비교) ── */
const LBL = {
  target: ['지원대상', '사업대상', '대상', '신청자격', '지원자격', '선정기준'],
  period: ['신청기간', '신청기한', '접수기간', '기간', '사업신청', '추진기간'],
  money:  ['사업비', '지원금액', '지원단가', '사업단가'],
  method: ['신청방법', '접수처', '신청처'],
};
function labelOf(txt) {
  const cleaned = txt.replace(/\s+/g, '');
  const head = cleaned.split(/[:：]/)[0];
  if (head === cleaned) return null;               /* 콜론이 없으면 라벨 줄이 아니다 */
  for (const k of Object.keys(LBL))
    for (const c of LBL[k])
      if (head === c || head.startsWith(c + '및') || head.startsWith(c + '(')) return k;
  return null;
}

/* 라벨 줄 + 그 밑에 딸린 더 깊은 줄들을 한 덩어리로 */
function collect(lines) {
  const out = { target: [], period: [], money: [], method: [] };
  for (let i = 0; i < lines.length; i++) {
    const k = labelOf(lines[i].txt); if (!k) continue;
    out[k].push(lines[i].txt);
    const lv = lines[i].lv || 1;
    for (let j = i + 1; j < lines.length; j++) {
      if ((lines[j].lv || 1) <= lv || labelOf(lines[j].txt)) break;
      out[k].push(lines[j].txt);
    }
  }
  return out;
}

/* ── 값 정규화 — 없으면 null, 추측 금지 ── */
/* 나이 조건이 누구의 나이인지 — 아동 대상 사업에서 부모가 제 나이를 넣는 혼동을 막는다 */
function parseAgeSubject(t) {
  if (/아동|자녀|어린이|유아/.test(t)) return '자녀(아동)';
  if (/청소년/.test(t)) return '청소년 자녀';
  if (/학생/.test(t)) return '학생 자녀';
  return null;
}
function parseAge(t) {
  const min = t.match(/(?:만\s*)?(\d{1,3})\s*세\s*이상/);
  const max = t.match(/(\d{1,3})\s*세\s*(미만|이하)/);
  let ageMin = min ? +min[1] : null;
  if (ageMin === null) {
    const r = t.match(/(?:만\s*)?(\d{1,3})\s*세?\s*[~∼〜-]\s*(\d{1,3})\s*세/);
    if (r) ageMin = +r[1];
  }
  return {
    ageMin,
    ageMax: max ? +max[1] : null,
    ageMaxInclusive: max ? max[2] === '이하' : null,
  };
}
function parseResidency(t) {
  return /봉화군(?:에|내)?\s*(?:주소|거주)|관내(?:에)?\s*(?:주소|거주)|봉화군에\s*주민등록|주소를\s*둔/.test(t.replace(/\s+/g, ' ')) ? '봉화군' : null;
}
function parseFarm(t) { return /농업\s*경영체\s*등록|경영체\s*등록/.test(t) ? true : null; }
function parseGender(t) { return /여성\s*농업인|여성\s*농어업인|여성\s*어업인|여성농/.test(t) ? '여성' : null; }
function parseRates(t) {
  const c = t.replace(/\s+/g, '');
  const b = c.match(/보조(?:율)?[:\s]*(\d{1,3})%/), j = c.match(/자(?:부담|담)[:\s]*(\d{1,3})%/);
  return { subsidyRate: b ? +b[1] : null, selfPayRate: j ? +j[1] : null };
}
/* 날짜 — 연도가 없으면 주차 연도로 보정하고 dateInferred 를 남긴다 */
function parseDates(t, week) {
  const baseY = +week.slice(0, 4);
  const c = t.replace(/\s+/g, '');
  const FULL = /(\d{4})[.\-\/년](\d{1,2})[.\-\/월]?(\d{1,2})?/g;
  const SHORT = /(?:^|[^\d.])(\d{1,2})\.(\d{1,2})\.?/g;
  const pad = n => String(n).padStart(2, '0');
  let inferred = false;
  const seg = c.split(/[~∼〜]/);
  function one(str, yHint) {
    let m = [...str.matchAll(FULL)][0];
    if (m && m[3]) return { d: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, y: +m[1] };
    m = [...str.matchAll(SHORT)][0];
    if (m) { inferred = true; return { d: `${yHint}-${pad(m[1])}-${pad(m[2])}`, y: yHint, mo: +m[1] }; }
    return null;
  }
  if (seg.length >= 2) {
    const a = one(seg[0], baseY);
    let b = one(seg[1], a ? a.y : baseY);
    if (a && b && b.d < a.d && b.mo !== undefined) {   /* "12. 20. ~ 1. 10." — 해를 넘긴 것 */
      b = { d: `${a.y + 1}-${b.d.slice(5)}` }; inferred = true;
    }
    return { applyStart: a ? a.d : null, applyEnd: b ? b.d : null, dateInferred: inferred };
  }
  const a = one(c, baseY);
  return { applyStart: a ? a.d : null, applyEnd: null, dateInferred: inferred };
}
function idOf(key) {   /* djb2 — 실행마다 같은 id */
  let h = 5381; for (const ch of key) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return 'sub_' + h.toString(16).padStart(8, '0');
}

/* ── 추출 ── */
const occHit = D.occ.filter(o => CAND_RE.test(o.item.title));
const uniqTitles = new Set(occHit.map(o => o.item.title.trim()));
/* 런타임(ui.js)과 똑같이 — 부서 단위로, 병합 규칙까지 넘겨서 묶는다.
   다르게 부르면 대표 키가 어긋나 화면에서 카드를 못 찾는다. */
const groups = [];
D.depts.forEach(dept => {
  BW.groupIssues(D.occ.filter(o => o.dept === dept), D.rules).forEach(g => {
    g.dept = dept; groups.push(g);
  });
});
let cand = groups.filter(g => g.list.some(o => CAND_RE.test(o.item.title)));
/* 읍·면 재공고 병합 — 같은 키가 소관과와 읍·면에 함께 있으면 카드는 하나만 둔다.
   소관과(읍·면이 아닌 부서) 것을 남기고, 없으면 등장 횟수가 많은 쪽을 남긴다. */
const EUP = new Set(BW.REGIONS || []);
const byK = {};
let mergedEup = 0;
for (const g of cand) {
  const cur = byK[g.key];
  if (!cur) { byK[g.key] = g; continue; }
  mergedEup++;
  const pick = (!EUP.has(g.dept) && EUP.has(cur.dept)) ? g
    : (!EUP.has(cur.dept) && EUP.has(g.dept)) ? cur
    : (g.list.length > cur.list.length ? g : cur);
  byK[g.key] = pick;
}
cand = Object.values(byK);

let review = {};
const rvPath = path.join(__dirname, 'subsidy-review.json');
if (fs.existsSync(rvPath)) review = JSON.parse(fs.readFileSync(rvPath, 'utf8'));

const items = []; const fieldN = { target: 0, period: 0, money: 0, method: 0 };
for (const g of cand) {
  const last = g.list[g.list.length - 1];
  const lines = (last.item.lines || []);
  const got = collect(lines);
  for (const k of Object.keys(fieldN)) if (got[k].length) fieldN[k]++;
  const targetT = got.target.join(' ');
  const age = parseAge(targetT);
  const rates = parseRates(got.money.join(' ') + ' ' + targetT);
  const dates = got.period.length ? parseDates(got.period.join(' '), last.week)
                                  : { applyStart: null, applyEnd: null, dateInferred: false };
  const it = {
    id: idOf(g.key), issueKey: g.key,
    title: last.item.title, dept: g.dept || last.dept || '', week: last.week,
    status: 'draft',                       /* 검수 전 — 판정에 쓰지 않는다 */
    conditions: {
      ageMin: age.ageMin, ageMax: age.ageMax, ageMaxInclusive: age.ageMaxInclusive,
      ageSubject: (age.ageMin !== null || age.ageMax !== null)
        ? parseAgeSubject(last.item.title + ' ' + targetT) : null,
      residency: parseResidency(targetT),
      needsFarmRegistry: parseFarm(targetT),
      gender: parseGender(last.item.title + ' ' + targetT),
      subsidyRate: rates.subsidyRate, selfPayRate: rates.selfPayRate,
      applyStart: dates.applyStart, applyEnd: dates.applyEnd, dateInferred: dates.dateInferred,
    },
    apply: { channel: null, place: null, documents: [] },
    rawLines: [...got.target, ...got.period, ...got.money, ...got.method],
  };
  const rv = review[it.id];
  if (rv) {
    if (rv.status) it.status = rv.status;
    if (rv.overrides) Object.assign(it.conditions, rv.overrides);
    if (rv.apply) Object.assign(it.apply, rv.apply);
    if (rv.reviewedBy) it.reviewedBy = rv.reviewedBy;
    if (rv.reviewedAt) it.reviewedAt = rv.reviewedAt;
  }
  items.push(it);
}

const out = '/* 자동 생성 파일 — build/subsidy-extract.js 로 재생성. 직접 수정 금지 */\n'
  + 'window.BW_SUBSIDY=' + JSON.stringify({ builtAt: D.builtAt, items }, null, 1) + ';\n';
fs.writeFileSync(path.join(ROOT, 'subsidy-data.js'), out);

/* ── 보고용 수치 ── */
const byDept = {}; for (const o of occHit) byDept[o.dept] = (byDept[o.dept] || 0) + 1;
const byStatus = {}; for (const it of items) byStatus[it.status] = (byStatus[it.status] || 0) + 1;
console.log('occ 단위 후보:', occHit.length, '건 / 고유 제목:', uniqTitles.size);
console.log('병합 뒤 카드:', items.length, '건 (읍·면 재공고 흡수', mergedEup, '건) / status:', JSON.stringify(byStatus));
console.log('부서별 상위:', Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([d, n]) => `${d} ${n}`).join(', '));
const pct = n => (n / items.length * 100).toFixed(0) + '%';
console.log(`필드 추출률 — 지원대상 ${pct(fieldN.target)}, 신청기간 ${pct(fieldN.period)}, 사업비 ${pct(fieldN.money)}, 신청방법 ${pct(fieldN.method)}`);
const judgeable = items.filter(i => {
  const c = i.conditions;
  return c.ageMin !== null || c.ageMax !== null || c.residency || c.needsFarmRegistry || c.gender;
});
console.log('문답을 만들 조건이 1개 이상:', judgeable.length, '건 (' + pct(judgeable.length) + ')');
