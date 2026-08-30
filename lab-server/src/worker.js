/* ═══════════════════════════════════════════════════════════════
   bonghwa-lab — 테스트본 전용 저장소
   운영 통계(bonghwa-stat)와 데이터베이스·워커가 모두 별개다.

   보조사업
     GET  /cfg              관리자 설정 전체 (공개 — 주민 화면이 읽는다)
     PUT  /cfg              설정 저장        (관리자 코드 필요)
     POST /apply            온라인 접수      (공개)
     GET  /apply?code=...   접수 내역        (관리자 코드 필요)

   장터 — 판매자 등록제 + 자율정화 (담당자가 상시로 보지 않는다)
     GET    /market              팔고 있는 글 (공개. 실명·전화는 절대 안 나간다)
     POST   /seller              판매자 등록 (공개. 자동 승인)
     GET    /seller/me           내 등록 상태와 통보 (수정키)
     GET    /seller/posts        내 글 전부 (수정키. 아직 안 뜬 글도 보인다)
     POST   /market              글 올리기   (수정키)
     PUT    /market/:id          글 고치기   (수정키. 신고가 저절로 풀린다)
     DELETE /market/:id          글 지우기   (수정키)
     POST   /market/:id/ok       "고칠 것 없습니다" (수정키)
     POST   /market/:id/sold     몇 개 나갔는지     (수정키)
     POST   /market/:id/done     "다 팔렸어요"      (수정키)
     POST   /market/:id/photo    사진 올리기 (수정키. 3장·400KB·webp/jpeg)
     DELETE /market/:id/photo/:p 사진 지우기 (수정키)
     GET    /photo/:id/:p        사진 보기   (공개. 가리면 그 자리에서 안 보인다)
     POST   /market/:id/report   신고 (공개)
     GET·POST /admin/seller      한 달에 5분 — 멈춤 풀기·재발급
     GET·POST /admin/market      기록 보기·긴급 삭제
     POST   /admin/cron          새벽 청소를 손으로 돌려 보기
   ═══════════════════════════════════════════════════════════════ */
/* 허용 주소 — 배포본과 로컬 미리보기 둘 다. 테스트본이라 이 정도만 연다. */
const OK_ORIGIN = o => !!o && (o === 'https://choyul.github.io' || /^http:\/\/localhost:\d+$/.test(o));
const CORS = (env, req) => ({
  'access-control-allow-origin': (req && OK_ORIGIN(req.headers.get('origin')))
    ? req.headers.get('origin') : (env.ALLOW_ORIGIN || 'https://choyul.github.io'),
  'vary': 'origin',
  'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-lab-code,x-lab-key,x-lab-id',
  'access-control-max-age': '86400',
});
let REQ = null;
const json = (o, env, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS(env, REQ) } });

function ok(req, env) {
  const c = req.headers.get('x-lab-code') || new URL(req.url).searchParams.get('code') || '';
  return env.ADMIN_CODE && c === env.ADMIN_CODE;
}
const S = (v, n) => String(v == null ? '' : v).slice(0, n);

/* ── 열쇠 만들기 ──
   수정키는 서버가 만들어 한 번만 돌려주고, 저장은 해시로만 한다.
   0·1·I·O 를 뺀 32자 — 어르신이 받아 적어도 헷갈리지 않게. */
const AL = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function rand(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return Array.from(b, x => AL[x % 32]).join('');
}
const newKey = () => rand(4) + '-' + rand(4) + '-' + rand(4);
const newId = p => p + '_' + rand(8).toLowerCase();
async function hash(key, id) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id + ':' + key));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
/* 열쇠는 길이가 같아야 안전하게 견줄 수 있다 — 둘 다 64자 해시라 그대로 견준다 */
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/* 수정키를 낸 사람이 누구인지 찾는다.
   누구인지(판매자 id 또는 판매자번호)를 함께 받아 그 한 줄만 꺼내 견준다 —
   표를 통째로 훑으면 판매자가 늘수록 느려지고, 열쇠를 여러 줄에 대 보게 된다. */
async function whoami(req, env) {
  const k = (req.headers.get('x-lab-key') || '').trim().toUpperCase();
  const who = (req.headers.get('x-lab-id') || '').trim();
  if (!/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(k)) return null;
  let s = null;
  if (/^s_[0-9a-z]{8}$/.test(who))
    s = await env.DB.prepare('SELECT * FROM seller WHERE id=?1').bind(who).first();
  else if (/^\d{4}$/.test(who))
    s = await env.DB.prepare('SELECT * FROM seller WHERE no=?1').bind(who).first();
  if (!s) return null;
  return same(await hash(k, s.id), s.keyhash) ? s : null;
}

/* ── 적으면 안 되는 것 (§3-3) ──
   화면단에도 같은 그물이 있지만, 주민이 직접 쓰기 시작하면
   저장되기 전에 서버가 막아야 한다. */
const PHONE = /01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const BANK = /(농협|농혐|신협|새마을|우체국|국민|신한|우리|하나|기업|대구|경북|카카오뱅크|토스)[^\n]{0,12}\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,7}|(?:계좌|입금|송금)[^\n]{0,10}\d{4,}/;
const FREE = ['설명', '품목', '규격', '수령장소'];
function leak(data) {
  for (const k of FREE) {
    const v = data[k];
    if (typeof v === 'string' && (PHONE.test(v) || BANK.test(v))) return k;
  }
  return '';
}

/* 공개 목록에 낼 칸 — 실명·전화가 섞여 나가지 않도록 칸을 하나하나 적는다.
   SELECT * 한 번이면 봉화 농가 전화번호가 통째로 새어 나간다. */
const PUBLIC_STATES = ['판매중', '수확예정', '마감', '종료'];

/* ═══════════════════════════════════════════════════════════════
   자율정화 — 관리자가 상시로 보지 않는다는 전제 아래의 규칙들.
   숫자를 바꾸려면 여기 한 곳만 고친다.
   ═══════════════════════════════════════════════════════════════ */
const HOLD_AT       = 2;    /* 서로 다른 기기 이만큼 신고하면 가린다 */
const HOLD_HOURS    = 72;   /* 확인중인 채로 이만큼 두면 저절로 종료된다 */
const MAX_HOLDS     = 3;    /* 한 글이 이만큼 가려지면 그 글은 끝난다 */
const SLOW_HOLDS    = 2;    /* 이 횟수부터는 복귀에 하루가 걸린다 */
const BACK_HOURS    = 24;
const JUDGE_DAYS    = 7;    /* 이의가 들어온 신고를 다시 보는 때 */
const DEV_BAD_MAX   = 3;    /* 무고 이만큼이면 그 기기의 신고는 세지 않는다 */
const REPORT_PER_DAY= 3;
const SPROUT_DONE   = 5;    /* 무사히 끝낸 거래 이만큼이면 '단골' */
const SPROUT_PER_DAY= 1;
const FIRST_HOURS   = 24;   /* 첫 글은 이만큼 뒤에 뜬다 */
const PICKUP_DAYS   = 7;    /* 수령일 + 이만큼이면 저절로 종료 */
const PURGE_DAYS    = 90;   /* 종료 + 이만큼이면 글 내용을 지운다 */
const IDLE_DAYS     = 90;   /* 활동 없음 이만큼이면 연락처를 지운다 */
const SUSPEND_DAYS  = 7;    /* 자동 정지 기간 */
/* 사진 — 용량은 '들어올 때' 정해진다. 나중에 관리하는 것이 아니라 크게 못 들어오게 한다. */
const MAX_PHOTOS    = 3;
const MAX_BYTES     = 400 * 1024;   /* 브라우저에서 1280px·WebP 로 줄이면 보통 100~200KB */
const PHOTO_DAYS    = 30;           /* 종료 + 이만큼이면 사진을 지운다 */
const PHOTO_TYPES   = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };

/* 목록에서 앞뒤를 가르는 기본 점수 — 지우지 않고 뒤로 민다 */
const BASE = { '판매중': 0, '수확예정': 1000, '확인중': 3000, '마감': 4000, '종료': 5000 };

/* 신고 사유. 사진과 개인정보는 눈에 들어오는 순간 이미 피해라서 문턱이 1이다. */
const WHY = {
  photo:   { at: 1, txt: '사진이 이상합니다' },
  privacy: { at: 1, txt: '전화번호·계좌가 적혀 있습니다' },
  banned:  { at: HOLD_AT, txt: '팔면 안 되는 물건입니다' },
  false:   { at: HOLD_AT, txt: '적힌 것과 다릅니다' },
  soldout: { at: HOLD_AT, txt: '이미 다 팔렸습니다' },
};

/* ── 때 ── 서버가 다루는 모든 시각은 한국 시각 'YYYY-MM-DD HH:MM' 이다.
   마감일시를 판매자가 한국 시각으로 적는데 서버가 UTC 로 견주면 아홉 시간 늦게 마감된다. */
const KST = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const NOW = () => KST(Date.now());
const PLUS = h => KST(Date.now() + h * 3600000);
function MS(s, endOfDay) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return 0;
  const h = m[4] != null ? +m[4] : (endOfDay ? 23 : 0), mi = m[5] != null ? +m[5] : (endOfDay ? 59 : 0);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], h, mi) - 9 * 3600000;
}

/* ── 판매자 등급·상태 ── */
const grade_of = s => (s.state === '정지') ? (s.until ? '쉬는 중' : '멈춤')
  : ((s.done || 0) >= SPROUT_DONE ? '단골' : '새로 오신 분');
const state_of = s => s.state;
/* 글을 올릴 수 없는 사유 (없으면 빈 문자열) */
function stopped(s) {
  if (s.state !== '정지') return '';
  return s.until ? `지금은 ${s.until} 까지 글을 올리실 수 없습니다.`
                 : '지금은 장터 이용이 멈춰 있습니다. 담당자에게 문의해 주세요.';
}
const touch = (env, id, now) =>
  env.DB.prepare('UPDATE seller SET seenAt=?2 WHERE id=?1').bind(id, now).run();

/* ── 글 내용 ── 시트에 쓰던 칸 이름을 그대로 쓴다 */
const COLS = ['품목', '설명', '규격', '가격', '수량', '수령장소', '수령일', '수령시각',
  '마감일시', '주문링크', '원글링크', '대리게시', '등록일', '상태'];
function clean(d) {
  const o = {};
  COLS.forEach(k => { if (d[k] != null && String(d[k]).trim() !== '') o[k] = S(d[k], k === '설명' ? 1500 : 120).trim(); });
  return o;
}
function need(d) {
  if (!d['품목']) return '무엇을 파시는지 적어 주세요';
  if (!d['가격']) return '값을 적어 주세요';
  if (!d['수량']) return '몇 개를 파시는지 적어 주세요';
  if (!d['마감일시']) return '주문 마감을 적어 주세요';
  if (!MS(d['마감일시'])) return '주문 마감을 2026-09-03 18:00 처럼 적어 주세요';
  return '';
}
const st_of = d => (d['상태'] === '수확예정') ? '수확예정' : '판매중';

/* ── 신고가 들어온 뒤 ── */
async function after_report(env, m, why, now) {
  /* 개인정보는 세지 않고 그 자리에서 가린다. 이미 서버가 찾을 줄 안다. */
  if (why === 'privacy') {
    let d = {}; try { d = JSON.parse(m.data); } catch (e) { }
    const bd = leak(d);
    if (bd) {
      FREE.forEach(k => { if (typeof d[k] === 'string' && (PHONE.test(d[k]) || BANK.test(d[k]))) d[k] = ''; });
      await env.DB.prepare('UPDATE market SET data=?2, notice=?3, edited=?4 WHERE id=?1')
        .bind(m.id, JSON.stringify(d), '전화번호나 계좌로 보이는 것이 있어 그 칸을 가렸습니다. 다시 적어 주세요.', now).run();
      await env.DB.prepare("UPDATE report SET state='해소' WHERE mid=?1 AND why='privacy'").bind(m.id).run();
      return { acted: '개인정보 가림' };
    }
    await env.DB.prepare("UPDATE report SET state='무효' WHERE mid=?1 AND why='privacy' AND state='유효'")
      .bind(m.id).run();
    return { acted: '해당 없음' };
  }
  if (why === 'photo') {
    /* 글씨는 읽어야 알지만 사진은 눈에 들어오는 순간 이미 피해다. 그래서 한 건에 가린다.
       글은 그대로 둔다 — 사진만 다시 올리면 된다. */
    if (!pics(m).length) {
      await env.DB.prepare("UPDATE report SET state='무효' WHERE mid=?1 AND why='photo' AND state='유효'")
        .bind(m.id).run();
      return { acted: '해당 없음' };
    }
    await env.DB.prepare('UPDATE market SET phold=1, notice=?2 WHERE id=?1')
      .bind(m.id, '사진 신고가 들어와 사진을 가렸습니다. 사진을 지우고 다시 올려 주세요.').run();
    return { acted: '사진 가림' };
  }
  /* 나머지는 서로 다른 기기 두 곳이 모여야 움직인다 */
  const c = await env.DB.prepare(
    `SELECT COUNT(*) n FROM report r LEFT JOIN device d ON d.dev=r.dev
      WHERE r.mid=?1 AND r.state='유효' AND r.why IN ('banned','false','soldout')
        AND COALESCE(d.bad,0) < ?2`).bind(m.id, DEV_BAD_MAX).first();
  const n = (c && c.n) || 0;
  if (n < HOLD_AT) return { acted: '', reports: n };

  if (why === 'soldout' && m.state !== '확인중') {
    await env.DB.prepare("UPDATE market SET state='마감', notice=?2, edited=?3 WHERE id=?1")
      .bind(m.id, '다 팔렸다는 신고가 모여 마감으로 바꾸었습니다. 아니면 다시 열어 주세요.', now).run();
    await env.DB.prepare("UPDATE report SET state='해소' WHERE mid=?1 AND why='soldout'").bind(m.id).run();
    return { acted: '자동 마감', reports: n };
  }
  return { ...(await hold(env, m, now)), reports: n };
}

/* ── 가리기 ── 삭제가 아니라 '주문 잠금 + 게시자 통보' 다 ── */
async function hold(env, m, now) {
  const holds = (m.holds || 0) + 1;
  if (holds >= MAX_HOLDS) {
    await env.DB.prepare("UPDATE market SET state='종료', holds=?2, notice=?3, edited=?4 WHERE id=?1")
      .bind(m.id, holds, '신고가 세 번 모여 이 글은 내렸습니다.', now).run();
    if (m.seller) await bump(env, m.seller, now);
    return { acted: '세 번째 — 글 종료' };
  }
  await env.DB.prepare("UPDATE market SET state='확인중', prev=?2, holds=?3, heldAt=?4, notice=?5 WHERE id=?1")
    .bind(m.id, m.state, holds, now,
      '이웃들이 이 글을 신고했습니다. 고치시면 바로 다시 올라갑니다. ' +
      '고칠 것이 없으면 [고칠 것 없습니다]를 눌러 주세요. ' + HOLD_HOURS + '시간 안에 아무 것도 하지 않으시면 글이 내려갑니다.').run();
  if (m.seller) await bump(env, m.seller, now);
  return { acted: '확인중' };
}

/* 판매자에게도 가림 횟수가 쌓인다 — 두 번이면 이레, 세 번이면 무기한 */
async function bump(env, sid, now) {
  const s = await env.DB.prepare('SELECT * FROM seller WHERE id=?1').bind(sid).first();
  if (!s) return;
  const h = (s.holds || 0) + 1;
  if (h >= MAX_HOLDS) {
    await env.DB.prepare("UPDATE seller SET holds=?2, state='정지', until='' WHERE id=?1").bind(sid, h).run();
    await env.DB.prepare("UPDATE market SET state='숨김' WHERE seller=?1 AND state IN ('판매중','수확예정')")
      .bind(sid).run();
  } else if (h >= SLOW_HOLDS) {
    await env.DB.prepare("UPDATE seller SET holds=?2, state='정지', until=?3 WHERE id=?1")
      .bind(sid, h, KST(Date.now() + SUSPEND_DAYS * 86400000)).run();
  } else {
    await env.DB.prepare('UPDATE seller SET holds=?2 WHERE id=?1').bind(sid, h).run();
  }
}

/* ── 복귀 ── 고치거나 이의를 내면 제자리로 ── */
async function recover(env, m, now, kind) {
  if (m.state !== '확인중') return { state: m.state, back: false };
  const slow = (m.holds || 0) >= SLOW_HOLDS;
  const showAt = slow ? PLUS(BACK_HOURS) : '';
  await env.DB.prepare("UPDATE market SET state=?2, prev='', heldAt='', backAt=?3, showAt=?4, notice='' WHERE id=?1")
    .bind(m.id, m.prev || '판매중', now, showAt).run();
  return { state: m.prev || '판매중', back: true, kind,
    showAt, note: slow ? '두 번째라 하루 뒤에 다시 뜹니다.' : '' };
}

/* ── 사진 ──
   보내온 것이 정말 사진인지 앞머리 몇 바이트로 확인한다.
   확장자나 content-type 은 아무나 적어 보낼 수 있다. */
function isImage(buf, type) {
  const b = new Uint8Array(buf);
  if (type === 'image/webp')
    return b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
           b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;   /* RIFF....WEBP */
  if (type === 'image/jpeg')
    return b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;      /* JPEG */
  return false;
}
const pics = m => { try { const a = JSON.parse(m.photos || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

/* ── 사진을 어디에 둘 것인가 ──
   R2 가 붙어 있으면 R2 를, 없으면 KV 를 쓴다.
   R2 는 계정에 결제수단을 등록해야 켜지는데, 그것 때문에 사진 기능 전체가
   멈춰 서지는 않게 한다. 나중에 R2 를 켜면 wrangler.jsonc 한 줄만 풀면 된다.

   KV 에 넣을 때는 시한을 함께 건다 — 새벽 청소가 어느 날 죽더라도
   사진은 저 혼자 사라진다. 안전망이 하나 더 생기는 셈이다. */
const PHOTO_TTL = 180 * 86400;   /* 청소(종료+30일)보다 한참 길게 잡은 뒷그물 */
function store(env) {
  if (env.PHOTOS) return { kind: 'R2',
    put: (k, buf, type) => env.PHOTOS.put(k, buf, { httpMetadata: { contentType: type } }),
    get: async k => { const o = await env.PHOTOS.get(k); return o ? o.body : null; },
    del: k => env.PHOTOS.delete(k) };
  if (env.PHOTO_KV) return { kind: 'KV',
    put: (k, buf, type) => env.PHOTO_KV.put(k, buf, { expirationTtl: PHOTO_TTL, metadata: { type } }),
    get: k => env.PHOTO_KV.get(k, 'arrayBuffer'),
    del: k => env.PHOTO_KV.delete(k) };
  return null;
}

/* 글에 딸린 사진을 모두 지운다. 글이 사라지면 사진도 남을 이유가 없다. */
async function wipe(env, m) {
  const ps = pics(m), st = store(env);
  if (!ps.length || !st) return 0;
  for (const p of ps) { try { await st.del(`photo/${m.id}/${p}`); } catch (e) { } }
  await env.DB.prepare("UPDATE market SET photos='[]' WHERE id=?1").bind(m.id).run();
  return ps.length;
}

/* ═══════════════════════════════════════════════════════════════
   새벽 청소 — 이 함수가 이 장터의 청소부다.
   모든 것에 수명을 주면 사람이 지울 것이 남지 않는다.
   ═══════════════════════════════════════════════════════════════ */
async function sweep(env) {
  const now = NOW(), t = Date.now(), out = {};
  const all = await env.DB.prepare("SELECT * FROM market WHERE state!='삭제됨'").all();
  let close = 0, end = 0, drop = 0, done = 0;

  for (const m of (all.results || [])) {
    let d = {}; try { d = JSON.parse(m.data); } catch (e) { }
    /* ① 확인중인 채로 사흘 — 게시자가 사라진 글은 저절로 내려간다 */
    if (m.state === '확인중' && m.heldAt && t - MS(m.heldAt) >= HOLD_HOURS * 3600000) {
      await env.DB.prepare("UPDATE market SET state='종료', notice=?2, edited=?3 WHERE id=?1")
        .bind(m.id, '신고에 아무 답이 없어 글을 내렸습니다.', now).run();
      drop++; continue;
    }
    /* ② 마감일시가 지났거나 다 팔렸으면 마감 */
    if ((m.state === '판매중' || m.state === '수확예정')) {
      const dl = MS(d['마감일시'], true);
      const qty = +(d['수량'] || 0) || 0;
      if ((dl && dl <= t) || (qty && (m.sold || 0) >= qty)) {
        await env.DB.prepare("UPDATE market SET state='마감', edited=?2 WHERE id=?1").bind(m.id, now).run();
        close++; continue;
      }
    }
    /* ③ 수령일이 이레 지나면 종료. 신고 없이 끝났으면 판매자에게 거래 한 건이 쌓인다 */
    if (m.state === '마감' || m.state === '판매중' || m.state === '수확예정') {
      const pk = MS(d['수령일'], true);
      if (pk && t - pk >= PICKUP_DAYS * 86400000) {
        await env.DB.prepare("UPDATE market SET state='종료', edited=?2 WHERE id=?1").bind(m.id, now).run();
        const bad = await env.DB.prepare("SELECT COUNT(*) n FROM report WHERE mid=?1 AND state='유효'")
          .bind(m.id).first();
        if (m.seller && !(bad && bad.n)) {
          await env.DB.prepare('UPDATE seller SET done=done+1 WHERE id=?1').bind(m.seller).run(); done++;
        }
        end++; continue;
      }
    }
    /* ③-2 종료된 지 한 달이면 사진을 지운다. 거래가 끝난 사진은 아무에게도 쓸모가 없다. */
    if (m.state === '종료' && m.edited && t - MS(m.edited) >= PHOTO_DAYS * 86400000 && pics(m).length) {
      out.photos = (out.photos || 0) + await wipe(env, m);
    }
    /* ④ 종료된 지 오래면 내용을 지운다. 남기는 것은 품목과 달뿐이다. */
    if (m.state === '종료' && m.edited && t - MS(m.edited) >= PURGE_DAYS * 86400000 && d['설명']) {
      await env.DB.prepare('UPDATE market SET data=?2 WHERE id=?1')
        .bind(m.id, JSON.stringify({ 품목: d['품목'] || '', 등록일: d['등록일'] || m.at.slice(0, 10) })).run();
      out.purged = (out.purged || 0) + 1;
    }
  }

  /* ⑤ 이의가 들어온 신고를 이레 뒤에 다시 본다 —
     그 사이 또 가려졌으면 신고가 옳았고, 아니면 무고다. */
  const jr = await env.DB.prepare("SELECT * FROM report WHERE state='이의' AND judgeAt!='' AND judgeAt<=?1")
    .bind(now).all();
  let good = 0, bad = 0;
  for (const r of (jr.results || [])) {
    const m = await env.DB.prepare('SELECT holds FROM market WHERE id=?1').bind(r.mid).first();
    if (m && (m.holds || 0) > (r.holdsAt || 0)) {
      await env.DB.prepare("UPDATE report SET state='해소' WHERE id=?1").bind(r.id).run(); good++;
    } else {
      await env.DB.prepare("UPDATE report SET state='무효' WHERE id=?1").bind(r.id).run();
      await env.DB.prepare('INSERT INTO device (dev,bad,at) VALUES (?1,1,?2) ' +
        'ON CONFLICT(dev) DO UPDATE SET bad=bad+1, at=excluded.at').bind(r.dev, now).run();
      bad++;
    }
  }

  /* ⑥ 자동 정지가 풀린다 */
  const up = await env.DB.prepare("UPDATE seller SET state='승인', until='' WHERE state='정지' AND until!='' AND until<=?1")
    .bind(now).run();

  /* ⑦ 오래 안 오신 분의 연락처를 지운다 */
  const idle = KST(t - IDLE_DAYS * 86400000);
  const pg = await env.DB.prepare("UPDATE seller SET phone='', name='' WHERE phone!='' AND " +
    "COALESCE(NULLIF(seenAt,''), at) <= ?1").bind(idle).run();

  return { at: now, 사진저장소: (store(env) || {}).kind || '없음',
    마감: close, 종료: end, 무응답정리: drop, 거래완료: done,
    사진파기: out.photos || 0, 글내용파기: out.purged || 0, 신고정당: good, 무고: bad,
    정지해제: (up.meta && up.meta.changes) || 0, 연락처파기: (pg.meta && pg.meta.changes) || 0 };
}

export default {
  async fetch(req, env) {
    REQ = req;
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS(env, req) });

    /* ═══════ 보조사업 (기존) ═══════ */
    if (u.pathname === '/cfg' && req.method === 'GET') {
      const r = await env.DB.prepare('SELECT id, json FROM cfg').all();
      const out = {};
      for (const row of (r.results || [])) { try { out[row.id] = JSON.parse(row.json); } catch (e) { } }
      return json({ cfg: out }, env);
    }

    if (u.pathname === '/cfg' && req.method === 'PUT') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const id = S(b.id, 40), cfg = b.cfg;
      if (!/^sub_[0-9a-f]{8}$/.test(id) || !cfg) return json({ error: '값이 없습니다' }, env, 400);
      const at = NOW();
      await env.DB.prepare('INSERT INTO cfg (id,json,at,by) VALUES (?1,?2,?3,?4) ' +
        'ON CONFLICT(id) DO UPDATE SET json=excluded.json, at=excluded.at, by=excluded.by')
        .bind(id, JSON.stringify(cfg).slice(0, 20000), at, S(b.by, 40)).run();
      return json({ saved: id, at }, env);
    }

    if (u.pathname === '/apply' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const sid = S(b.sid, 40);
      if (!/^sub_[0-9a-f]{8}$/.test(sid)) return json({ error: '사업을 찾을 수 없습니다' }, env, 400);
      /* 정원이 있으면 서버에서 다시 센다 — 기기별로 세면 여러 사람이 동시에 넘길 수 있다 */
      if (b.capacity) {
        const c = await env.DB.prepare('SELECT COUNT(*) n FROM apply WHERE sid=?1').bind(sid).first();
        if (c && c.n >= +b.capacity) return json({ error: '접수 정원이 찼습니다', full: true }, env, 409);
      }
      const at = NOW();
      const seq = await env.DB.prepare('SELECT COUNT(*) n FROM apply').first();
      const no = 'B' + at.slice(2, 10).replace(/-/g, '') + '-' + String(((seq && seq.n) || 0) + 1).padStart(3, '0');
      await env.DB.prepare('INSERT INTO apply (no,sid,title,dept,at,data,agrix) VALUES (?1,?2,?3,?4,?5,?6,?7)')
        .bind(no, sid, S(b.title, 200), S(b.dept, 40), at,
          JSON.stringify(b.data || {}).slice(0, 4000), JSON.stringify(b.agrix || null).slice(0, 2000)).run();
      return json({ no, at }, env);
    }

    if (u.pathname === '/apply' && req.method === 'GET') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      const r = await env.DB.prepare('SELECT * FROM apply ORDER BY at DESC LIMIT 500').all();
      return json({ rows: (r.results || []).map(x => ({ ...x,
        data: (() => { try { return JSON.parse(x.data); } catch (e) { return {}; } })(),
        agrix: (() => { try { return JSON.parse(x.agrix); } catch (e) { return null; } })() })) }, env);
    }

    /* ═══════════════════════════════════════════════════════════
       사진 보여주기 (공개)
       R2 를 공개 버킷으로 열지 않는다. 주소를 아는 사람은 가려도 계속 보게 된다.
       ═══════════════════════════════════════════════════════════ */
    const pm = u.pathname.match(/^\/photo\/(m_[0-9a-z]{8})\/(p_[0-9a-z]{8}\.(?:webp|jpg))$/);
    if (pm && req.method === 'GET') {
      const st = store(env);
      if (!st) return new Response('사진 저장소가 없습니다', { status: 503 });
      const m = await env.DB.prepare('SELECT id,state,photos,phold FROM market WHERE id=?1').bind(pm[1]).first();
      const gone = !m || m.phold || !pics(m).includes(pm[2]) ||
        ['삭제됨', '숨김'].includes(m.state);
      if (gone) return new Response('없는 사진입니다', { status: 404 });
      /* 캐시를 두면 가린 뒤에도 이미 열어 본 사람에게는 그대로 남는다.
         신고당한 사진에 그 시간을 줄 수 없어, 볼 때마다 서버에 한 번 묻게 한다.
         바뀐 것이 없으면 304 만 돌려주므로 사진을 다시 내려받지는 않는다. */
      const tag = '"' + pm[2] + '"';
      if (req.headers.get('if-none-match') === tag)
        return new Response(null, { status: 304, headers: {
          'etag': tag, 'cache-control': 'no-cache', 'access-control-allow-origin': '*' } });
      const o = await st.get(`photo/${pm[1]}/${pm[2]}`);
      if (!o) return new Response('없는 사진입니다', { status: 404 });
      return new Response(o, { headers: {
        'content-type': pm[2].endsWith('.webp') ? 'image/webp' : 'image/jpeg',
        'etag': tag,
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*' } });
    }

    /* ═══════════════════════════════════════════════════════════
       장터 — 주민 화면이 읽는 곳
       ═══════════════════════════════════════════════════════════ */
    if (u.pathname === '/market' && req.method === 'GET') {
      const now = NOW();
      const r = await env.DB.prepare(
        `SELECT id,seller,nick,data,state,sold,holds,heldAt,showAt,photos,phold,at
           FROM market WHERE state IN ('판매중','수확예정','확인중','마감','종료')
            AND (showAt='' OR showAt<=?1) LIMIT 500`).bind(now).all();
      /* 신고 수 — 가중치가 0이 된 기기(무고 3회)는 세지 않는다 */
      const rep = await env.DB.prepare(
        `SELECT r.mid mid, COUNT(*) n FROM report r LEFT JOIN device d ON d.dev=r.dev
          WHERE r.state='유효' AND COALESCE(d.bad,0) < ?1 GROUP BY r.mid`).bind(DEV_BAD_MAX).all();
      const nrep = {}; for (const x of (rep.results || [])) nrep[x.mid] = x.n;
      /* 등급(무사히 끝낸 거래)은 판매자에게 붙어 있다 */
      const sel = await env.DB.prepare('SELECT id,done FROM seller').all();
      const done = {}; for (const x of (sel.results || [])) done[x.id] = x.done || 0;

      const items = (r.results || []).map(x => {
        let d = {}; try { d = JSON.parse(x.data); } catch (e) { }
        const n = nrep[x.id] || 0, dn = done[x.seller] || 0;
        return { id: x.id, nick: x.nick, state: x.state, sold: x.sold || 0, at: x.at, data: d,
          photos: x.phold ? [] : pics(x), phold: !!x.phold,
          held: x.state === '확인중', reports: n, holds: x.holds || 0,
          sprout: dn < SPROUT_DONE,                       /* '새로 오신 분' 배지 */
          _score: BASE[x.state] + n * 50 + (x.holds || 0) * 100 - Math.min(dn, 10) * 20,
          _dl: MS(d['마감일시']) || 9e15 };
      });
      items.sort((p, q) => p._score - q._score || p._dl - q._dl);
      items.forEach(x => { delete x._score; delete x._dl; });
      return json({ items }, env);
    }

    /* ═══════════════════════════════════════════════════════════
       판매자 등록 — 담당자가 없으니 자동 승인이다.
       대신 '새로 오신 분'은 하루 1건, 첫 글은 24시간 뒤에 뜬다.
       광고·스팸은 즉시 노출이 안 되면 수지가 맞지 않아 오지 않는다.
       ═══════════════════════════════════════════════════════════ */
    if (u.pathname === '/seller' && req.method === 'POST') {
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const name = S(b.name, 20).trim(), nick = S(b.nick, 24).trim();
      const phone = S(b.phone, 20).replace(/[^\d]/g, '');
      const town = S(b.town, 40).trim(), crops = S(b.crops, 80).trim();
      if (name.length < 2) return json({ error: '이름을 적어 주세요' }, env, 400);
      if (!/^01[016-9]\d{7,8}$/.test(phone)) return json({ error: '휴대폰 번호를 다시 봐 주세요' }, env, 400);
      if (nick.length < 2) return json({ error: '장터에 뜰 이름을 적어 주세요' }, env, 400);
      if (!town) return json({ error: '어느 면·리에 사시는지 적어 주세요' }, env, 400);
      if (!b.agree) return json({ error: '연락처 수집에 동의해 주셔야 접수됩니다' }, env, 400);
      if (PHONE.test(nick) || BANK.test(nick))
        return json({ error: '장터에 뜰 이름에는 전화번호·계좌를 넣을 수 없습니다' }, env, 400);

      const dup = await env.DB.prepare('SELECT id, state FROM seller WHERE phone=?1').bind(phone).first();
      if (dup) {
        if (dup.state === '정지') return json({ error: '이 번호는 지금 장터 이용이 멈춰 있습니다.' }, env, 409);
        return json({ error: '이미 등록된 번호입니다. 쓰시던 판매자번호와 수정키로 되찾아 주세요.', dup: true }, env, 409);
      }
      const id = newId('s'), key = newKey(), at = NOW();
      const seq = await env.DB.prepare('SELECT COUNT(*) n FROM seller').first();
      const no = String(((seq && seq.n) || 0) + 1 + 100).padStart(4, '0');
      await env.DB.prepare('INSERT INTO seller (id,no,nick,keyhash,name,phone,town,crops,agrix,state,at,seenAt) ' +
        "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'승인',?10,?10)")
        .bind(id, no, nick, await hash(key, id), name, phone, town, crops, S(b.agrix, 30), at).run();
      return json({ id, no, nick, key, state: '승인', grade: '새로 오신 분' }, env);
    }

    if (u.pathname === '/seller/me' && req.method === 'GET') {
      const me = await whoami(req, env);
      if (!me) return json({ error: '수정키가 맞지 않습니다' }, env, 401);
      const n = await env.DB.prepare('SELECT COUNT(*) n FROM market WHERE seller=?1 AND state!=?2')
        .bind(me.id, '삭제됨').first();
      /* 게시자에게 갈 통보 — 신고가 들어온 내 글 */
      const nt = await env.DB.prepare(
        "SELECT id,notice,state,heldAt FROM market WHERE seller=?1 AND notice!='' AND state!='삭제됨'")
        .bind(me.id).all();
      return json({ me: { id: me.id, no: me.no, nick: me.nick, state: state_of(me),
        town: me.town, crops: me.crops, at: me.at, done: me.done || 0, holds: me.holds || 0,
        until: me.until || '', grade: grade_of(me), posts: (n && n.n) || 0 },
        notices: nt.results || [] }, env);
    }

    /* 내 글 — 아직 안 뜬 첫 글이나 내려간 글도 본인은 볼 수 있어야 고친다 */
    if (u.pathname === '/seller/posts' && req.method === 'GET') {
      const me = await whoami(req, env);
      if (!me) return json({ error: '수정키가 맞지 않습니다' }, env, 401);
      const r = await env.DB.prepare("SELECT id,data,state,sold,holds,heldAt,showAt,notice,photos,phold,at,edited " +
        "FROM market WHERE seller=?1 AND state!='삭제됨' ORDER BY at DESC LIMIT 200").bind(me.id).all();
      const rep = await env.DB.prepare("SELECT mid, COUNT(*) n FROM report r WHERE state='유효' GROUP BY mid").all();
      const nr = {}; for (const x of (rep.results || [])) nr[x.mid] = x.n;
      return json({ rows: (r.results || []).map(x => ({ ...x, photos: pics(x), phold: !!x.phold,
        data: (() => { try { return JSON.parse(x.data); } catch (e) { return {}; } })(),
        reports: nr[x.id] || 0 })) }, env);
    }

    /* ═══════════════════════════════════════════════════════════
       글 올리기·고치기 — 판매자 본인만 (수정키)
       ═══════════════════════════════════════════════════════════ */
    if (u.pathname === '/market' && req.method === 'POST') {
      const me = await whoami(req, env);
      if (!me) return json({ error: '판매자로 등록하신 뒤 올리실 수 있습니다' }, env, 401);
      const bad = stopped(me); if (bad) return json({ error: bad }, env, 403);
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const d = clean(b.data || {});
      const why = need(d); if (why) return json({ error: why }, env, 400);
      const bd = leak(d);
      if (bd) return json({ error: `'${bd}' 칸에 전화번호나 계좌로 보이는 것이 있습니다. 빼고 올려 주세요.` }, env, 400);

      const now = NOW(), today = now.slice(0, 10);
      const mine = await env.DB.prepare(
        "SELECT COUNT(*) n FROM market WHERE seller=?1 AND state!='삭제됨'").bind(me.id).first();
      const first = !(mine && mine.n);
      if ((me.done || 0) < SPROUT_DONE) {         /* 새로 오신 분 — 하루 한 건 */
        const t = await env.DB.prepare(
          "SELECT COUNT(*) n FROM market WHERE seller=?1 AND at>=?2 AND state!='삭제됨'")
          .bind(me.id, today + ' 00:00').first();
        if (t && t.n >= SPROUT_PER_DAY)
          return json({ error: '아직 새로 오신 분이라 하루에 한 건만 올리실 수 있습니다. 내일 다시 올려 주세요.' }, env, 429);
      }
      const showAt = first ? PLUS(FIRST_HOURS) : '';
      const id = newId('m');
      await env.DB.prepare('INSERT INTO market (id,seller,nick,data,state,showAt,at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
        .bind(id, me.id, me.nick, JSON.stringify(d), st_of(d), showAt, now).run();
      await touch(env, me.id, now);
      return json({ id, state: st_of(d), showAt,
        note: first ? '처음 올리신 글이라 24시간 뒤에 목록에 뜹니다.' : '' }, env);
    }

    /* 사진 올리기·지우기 — 글 주인만 */
    const um = u.pathname.match(/^\/market\/(m_[0-9a-z]{8})\/photo(?:\/(p_[0-9a-z]{8}\.(?:webp|jpg)))?$/);
    if (um) {
      const me = await whoami(req, env);
      const m = await env.DB.prepare('SELECT * FROM market WHERE id=?1').bind(um[1]).first();
      if (!m || m.state === '삭제됨') return json({ error: '그 글을 찾지 못했습니다' }, env, 404);
      if (!me || me.id !== m.seller) return json({ error: '이 글은 올리신 분만 고칠 수 있습니다' }, env, 403);
      const st = store(env);
      if (!st) return json({ error: '사진 저장소가 아직 없습니다' }, env, 503);
      const ps = pics(m), now = NOW();

      if (!um[2] && req.method === 'POST') {
        if (ps.length >= MAX_PHOTOS) return json({ error: `사진은 ${MAX_PHOTOS}장까지 올리실 수 있습니다` }, env, 400);
        const type = (req.headers.get('content-type') || '').split(';')[0].trim();
        if (!PHOTO_TYPES[type]) return json({ error: '사진 파일만 올리실 수 있습니다' }, env, 400);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength) return json({ error: '사진이 비어 있습니다' }, env, 400);
        if (buf.byteLength > MAX_BYTES)
          return json({ error: `사진 한 장이 ${Math.round(MAX_BYTES / 1024)}KB 를 넘습니다. 다시 찍어 주세요.` }, env, 413);
        if (!isImage(buf, type)) return json({ error: '사진 파일이 아닙니다' }, env, 400);
        const pid = newId('p') + '.' + PHOTO_TYPES[type];
        await st.put(`photo/${m.id}/${pid}`, buf, type);
        const next = ps.concat(pid);
        /* 사진을 새로 올리면 사진 가림은 풀린다 — 고치면 저절로 복귀하는 것과 같은 규칙이다 */
        await env.DB.prepare('UPDATE market SET photos=?2, phold=0, notice=?3, edited=?4 WHERE id=?1')
          .bind(m.id, JSON.stringify(next), m.phold ? '' : m.notice, now).run();
        if (m.phold) await env.DB.prepare("UPDATE report SET state='해소' WHERE mid=?1 AND why='photo'").bind(m.id).run();
        await touch(env, me.id, now);
        return json({ ok: true, pid, url: `/photo/${m.id}/${pid}`, photos: next, bytes: buf.byteLength }, env);
      }

      if (um[2] && req.method === 'DELETE') {
        if (!ps.includes(um[2])) return json({ error: '그 사진이 없습니다' }, env, 404);
        try { await st.del(`photo/${m.id}/${um[2]}`); } catch (e) { }
        const next = ps.filter(x => x !== um[2]);
        /* 지우는 것도 시정이다. 석 장이 다 찬 글이 사진 신고를 받으면
           새로 올릴 자리가 없어 가림을 풀 길이 없어진다. */
        await env.DB.prepare('UPDATE market SET photos=?2, phold=0, notice=?3, edited=?4 WHERE id=?1')
          .bind(m.id, JSON.stringify(next), m.phold ? '' : m.notice, now).run();
        if (m.phold) await env.DB.prepare("UPDATE report SET state='해소' WHERE mid=?1 AND why='photo'").bind(m.id).run();
        await touch(env, me.id, now);
        return json({ ok: true, photos: next, unheld: !!m.phold }, env);
      }
      return json({ error: '없는 주소입니다' }, env, 404);
    }

    const mm = u.pathname.match(/^\/market\/(m_[0-9a-z]{8})(?:\/(ok|done|sold|report))?$/);
    if (mm) {
      const id = mm[1], sub = mm[2] || '';
      const m = await env.DB.prepare('SELECT * FROM market WHERE id=?1').bind(id).first();
      if (!m || m.state === '삭제됨') return json({ error: '그 글을 찾지 못했습니다' }, env, 404);

      /* ── 신고 (누구나) ── */
      if (sub === 'report' && req.method === 'POST') {
        let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
        const dev = S(b.dev, 40).trim(), why = S(b.why, 10);
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(dev)) return json({ error: '신고를 받지 못했습니다' }, env, 400);
        if (!WHY[why]) return json({ error: '무슨 일로 신고하시는지 골라 주세요' }, env, 400);
        const now = NOW();
        const dup = await env.DB.prepare('SELECT id FROM report WHERE mid=?1 AND dev=?2').bind(id, dev).first();
        if (dup) return json({ error: '이미 신고하신 글입니다', dup: true }, env, 409);
        const day = await env.DB.prepare('SELECT COUNT(*) n FROM report WHERE dev=?1 AND at>=?2')
          .bind(dev, now.slice(0, 10) + ' 00:00').first();
        if (day && day.n >= REPORT_PER_DAY)
          return json({ error: '하루에 세 건까지만 신고하실 수 있습니다' }, env, 429);

        await env.DB.prepare('INSERT INTO report (id,mid,dev,why,at) VALUES (?1,?2,?3,?4,?5)')
          .bind(newId('r'), id, dev, why, now).run();
        const out = await after_report(env, m, why, now);
        return json({ ok: true, ...out }, env);
      }

      /* 아래는 모두 글 주인만 */
      const me = await whoami(req, env);
      if (!me || me.id !== m.seller) return json({ error: '이 글은 올리신 분만 고칠 수 있습니다' }, env, 403);
      const now = NOW();

      /* ── 고치기 — 신고가 저절로 풀린다 ── */
      if (!sub && req.method === 'PUT') {
        let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
        const d = clean(b.data || {});
        const why = need(d); if (why) return json({ error: why }, env, 400);
        const bd = leak(d);
        if (bd) return json({ error: `'${bd}' 칸에 전화번호나 계좌로 보이는 것이 있습니다. 빼고 올려 주세요.` }, env, 400);
        await env.DB.prepare('UPDATE market SET data=?2, edited=?3 WHERE id=?1')
          .bind(id, JSON.stringify(d), now).run();
        await env.DB.prepare("UPDATE report SET state='해소' WHERE mid=?1 AND state='유효'").bind(id).run();
        const back = await recover(env, m, now, '고침');
        await touch(env, me.id, now);
        return json({ ok: true, ...back }, env);
      }

      /* ── 이의 — "고칠 것이 없습니다" ── */
      if (sub === 'ok' && req.method === 'POST') {
        if (m.state !== '확인중') return json({ error: '지금은 확인중인 글이 아닙니다' }, env, 400);
        await env.DB.prepare("UPDATE report SET state='이의', judgeAt=?2, holdsAt=?3 WHERE mid=?1 AND state='유효'")
          .bind(id, PLUS(JUDGE_DAYS * 24), m.holds || 0).run();
        const back = await recover(env, m, now, '이의');
        await touch(env, me.id, now);
        return json({ ok: true, ...back,
          note: '올려 두었습니다. 이레 뒤에도 같은 신고가 없으면 그 신고는 무고로 봅니다.' }, env);
      }

      /* ── 몇 개 나갔는지 ── 주문은 구글 폼으로 가므로 숫자는 판매자가 넣는다 ── */
      if (sub === 'sold' && req.method === 'POST') {
        let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
        const n = Math.max(0, +b.n || 0);
        let d = {}; try { d = JSON.parse(m.data); } catch (e) { }
        const qty = +(d['수량'] || 0) || 0;
        const st = (qty && n >= qty && (m.state === '판매중' || m.state === '수확예정')) ? '마감' : m.state;
        await env.DB.prepare('UPDATE market SET sold=?2, state=?3, edited=?4 WHERE id=?1')
          .bind(id, n, st, now).run();
        await touch(env, me.id, now);
        return json({ ok: true, sold: n, state: st }, env);
      }

      /* ── 다 팔렸어요 ── */
      if (sub === 'done' && req.method === 'POST') {
        await env.DB.prepare("UPDATE market SET state='종료', edited=?2 WHERE id=?1").bind(id, now).run();
        await env.DB.prepare('UPDATE seller SET done=done+1, seenAt=?2 WHERE id=?1').bind(me.id, now).run();
        return json({ ok: true, state: '종료' }, env);
      }

      /* ── 지우기 ── */
      if (!sub && req.method === 'DELETE') {
        await wipe(env, m);                       /* 글이 사라지면 사진도 남을 이유가 없다 */
        await env.DB.prepare("UPDATE market SET state='삭제됨', data='{}', notice='', edited=?2 WHERE id=?1")
          .bind(id, now).run();
        await env.DB.prepare('DELETE FROM report WHERE mid=?1').bind(id).run();
        await touch(env, me.id, now);
        return json({ ok: true, state: '삭제됨' }, env);
      }
      return json({ error: '없는 주소입니다' }, env, 404);
    }

    /* ═══════════════════════════════════════════════════════════
       한 달에 5분 — 담당자가 들여다보는 곳
       ═══════════════════════════════════════════════════════════ */
    if (u.pathname === '/admin/seller' && req.method === 'GET') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      const r = await env.DB.prepare("SELECT id,no,nick,name,phone,town,crops,agrix,memo,state,until," +
        "done,holds,at,seenAt FROM seller ORDER BY (state='정지') DESC, at DESC LIMIT 500").all();
      return json({ rows: (r.results || []).map(x => ({ ...x, grade: grade_of(x) })) }, env);
    }

    if (u.pathname === '/admin/seller' && req.method === 'POST') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const id = S(b.id, 40), act = S(b.act, 10), memo = S(b.memo, 300);
      const s = await env.DB.prepare('SELECT * FROM seller WHERE id=?1').bind(id).first();
      if (!s) return json({ error: '그 판매자를 찾지 못했습니다' }, env, 404);
      if (act === '해제') {
        await env.DB.prepare("UPDATE seller SET state='승인', until='', holds=0, memo=?2 WHERE id=?1")
          .bind(id, memo).run();
        return json({ ok: true, state: '승인' }, env);
      }
      if (act === '정지') {
        await env.DB.prepare("UPDATE seller SET state='정지', until='', memo=?2 WHERE id=?1").bind(id, memo).run();
        await env.DB.prepare("UPDATE market SET state='숨김' WHERE seller=?1 AND state IN ('판매중','수확예정','확인중')")
          .bind(id).run();
        return json({ ok: true, state: '정지' }, env);
      }
      if (act === '재발급') {
        const key = newKey();
        await env.DB.prepare('UPDATE seller SET keyhash=?2 WHERE id=?1').bind(id, await hash(key, id)).run();
        return json({ ok: true, key }, env);
      }
      if (act === '메모') {
        await env.DB.prepare('UPDATE seller SET memo=?2 WHERE id=?1').bind(id, memo).run();
        return json({ ok: true }, env);
      }
      return json({ error: '무슨 처리인지 모르겠습니다' }, env, 400);
    }

    if (u.pathname === '/admin/market' && req.method === 'GET') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      const r = await env.DB.prepare("SELECT * FROM market WHERE state!='삭제됨' " +
        "ORDER BY (state='확인중') DESC, at DESC LIMIT 500").all();
      const rep = await env.DB.prepare(
        "SELECT mid, why, state, COUNT(*) n FROM report GROUP BY mid, why, state").all();
      const by = {}; for (const x of (rep.results || []))
        (by[x.mid] = by[x.mid] || []).push({ why: x.why, state: x.state, n: x.n });
      return json({ rows: (r.results || []).map(x => ({ ...x,
        data: (() => { try { return JSON.parse(x.data); } catch (e) { return {}; } })(),
        reports: by[x.id] || [] })) }, env);
    }

    if (u.pathname === '/admin/market' && req.method === 'POST') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      let b; try { b = await req.json(); } catch (e) { return json({ error: '형식 오류' }, env, 400); }
      const id = S(b.id, 40), act = S(b.act, 10), memo = S(b.memo, 300);
      const m = await env.DB.prepare('SELECT * FROM market WHERE id=?1').bind(id).first();
      if (!m) return json({ error: '그 글을 찾지 못했습니다' }, env, 404);
      if (act === '숨김' || act === '마감' || act === '종료') {
        await env.DB.prepare('UPDATE market SET state=?2, edited=?3 WHERE id=?1').bind(id, act, NOW()).run();
        return json({ ok: true, state: act }, env);
      }
      if (act === '삭제') {
        await env.DB.prepare('DELETE FROM market WHERE id=?1').bind(id).run();
        await env.DB.prepare('DELETE FROM report WHERE mid=?1').bind(id).run();
        return json({ ok: true, deleted: id }, env);
      }
      return json({ error: '무슨 처리인지 모르겠습니다' }, env, 400);
    }

    /* 새벽 청소를 손으로 돌려 보는 곳 (평소엔 Cron 이 알아서 돈다) */
    if (u.pathname === '/admin/cron' && req.method === 'POST') {
      if (!ok(req, env)) return json({ error: '코드가 맞지 않습니다' }, env, 401);
      return json(await sweep(env), env);
    }

    return json({ error: '없는 주소입니다' }, env, 404);
  },

  /* 매일 새벽 — 마감·종료·무응답 정리·파기를 한 번에 돈다 */
  async scheduled(ev, env, ctx) { ctx.waitUntil(sweep(env)); },
};
