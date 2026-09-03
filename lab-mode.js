/* ═══════════════════════════════════════════════════════════════
   lab-mode.js — 같은 사업을 '두 판'으로 보여 주기 위한 스위치.

     🔗 연동판(api)  — 농산물품질관리원 농업경영체 정보를 불러왔다고 가정한다.
                       등록 상태·경작 면적이 자동으로 채워지고, 담당자 화면에서는
                       건마다 자격 판정이 이미 붙어 있다.
     ✋ 수기판(manual) — 아무 데도 묻지 않는다. 주민이 적은 대로 접수되고,
                       담당자가 대장을 열어 한 건씩 손으로 대조한다.

   두 판은 같은 코드·같은 사업·같은 접수함을 쓴다. 다른 것은 '확인이 어디서
   일어나는가' 하나뿐이다. 그 하나가 담당자의 하루를 어떻게 바꾸는지 보이려고
   판을 가른다.

   고르는 법 — 주소에 ?mode=api / ?mode=manual, 또는 [⚙️ 설정]에서.
   고른 판은 이 기기에 남는다(bhlab.mode).
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  const KEY = 'bhlab.mode';
  const ok = m => m === 'api' || m === 'manual';
  let cur = null;

  function get() {
    if (cur) return cur;
    try {                                   /* 주소로 준 것이 가장 세다 — 시연 때 두 주소를 나란히 연다 */
      const q = new URLSearchParams(location.search).get('mode');
      if (ok(q)) { cur = q; try { localStorage.setItem(KEY, q); } catch (e) { } return cur; }
    } catch (e) { }
    try { const v = localStorage.getItem(KEY); if (ok(v)) return (cur = v); } catch (e) { }
    return (cur = 'api');                   /* 기본은 연동판 — 지금까지 보여 주던 그 화면 */
  }
  function set(m) { if (!ok(m)) return; cur = m; try { localStorage.setItem(KEY, m); } catch (e) { } }

  G.LABMODE = {
    get, set, KEY,
    isApi: () => get() === 'api',
    LABEL: { api: '경영체 연동판', manual: '수기 접수판' },
    SHORT: { api: '🔗 연동', manual: '✋ 수기' },
    WHY: {
      api: '농업경영체 정보를 불러와 등록 상태·면적을 그 자리에서 확인합니다.',
      manual: '확인할 데가 없어, 적어 주신 대로 받아 두고 담당자가 나중에 대조합니다.',
    },
  };
})(window);
