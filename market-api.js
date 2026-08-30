/* ═══════════════════════════════════════════════════════════════
   market-api.js — 장터가 서버(bonghwa-lab)와 이야기하는 곳.

   장터 자료는 이제 구글 시트가 아니라 서버(D1)에 있다.
   주민이 직접 올리고 고칠 수 있어야 하는데, 시트는 주민이 쓸 수가 없다.

   판매자 표시는 '수정키' 하나로 한다. 로그인도 회원가입도 없다.
   서버가 만들어 준 수정키를 이 기기에 넣어 두었다가 그대로 내민다 —
   그래서 같은 휴대폰에서는 아무것도 묻지 않는다.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  /* 시험할 때만 ?api=http://localhost:8787 로 서버를 바꿔 볼 수 있다.
     로컬 주소가 아니면 무시한다 — 낯선 주소가 붙은 링크로 남의 서버에 자료를 보내게 되면 안 된다. */
  const q = new URLSearchParams(location.search).get('api') || '';
  const local = /^http:\/\/localhost:\d+$/.test(q) ? q : '';
  const EP = local || (G.MARKET_CONFIG && G.MARKET_CONFIG.api) ||
             (G.LABAPI && G.LABAPI.EP) || 'https://bonghwa-lab.balance-cho.workers.dev';
  const MEKEY = 'bhlab.market.me';

  /* ── 이 기기에 든 판매자 표시 ── */
  function me() { try { return JSON.parse(localStorage.getItem(MEKEY)) || null; } catch (e) { return null; } }
  function setMe(v) {
    try { v ? localStorage.setItem(MEKEY, JSON.stringify(v)) : localStorage.removeItem(MEKEY); } catch (e) { }
  }
  function head() {
    const m = me(); if (!m || !m.key) return {};
    return { 'x-lab-key': m.key, 'x-lab-id': m.id || m.no || '' };
  }

  async function jf(path, opt) {
    const r = await fetch(EP + path, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || '서버가 응답하지 않습니다'); e.body = j; e.status = r.status; throw e; }
    return j;
  }

  /* ── 팔고 있는 글 ── */
  async function list() {
    try {
      const j = await jf('/market', { cache: 'no-store' });
      return { items: j.items || [] };
    } catch (e) { return { error: '장터 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }; }
  }

  /* ── 판매자 등록 신청 ──
     성공하면 수정키를 딱 한 번 돌려준다. 그 자리에서 이 기기에 넣어 둔다. */
  async function register(f) {
    try {
      const j = await jf('/seller', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
      setMe({ id: j.id, no: j.no, nick: j.nick, key: j.key, state: j.state || '대기' });
      return { ok: true, ...j };
    } catch (e) { return { ok: false, why: e.message, dup: !!(e.body && e.body.dup) }; }
  }

  /* ── 내 등록이 어떻게 되었는지 (승인 났는지) ── */
  async function refresh() {
    const m = me(); if (!m) return null;
    try {
      const j = await jf('/seller/me', { cache: 'no-store', headers: head() });
      const next = { ...m, ...j.me, key: m.key };
      setMe(next);
      return next;
    } catch (e) {
      if (e.status === 401) return { ...m, state: '열쇠오류' };
      return m;                                    /* 서버에 못 닿으면 알던 것을 그대로 쓴다 */
    }
  }

  /* ── 다른 휴대폰에서 내 것 되찾기 (판매자번호 + 수정키) ── */
  async function signIn(no, key) {
    const cand = { id: '', no: String(no || '').trim(), key: String(key || '').trim().toUpperCase() };
    try {
      const j = await jf('/seller/me', { cache: 'no-store',
        headers: { 'x-lab-key': cand.key, 'x-lab-id': cand.no } });
      setMe({ ...cand, ...j.me, key: cand.key });
      return { ok: true, me: me() };
    } catch (e) { return { ok: false, why: '판매자번호나 수정키가 맞지 않습니다' }; }
  }

  function signOut() { setMe(null); }

  G.MKAPI = { EP, list, register, refresh, signIn, signOut, me, setMe, MEKEY };
})(window);
