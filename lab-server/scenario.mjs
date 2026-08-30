/* ═══════════════════════════════════════════════════════════════
   scenario.mjs — 장터 자율정화 전수 시나리오.

       npx wrangler d1 execute bonghwa-lab --local \
         --config wrangler.jsonc --command "DELETE FROM market;DELETE FROM seller;DELETE FROM report;DELETE FROM device;"
       node scenario.mjs

   정상 5건과 문제 유형마다 5건씩을 실제로 등록·거래·신고·삭제해 본다.
   시간이 걸리는 규칙(72시간 무응답, 수령일+7일, 이의 7일)은
   자료의 시각을 뒤로 돌려 놓고 새벽 청소를 한 번 돌려 확인한다.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const EP = 'http://localhost:8787', CODE = 'bonghwa';
const D = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = (n, h) => D(n) + ' ' + String(h).padStart(2, '0') + ':00';

/* ── 채점판 ── */
const rows = []; let pass = 0, fail = 0;
function ck(group, name, good, got) {
  rows.push({ group, name, good, got: typeof got === 'string' ? got : JSON.stringify(got) });
  good ? pass++ : fail++;
  if (!good) console.error('  ✗', group, '—', name, '→', got);
}

/* ── 서버와 이야기하기 ── */
async function api(path, { method = 'GET', body, key, id, admin } = {}) {
  const h = { 'content-type': 'application/json' };
  if (key) { h['x-lab-key'] = key; h['x-lab-id'] = id; }
  if (admin) h['x-lab-code'] = CODE;
  const r = await fetch(EP + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
let phone = 10000000;
async function join(nick, town) {
  const r = await api('/seller', { method: 'POST', body: {
    name: nick.split(' ').pop(), phone: '010' + (++phone), nick, town, crops: '채소', agree: true } });
  if (!r.id) throw new Error('판매자 등록 실패: ' + JSON.stringify(r));
  return { ...r, hdr: { key: r.key, id: r.id } };
}
async function put(s, item) {
  return api('/market', { method: 'POST', ...s.hdr, body: { data: item } });
}
const ITEM = (품목, over = {}) => ({ 품목, 설명: '직접 기른 ' + 품목 + '입니다.', 규격: '5kg 상자',
  가격: '20000', 수량: '10', 수령장소: '농민회 사무실', 수령일: D(5), 수령시각: '17:30',
  마감일시: T(3, 18), 주문링크: 'https://docs.google.com/forms/d/e/x/viewform', ...over });

/* ── 신고하는 기기 ── 한 기기는 하루 3건까지, 같은 글엔 한 번 ── */
let devn = 0; const used = new Map();
function dev() { return 'devKKKK' + String(++devn).padStart(4, '0'); }
const pool = []; for (let i = 0; i < 200; i++) pool.push(dev());
function pick(mid, n) {                       /* 그 글을 아직 신고하지 않은 기기 n 개 */
  const out = [];
  for (const d of pool) {
    const u = used.get(d) || { n: 0, mids: new Set() };
    if (u.n >= 3 || u.mids.has(mid)) continue;
    u.n++; u.mids.add(mid); used.set(d, u); out.push(d);
    if (out.length === n) break;
  }
  return out;
}
const report = (mid, d, why) => api(`/market/${mid}/report`, { method: 'POST', body: { dev: d, why } });
async function reportBy(mid, why, n = 2) {
  const ds = pick(mid, n); const out = [];
  for (const d of ds) out.push({ d, r: await report(mid, d, why) });
  return out;
}

/* ── 때를 뒤로 돌린다 ── 실제로 사흘을 기다릴 수는 없다 ── */
const sql = [];
function backdate(stmt) { sql.push(stmt); }
function runSQL() {
  if (!sql.length) return;
  writeFileSync('/tmp/scenario-tt.sql', sql.join('\n'));
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'bonghwa-lab', '--local',
    '--config', 'wrangler.jsonc', '--file=/tmp/scenario-tt.sql'], { stdio: 'pipe' });
  sql.length = 0;
}
const cron = () => api('/admin/cron', { method: 'POST', admin: true });
const list = async () => (await api('/market')).items || [];
const find = (items, mid) => items.find(x => x.id === mid);
const one = async (s) => (await api('/seller/me', { ...s.hdr })).me;

/* ═══════════════════════════════════════════════════════════════ */
console.log('\n장터 자율정화 시나리오 — 시작\n');

/* ───── ① 정상 거래 5건 ───── */
const N = [], NM = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`정상 판매자${i}`, '봉화읍'); N.push(s);
  const r = await put(s, ITEM(`정상품목${i}`));
  NM.push(r.id);
  ck('정상', `${i}. 글이 올라감`, !!r.id, r.id || r.error);
}
ck('정상', '첫 글은 24시간 뒤 노출 — 지금은 목록에 없음',
  (await list()).filter(x => NM.includes(x.id)).length === 0, '보이는 글 0건');

/* 새싹은 하루 한 건 */
const dup = await put(N[0], ITEM('두번째'));
ck('정상', '새로 오신 분 — 하루 두 번째 글은 막힘', dup.status === 429, dup.error);

/* 24시간이 지났다고 치자 */
NM.forEach(id => backdate(`UPDATE market SET showAt='' WHERE id='${id}';`));
runSQL();
ck('정상', '24시간 뒤 다섯 건 모두 노출',
  (await list()).filter(x => NM.includes(x.id)).length === 5, '보이는 글 5건');

/* 1~3번: 주문이 다 차서 마감 → 수령일 지나 자동 종료 */
for (let i = 0; i < 3; i++) {
  const r = await api(`/market/${NM[i]}/sold`, { method: 'POST', ...N[i].hdr, body: { n: 10 } });
  ck('정상', `${i + 1}. 다 팔려 자동 마감`, r.state === '마감', r.state || r.error);
}
/* 4~5번: 판매자가 [다 팔렸어요] */
for (let i = 3; i < 5; i++) {
  const r = await api(`/market/${NM[i]}/done`, { method: 'POST', ...N[i].hdr });
  ck('정상', `${i + 1}. [다 팔렸어요] 로 종료`, r.state === '종료', r.state || r.error);
}
/* 수령일이 이레 지났다고 치자 → 새벽 청소가 거래를 완료로 센다 */
NM.slice(0, 3).forEach(id => backdate(
  `UPDATE market SET data=json_set(data,'$.수령일','${D(-9)}') WHERE id='${id}';`));
runSQL();
const c1 = await cron();
ck('정상', '수령일+7일 — 자동 종료', c1['종료'] >= 3, JSON.stringify(c1));
let ok = 0; for (let i = 0; i < 3; i++) if ((await one(N[i])).done >= 1) ok++;
ck('정상', '신고 없이 끝난 거래가 판매자 실적에 쌓임', ok === 3, `${ok}/3`);
ck('정상', '끝난 글은 목록 맨 뒤로 (앞에 판매중이 없으면 종료만 남음)',
  (await list()).filter(x => NM.includes(x.id)).every(x => x.state === '종료'), '전부 종료');

/* ───── ② 개인정보가 적힌 글 5건 (문턱 1) ───── */
const A = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`연락처 판매자${i}`, '물야면');
  const bad = ITEM(`깻잎${i}`, { 설명: `깻잎입니다. 궁금하면 010-1234-567${i} 로 연락 주세요.` });
  const r = await put(s, bad);
  ck('개인정보', `${i}. 올릴 때 이미 막힘`, r.status === 400 && /전화번호/.test(r.error || ''), r.error);
  /* 서버가 막으므로, 옛 글이 남아 있는 상황을 만들어 신고로 가려지는지 본다 */
  const r2 = await put(s, ITEM(`깻잎${i}`));
  backdate(`UPDATE market SET showAt='', data=json_set(data,'$.설명','문의는 농협 351-0000-123${i} 로') WHERE id='${r2.id}';`);
  A.push({ s, mid: r2.id });
}
runSQL();
for (const [i, a] of A.entries()) {
  const [f] = await reportBy(a.mid, 'privacy', 1);
  ck('개인정보', `${i + 1}. 신고 한 건에 그 칸이 즉시 가려짐`,
    f.r.acted === '개인정보 가림', f.r.acted || f.r.error);
}
const la = await list();
ck('개인정보', '가려진 뒤 목록에 계좌가 남아 있지 않음',
  A.every(a => !/351-0000/.test(JSON.stringify(find(la, a.mid) || {}))), '없음');
ck('개인정보', '글 자체는 살아 있음 (지우지 않는다)',
  A.every(a => (find(la, a.mid) || {}).state === '판매중'), '판매중');

/* ───── ③ 팔면 안 되는 물건 5건 → 확인중 → 고침 → 복귀 ───── */
const B = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`가공품 판매자${i}`, '춘양면');
  const r = await put(s, ITEM(`고춧가루${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  B.push({ s, mid: r.id });
}
runSQL();
for (const [i, b] of B.entries()) {
  const one1 = await reportBy(b.mid, 'banned', 1);
  const mid1 = find(await list(), b.mid);
  ck('금지품목', `${i + 1}. 신고 한 건으로는 아직 안 가림`, mid1.state === '판매중', mid1.state);
  const two = await reportBy(b.mid, 'banned', 1);
  ck('금지품목', `${i + 1}. 서로 다른 두 기기가 신고 → 확인중`,
    two[0].r.acted === '확인중', two[0].r.acted || two[0].r.error);
}
const lb = await list();
ck('금지품목', '다섯 건 모두 확인중', B.every(b => (find(lb, b.mid) || {}).held === true), '전부 held');
/* 순위 — 지우지 않고 뒤로 민다. 확인중은 판매중보다 반드시 뒤에 있어야 한다. */
const posOf = (l, id) => l.findIndex(x => x.id === id);
const lastSale = Math.max(...lb.map((x, i) => x.state === '판매중' ? i : -1));
ck('금지품목', '확인중인 글은 판매중인 글보다 모두 뒤에 있음',
  B.every(b => posOf(lb, b.mid) > lastSale), `맨 뒤 판매중=${lastSale}, 확인중=${B.map(b => posOf(lb, b.mid)).join(',')}`);
/* 신고 한 건만 받은 글(A)은 신고 없는 글보다 뒤로 간다 — 상태는 똑같이 판매중인데도 */
{
  const sales = lb.filter(x => x.state === '판매중');
  const withRep = sales.filter(x => x.reports > 0).map(x => sales.indexOf(x));
  const noRep = sales.filter(x => x.reports === 0).map(x => sales.indexOf(x));
  ck('금지품목', '같은 판매중이라도 신고가 있는 글이 뒤로 감',
    !withRep.length || !noRep.length || Math.min(...withRep) > Math.max(...noRep),
    `신고있음 ${withRep.length}건 · 신고없음 ${noRep.length}건`);
}
ck('금지품목', '게시자에게 통보가 감',
  (await api('/seller/me', { ...B[0].s.hdr })).notices.length === 1, '통보 1건');
for (const [i, b] of B.entries()) {
  const r = await api(`/market/${b.mid}`, { method: 'PUT', ...b.s.hdr, body: { data: ITEM(`햇감자${i + 1}`) } });
  ck('금지품목', `${i + 1}. 고치면 저절로 복귀 (취하 안 눌러도)`, r.back === true && r.state === '판매중', r.state);
}
ck('금지품목', '복귀한 글의 신고는 모두 해소됨',
  (await list()).filter(x => B.some(b => b.mid === x.id)).every(x => x.reports === 0), '신고 0');

/* 신고 한 건만 받고 그대로 있는 글 — 순위 감점을 눈으로 보려고 남겨 둔다 */
{
  const s0 = await join('감점 판매자', '봉화읍');
  const r0 = await put(s0, ITEM('감점시험'));
  backdate(`UPDATE market SET showAt='' WHERE id='${r0.id}';`);
  runSQL();
  await reportBy(r0.id, 'banned', 1);
  const l0 = await list();
  const me0 = l0.findIndex(x => x.id === r0.id);
  /* '깨끗한 글' = 신고도 없고 가려진 적도 없는 판매중. 가림 이력이 있는 글은 더 뒤라 셈에서 뺀다. */
  const last0 = Math.max(...l0.map((x, i) =>
    (x.state === '판매중' && x.reports === 0 && x.holds === 0) ? i : -1));
  ck('금지품목', '신고 한 건을 받은 글이 깨끗한 글들보다 모두 뒤에 놓임',
    me0 > last0, `자리 ${me0}, 맨 뒤 깨끗한 글 ${last0}`);
}

/* ───── ④ 적힌 것과 다름 5건 → 확인중 → 이의 → 7일 뒤 무고 판정 ───── */
const C = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`이의 판매자${i}`, '법전면');
  const r = await put(s, ITEM(`사과${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  C.push({ s, mid: r.id, devs: [] });
}
runSQL();
for (const [i, c] of C.entries()) {
  const rs = await reportBy(c.mid, 'false', 2);
  c.devs = rs.map(x => x.d);
  ck('허위주장', `${i + 1}. 신고 두 건 → 확인중`, rs[1].r.acted === '확인중', rs[1].r.acted);
  const r = await api(`/market/${c.mid}/ok`, { method: 'POST', ...c.s.hdr });
  ck('허위주장', `${i + 1}. [고칠 것 없습니다] 로 복귀`, r.back === true, r.state || r.error);
}
/* 이레가 지났다 — 그 사이 다시 신고가 없었으니 무고로 본다 */
backdate(`UPDATE report SET judgeAt='${T(-1, 12)}' WHERE state='이의';`);
runSQL();
const c2 = await cron();
ck('허위주장', '이레 뒤 다시 봄 — 무고로 판정', c2['무고'] === 10, `무고 ${c2['무고']}건`);
const badDev = C[0].devs[0];
const dcheck = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'bonghwa-lab', '--local',
  '--config', 'wrangler.jsonc', '--json', '--command',
  `SELECT dev,bad FROM device ORDER BY bad DESC LIMIT 3`], { encoding: 'utf8' }));
const worst = dcheck[0].results[0];
ck('허위주장', '무고한 기기에 표가 쌓임', worst && worst.bad >= 1, JSON.stringify(worst));

/* ───── ⑤ 이미 다 팔림 5건 → 자동 마감 ───── */
const Dz = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`품절 판매자${i}`, '소천면');
  const r = await put(s, ITEM(`옥수수${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  Dz.push({ s, mid: r.id });
}
runSQL();
for (const [i, d] of Dz.entries()) {
  const rs = await reportBy(d.mid, 'soldout', 2);
  ck('품절', `${i + 1}. 신고 두 건 → 자동 마감`, rs[1].r.acted === '자동 마감', rs[1].r.acted);
}
const ld = await list();
ck('품절', '마감된 글은 주문이 막히고 뒤로 감',
  Dz.every(d => (find(ld, d.mid) || {}).state === '마감'), '전부 마감');

/* ───── ⑥ 무응답 5건 → 72시간 뒤 자동 종료 ───── */
const E = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`잠수 판매자${i}`, '명호면');
  const r = await put(s, ITEM(`무응답${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  E.push({ s, mid: r.id });
}
runSQL();
for (const e of E) await reportBy(e.mid, 'banned', 2);
ck('무응답', '다섯 건 모두 확인중',
  (await list()).filter(x => E.some(e => e.mid === x.id)).every(x => x.held), '전부 확인중');
E.forEach(e => backdate(`UPDATE market SET heldAt='${T(-4, 12)}' WHERE id='${e.mid}';`));
runSQL();
const c3 = await cron();
ck('무응답', '72시간 지나 아무 답이 없으면 저절로 내려감', c3['무응답정리'] === 5, `${c3['무응답정리']}건`);
const le = await list();
ck('무응답', '내려간 글은 종료 상태',
  E.every(e => (find(le, e.mid) || {}).state === '종료'), '전부 종료');

/* ───── ⑦ 반복 위반 5건 → 세 번째에 글 종료 + 판매자 멈춤 ───── */
const F = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`반복 판매자${i}`, '상운면');
  const r = await put(s, ITEM(`반복${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  F.push({ s, mid: r.id });
}
runSQL();
for (const [i, f] of F.entries()) {
  await reportBy(f.mid, 'banned', 2);                                   /* 1회차 */
  await api(`/market/${f.mid}`, { method: 'PUT', ...f.s.hdr, body: { data: ITEM(`반복${i + 1}-고침`) } });
  await reportBy(f.mid, 'banned', 2);                                   /* 2회차 */
  const back2 = await api(`/market/${f.mid}`, { method: 'PUT', ...f.s.hdr, body: { data: ITEM(`반복${i + 1}-또고침`) } });
  ck('반복위반', `${i + 1}. 두 번째 복귀는 하루 뒤에 뜬다`, !!back2.showAt, back2.showAt || '지연 없음');
  const me2 = await one(f.s);
  ck('반복위반', `${i + 1}. 두 번 가려진 판매자는 이레 쉼`, me2.state === '정지' && !!me2.until, me2.grade);
  backdate(`UPDATE market SET showAt='' WHERE id='${f.mid}';`);
}
runSQL();
for (const [i, f] of F.entries()) {
  const rs = await reportBy(f.mid, 'banned', 2);                        /* 3회차 */
  ck('반복위반', `${i + 1}. 세 번째 — 글이 내려감`, rs[1].r.acted === '세 번째 — 글 종료', rs[1].r.acted);
  const me3 = await one(f.s);
  ck('반복위반', `${i + 1}. 판매자는 무기한 멈춤`, me3.state === '정지' && !me3.until, me3.grade);
  const no = await put(f.s, ITEM('멈춘 뒤 글'));
  ck('반복위반', `${i + 1}. 멈춘 판매자는 새 글을 못 올림`, no.status === 403, no.error);
}

/* ───── ⑧ 삭제 5건 ───── */
const H = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`삭제 판매자${i}`, '재산면');
  const r = await put(s, ITEM(`삭제대상${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  H.push({ s, mid: r.id });
}
runSQL();
for (const h of H) await reportBy(h.mid, 'banned', 1);
for (const [i, h] of H.entries()) {
  const r = await api(`/market/${h.mid}`, { method: 'DELETE', ...h.s.hdr });
  ck('삭제', `${i + 1}. 올린 사람이 지움`, r.state === '삭제됨', r.state || r.error);
}
const lh = await list();
ck('삭제', '지운 글은 목록에서 사라짐', H.every(h => !find(lh, h.mid)), '전부 사라짐');
const left = JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'bonghwa-lab', '--local',
  '--config', 'wrangler.jsonc', '--json', '--command',
  `SELECT COUNT(*) n FROM report WHERE mid IN (${H.map(h => `'${h.mid}'`).join(',')})`],
  { encoding: 'utf8' }))[0].results[0].n;
ck('삭제', '딸린 신고 기록도 함께 지워짐', left === 0, `남은 신고 ${left}건`);

/* ───── ⑨ 남의 글 건드리기·신고 남용 ───── */
const x1 = await join('남의 판매자', '봉성면');
const target = B[0].mid;
const bad1 = await api(`/market/${target}`, { method: 'PUT', ...x1.hdr, body: { data: ITEM('가로채기') } });
ck('막기', '남의 글은 고칠 수 없음', bad1.status === 403, bad1.error);
const bad2 = await api(`/market/${target}`, { method: 'DELETE', ...x1.hdr });
ck('막기', '남의 글은 지울 수 없음', bad2.status === 403, bad2.error);
const bad3 = await api(`/market/${target}`, { method: 'PUT', body: { data: ITEM('열쇠없이') } });
ck('막기', '수정키 없이는 고칠 수 없음', bad3.status === 403 || bad3.status === 401, bad3.error);

const dd = pick(Dz[0].mid, 1)[0] || 'devSPAM000001';
await report(Dz[1].mid, dd, 'banned');
const again = await report(Dz[1].mid, dd, 'banned');
ck('막기', '같은 기기가 같은 글을 두 번 신고 못 함', again.status === 409, again.error);
const spam = 'devSPAM000002';
const sr = [];
for (const t of [C[0].mid, C[1].mid, C[2].mid, C[3].mid]) sr.push(await report(t, spam, 'false'));
ck('막기', '한 기기는 하루 세 건까지만 신고', sr[3].status === 429, sr[3].error);

/* 무고가 세 번 쌓인 기기의 신고는 세지 않는다 */
const zombie = 'devZOMBIE0001';
backdate(`INSERT INTO device (dev,bad,at) VALUES ('${zombie}',3,'${T(-1, 12)}');`);
const zs = await join('가중치 판매자', '물야면');
const zr = await put(zs, ITEM('가중치시험'));
backdate(`UPDATE market SET showAt='' WHERE id='${zr.id}';`);
runSQL();
await report(zr.id, zombie, 'banned');
const zd = pick(zr.id, 1)[0];
const z2 = await report(zr.id, zd, 'banned');
ck('막기', '무고 3회 기기의 신고는 세지 않음 (두 건이어도 안 가려짐)',
  z2.acted === '' && z2.reports === 1, `가려짐=${z2.acted || '없음'} 세어진 신고=${z2.reports}`);

/* ───── ⑩ 필수값·정지 상태 ───── */
const q = await join('빈칸 판매자', '봉화읍');
const e1 = await put(q, { 품목: '', 가격: '1000', 수량: '1', 마감일시: T(2, 18) });
ck('막기', '품목 없이는 못 올림', e1.status === 400, e1.error);
const e2 = await put(q, { 품목: '무', 가격: '1000', 수량: '1', 마감일시: '언제까지나' });
ck('막기', '마감일시 형식이 틀리면 못 올림', e2.status === 400, e2.error);

/* ───── ⑪ 두 번 가려져 '쉬는 중' 이 된 판매자 5명 → 이레 뒤 저절로 복귀 ───── */
const R = [];
for (let i = 1; i <= 5; i++) {
  const s = await join(`쉬는 판매자${i}`, '봉성면');
  const r = await put(s, ITEM(`쉼${i}`));
  backdate(`UPDATE market SET showAt='' WHERE id='${r.id}';`);
  R.push({ s, mid: r.id });
}
runSQL();
for (const [i, f] of R.entries()) {
  await reportBy(f.mid, 'banned', 2);                                   /* 1회차 */
  await api(`/market/${f.mid}`, { method: 'PUT', ...f.s.hdr, body: { data: ITEM(`쉼${i + 1}-고침`) } });
  await reportBy(f.mid, 'banned', 2);                                   /* 2회차 */
  await api(`/market/${f.mid}`, { method: 'PUT', ...f.s.hdr, body: { data: ITEM(`쉼${i + 1}-또고침`) } });
  const me = await one(f.s);
  ck('회복', `${i + 1}. 두 번 가려져 '쉬는 중'`, me.grade === '쉬는 중' && !!me.until, me.grade);
  const no = await put(f.s, ITEM('쉬는 중 글'));
  ck('회복', `${i + 1}. 쉬는 동안은 새 글을 못 올림`, no.status === 403 && /까지/.test(no.error || ''), no.error);
}
backdate(`UPDATE seller SET until='${T(-1, 12)}' WHERE state='정지' AND until!='';`);
runSQL();
const c4 = await cron();
ck('회복', '이레가 지나면 쉬던 판매자가 저절로 돌아옴', c4['정지해제'] >= 5, `${c4['정지해제']}명`);
for (const [i, f] of R.entries()) {
  const me = await one(f.s);
  ck('회복', `${i + 1}. 돌아온 뒤 다시 글을 올릴 수 있음`, me.state === '승인', me.state);
}
/* 정지가 풀렸는지 확인 — 이제 막히더라도 '멈춤'이 아니라 '하루 한 건' 때문이어야 한다 */
const why1 = await put(R[0].s, ITEM('돌아와서 올린 글'));
ck('회복', '막히는 사유가 멈춤이 아니라 하루 한 건으로 바뀜', why1.status === 429, why1.error);
backdate(`UPDATE market SET at='${T(-2, 9)}' WHERE seller='${R[0].s.id}';`);
runSQL();
const backPost = await put(R[0].s, ITEM('돌아와서 올린 글'));
ck('회복', '하루가 지나면 실제로 올라감', !!backPost.id, backPost.id || backPost.error);

/* ───── ⑪-2 무사히 다섯 번 끝내면 '단골' — 하루 한 건 제한이 풀린다 ───── */
const V = await join('단골될 판매자', '봉화읍');
const vm = [];
for (let i = 1; i <= 5; i++) {
  const r = await put(V, ITEM(`단골거래${i}`));
  if (!r.id) { ck('등급', `${i}번째 글`, false, r.error); break; }
  vm.push(r.id);
  backdate(`UPDATE market SET showAt='', at='${T(-10 + i, 9)}' WHERE id='${r.id}';`);
  runSQL();                                   /* 어제 올린 것으로 돌려 하루 한 건 제한을 피한다 */
}
ck('등급', '새로 오신 분으로 다섯 건을 (날짜를 나눠) 올림', vm.length === 5, `${vm.length}건`);
for (const id of vm) await api(`/market/${id}/done`, { method: 'POST', ...V.hdr });
const vme = await one(V);
ck('등급', '무사히 끝낸 거래 다섯 건', vme.done === 5, `${vme.done}건`);
ck('등급', '등급이 단골로 오름', vme.grade === '단골', vme.grade);
const v1 = await put(V, ITEM('단골 첫째'));
const v2 = await put(V, ITEM('단골 둘째'));
ck('등급', '단골은 하루에 두 건도 올릴 수 있음', !!v1.id && !!v2.id, `${v1.id ? 'ok' : v1.error} / ${v2.id ? 'ok' : v2.error}`);
ck('등급', '단골의 글은 지연 없이 바로 뜸', v1.showAt === '', `showAt='${v1.showAt}'`);

/* ───── ⑫ 오래된 것 파기 ───── */
backdate(`UPDATE market SET state='종료', edited='${T(-100, 12)}' WHERE id='${NM[0]}';`);
backdate(`UPDATE seller SET seenAt='${T(-100, 12)}', at='${T(-100, 12)}' WHERE id='${N[4].id}';`);
runSQL();
const c5 = await cron();
ck('파기', '종료 90일 지난 글은 내용이 지워짐', c5['글내용파기'] >= 1, `${c5['글내용파기']}건`);
ck('파기', '90일 활동 없는 판매자의 연락처가 지워짐', c5['연락처파기'] >= 1, `${c5['연락처파기']}명`);
const adm = await api('/admin/seller', { admin: true });
const gone = adm.rows.find(r => r.id === N[4].id);
ck('파기', '지워진 뒤 담당자 화면에도 번호가 없음', gone && !gone.phone, `phone='${gone && gone.phone}'`);

/* ───── ⑬ 공개 주소에 개인정보가 새지 않는가 ───── */
const raw = await (await fetch(EP + '/market')).text();
ck('개인정보', '공개 목록에 휴대폰·실명·메모가 없음',
  !/"phone"|"name"|"memo"|01000|0101000/.test(raw), '없음');

/* ═══════════════════ 결과 ═══════════════════ */
const groups = [...new Set(rows.map(r => r.group))];
console.log('\n┌─────────────────────────────────────────────────────────────');
for (const g of groups) {
  const rs = rows.filter(r => r.group === g);
  const bad = rs.filter(r => !r.good).length;
  console.log(`│ ${bad ? '✗' : '✓'} ${g.padEnd(6)}  ${String(rs.length - bad).padStart(2)}/${rs.length}`);
  for (const r of rs.filter(r => !r.good)) console.log(`│      ✗ ${r.name} → ${r.got}`);
}
console.log('└─────────────────────────────────────────────────────────────');
console.log(`\n통과 ${pass} · 실패 ${fail}\n`);
const st = await api('/admin/market', { admin: true });
const cnt = {}; for (const r of st.rows) cnt[r.state] = (cnt[r.state] || 0) + 1;
console.log('끝난 뒤 글 상태:', JSON.stringify(cnt, null, 0));
const ss = await api('/admin/seller', { admin: true });
const gc = {}; for (const r of ss.rows) gc[r.grade] = (gc[r.grade] || 0) + 1;
console.log('판매자 등급    :', JSON.stringify(gc, null, 0));
process.exit(fail ? 1 : 0);
