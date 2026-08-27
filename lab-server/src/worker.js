/* ═══════════════════════════════════════════════════════════════
   bonghwa-lab — 테스트본 전용 저장소
   운영 통계(bonghwa-stat)와 데이터베이스·워커가 모두 별개다.

   GET  /cfg              관리자 설정 전체 (공개 — 주민 화면이 읽는다)
   PUT  /cfg              설정 저장        (관리자 코드 필요)
   POST /apply            온라인 접수      (공개)
   GET  /apply?code=...   접수 내역        (관리자 코드 필요)
   ═══════════════════════════════════════════════════════════════ */
/* 허용 주소 — 배포본과 로컬 미리보기 둘 다. 테스트본이라 이 정도만 연다. */
const OK_ORIGIN = o => !!o && (o === 'https://choyul.github.io' || /^http:\/\/localhost:\d+$/.test(o));
const CORS = (env, req) => ({
  'access-control-allow-origin': (req && OK_ORIGIN(req.headers.get('origin')))
    ? req.headers.get('origin') : (env.ALLOW_ORIGIN || 'https://choyul.github.io'),
  'vary': 'origin',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-lab-code',
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

export default {
  async fetch(req, env) {
    REQ = req;
    const u = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS(env, req) });

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
      const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
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
      const at = new Date().toISOString().slice(0, 16).replace('T', ' ');
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

    return json({ error: '없는 주소입니다' }, env, 404);
  },
};
