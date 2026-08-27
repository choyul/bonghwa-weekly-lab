/* ═══════════════════════════════════════════════════════════════
   core.js — 봉화군 주간업무 대시보드 공용 로직
   출처: 주간업무_데스크_도시계획과.html 에서 검증된 로직을 추출.
   브라우저(window.BW)와 Node(module.exports) 겸용.
   ─ 기존 로직은 수정하지 않는 것이 원칙. 변경분은 [신규] 표기.
   ═══════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────── 날짜 유틸 (기존 그대로) ───────── */
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function d2(s) { const d = new Date(s + 'T00:00:00'); return d; }
  function fmtK(d) { return `${d.getMonth() + 1}. ${d.getDate()}.(${DOW[d.getDay()]})`; }
  function addD(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function isoW(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - dn); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); }
  function mondayOf(dt) { const d = new Date(dt); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d; }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function weekLabel(ws) { const s = d2(ws), e = addD(s, 6); return `${s.getFullYear()}. ${fmtK(s)} ~ ${fmtK(e)}`; }
  /* [신규] 주차 한글 표기: "2026년 7월 4주차" — 화면 상단 데이터 기준 표시용 */
  function weekKo(ws) { const s = d2(ws); const nth = Math.ceil((s.getDate() + (new Date(s.getFullYear(), s.getMonth(), 1).getDay() + 6) % 7) / 7); return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${nth}주차`; }

  /* ───────── 제목 정규화 (기존 그대로) ───────── */
  function normKey(t) { let s = String(t).replace(/\([^)]*\)/g, '').replace(/[\s·,「」『』()\[\]]/g, ''); for (let i = 0; i < 3; i++) s = s.replace(/(계속|신규)?(추진|실시|개최|운영|보고|착수|완료|진행|계획)$/, ''); return s; }

  /* ───────── 업무유형 프리셋 (기존 그대로) ───────── */
  const TYPES = {
    '행사·의식': ['일    시: ', '장    소: ', '참석대상: ', '주요내용: '],
    '회의·심의': ['일    시: ', '장    소: ', '참    석: ', '안    건: '],
    '공사 추진': ['위    치: ', '공정현황:  (공정률 %)', '추진계획: '],
    '용역 추진': ['용역기간: ', '추진현황: ', '추진계획: '],
    '행정절차': ['기    간: ', '대    상: ', '주요내용: '],
    '점검·감사': ['일    시: ', '대    상: ', '점검내용: '],
    '기타': ['주요내용: ']
  };
  const LABELS = ['일    시: ', '장    소: ', '참석대상: ', '참    석: ', '주요내용: ', '위    치: ', '공정현황: ', '추진계획: ', '추진현황: ', '용역기간: ', '기    간: ', '대    상: ', '사 업 비: ', '안    건: '];

  /* 군민용 표시 라벨 (내부값은 유지, 표시만 치환 — 설계서 §8.2) */
  const PUBLIC_TYPE_LABELS = {
    '행사·의식': '행사·축제', '회의·심의': '위원회·회의', '공사 추진': '공사·정비',
    '용역 추진': '조사·연구', '행정절차': '행정 안내', '점검·감사': '점검·안전', '기타': '그 밖의 일'
  };

  function guessType(it) {
    const t = it.title || ''; const ls = it.lines.map(l => l.txt).join(' ');
    if (/공사/.test(t) || /공정률/.test(ls)) return '공사 추진';
    if (/용역/.test(t)) return '용역 추진';
    if (/회의|위원회|심의|보고회|협의회/.test(t)) return '회의·심의';
    if (/점검|감사|단속/.test(t)) return '점검·감사';
    if (/공고|열람|고시|승인|지정|신청|접수|공모/.test(t)) return '행정절차';
    if (/일\s*시/.test(ls) && /장\s*소/.test(ls)) return '행사·의식';
    return '기타';
  }

  /* ───────── 공정률 추출 (기존 그대로) ───────── */
  function parseProg(item) {
    let p = null;
    const scan = t => { const ms = [...String(t).matchAll(/공정률\s*[:：]?\s*([\d.]+)\s*%/g)]; if (ms.length) p = parseFloat(ms[ms.length - 1][1]); };
    item.lines.forEach(l => scan(l.txt));
    if (item.box) item.box.lines.forEach(scan);
    return p;
  }

  /* ───────── 현안 군집화 (기존 union-find + [신규] 예외 규칙 주입) ─────────
     occ: [{week, dept, item:{title,team,type,lines,box?}, prog}]
     rules: {same:[[k1,k2],...], never:[[k1,k2],...]}  — merge-rules.json
       same  : 두 normKey 를 강제로 같은 현안으로 병합 (미병합 교정)
       never : 자동 부분문자열 병합을 차단 (과잉 병합 교정)
     기존 자동 병합 조건(6자 이상 부분 문자열 포함)은 그대로 유지한다. */
  function groupIssues(occ, rules) {
    rules = rules || {};
    const sameSet = new Set((rules.same || []).map(p => p.slice().sort().join('')));
    const neverSet = new Set((rules.never || []).map(p => p.slice().sort().join('')));
    const pairKey = (a, b) => (a < b ? a + '' + b : b + '' + a);

    const keys = [...new Set(occ.map(o => normKey(o.item.title)))].filter(Boolean);
    const parent = {}; keys.forEach(k => parent[k] = k);
    const find = k => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    /* 군집 구성 키 추적 — never 검사용 [신규] */
    const members = {}; keys.forEach(k => members[k] = [k]);
    const canUnion = (ra, rb) => {
      for (const a of members[ra]) for (const b of members[rb])
        if (neverSet.has(pairKey(a, b))) return false;
      return true;
    };
    const doUnion = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra === rb) return;
      parent[ra] = rb;
      members[rb] = members[rb].concat(members[ra]);
      delete members[ra];
    };
    /* 1) 수동 병합(same) 우선 적용 */
    sameSet.forEach(pk => { const [a, b] = pk.split(''); if (a in parent && b in parent) doUnion(a, b); });
    /* 2) 자동 병합: 6자 이상 부분 문자열 포함 (기존 조건), never 쌍은 차단 */
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j]; const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
      if (s.length >= 6 && l.includes(s)) {
        const ra = find(a), rb = find(b);
        if (ra !== rb && canUnion(ra, rb)) doUnion(a, b);
      }
    }
    const map = {};
    occ.forEach(o => { const k = normKey(o.item.title); if (!k) return; const r = find(k); (map[r] = map[r] || []).push(o); });
    return Object.entries(map).map(([k, list]) => {
      list.sort((a, b) => a.week < b.week ? -1 : 1);
      const last = list[list.length - 1];
      const progs = list.filter(o => o.prog != null);
      return {
        key: k, list, title: last.item.title, team: last.item.team, type: last.item.type,
        dept: last.dept,
        first: list[0].week, last: last.week, weeks: new Set(list.map(o => o.week)).size,
        prog: progs.length ? progs[progs.length - 1].prog : null,
        progSeries: progs.map(o => ({ week: o.week, p: o.prog })),
        srcKeys: [...new Set(list.map(o => normKey(o.item.title)))]   /* [신규] 검증 화면용: 묶인 원본 키 */
      };
    }).sort((a, b) => a.last < b.last ? 1 : -1);
  }

  /* ───────── 지속성 지표 [신규 — 설계서 §4.4] ─────────
     공정률(기재값)과 성격이 다른 "등장 기준 추정" 간접 신호.
     UI 에서 공정률과 나란히·같은 서식으로 표시하지 말 것. */
  function persistence(issue, weekStart) {
    const wk = s => Math.floor(d2(s).getTime() / 864e5 / 7);
    const span = wk(issue.last) - wk(issue.first) + 1;            /* first~last 경과 주차 수 */
    const density = span > 0 ? issue.weeks / span : 1;            /* 연속성. 1.0이면 매주 등장 */
    const weeksSince = wk(weekStart) - wk(issue.last);            /* 현재 보고주간 - last */
    return { weeks: issue.weeks, span, density: Math.round(density * 100) / 100, weeksSince };
  }
  function persistenceLabel(p) {
    const since = p.weeksSince <= 0 ? '이번 주 등장' : `최근 등장 ${p.weeksSince}주 전`;
    return `${p.weeks}주 등장 · 연속성 ${p.density} · ${since}`;
  }

  /* ───────── 기간 종료일 추출 (기존 그대로) ───────── */
  function parsePeriodEnd(item) {
    const texts = []; item.lines.forEach(l => texts.push(l.txt)); if (item.box) item.box.lines.forEach(x => texts.push(x));
    let end = null;
    texts.forEach(t => {
      if (!/기\s*간/.test(t)) return;
      const seg = String(t).split(/[~〜–—-]|부터|까지/);
      const full = s => { const m = s.match(/(20\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
      const partial = s => { const m = s.match(/(?:^|[^\d])(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/); return m ? { mo: +m[1], d: +m[2] } : null; };
      /* [신규] 일(日) 생략형 "2026. 10." → 해당 월 말일로 해석 (사업기간 표기 관행) */
      const fullYM = s => { const m = s.match(/(20\d{2})\s*\.\s*(\d{1,2})\s*\.?(?!\s*\d)/); return m ? { y: +m[1], mo: +m[2], d: new Date(+m[1], +m[2], 0).getDate() } : null; };
      const start = full(seg[0]) || fullYM(seg[0]);
      const tail = seg[seg.length - 1];
      if (!full(tail) && !fullYM(tail) && !partial(tail)) return;
      let e = full(tail) || fullYM(tail);
      if (!e && start) { const p = partial(tail); if (p) { let y = start.y; if (p.mo < start.mo) y++; e = { y, mo: p.mo, d: p.d }; } }
      if (!e) return;
      const d = new Date(e.y, e.mo - 1, e.d); if (!isNaN(d)) { const v = ymd(d); if (!end || v > end) end = v; }
    });
    return end;
  }
  function issueEndDate(issue) {
    let end = null;
    issue.list.forEach(o => { const e = parsePeriodEnd(o.item); if (e && (!end || e > end)) end = e; });
    return end;
  }

  /* ───────── 상태 판정 (기존 그대로 — weekStart 인자화만) ─────────
     결과 데이터가 없는 전제이므로 모든 판정은 추정이다. */
  function issueStatus(issue, weekStart, meta) {
    const m = meta;                             /* 0: 수동 진행중 되돌림, 1: 수동 완료 */
    if (m === 1) return 'done';
    if (m === 0) return statusByRecency(issue, weekStart);
    if (issue.prog != null && issue.prog >= 100) return 'done';
    const lastIt = issue.list[issue.list.length - 1].item;
    if (/준공식|사업\s*완료|추진\s*완료|준공\s*완료|공사\s*완료$/.test(lastIt.title)) return 'done';
    const end = issueEndDate(issue);
    if (end && end < weekStart) return 'done';  /* 기간 종료일이 현재 보고주간 이전 → 자동 완료(추정) */
    return statusByRecency(issue, weekStart);
  }
  function statusByRecency(issue, weekStart) {
    const cut = ymd(addD(d2(weekStart), -28));
    if (issue.last < cut) return 'stale';       /* 4주째 미등장 + 종료 보고 없음 */
    return 'active';
  }

  /* ───────── 스파크라인 (기존 그대로) ───────── */
  function sparkline(series) {
    if (series.length < 2) return '';
    const W = 92, H = 26, ps = series.map(s => s.p);
    const mn = Math.min(...ps), mx = Math.max(...ps), rg = mx - mn || 1;
    const pts = series.map((s, i) => `${(i / (series.length - 1) * (W - 6) + 3).toFixed(1)},${(H - 4 - (s.p - mn) / rg * (H - 8)).toFixed(1)}`).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="#B23A2F" stroke-width="2" stroke-linecap="round"/><circle cx="${(W - 3)}" cy="${(H - 4 - (series[series.length - 1].p - mn) / rg * (H - 8)).toFixed(1)}" r="2.6" fill="#B23A2F"/></svg>`;
  }

  /* ───────── 공정률 단계 표현 [신규 — 군민용, 확인 결과 채택] ───────── */
  function progStage(p) {
    if (p == null) return null;
    const stage = p < 34 ? '공사 초기' : p < 67 ? '공사 중반' : p < 100 ? '마무리 단계' : '공사 마무리';
    return `${stage} (공정률 ${p}% 기재 기준)`;
  }

  /* ═══════════════════════════════════════════════════════════════
     이하 [사용성 검토 반영분] — 2026-07-25
     ═══════════════════════════════════════════════════════════════ */

  /* ───────── ① 기간 파싱 → 종료 / 진행중 / 예정 ─────────
     문서의 79%가 '기 간:' '일 시:' 등에 날짜를 적는다. 그 날짜를 오늘과 비교한다.
     주의: 이것은 '계획서에 적힌 기간'이지 실제 완료 여부가 아니다. */
  const PERIOD_LABEL = /(기\s*간|일\s*시|일\s*자|기\s*한|마\s*감|점검기간|사업기간|용역기간|과업기간|접수기간|모집기간|교육기간|운영기간|추진기간|공사기간|지급일|개최일|신청기한|제출기한|접수기한)/;

  function dateTokens(text, baseYear) {
    /* 반환: [{y,mo,d,ym:bool}] — ym:true 면 '2025. 9.' 처럼 일(日) 생략 */
    const out = [];
    const re = /(20\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})\s*[.일]?|(20\d{2})\s*[.\-년]\s*(\d{1,2})\s*[.월](?!\s*\d)|(?:^|[^\d.])(\d{1,2})\s*\.\s*(\d{1,2})\s*[.\)]/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out.push({ y: +m[1], mo: +m[2], d: +m[3], ym: false });
      else if (m[4]) out.push({ y: +m[4], mo: +m[5], d: null, ym: true });
      else if (m[6]) out.push({ y: null, mo: +m[6], d: +m[7], ym: false });
    }
    /* 연도 보정: 생략된 연도는 기준 연도를 쓰되, 연말→연초 넘김이면 +1 */
    let lastY = baseYear;
    out.forEach(t => {
      if (t.y == null) {
        t.y = lastY;
        const prev = out[out.indexOf(t) - 1];
        if (prev && prev.y != null && t.mo < prev.mo - 6) t.y = prev.y + 1;
      }
      lastY = t.y;
      if (t.mo < 1 || t.mo > 12) t.valid = false;
      else if (t.d != null && (t.d < 1 || t.d > 31)) t.valid = false;
      else t.valid = true;
    });
    return out.filter(t => t.valid);
  }

  /* 항목의 기재 기간 → {start, end} (없으면 null). occWeek 은 연도 보정 기준. */
  function parseDateRange(item, occWeek) {
    const baseYear = occWeek ? +occWeek.slice(0, 4) : new Date().getFullYear();
    const texts = [];
    item.lines.forEach(l => { if (PERIOD_LABEL.test(l.txt)) texts.push(l.txt); });
    if (item.box) item.box.lines.forEach(t => { if (PERIOD_LABEL.test(t)) texts.push(t); });
    /* '주요 행사'란은 라벨 없이 "7. 27.(월) 13:00~, 연구지원센터/ 20명" 처럼 적는다.
       라벨 달린 줄이 없을 때만 날짜로 시작하는 줄을 기간으로 본다. */
    if (!texts.length) {
      item.lines.forEach(l => {
        if (/^\s*(20\d{2}\s*[.년]\s*)?\d{1,2}\s*\.\s*\d{1,2}\s*[.\(]/.test(l.txt)) texts.push(l.txt);
      });
    }
    if (!texts.length) return null;

    let start = null, end = null, openEnded = false;
    texts.forEach(t => {
      const toks = dateTokens(t, baseYear);
      if (!toks.length) return;
      /* '~ 소진 시까지', '계속' 처럼 종료가 열린 표현 */
      if (/소진|계속|연중|상시/.test(t)) openEnded = true;
      const first = toks[0], last = toks[toks.length - 1];
      const sv = ymd(new Date(first.y, first.mo - 1, first.ym ? 1 : first.d));
      /* 일 생략형 종료는 그 달 말일로 (사업기간 표기 관행) */
      const ev = ymd(new Date(last.y, last.mo - 1, last.ym ? new Date(last.y, last.mo, 0).getDate() : last.d));
      /* '~까지'만 있고 시작이 없으면 시작은 미상 */
      const endOnly = /까지/.test(t) && toks.length === 1;
      if (!endOnly && (!start || sv < start)) start = sv;
      if (!end || ev > end) end = ev;
    });
    if (!start && !end) return null;
    return { start, end, openEnded };
  }

  /* 오늘 기준 3상태. 반환: 'done'(종료) | 'ongoing'(진행중) | 'upcoming'(예정) | null(기간 미기재) */
  function periodStatus(item, occWeek, today) {
    const t = today || ymd(new Date());
    const r = parseDateRange(item, occWeek);
    if (!r) return null;
    if (r.openEnded) return r.start && r.start > t ? 'upcoming' : 'ongoing';
    if (r.end && r.end < t) return 'done';
    if (r.start && r.start > t) return 'upcoming';
    return 'ongoing';
  }
  /* 현안 단위: 가장 최근 등장분의 기재 기간을 따른다 */
  function issuePeriodStatus(issue, today) {
    for (let i = issue.list.length - 1; i >= 0; i--) {
      const o = issue.list[i];
      const st = periodStatus(o.item, o.week, today);
      if (st) return st;
    }
    return null;
  }
  function issueDateRange(issue) {
    for (let i = issue.list.length - 1; i >= 0; i--) {
      const r = parseDateRange(issue.list[i].item, issue.list[i].week);
      if (r) return r;
    }
    return null;
  }
  const PERIOD_LABELS_KO = { done: '종료', ongoing: '진행중', upcoming: '예정', none: '기간 미기재' };

  /* ───────── ② 연례 반복 업무 — "매년 이맘때" ─────────
     연도·회차·분기 토큰을 지운 키로 묶고, 다른 해의 같은 시기(±3주)에
     나타났으면 연례 업무로 본다. 작년 행정을 참고하라는 신호. */
  function annualKey(title) {
    return normKey(String(title)
      .replace(/20\d{2}\s*년?도?/g, '')
      .replace(/제?\s*\d{1,3}\s*회/g, '')
      .replace(/\d{1,2}\s*월/g, '')
      .replace(/[1-4]\s*\/\s*4\s*분기|[상하]반기|\d\s*차/g, ''))
      .replace(/^년도?/, '');
  }
  const dayOfYear = w => { const d = d2(w); return Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5); };

  /* occ 전체에서 연례 그룹을 만든다 → {키: [발생...]} (2개 연도 이상 + 시기 근접) */
  function annualGroups(occ, gapDays) {
    const gap = gapDays == null ? 21 : gapDays;
    const map = {};
    occ.forEach(o => {
      const k = annualKey(o.item.title);
      if (k.length < 4) return;
      (map[o.dept + '|' + k] = map[o.dept + '|' + k] || []).push(o);
    });
    const out = {};
    Object.entries(map).forEach(([k, list]) => {
      const byY = {};
      list.forEach(o => { (byY[o.week.slice(0, 4)] = byY[o.week.slice(0, 4)] || []).push(dayOfYear(o.week)); });
      const ys = Object.keys(byY).sort();
      if (ys.length < 2) return;
      let min = 999;
      for (let i = 0; i < ys.length - 1; i++)
        for (const a of byY[ys[i]]) for (const b of byY[ys[i + 1]]) min = Math.min(min, Math.abs(a - b));
      if (min <= gap) out[k] = list.slice().sort((x, y) => x.week < y.week ? -1 : 1);
    });
    return out;
  }
  /* 현안에 연례 정보 부착용: 이 현안이 속한 연례 그룹의 '작년 같은 시기' 발생 */
  function annualInfo(issue, groups) {
    const k = issue.dept + '|' + annualKey(issue.title);
    const g = groups[k];
    if (!g) return null;
    const curYear = issue.last.slice(0, 4);
    const prior = g.filter(o => o.week.slice(0, 4) < curYear);
    if (!prior.length) return null;
    const last = prior[prior.length - 1];
    return { key: k, years: [...new Set(g.map(o => o.week.slice(0, 4)))], prior, lastYear: last };
  }

  /* ───────── ③ 회차별 진행 — 같은 업무, 내용만 바뀜 ─────────
     "◦ 일 시: ..." 형태를 라벨/값으로 쪼개 고정 항목과 회차별 변동 항목을 가른다.
     5회 반복 블록을 [공통 1개 + 회차 표]로 접기 위한 데이터. */
  function splitLabeled(txt) {
    const m = String(txt).match(/^\s*([가-힣A-Za-z][가-힣A-Za-z\s]{0,9}?)\s*[:：]\s*(.+)$/);
    if (!m) return null;
    const label = m[1].replace(/\s+/g, '');
    if (label.length < 2 || label.length > 8) return null;
    return { label, val: m[2].trim() };
  }
  function roundsView(issue) {
    if (issue.list.length < 3) return null;
    const byLabel = {}, order = [];
    issue.list.forEach(o => {
      o.item.lines.forEach(l => {
        const s = splitLabeled(l.txt);
        if (!s) return;
        if (!(s.label in byLabel)) { byLabel[s.label] = []; order.push(s.label); }
        byLabel[s.label].push({ week: o.week, val: s.val });
      });
    });
    if (!order.length) return null;
    const n = issue.list.length;
    const fixed = [], varying = [];
    order.forEach(k => {
      const vals = byLabel[k].map(x => x.val);
      const uniq = new Set(vals);
      if (uniq.size === 1 && vals.length >= n - 1) fixed.push({ label: k, val: vals[0] });
      else if (uniq.size > 1) varying.push(k);
    });
    if (!varying.length) return null;
    const rows = issue.list.map(o => {
      const cells = {};
      o.item.lines.forEach(l => { const s = splitLabeled(l.txt); if (s && varying.includes(s.label)) cells[s.label] = s.val; });
      /* 라벨 없이 "7. 27.(월) 13:00~, 연구지원센터/ 20명" 처럼 한 줄로 적은 주차가 섞인다.
         그런 회차는 원문 줄을 그대로 보여준다. */
      const raw = Object.keys(cells).length ? null : o.item.lines.map(l => l.txt).join(' / ');
      return { week: o.week, title: o.item.title, cells, raw };
    }).reverse();
    return { fixed, varying, rows, count: n };
  }

  /* ───────── ④ 유사업무 — 기간 창 + 사유 표시 ─────────
     흔한 행정 낱말(점검·추진·실시…)만 겹친 것을 '유사'라 부르면 신뢰를 잃는다.
     문서 전체에서 드물게 쓰인 낱말일수록 높게 친다(IDF). */
  const STOPWORDS = new Set(['추진', '실시', '개최', '운영', '계획', '사업', '관련', '위한', '통한', '대한', '업무',
    '현황', '보고', '시행', '지원', '관리', '및', '등', '대비', '따른', '기간', '대상', '내용', '결과', '완료', '신청', '접수']);
  function tokenize(title) {
    const t = String(title).replace(/[^가-힣A-Za-z0-9\s]/g, ' ');
    const out = new Set();
    t.split(/\s+/).forEach(w => {
      if (w.length < 2) return;
      const bare = w.replace(/20\d{2}년?도?|제\d+회|\d+차/g, '');
      if (bare.length < 2 || STOPWORDS.has(bare)) return;
      out.add(bare);
    });
    return out;
  }
  /* 전체 현안 제목으로 문서빈도(df) 표를 만든다 */
  function buildIdf(issues) {
    const df = {};
    issues.forEach(i => tokenize(i.title).forEach(w => df[w] = (df[w] || 0) + 1));
    return { df, n: issues.length };
  }
  /* 유사업무 검색 — 결과를 '왜 묶였는지'로 계층화한다.
       same   : 같은 현안을 다른 과도 함께 함 (제목 정규화 키가 포함관계)
       annual : 작년 이맘때 다른 과가 같은 일을 함
       recent : 요즘(기준일 ±windowWeeks) 비슷한 일 — 같은 유형 + 특징 낱말 겹침
       past   : 같은 근거지만 시기가 떨어진 지난 사례 (기본 접힘)
     기간으로 잘라 버리지 않고 구간을 나눠 보여준다. 여름 업무를 보는데
     작년 겨울 건이 같은 목록에 섞이던 문제를 이렇게 푼다. */
  function findSimilar(base, issues, idf, opts) {
    opts = opts || {};
    const windowWeeks = opts.windowWeeks == null ? 8 : opts.windowWeeks;  /* 0 이면 기간 제한 없음 */
    const anchor = opts.anchor || base.last;
    const bt = tokenize(base.title);
    const weight = w => 1 / Math.log(2 + (idf.df[w] || 1));
    /* '점검'(186건) '교육'(102건) '봉화군'(211건) 처럼 어디에나 나오는 말은
       겹쳐도 의미가 없다. 전체의 5%를 넘으면 판단 근거에서 뺀다. */
    const GENERIC_AT = Math.max(20, idf.n * 0.05);
    const distinctive = w => (idf.df[w] || 1) <= GENERIC_AT;
    const MIN_SCORE = 0.85;   /* 낱말 2개가 겹치되 최소 하나는 제법 드물어야 넘는 값 */
    const near = w => {
      if (!windowWeeks) return true;
      const diff = Math.abs(d2(w) - d2(anchor)) / 864e5 / 7;
      return diff <= windowWeeks;
    };
    /* 연중 같은 시기(연도 무시) 판정 — 작년 자료 참고용 */
    const sameSeason = w => Math.abs(dayOfYear(w) - dayOfYear(anchor)) <= 21
      || Math.abs(dayOfYear(w) - dayOfYear(anchor)) >= 344;

    const out = [];
    const baseAnn = annualKey(base.title);
    issues.forEach(iss => {
      if (iss === base || iss.dept === base.dept) return;
      const shared = [...tokenize(iss.title)].filter(w => bt.has(w));
      /* (a) 같은 현안 계열 — 제목 정규화 키가 포함관계 */
      const s = base.key.length < iss.key.length ? base.key : iss.key;
      const l = base.key.length < iss.key.length ? iss.key : base.key;
      if (s.length >= 6 && l.includes(s)) {
        out.push({ iss, kind: 'same', score: 1000, shared });
        return;
      }
      /* (b) 연례 — 같은 일을 작년 이맘때 다른 과가 */
      if (annualKey(iss.title) === baseAnn && sameSeason(iss.last)) {
        out.push({ iss, kind: 'annual', score: 900, shared });
        return;
      }
      /* (c) 비슷한 업무 — 특징적인 낱말이 겹칠 것. 유형이 같으면 가산. */
      if (shared.length < 2) return;
      const key = shared.filter(distinctive);
      if (!key.length) return;                           /* 흔한 낱말만 겹치면 제외 */
      let score = shared.reduce((a, w) => a + weight(w), 0);
      if (iss.type === base.type) score += 0.25;
      if (score < MIN_SCORE) return;
      out.push({
        iss, kind: near(iss.last) ? 'recent' : 'past',
        sameType: iss.type === base.type,
        score, shared, keyWords: key
      });
    });
    out.sort((a, b) => b.score - a.score || (a.iss.last < b.iss.last ? 1 : -1));
    return out;
  }

  /* ───────── ⑤ 지속성 지표 평문화 ─────────
     '연속성 0.04' 같은 숫자는 읽는 사람에게 뜻이 전달되지 않는다.
     같은 정보를 문장으로 바꾼다. */
  function persistenceSentence(issue, weekStart) {
    const p = persistence(issue, weekStart);
    if (p.weeks === 1) {
      return p.weeksSince <= 0 ? '이번 주에 처음 올라옴'
        : `${fmtWeekKo(issue.last)}에 한 번 올라온 뒤 ${p.weeksSince}주째 없음`;
    }
    const 최근 = p.weeksSince <= 0 ? '이번 주에도 올라옴'
      : p.weeksSince === 1 ? '지난주가 마지막'
        : `${p.weeksSince}주째 안 올라옴`;
    return `${fmtWeekKo(issue.first)}부터 ${p.span}주 동안 ${p.weeks}번 올라옴 · ${최근}`;
  }
  function fmtWeekKo(w) { const d = d2(w); return `${d.getFullYear()}. ${d.getMonth() + 1}월`; }

  /* ═══════════════════════════════════════════════════════════════
     군민용 분류 — 달력 / 지역 / 주제 / 대상
     "이번 주 봉화군에서 나와 상관있는 일이 뭔가"를 찾아가게 하는 축.
     ═══════════════════════════════════════════════════════════════ */

  /* ── 지역: 읍·면 10곳 ── */
  const REGIONS = ['봉화읍', '물야면', '봉성면', '법전면', '춘양면', '소천면', '석포면', '재산면', '명호면', '상운면'];
  /* 읍면 이름 없이 시설명만 적는 경우가 많다. 자주 나오는 곳을 지역에 붙여 둔다. */
  const VENUE_REGION = {
    '봉화군청': '봉화읍', '군청': '봉화읍', '내성천': '봉화읍', '내성리': '봉화읍',
    '봉화상설시장': '봉화읍', '봉화정자문화생활관': '봉화읍', '평생학습관': '봉화읍',
    '청소년센터': '봉화읍', '다문화커뮤니티센터': '봉화읍', '군민행복센터': '봉화읍',
    '봉화어울림센터': '봉화읍', '문화예술회관': '봉화읍', '은어축제장': '봉화읍',
    '농업기술센터': '봉화읍', '미래농업교육관': '봉화읍', '생활과학연수관': '봉화읍',
    '보건소': '봉화읍', '봉화역': '봉화읍', '체육관': '봉화읍', '국민체육센터': '봉화읍',
    '청량산': '명호면', '분천': '소천면', '백두대간수목원': '춘양면', '춘양목': '춘양면'
  };
  function regionsOf(item) {
    const t = item.title + ' ' + item.lines.map(l => l.txt).join(' ') + ' ' +
      (item.box ? item.box.lines.join(' ') : '');
    const out = new Set();
    REGIONS.forEach(r => { if (t.includes(r)) out.add(r); });
    if (!out.size) {
      for (const [v, r] of Object.entries(VENUE_REGION)) if (t.includes(v)) { out.add(r); break; }
    }
    /* 특정 읍면이 안 잡히면 '공통'으로 둔다.
       관내 전역을 뜻하는 것도, 원문에 장소가 아예 없는 것도 여기에 들어간다.
       빈칸으로 두면 지역으로 찾을 때 아예 보이지 않게 되므로 한 곳에 모은다. */
    return out.size ? [...out] : ['공통'];
  }

  /* ── 대상: 누가 참여하거나 해당되는 일인가 ── */
  const AUDIENCES = [
    { k: '어르신', icon: '🧓', re: /노인|어르신|경로당|치매|고령|실버|65세|장수|요양/ },
    { k: '아이·청소년', icon: '🧒', re: /아동|어린이|청소년|유아|초등|중학교|고등학교|학생|보육|어린이집|유치원|드림스타트|돌봄/ },
    { k: '청년', icon: '🧑', re: /청년|대학생|20대|30대|취업|일자리|창업/ },
    { k: '농업인', icon: '👨‍🌾', re: /농업인|농가|농민|귀농|귀촌|영농|축산|과수|시설하우스|재배|작물|농기계|산림|임업/ },
    { k: '여성·가족', icon: '👨‍👩‍👧', re: /여성|가족|다문화|출산|임신|양육|한부모|보육료|결혼/ },
    { k: '복지·돌봄', icon: '🤝', re: /장애인|기초생활|수급자|취약계층|복지시설|자활|저소득|돌봄|사회복지/ },
    { k: '소상공인', icon: '🏪', re: /소상공인|상인|점포|전통시장|상설시장|기업|공장|사업장/ },
    /* [신규] 채용 글 — 뽑는 자리를 찾는 사람 */
    { k: '구직자', icon: '🧑‍💼', re: /채용|응시자|합격자|필기시험|면접시험|서류전형|임용후보|공개경쟁/ },
    /* [신규] 특정 계층으로 좁힐 수 없는 일 — 담당자 확인 규칙(2026-08)
       · 계절근로자·외국인 : 농가뿐 아니라 식당 등도 쓰므로 전체
       · 이장회의·이장연합회 : 내부 회의지만 이장님들이 보므로 전체
       · 수강생 : 교육에 따라 청년·농업인·소상공인·구직자 누구나
       · 주민세·납세자 : 군민 전체 */
    { k: '주민 누구나', icon: '👥', re: /계절근로자|외국인|이장회의|이장연합회|수강생|주민세|납세자/ }
  ];
  /* [신규] 제목에서만 판단하는 대상 — 본문에 스쳐 나오는 말로 잘못 붙는 것을 막는다.
     (예: 일정란의 "[이장회의 시]", 본문 어딘가의 "채용"이 제목과 무관하게 걸리던 문제) */
  const TITLE_ONLY = new Set(['구직자', '주민 누구나']);
  function audiencesOf(item) {
    const title = item.title;
    const full = title + ' ' + item.lines.map(l => l.txt).join(' ');
    const out = AUDIENCES.filter(a => a.re.test(TITLE_ONLY.has(a.k) ? title : full)).map(a => a.k);
    /* 근로자·기간제근로자는 글의 성격에 따라 갈린다 —
       뽑는 글이면 구직자, 그 밖(처우·안전·교육 안내 등)이면 전체. 제목만 본다. */
    if (/근로자/.test(title)) {
      const hiring = /채용|모집|응시|합격|면접|필기|서류전형|임용|시험\s*시행/.test(title);
      const k = hiring ? '구직자' : '주민 누구나';
      if (!out.includes(k)) out.push(k);
    }
    return out;
  }

  /* ── 주제: 군민이 찾는 말로 ── */
  const TOPICS = [
    { k: '축제·행사', icon: '🎪', re: /축제|행사|공연|전시|체험|캠프|한마당|대회|박람회|음악회|개막|기념식|페스티벌/ },
    { k: '교육·강좌', icon: '📚', re: /교육|강좌|강의|아카데미|수강|학교|연수|워크숍|설명회|간담회|특강|프로그램/ },
    /* '포장'은 임산물 포장재처럼 다른 뜻으로도 쓰여 도로 포장 표현만 잡는다 */
    { k: '공사·정비', icon: '🚧', re: /공사|정비사업|보수|철거|가설|시설\s*개선|준공|착공|굴착|도로\s*통제|아스콘|덧씌우기|포장공사|노후관|상수도|하수도/ },
    { k: '신청·접수', icon: '📋', re: /신청|접수|모집|공모|수요조사|지급|지원사업|보조금|선정|공고|등록/ },
    { k: '점검·안전', icon: '🦺', re: /점검|단속|검사|안전|방역|소독|예방|대비|순찰|재난|화재|폭염|한파|호우|태풍/ },
    { k: '건강·의료', icon: '🩺', re: /건강|보건|진료|접종|검진|의료|치료|상담|위생|식중독/ },
    { k: '민원·인허가', icon: '🗂️', re: /민원|인\s*·?\s*허가|허가|신고\s*처리|등록|증명|발급|상담창구|지적|측량|공시지가/ }
  ];
  function topicsOf(item) {
    const t = item.title + ' ' + item.lines.map(l => l.txt).join(' ');
    const out = TOPICS.filter(x => x.re.test(t)).map(x => x.k);
    return out.length ? out : ['그 밖의 일'];
  }

  /* ── 군민 참여 가능성 ──
     '부군수 주재 간부회의'처럼 내부 업무는 군민 화면 위로 올리지 않는다.
     확실히 가릴 방법은 없으니 순서를 낮추는 데만 쓴다. */
  const INTERNAL_RE = /직원|공무원|간부|실과소|부서장|팀장|과장|주재|내부|의회|행정사무감사|복무|인사발령|예산\s*편성|과세대장|정산|제출\s*협조|보고회/;
  const OPEN_RE = /주민|군민|참여|신청|접수|모집|관람|무료|누구나|희망자|이용/;
  function citizenScore(item) {
    const t = item.title + ' ' + item.lines.map(l => l.txt).join(' ');
    let s = 0;
    if (OPEN_RE.test(t)) s += 2;
    if (INTERNAL_RE.test(t)) s -= 2;
    return s;
  }

  /* ── 달력: 이 항목이 그 날짜에 걸리는가 ──
     그냥 기간에 걸치기만 하면 세면, '8월 10일까지 접수' 같은 건이 이레 내내 잡혀
     날짜별 숫자가 다 비슷해진다. 군민이 달력에서 보고 싶은 건 '그날 열리는 일'이다.

     그래서 성격을 나눈다.
       현장에서 벌어지는 일(축제·행사, 점검, 진료 등) → 기간 안 모든 날에 표시
       상태가 이어지는 일(접수·공사 등)              → 시작하는 날에만 표시 */
  const DAILY_TOPIC = /축제·행사|점검·안전|건강·의료|교육·강좌/;
  function coversDate(item, occWeek, day) {
    const r = parseDateRange(item, occWeek);
    if (!r || !r.start) return false;
    const end = r.end || r.start;
    if (r.start > day || end < day) return false;
    if (r.start === day) return true;                       /* 시작하는 날은 언제나 */
    /* 두 주를 넘기는 건 '상시 운영'에 가깝다 — 달력을 채우기만 하므로 시작일만 남긴다 */
    const days = (d2(end) - d2(r.start)) / 864e5 + 1;
    if (days > 14) return false;
    return topicsOf(item).some(t => DAILY_TOPIC.test(t));   /* 이어지는 날은 성격에 따라 */
  }
  /* 주(월~일) 7일 중 걸리는 날짜 목록 */
  function daysInWeek(item, occWeek, weekStart) {
    const out = [];
    const ws = d2(weekStart);
    for (let i = 0; i < 7; i++) {
      const d = ymd(addD(ws, i));
      if (coversDate(item, occWeek, d)) out.push(d);
    }
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════
     한 줄 요약 — 목록에서 제목만 보고는 판단이 안 될 때
     제목 아래 한 줄로 "언제·어디서·얼마나"를 붙여 준다.
     상세를 열지 않고도 훑을 수 있게 하는 것이 목적이다.
     ═══════════════════════════════════════════════════════════════ */
  /* 라벨을 떼어 값만 남긴다.
     "기 간: 2026. 7. 25." 뿐 아니라, 줄바꿈이 붙어 "기간2026. 7. 25." 처럼
     콜론 없이 이어진 것도 있어 그 경우도 함께 처리한다. */
  const _LABEL_WORDS = '기\\s*간|일\\s*시|일\\s*자|장\\s*소|위\\s*치|대\\s*상|인\\s*원|참\\s*석|내\\s*용|기\\s*한';
  const _strip = t => String(t)
    .replace(/^[^:：]{0,12}[:：]\s*/, '')
    .replace(new RegExp('^(?:' + _LABEL_WORDS + ')(?=\\s*\\d|\\s*20\\d{2})', ''), '')
    .trim();
  function pickLine(item, re) {
    const l = item.lines.find(x => re.test(x.txt));
    return l ? _strip(l.txt) : '';
  }
  /* 값이 길면 앞부분만 — 목록 한 줄을 넘기지 않도록 */
  const _cut = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

  function briefOf(item) {
    const when = pickLine(item, /^(일\s*시|기\s*간|일\s*자|기\s*한|마\s*감|점검기간|접수기간|모집기간|교육기간|운영기간|사업기간|공사기간|용역기간|신청기한)/);
    const place = pickLine(item, /^(장\s*소|위\s*치)/);
    const scale = pickLine(item, /^(참석인원|인\s*원|대\s*상|사\s*업\s*비|총사업비|사업비)/);
    const bits = [];
    if (when) bits.push(_cut(when.replace(/\s*\[[^\]]*\]\s*$/, ''), 34));
    if (place) bits.push(_cut(place, 26));
    if (scale && bits.length < 2) bits.push(_cut(scale, 22));
    if (bits.length) return bits.join(' · ');
    /* 일정·장소가 없으면 무슨 일인지라도. 그것도 없으면 첫 줄을 그대로. */
    const main = pickLine(item, /^(주요\s*내용|내\s*용|추진내용|점검내용|사업내용|협조사항)/);
    if (main) return _cut(main, 52);
    const first = item.lines.find(l => l.txt.trim());
    return first ? _cut(_strip(first.txt) || first.txt.trim(), 52) : '';
  }

  /* 상세용 요약 — 아이콘 붙은 서너 줄 */
  function digestOf(item) {
    const rows = [];
    const when = pickLine(item, /^(일\s*시|기\s*간|일\s*자|기\s*한|마\s*감|점검기간|접수기간|모집기간|교육기간|운영기간|사업기간|공사기간|용역기간|신청기한)/);
    const place = pickLine(item, /^(장\s*소|위\s*치)/);
    const who = pickLine(item, /^(대\s*상|참석대상|참석인원|참\s*석|인\s*원|교육대상|모집대상|지원대상)/);
    const cost = pickLine(item, /^(사\s*업\s*비|총사업비|사업비|예\s*산|용역비)/);
    if (when) rows.push(['📅', when]);
    if (place) rows.push(['📍', place]);
    if (who) rows.push(['👥', who]);
    if (cost) rows.push(['💰', cost]);
    return rows;
  }

  /* ═══════════════════════════════════════════════════════════════
     업무 성격 — 챙겨야 할 일과 늘 하는 일을 가른다
     「인·허가관련 민원처리계획」처럼 종합민원실이 매주 올리는 관리 업무는
     새 사업이 아니라 늘 하는 일이다. 이런 것이 '오래 안 보이는 일' 목록
     맨 위에 올라오면 군수가 헛걸음한다.
     ═══════════════════════════════════════════════════════════════ */
  /* '수시 재산등록'처럼 제도 이름에 든 말은 빼야 한다 — 그건 늘 하는 일이 아니다 */
  const ROUTINE_RE = /민원\s*처리|계속\s*추진|상시\s*운영|정기\s*점검|일상\s*점검|월례회|정례회|정례\s*회의|매월|매주|과세대장|대장\s*정비/;

  function natureOf(issue, annualGroupsMap) {
    /* ① 늘 하는 일 — 제목이 말해 주거나, 오래 꾸준히 되풀이된 것 */
    if (ROUTINE_RE.test(issue.title)) return '상시';
    const p = persistence(issue, issue.last);
    if (issue.weeks >= 8 && p.density >= 0.45) return '상시';

    /* ② 매년 이맘때 — 작년 것을 참고하면 된다 */
    if (annualGroupsMap && annualInfo(issue, annualGroupsMap)) return '연례';

    /* ③ 지원·보조 — 군민에게 돈·물자가 나가는 일 */
    if (/지원사업|보조금|지원금|보조사업|지원\s*계획|수요조사|신청\s*접수|지급/.test(issue.title)) return '지원';

    /* ④ 그 밖은 그때그때 생긴 일 */
    return '단발';
  }
  const NATURES = [
    { k: '단발', icon: '📌', desc: '그때그때 생긴 일' },
    { k: '지원', icon: '💳', desc: '보조금·지원사업' },
    { k: '연례', icon: '🔁', desc: '매년 이맘때' },
    { k: '상시', icon: '♾️', desc: '늘 하는 관리 업무' }
  ];

  /* ═══════════════════════════════════════════════════════════════
     키워드 보기 — 1년 동안 자주 거론된 사안
     '봉화군'(211) '점검'(186) 같은 행정 일반어는 무엇에 관한 일인지
     말해 주지 않으므로 뺀다. 남는 것이 실제 사안어다.
     ═══════════════════════════════════════════════════════════════ */
  const KW_STOP = new Set([
    '봉화군', '봉화', '경상북도', '경북', '상반기', '하반기', '참석', '참가', '안내', '협조', '제출',
    '대상자', '현장', '지도', '수립', '운영', '실시', '추진', '개최', '시행', '지원', '관리', '점검',
    '교육', '행사', '회의', '조사', '모집', '홍보', '정비', '설치', '지급', '예방', '사업', '계획',
    '프로그램', '지원사업', '조성사업', '용역', '수요조사', '간담회', '워크숍', '캠페인', '설명회',
    '주민설명회', '안전점검', '현장점검', '환경정비', '위원회', '심의회', '보고회', '평가', '선정',
    '변경', '확대', '개선', '강화', '완료', '결과', '기간', '대상', '내용', '방법', '기준',
    '찾아가는', '공고', '신청접수', '부과', '활성화', '시설', '대상지', '정기분', '지도점검',
    '합동점검', '전수조사', '실태조사', '점검계획', '추진계획', '시행계획', '연장', '재개',
    '신규', '기존', '일원', '관내', '전체', '해당', '관련', '이상', '이하', '이용', '제공'
  ]);

  /* issues 전체에서 사안 키워드를 빈도순으로. 너무 흔하거나 너무 드문 것은 뺀다. */
  function topKeywords(issues, opts) {
    opts = opts || {};
    const min = opts.min || 4;
    const maxRatio = opts.maxRatio || 0.035;   /* 전체의 3.5%를 넘으면 일반어로 본다 */
    const limit = opts.limit || 40;
    const df = {};
    issues.forEach(i => tokenize(i.title).forEach(w => {
      if (KW_STOP.has(w) || w.length < 2) return;
      df[w] = (df[w] || 0) + 1;
    }));
    const cap = Math.max(min + 1, Math.floor(issues.length * maxRatio));
    return Object.entries(df)
      .filter(([w, c]) => c >= min && c <= cap)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .slice(0, limit)
      .map(([w, c]) => ({ w, n: c }));
  }
  /* 이 현안이 그 키워드를 달고 있나 */
  function hasKeyword(issue, w) { return tokenize(issue.title).has(w); }

  /* ───────── 기타 공용 ───────── */
  const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return {
    DOW, d2, fmtK, addD, isoW, mondayOf, ymd, weekLabel, weekKo,
    normKey, TYPES, LABELS, PUBLIC_TYPE_LABELS, guessType,
    parseProg, groupIssues, persistence, persistenceLabel,
    parsePeriodEnd, issueEndDate, issueStatus, statusByRecency,
    sparkline, progStage, escH,
    /* 사용성 검토 반영분 */
    parseDateRange, periodStatus, issuePeriodStatus, issueDateRange, PERIOD_LABELS_KO,
    annualKey, annualGroups, annualInfo, dayOfYear,
    roundsView, splitLabeled,
    tokenize, buildIdf, findSimilar, STOPWORDS,
    persistenceSentence, fmtWeekKo,
    /* 군민용 분류 */
    REGIONS, VENUE_REGION, regionsOf, AUDIENCES, audiencesOf, TOPICS, topicsOf,
    citizenScore, coversDate, daysInWeek,
    /* 한 줄 요약 */
    pickLine, briefOf, digestOf,
    /* 업무 성격 · 키워드 */
    natureOf, NATURES, ROUTINE_RE, topKeywords, hasKeyword, KW_STOP
  };
});
