/* ═══════════════════════════════════════════════════════════════
   parse.js — 주간업무계획 md → 구조화 데이터 (Node)
   입력: kordoc 이 변환한 md 파일 (파일명 접두 YYYY-MM-DD_ = 주차 시작일)
   출력: { week, entries:[{dept, sec, item:{title,team,type,lines,box}}], skipped }

   문서 구조 (54주 표본조사 결과):
   - 목차: "01. 기획예산실\t 1"  (PDF 변환본은 "01. 기획예산실 ····1")
   - 부서 헤더: 부서명 단독 라인 (PDF 변환본은 "# 부서명")
   - 섹션 표: "| 1 | 주요 시책현안 |"  (PDF 변환본은 단독 라인)
   - 업무: "□ 제목"  / 본문: "◦ ..."(lv1), "- ..."(lv2)
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const BW = require('../core.js');

/* 봉화군 읍면 — 목차에 없어도 섹션 헤더로 인식 */
const EUPMYEON = ['봉화읍', '물야면', '봉성면', '법전면', '춘양면', '소천면', '석포면', '재산면', '명호면', '상운면'];

/* '정부 정책동향' 류 섹션은 군 업무가 아니라 정부 동향 요약이므로 현안 추적에서 제외 */
const EXCLUDED_SECS = /정책\s*동향/;

function unesc(s) { return s.replace(/\\([~.\-()\[\]*_#])/g, '$1'); }
function squash(s) { return s.replace(/\s+/g, ''); }

function parseWeekMd(text, week) {
  const lines = text.split('\n');

  /* 1) 목차에서 부서 목록 추출 (두 형식 모두) */
  const deptSet = new Set();
  for (const ln of lines) {
    let m = ln.match(/^(\d{2})\.\s*([^\t·]+?)\s*(?:\t|·{2,})/);
    if (m) { const name = squash(m[2]); if (/^[가-힣]{2,15}$/.test(name)) deptSet.add(name); }
  }
  EUPMYEON.forEach(d => deptSet.add(d));

  const entries = [];
  const skipped = { noDept: 0, excludedSec: 0 };
  let dept = null, sec = null, cur = null, inHtmlTable = false;

  const flush = () => {
    if (!cur) return;
    /* 제목만 있고 본문 없는 항목도 유지 (계속 추진 한 줄 항목 존재) */
    cur.item.type = BW.guessType(cur.item);
    entries.push(cur);
    cur = null;
  };

  for (let raw of lines) {
    let s = raw.replace(/\r$/, '').trim();
    if (!s) continue;
    if (/^!\[/.test(s)) continue;                       /* 이미지 */
    if (/^\|[\s:-]+\|/.test(s.replace(/-/g, '-'))) continue; /* 표 구분선 */

    /* kordoc 이 복잡한 표(셀 병합)를 HTML <table>로 내보내는 경우:
       태그를 벗겨 셀 텍스트만 box.lines 로 수집. 제목·본문 오염 방지. */
    if (/<table\b/i.test(s)) inHtmlTable = true;
    if (inHtmlTable) {
      if (cur) {
        const txt = unesc(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        if (txt) (cur.item.box = cur.item.box || { lines: [] }).lines.push(txt);
      }
      if (/<\/table>/i.test(s)) inHtmlTable = false;
      continue;
    }
    /* 표 밖의 파편 HTML 태그 라인도 제목에 붙이지 않는다 */
    if (/^<[^>]+>/.test(s) && !/[가-힣]/.test(s.replace(/<[^>]+>/g, ''))) continue;

    /* 부서 헤더: 단독 라인 or "# 부서명" */
    const hd = s.replace(/^#+\s*/, '');
    if (deptSet.has(squash(hd)) && squash(hd) === squash(hd.replace(/[^가-힣\s]/g, ''))) {
      flush(); dept = squash(hd); sec = null; continue;
    }

    /* 섹션: "| 1 | 주요 시책현안 |" 표 or 단독 라인 */
    let m = s.match(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|$/);
    if (m) { flush(); sec = m.group ? m.group(1) : m[1]; continue; }
    if (/^(주요\s*시책\s*현안|주요\s*행사|정부\s*정책\s*동향|주요\s*정책\s*동향|주요\s*업무\s*계획)$/.test(s)) {
      flush(); sec = s; continue;
    }

    /* 업무 시작: "□ 제목" ("#### □ 제목" 포함) */
    m = s.match(/^#*\s*□\s*(.+)$/);
    if (m) {
      flush();
      if (!dept) { skipped.noDept++; continue; }
      if (sec && EXCLUDED_SECS.test(sec)) { skipped.excludedSec++; continue; }
      cur = { dept, sec: sec || '', item: { title: unesc(m[1]).trim(), team: '', type: '기타', lines: [], box: null } };
      continue;
    }
    if (!cur) continue;

    /* 표 라인 → box.lines (공정률이 표 안에 기재되는 경우 대비) */
    if (/^\|.*\|$/.test(s)) {
      const cells = s.slice(1, -1).split('|').map(c => unesc(c.trim())).filter(Boolean);
      if (cells.length) { (cur.item.box = cur.item.box || { lines: [] }).lines.push(cells.join(' ')); }
      continue;
    }

    /* 본문 라인 */
    m = s.match(/^[◦○•]\s*(.*)$/);
    if (m) { cur.item.lines.push({ lv: 1, txt: unesc(m[1]) }); continue; }
    m = s.match(/^-\s*(?:-\s*)?(.*)$/);
    if (m) { cur.item.lines.push({ lv: 2, txt: unesc(m[1]) }); continue; }
    m = s.match(/^[▸▶]\s*(.*)$/);
    if (m) { cur.item.lines.push({ lv: 2, txt: unesc(m[1]) }); continue; }

    /* 마커 없는 라인: 직전 라인(또는 제목)에 이어붙임 — 줄바꿈으로 끊긴 문장.
       인라인 HTML 태그는 제거해 제목 오염을 막는다 */
    const cont = unesc(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!cont) continue;
    if (cur.item.lines.length) cur.item.lines[cur.item.lines.length - 1].txt += ' ' + cont;
    else cur.item.title += ' ' + cont;
  }
  flush();
  return { week, entries, skipped };
}

/* 파일명에서 주차 추출: "2026-07-20_주간업무계획(...).md" */
function weekOfFilename(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

module.exports = { parseWeekMd, weekOfFilename, EUPMYEON };

/* CLI: node parse.js <md파일 또는 폴더> — 파싱 요약 출력 */
if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const target = process.argv[2];
  if (!target) { console.error('usage: node parse.js <file.md | dir>'); process.exit(1); }
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter(f => f.endsWith('.md')).sort().map(f => path.join(target, f))
    : [target];
  let total = 0;
  for (const f of files) {
    const week = weekOfFilename(path.basename(f));
    if (!week) { console.log(`SKIP (주차 없음): ${f}`); continue; }
    const r = parseWeekMd(fs.readFileSync(f, 'utf-8'), week);
    const depts = new Set(r.entries.map(e => e.dept));
    total += r.entries.length;
    console.log(`${week}  업무 ${String(r.entries.length).padStart(3)}건  부서 ${String(depts.size).padStart(2)}  제외(정책동향) ${r.skipped.excludedSec}  부서불명 ${r.skipped.noDept}`);
  }
  console.log(`\n합계 ${total}건 / ${files.length}주`);
}
