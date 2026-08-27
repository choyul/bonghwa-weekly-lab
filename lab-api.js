/* ═══════════════════════════════════════════════════════════════
   lab-api.js — 테스트 서버(bonghwa-lab)와 이야기하는 곳.
   운영 통계(bonghwa-stat)와는 워커도 데이터베이스도 별개다.

   서버가 안 되면 이 기기(localStorage)로 물러난다 —
   담당자가 설정하던 것이 통째로 날아가지는 않게.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  const EP = 'https://bonghwa-lab.balance-cho.workers.dev';
  const CKEY = 'bhlab.admin.cfg', LOGKEY = 'bhlab.apply.log', CODEKEY = 'bhlab.admin.code';

  const lget = k => { try { return JSON.parse(localStorage.getItem(k)) || (k === LOGKEY ? [] : {}); } catch (e) { return k === LOGKEY ? [] : {}; } };
  const lset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const code = () => { try { return sessionStorage.getItem(CODEKEY) || ''; } catch (e) { return ''; } };

  async function pullCfg() {
    try {
      const r = await fetch(EP + '/cfg', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const j = await r.json();
      lset(CKEY, j.cfg || {});                 /* 서버 것을 기기에도 받아 둔다(오프라인 대비) */
      return { cfg: j.cfg || {}, from: 'server' };
    } catch (e) { return { cfg: lget(CKEY), from: 'local' }; }
  }

  async function pushCfg(id, cfg, by) {
    const all = lget(CKEY); all[id] = cfg; lset(CKEY, all);   /* 먼저 기기에 */
    try {
      const r = await fetch(EP + '/cfg', { method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-lab-code': code() },
        body: JSON.stringify({ id, cfg, by: by || '' }) });
      if (!r.ok) return { ok: false, why: (await r.json().catch(() => ({}))).error || '서버에 저장하지 못했습니다' };
      return { ok: true };
    } catch (e) { return { ok: false, why: '서버에 닿지 못했습니다 (이 기기에는 저장했습니다)' }; }
  }

  async function apply(rec) {
    try {
      const r = await fetch(EP + '/apply', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, full: !!j.full, why: j.error || '접수하지 못했습니다' };
      const l = lget(LOGKEY); l.push({ ...rec, no: j.no, at: j.at }); lset(LOGKEY, l);
      return { ok: true, no: j.no, at: j.at };
    } catch (e) { return { ok: false, why: '서버에 닿지 못했습니다. 잠시 뒤 다시 해 주세요.' }; }
  }

  async function applyList() {
    try {
      const r = await fetch(EP + '/apply?code=' + encodeURIComponent(code()), { cache: 'no-store' });
      if (!r.ok) throw 0;
      return (await r.json()).rows || [];
    } catch (e) { return lget(LOGKEY).map(x => ({ no: x.no, sid: x.sid, title: x.title, dept: x.dept, at: x.at, data: x.data || x.d || {}, agrix: x.agrix })); }
  }

  /* 내가 이 사업에 이미 접수했는지 — 기기 기록으로만 본다(서버에 개인 식별자를 두지 않는다) */
  function mine(sid) { return lget(LOGKEY).some(r => r.sid === sid || r.id === sid); }
  function setCode(c) { try { sessionStorage.setItem(CODEKEY, c); } catch (e) { } }

  G.LABAPI = { EP, pullCfg, pushCfg, apply, applyList, mine, setCode, CKEY, LOGKEY };
})(window);
