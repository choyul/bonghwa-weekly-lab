/* ═══════════════════════════════════════════════════════════════════════════
   analytics.js — '오늘의 봉화' 이용 통계 수집기 (군민용 화면 전용)

   이 앱이 실제로 쓸모가 있는지 보려고 만든 것이다. 답하고 싶은 질문은 다섯 가지.
     ① 얼마나 들어오나 (사람 수 · 새로 온 사람 · 다시 온 사람)
     ② 무엇을 많이 보나 (화면별 · 소식별)
     ③ 어디에서 그만두나 (세션의 마지막 화면)
     ④ 언제 쓰나 (요일 × 시간대)
     ⑤ 무엇을 남에게 보내나 (공유한 소식 · 공유 수단)

   개인정보는 담지 않는다.
     - 이름·전화·아이피를 보내지 않는다(아이피는 수집 서버도 저장하지 않는다).
     - 방문자 구분은 이 기기에서 만든 임의의 난수 하나뿐이다(bh.an.v). 되돌려서
       사람을 알아낼 수 없고, 브라우저 자료를 지우면 새 사람으로 잡힌다.
     - 관심 업무·맞춤 설정 같은 개인 저장분은 건드리지 않는다.

   앱을 방해하지 않는 것을 첫째로 둔다. 수집 주소가 비었거나, 통신이 실패하거나,
   이 파일이 통째로 안 받아져도 화면은 그대로 돌아가야 한다. 그래서 모든 호출부는
   public.html 에서 `window.BWA && BWA.view(...)` 처럼 방어적으로 부른다.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';

  /* ── 수집 주소 ──────────────────────────────────────────────────────────
     Cloudflare Worker 를 올린 뒤 그 주소로 바꾼다. analytics/setup.sh 가 대신 넣어준다.
     'PUT-WORKER-URL-HERE' 그대로면 아무것도 보내지 않는다(= 통계 꺼짐). */
  var EP = "https://bonghwa-stat.balance-cho.workers.dev";

  var OFF = !EP || EP.indexOf('PUT-WORKER-URL') === 0;

  /* 사람이 아닌 것(검색엔진 수집기 등)과 개발 중인 내 컴퓨터는 빼고 센다 */
  var UA = navigator.userAgent || '';
  var BOT = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|headless|lighthouse|gtmetrix|pingdom/i.test(UA);
  var LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
  if (OFF || BOT || LOCAL || navigator.webdriver) { g.BWA = stub(); return; }

  /* 통계를 원치 않는 사람은 주소 뒤에 ?nostat=1 을 한 번 붙이면 이 기기에서 영영 꺼진다 */
  try {
    var justOff = /[?&]nostat=1/.test(location.search);
    if (justOff) localStorage.setItem('bhlab.an.off', '1');
    if (localStorage.getItem('bhlab.an.off') === '1') {
      /* 껐다는 것을 알려 준다 — 아무 반응이 없으면 눌러도 된 건지 알 수 없다 */
      if (justOff) addEventListener('load', function () {
        setTimeout(function () { if (g.BWUI && g.BWUI.toast) g.BWUI.toast('이 기기에서는 이용 기록을 모으지 않습니다'); }, 1800);
      });
      g.BWA = stub(); return;
    }
  } catch (e) { }

  function stub() { var n = function () { }; return { view: n, act: n, off: true }; }

  /* ── 방문자 · 방문 구분 ────────────────────────────────────────────────
     vid : 이 기기의 익명 번호(오래 감) — '다시 온 사람'을 세는 데만 쓴다
     sid : 이번 방문 하나의 번호(탭을 닫으면 끝) — '한 번 들어와서 무엇을 했나'의 묶음 */
  function rnd() {
    try {
      var a = new Uint8Array(9); crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (x) { return (x % 36).toString(36) }).join('');
    } catch (e) { return Math.random().toString(36).slice(2, 11) }
  }
  function ss(k, v) {                 /* 한 번 감싸 둔다 — 사파리 비공개 모드에선 저장이 막힌다 */
    try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  var isNew = 0, vid = '', sid = '';
  try {
    vid = localStorage.getItem('bhlab.an.v') || '';
    if (!vid) { vid = rnd(); isNew = 1; localStorage.setItem('bhlab.an.v', vid); }
  } catch (e) { vid = rnd(); isNew = 1; }

  /* ── 새로고침·뒤로가기로 페이지가 다시 떠도 '한 번의 방문'으로 이어 붙인다 ──
     방문 번호(sid)·시작 시각(t0)·마지막 순번(q)을 탭에 남겨 두고 이어서 쓴다.
     이걸 안 하면 다시 뜰 때 순번이 1부터 시작해 서버가 '이미 받은 것'으로 보고
     버려 버린다 — 새로고침 뒤의 행동이 통째로 사라진다. */
  sid = ss('bhlab.an.s') || '';
  var T0 = Number(ss('bhlab.an.t0')) || 0;
  var seq = Number(ss('bhlab.an.q')) || 0;
  var freshSession = !sid;
  if (!sid) {
    sid = rnd() + rnd().slice(0, 4); T0 = Date.now(); seq = 0;
    ss('bhlab.an.s', sid); ss('bhlab.an.t0', T0);
  }
  if (!T0) T0 = Date.now();          /* 저장이 반쪽만 남은 이상한 상태 대비 */
  var views = Number(ss('bhlab.an.n')) || 0;

  /* ── 기기·유입 정보 (원문 UA 는 보내지 않고 여기서 갈래만 뽑는다) ────────── */
  function deviceInfo() {
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(UA);
    var tablet = /iPad|Tablet|SM-T/i.test(UA);
    var os = /iPhone|iPad|iPod/i.test(UA) ? 'iOS'
      : /Android/i.test(UA) ? 'Android'
        : /Mac OS X/i.test(UA) ? 'Mac'
          : /Windows/i.test(UA) ? 'Windows' : '기타';
    /* 인앱 브라우저(앱 안에서 열리는 창)는 기능 제약이 커서 따로 센다.
       특히 카카오톡 인앱에는 OS 공유 시트가 아예 없다 — 공유 수치를 읽을 때 반드시 필요한 구분. */
    var inapp = /KAKAOTALK/i.test(UA) ? '카카오톡'
      : /NAVER\(inapp/i.test(UA) || /NAVER/i.test(UA) ? '네이버'
        : /DaumApps|Daum/i.test(UA) ? '다음'
          : /Instagram/i.test(UA) ? '인스타그램'
            : /FBAN|FBAV/i.test(UA) ? '페이스북'
              : /Line\//i.test(UA) ? '라인' : '';
    var browser = inapp ? (inapp + ' 인앱')
      : /SamsungBrowser/i.test(UA) ? '삼성인터넷'
        : /Edg\//i.test(UA) ? '엣지'
          : /Whale/i.test(UA) ? '웨일'
            : /Chrome|CriOS/i.test(UA) ? '크롬'
              : /Firefox|FxiOS/i.test(UA) ? '파이어폭스'
                : /Safari/i.test(UA) ? '사파리' : '기타';
    return {
      device: tablet ? '태블릿' : (mobile ? '휴대폰' : '컴퓨터'),
      os: os, browser: browser, inapp: inapp
    };
  }

  function entryKind() {
    var p = location.search;
    if (/[?&](i|item)=/.test(p)) return '공유링크';     /* 친구가 보낸 링크로 들어옴 */
    if (/[?&](r|remind)=/.test(p)) return '알림링크';   /* 카톡 → 기본 브라우저 전환 */
    if (/[?&]add=1/.test(p)) return '설치안내';
    if (isStandalone()) return '바탕화면';               /* 설치한 아이콘으로 열었다 = 재방문 의지 */
    if (document.referrer) return '외부링크';
    return '직접';
  }
  function isStandalone() {
    return (g.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function refHost() {
    try {
      if (!document.referrer) return '';
      var h = new URL(document.referrer).hostname.replace(/^www\./, '');
      return h === location.hostname ? '' : h;     /* 우리 사이트 안에서 넘어온 것은 유입이 아니다 */
    } catch (e) { return '' }
  }

  /* ── 보낼 것 모으기 ────────────────────────────────────────────────────
     이벤트마다 seq(순번)와 t(방문 시작 후 몇 ms)를 붙인다. 서버는 이 둘로
     '어느 화면에 몇 초 머물렀나'와 '마지막에 어느 화면에서 나갔나'를 계산한다.
     → 화면마다 끝날 때 또 한 번 보낼 필요가 없어져 통신이 절반으로 준다. */
  function now() { return Math.max(0, Date.now() - T0); }

  var queue = [], flushT = null;
  var MAX_SEND = 400;   /* 한 방문에서 이 이상은 보내지 않는다(오작동으로 무한히 쌓이는 것 방지) */

  function cut(s, n) { s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }

  function push(type, name, key, title) {
    if (seq >= MAX_SEND) return;
    seq++; ss('bhlab.an.q', seq);
    queue.push({ q: seq, t: now(), ty: type, nm: cut(name, 40), k: cut(key, 120), ti: cut(title, 160) });
    if (queue.length >= 20) flush();
    else if (!flushT) flushT = setTimeout(flush, 4000);   /* 몇 개 모아서 한 번에 — 통신을 아낀다 */
  }

  function payload(list, final) {
    var o = { v: 1, s: 'public', vid: vid, sid: sid, evs: list };
    if (final) o.fin = 1;
    if (!meta.done) {                    /* 방문 정보는 첫 전송에 한 번만 실어 보낸다 */
      meta.done = true;
      var d = deviceInfo();
      o.m = {
        neu: isNew, dev: d.device, os: d.os, br: d.browser, inapp: d.inapp,
        std: isStandalone() ? 1 : 0, ent: entryKind(), ref: cut(refHost(), 80),
        lang: cut(navigator.language, 12), sw: (g.screen && screen.width) || 0,
        tz: new Date().getTimezoneOffset()
      };
    }
    if (final) { o.end = { dur: now(), views: views, scroll: maxScroll, last: cut(lastView, 40) }; }
    return JSON.stringify(o);
  }
  var meta = { done: !freshSession };   /* 새로고침으로 다시 뜬 경우엔 방문 정보를 또 보내지 않는다 */

  function send(body, beacon) {
    try {
      /* 페이지를 떠나는 순간에는 fetch 가 잘려서 sendBeacon 이 유일하게 믿을 만하다.
         text/plain 으로 보내면 브라우저가 사전요청(preflight)을 하지 않아 한 번에 끝난다. */
      /* [테스트본] 전송 차단 — 테스트 트래픽이 운영 통계에 섞이면 판단 근거가 오염된다.
       코드 구조 비교를 위해 함수는 남기고 전송 직전에만 끊는다. */
    if (true) { console.debug('[bhlab] analytics 전송 차단:', o); return; }
    if (beacon && navigator.sendBeacon) {
        var b = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(EP + '/c', b)) return;
      }
      fetch(EP + '/c', {
        method: 'POST', body: body, keepalive: true, mode: 'cors', credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      }).catch(function () { });
    } catch (e) { }
  }

  function flush(final) {
    if (flushT) { clearTimeout(flushT); flushT = null; }
    if (!queue.length && !final) return;
    var list = queue; queue = [];
    send(payload(list, final), !!final);
  }

  /* ── 화면 머문 정도 ────────────────────────────────────────────────────
     스크롤을 얼마나 내렸는지는 '읽었는지 그냥 닫았는지'를 가르는 가장 싼 신호다. */
  var maxScroll = 0, lastView = '';   /* views 는 위에서 탭에 남겨 둔 값을 이어받는다 */
  function onScroll() {
    var h = document.documentElement;
    var total = (h.scrollHeight || 1) - (g.innerHeight || 1);
    var p = total > 0 ? Math.round((g.scrollY || h.scrollTop || 0) / total * 100) : 100;
    if (p > maxScroll) maxScroll = Math.max(0, Math.min(100, p));
  }
  addEventListener('scroll', onScroll, { passive: true });

  /* 끝맺음 — 휴대폰(특히 아이폰)에서는 pagehide 가 안 오는 경우가 있어 visibilitychange 를 같이 쓴다.
     두 번 불려도 ended 로 한 번만 보낸다. 다시 돌아오면 이어서 또 셀 수 있게 풀어 준다. */
  var ended = false;
  function finish() { if (ended) return; ended = true; flush(true); }
  addEventListener('pagehide', finish);
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') finish();
    else ended = false;                       /* 화면으로 돌아옴 — 이후 활동도 계속 기록 */
  });

  /* ── 밖에서 쓰는 함수 두 개 ──────────────────────────────────────────── */
  g.BWA = {
    /* 화면 하나를 열었다 (목록·상세·모달 모두 '화면'으로 센다) */
    view: function (name, key, title) { views++; ss('bhlab.an.n', views); lastView = name; push('view', name, key, title); },
    /* 무언가를 눌렀다 (공유·알림·전화·검색 등) */
    act: function (name, key, title) { push('act', name, key, title); },
    off: false
  };

  /* ── 밖으로 나가는 누름은 여기서 한꺼번에 잡는다 ──
     전화·봉화군 원문 보기처럼 앱을 떠나는 행동은 링크(<a>)라서 화면 쪽 코드를 고치지 않고도
     클릭을 가로채 셀 수 있다. capture 단계로 받아 두면 중간에서 이벤트를 막아도 놓치지 않는다. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) { g.BWA.act('전화문의', href.replace(/^tel:/i, '')); return; }
    if (/^sms:/i.test(href)) return;                       /* 공유 문자는 이미 따로 센다 */
    if (/^https?:/i.test(href)) {
      try {
        var h = new URL(href, location.href).hostname.replace(/^www\./, '');
        if (h && h !== location.hostname) g.BWA.act('바깥으로', h, cut(a.textContent, 60));
      } catch (err) { }
    }
  }, true);

  onScroll();
})(window);
