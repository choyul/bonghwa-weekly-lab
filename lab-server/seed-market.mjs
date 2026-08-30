/* ═══════════════════════════════════════════════════════════════
   seed-market.mjs — 시트에 있던 샘플을 D1 로 옮기는 씨앗 만들기.

       node seed-market.mjs > seed-market.sql
       npx wrangler d1 execute bonghwa-lab --remote --file=seed-market.sql

   실제 운영 자료를 옮길 때도 같은 방법을 쓴다 —
   data/sample_market.csv 자리에 진짜 시트 CSV 를 내려받아 두면 된다.
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const q = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const sha = (id, key) => createHash('sha256').update(id + ':' + key).digest('hex');
const rid = p => p + '_' + randomUUID().replace(/-/g, '').slice(0, 8);

function parseCSV(text) {
  const rows = []; let row = [], val = '', qq = false;
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (qq) { if (ch === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else qq = false; } else val += ch; }
    else if (ch === '"') qq = true;
    else if (ch === ',') { row.push(val); val = ''; }
    else if (ch === '\n') { row.push(val); rows.push(row); row = []; val = ''; }
    else val += ch;
  }
  if (val !== '' || row.length) { row.push(val); rows.push(row); }
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = (r[i] || '').trim()); return o; });
}

const items = parseCSV(readFileSync('../data/sample_market.csv', 'utf8'));
const orders = {};
parseCSV(readFileSync('../data/sample_orders.csv', 'utf8'))
  .forEach(o => orders[o.id] = +(o['주문수량합계'] || 0) || 0);

/* 표시명 하나가 판매자 한 사람이다 */
const sellers = new Map();
let no = 100;
for (const r of items) {
  const nick = r['판매자표시명'];
  if (!nick || sellers.has(nick)) continue;
  no++;
  sellers.set(nick, {
    id: rid('s'), no: String(no).padStart(4, '0'), nick,
    key: 'DEMO-' + String(no) + '-KEY',          /* 씨앗 자료 전용. 실제 신청은 서버가 만든다 */
    name: nick.split(' ').pop(), phone: '0100000' + String(no).padStart(4, '0'),
    town: nick.split(' ')[0], crops: r['품목'],
  });
}
/* 마지막 한 사람은 '대기'로 둔다 — 담당자 승인 화면을 눈으로 볼 수 있게 */
const list = [...sellers.values()];
list.forEach((s, i) => s.state = (i === list.length - 1) ? '대기' : '승인');

const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
const out = [];
out.push('-- 샘플 자료 (테스트본 전용). 다시 넣기 전에 지운다.');
out.push('DELETE FROM market;');
out.push('DELETE FROM seller;');
for (const s of list) {
  out.push('INSERT INTO seller (id,no,nick,keyhash,name,phone,town,crops,agrix,memo,state,at,okAt,firstOk) VALUES (' +
    [q(s.id), q(s.no), q(s.nick), q(sha(s.id, s.key)), q(s.name), q(s.phone), q(s.town), q(s.crops),
     q(''), q('샘플 자료'), q(s.state), q(now), q(s.state === '승인' ? now : ''),
     s.state === '승인' ? 1 : 0].join(',') + ');');
}
/* 두 건은 '대기'로 둔다 — 글 승인 화면에도 볼 것이 있어야 한다.
   깻잎 글은 설명에 전화·계좌가 들어 있어, 승인 눌렀을 때 서버가 막는지 볼 수 있다. */
const HOLD = new Set(['20260830-04', '20260830-05']);
for (const r of items) {
  const s = sellers.get(r['판매자표시명']) || {};
  const state = HOLD.has(r.id) ? '대기'
    : ((r['노출'] || 'Y').toUpperCase() === 'N' ? '숨김' : (r['상태'] || '판매중'));
  const data = {};
  ['등록일', '품목', '설명', '규격', '가격', '수량', '대리게시', '수령장소', '수령일',
   '수령시각', '마감일시', '주문링크', '원글링크', '상태'].forEach(k => { if (r[k]) data[k] = r[k]; });
  out.push('INSERT INTO market (id,seller,nick,data,state,sold,reports,memo,at,edited) VALUES (' +
    [q(rid('m')), q(s.state === '승인' ? s.id : ''), q(r['판매자표시명']),
     q(JSON.stringify(data)), q(state), orders[r.id] || 0, 0, q('시트에서 옮김 (' + r.id + ')'),
     q(r['등록일'] ? r['등록일'] + ' 09:00' : now), q('')].join(',') + ');');
}
console.log(out.join('\n'));
