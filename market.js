/* ═══════════════════════════════════════════════════════════════
   market.js — 지역 농산물 장터

   자료는 운영자가 구글 시트를 '웹에 게시'로 연 CSV 두 장뿐이다.
   서버·로그인·결제는 없다. 사이트는 보여 주기만 하고,
   주문은 구글 폼으로 넘긴다(계좌·연락처는 폼 회신으로만 간다).

   화면 주소는 /market 이 아니라 #market 을 쓴다 —
   깃허브 페이지는 정적 호스팅이라 /market 로 들어오면 404 가 난다.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  const CFG = G.MARKET_CONFIG || {};
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AV = (n, k, t) => { if (G.BWA) try { BWA.view(n, k, t); } catch (e) { } };
  const AA = (n, k, t) => { if (G.BWA) try { BWA.act(n, k, t); } catch (e) { } };

  /* 법적 고지 — 「전자상거래 등에서의 소비자보호에 관한 법률」 제20조제1항,
     같은 법 시행규칙 제11조의2제1항. 줄이거나 바꾸지 않는다. */
  const NOTICE = `이 서비스는 봉화 지역 생산자와 구매자가 서로를 찾을 수 있도록
정보를 모아 보여주는 게시 공간입니다.
운영자는 통신판매의 당사자가 아닙니다.
상품 정보, 가격, 거래 조건, 이행에 대한 책임은 판매자에게 있습니다.`;
  const BANNED = `직접 기른 농산물 원물만 올릴 수 있습니다.
고춧가루·즙·효소·장류 등 가공식품, 주류, 그리고
영업신고 없이 판매하는 달걀은 올릴 수 없습니다.`;

  /* ── 개인정보 방어 (§3-3) ──
     저장되기 전에 서버가 한 번 막는다(worker.js 의 leak). 여기는 두 번째 그물이다 —
     그 그물이 생기기 전에 들어간 옛 글이 화면에 그대로 나가지 않게 한다. */
  const PHONE = /01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/;
  /* 계좌로 보이는 것 — 은행 이름이 함께 있거나 '계좌/입금' 이라는 말이 붙은 숫자 뭉치.
     날짜(2026-08-30)나 시각을 계좌로 잘못 보지 않도록 은행·계좌 낱말을 함께 본다. */
  const BANK = /(농협|농혐|신협|새마을|우체국|국민|신한|우리|하나|기업|대구|경북|카카오뱅크|토스)[^\n]{0,12}\d{2,6}[-\s]?\d{2,6}[-\s]?\d{2,7}|(?:계좌|입금|송금)[^\n]{0,10}\d{4,}/;
  /* 판매자가 자유롭게 적는 칸만 검사한다. 날짜·가격 칸은 형식이 정해져 있어 볼 필요가 없다. */
  const FREE = ['설명', '품목', '규격', '판매자표시명', '수령장소'];
  function scrub(row) {
    FREE.forEach(k => {
      const v = row[k];
      if (typeof v === 'string' && (PHONE.test(v) || BANK.test(v))) {
        console.warn('[장터] 개인정보로 보이는 값이 있어 화면에 내지 않습니다 —',
          'id=' + row.id, '칸=' + k);
        row[k] = '';
      }
    });
    return row;
  }

  /* ── 받아 오기 (5분 캐시) ── */
  let cache = null, cachedAt = 0, loading = null;
  async function load(force) {
    const ms = (CFG.cacheMinutes || 5) * 60000;
    if (!force && cache && Date.now() - cachedAt < ms) return cache;
    if (loading) return loading;
    if (!G.MKAPI) return { error: '장터를 준비하지 못했습니다. 새로고침해 주세요.' };
    loading = (async () => {
      try {
        const d = await MKAPI.list();
        if (d.error) return d;
        /* 서버가 준 것을 예전 시트 칸 이름 그대로 펴 놓는다 —
           아래 화면 코드를 손대지 않아도 되게. */
        const orders = {};
        const items = d.items.map(x => {
          orders[x.id] = x.sold || 0;
          const r = scrub({ ...(x.data || {}), id: x.id,
            '판매자표시명': x.nick || (x.data && x.data['판매자표시명']) || '',
            '상태': x.state });
          r._photos = x.photos || []; r._held = !!x.held; r._sprout = !!x.sprout;
          r._reports = x.reports || 0; r._phold = !!x.phold;
          return r;
        }).map(r => decorate(r, orders));
        cache = { items }; cachedAt = Date.now();
        return cache;
      } catch (e) {
        return { error: '장터 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
      } finally { loading = null; }
    })();
    return loading;
  }
  const forget = () => { cache = null; cachedAt = 0; };

  /* ── 상태 계산 (§3-2) ── */
  function decorate(r, orders) {
    const total = +(r['수량'] || 0) || 0;
    const sold = orders[r.id] || 0;
    r._left = Math.max(0, total - sold);
    r._deadline = parseDT(r['마감일시']);
    const past = r._deadline && r._deadline.getTime() < Date.now();
    let st = (r['상태'] || '').trim();
    if (past || st === '마감' || st === '종료' || r._left <= 0) st = (st === '종료') ? '종료' : '마감';
    r._state = st || '판매중';
    r._closed = (r._state === '마감' || r._state === '종료' || r._state === '확인중');
    r._soon = !r._closed && r._deadline &&
      (r._deadline.getTime() - Date.now()) < (CFG.soonHours || 6) * 3600000;
    r._price = +(String(r['가격'] || '').replace(/[^\d]/g, '')) || 0;
    return r;
  }
  function parseDT(s) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59));
  }
  const won = n => n ? n.toLocaleString('ko-KR') + '원' : '';
  const dLabel = s => { const d = parseDT(s); if (!d) return s || '';
    return `${d.getMonth() + 1}월 ${d.getDate()}일(${'일월화수목금토'[d.getDay()]})`; };

  /* ── 목록 정렬: 판매중 → 수확예정 → 마감(아래로) ── */
  /* 순서는 서버가 매겨서 보낸다 — 신고·가림 감점과 거래 실적 가점이 들어 있어
     화면에서 다시 섞으면 그 뜻이 사라진다. */
  const sorted = items => items;
  const noticeBox = () => `<div class="mk-notice">${E(NOTICE).replace(/\n/g, '<br>')}</div>`;

  /* ── 화면 ── */
  function host() {
    let el = document.getElementById('mkView');
    if (!el) {
      const wrap = document.querySelector('.bw-wrap'); if (!wrap) return null;
      el = document.createElement('div'); el.id = 'mkView'; wrap.appendChild(el);
    }
    return el;
  }

  async function renderList(force) {
    const el = host(); if (!el) return;
    AV('market_list_view');
    el.innerHTML = '<div class="mk-load">장터 정보를 불러오는 중…</div>';
    const d = await load(force);
    if (d.error) { el.innerHTML = `<div class="mk-err">${E(d.error)}
      <button type="button" class="mk-retry">다시 시도</button></div>`;
      el.querySelector('.mk-retry').onclick = () => renderList(true); return; }
    const rows = sorted(d.items);
    const live = rows.filter(r => !r._closed).length;
    el.innerHTML = `
      <div class="mk-top">
        <div class="mk-h">이번 주 장터 <b>${live}건</b></div>
        ${sellerStrip()}
        <div class="mk-banned">${E(BANNED).replace(/\n/g, '<br>')}</div>
        ${noticeBox()}
      </div>
      <div class="mk-list">${rows.map(card).join('') || '<div class="mk-empty">올라온 장터 글이 없습니다.</div>'}</div>
      ${noticeBox()}`;
    el.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => go('#market/' + b.dataset.mk));
    wireStrip(el);
    /* 담당자가 승인해도 이 휴대폰은 그 사실을 모른다 —
       목록을 열 때 조용히 한 번 물어보고, 달라졌으면 맨 윗줄만 바꿔 그린다. */
    if (G.MKAPI && MKAPI.me()) {
      const was = MKAPI.me().state;
      MKAPI.refresh().then(m => {
        noticeBanner(el);
        if (!m || m.state === was) return;
        const b = el.querySelector('.mk-sellbtn'); if (!b) return;
        (b.closest('.mk-mebar') || b).outerHTML = sellerStrip(); wireStrip(el);
      });
    }
  }
  const HASH = { seller: '#market/seller', new: '#market/new', mine: '#market/mine' };
  function wireStrip(el) {
    el.querySelectorAll('.mk-sellbtn[data-s]').forEach(b =>
      b.onclick = () => go(HASH[b.dataset.s] || '#market/seller'));
  }

  /* 목록 맨 위 한 줄 — 이 기기가 판매자로 등록되어 있는지에 따라 달라진다 */
  function sellerStrip() {
    const m = G.MKAPI && MKAPI.me();
    if (!m) return `<button type="button" class="mk-sellbtn" data-s="seller">🌾 직접 기른 것을 팔고 싶으신가요 — 판매자로 등록하기</button>`;
    if (m.state === '승인') return `<div class="mk-mebar">
      <button type="button" class="mk-sellbtn ok" data-s="new">＋ 팔 것 올리기</button>
      <button type="button" class="mk-sellbtn sub" data-s="mine">내 글</button></div>`;
    return `<button type="button" class="mk-sellbtn wait" data-s="seller">${
      m.state === '정지' ? '지금은 글을 올리실 수 없습니다 — 눌러서 보기' : '내 판매자 등록 보기'}</button>`;
  }

  const thumb = r => (r._photos && r._photos[0])
    ? `<img class="mk-th" src="${E(MKAPI.photoURL(r.id, r._photos[0]))}" alt="" loading="lazy">` : '';

  /* 신고가 들어온 내 글이 있으면 목록 맨 위에 붉은 띠로 알린다 —
     게시자가 알아채지 못하면 사흘 뒤 글이 저절로 내려간다. */
  async function noticeBanner(el) {
    const m = G.MKAPI && MKAPI.me(); if (!m || m.state !== '승인') return;
    const r = await MKAPI.posts();
    const hot = (r.rows || []).filter(x => x.notice);
    if (!hot.length || !el.querySelector('.mk-top')) return;
    const div = document.createElement('div');
    div.className = 'mk-hold big';
    div.innerHTML = `<div>내 글 <b>${hot.length}건</b>에 알림이 있습니다${
      hot.length > 1 ? '' : ' — ' + E(hot[0].data && hot[0].data['품목'] || '')}</div>
      <div class="n">${E(hot[0].notice)}</div>
      <button type="button" class="mk-sm">내 글 보러 가기</button>`;
    div.querySelector('button').onclick = () => go('#market/mine');
    el.querySelector('.mk-top').prepend(div);
  }

  function card(r) {
    return `<button type="button" class="mk-card${r._closed ? ' off' : ''}${r._held ? ' held' : ''}" data-mk="${E(r.id)}">
      ${thumb(r)}
      <div class="mk-body">
        <div class="mk-row1">
          <span class="mk-name">${E(r['품목'])}</span>
          <span class="mk-state s-${E(r._state)}">${E(r._state)}</span>
          ${r._soon && !r._closed ? '<span class="mk-soon">마감 임박</span>' : ''}
        </div>
        <div class="mk-row2">${E(r['판매자표시명'])}${
          r._sprout ? '<span class="mk-new">새로 오신 분</span>' : ''} · <b>${won(r._price)}</b>${
          r['규격'] ? ' · ' + E(r['규격']) : ''}</div>
        <div class="mk-row3">${r['수령일'] ? '받는 날 ' + E(dLabel(r['수령일'])) : ''}${
          r['수령시각'] ? ' ' + E(r['수령시각']) : ''}
          <span class="mk-left">${r._held ? '확인 중' : (r._closed ? '마감' : '남은 수량 ' + r._left)}</span></div>
      </div>
    </button>`;
  }

  async function renderDetail(id) {
    const el = host(); if (!el) return;
    const d = await load();
    if (d.error) { el.innerHTML = `<div class="mk-err">${E(d.error)}</div>`; return; }
    const r = d.items.find(x => x.id === id);
    if (!r) { el.innerHTML = '<div class="mk-empty">그 글을 찾지 못했습니다.</div>'; return; }
    AV('market_detail_view', r.id, r['품목']);
    const rows = [
      ['품목', E(r['품목'])],
      ['규격', E(r['규격'])],
      ['가격', won(r._price)],
      ['남은 수량', r._held ? '확인 중' : (r._closed ? '마감' : r._left + (r['수량'] ? ' / ' + E(r['수량']) : ''))],
      ['받는 날', (r['수령일'] ? E(dLabel(r['수령일'])) : '') + (r['수령시각'] ? ' ' + E(r['수령시각']) : '')],
      ['받는 곳', E(r['수령장소'])],
      ['주문 마감', r['마감일시'] ? E(r['마감일시']) : ''],
      ['판매자', E(r['판매자표시명'])],
    ].filter(x => x[1]);
    const mine = isMine(r);
    el.innerHTML = `
      <button type="button" class="mk-back">← 장터 목록</button>
      <div class="mk-detail">
        ${r._held ? `<div class="mk-hold">이웃들이 이 글을 신고해서 <b>확인 중</b>입니다.
          지금은 주문하실 수 없습니다.${mine ? '' : ' 올리신 분이 확인하면 다시 열립니다.'}</div>` : ''}
        ${r._phold ? '<div class="mk-hold">사진 신고가 들어와 사진을 가렸습니다.</div>' : ''}
        <div class="mk-row1"><span class="mk-name big">${E(r['품목'])}</span>
          <span class="mk-state s-${E(r._state)}">${E(r._state)}</span>
          ${r._soon && !r._closed ? '<span class="mk-soon">마감 임박</span>' : ''}</div>
        ${photoStrip(r)}
        ${(r['대리게시'] || '').toUpperCase() === 'Y'
          ? '<div class="mk-proxy">이웃을 대신해 올린 글입니다</div>' : ''}
        <div class="mk-desc">${E(r['설명']).replace(/\n/g, '<br>')}</div>
        <dl class="mk-facts">${rows.map(x =>
          `<dt>${E(x[0])}</dt><dd>${x[1]}</dd>`).join('')}</dl>
        ${r['원글링크'] ? `<a class="mk-band" href="${E(r['원글링크'])}" target="_blank" rel="noopener">밴드에서 사진·댓글 보기</a>` : ''}
        <div class="mk-acts">
          ${r._held ? '<div class="mk-order off">확인 중이라 주문할 수 없습니다</div>'
            : r._closed ? '<div class="mk-order off">마감되었습니다</div>'
            : `<a class="mk-order" href="${E(r['주문링크'])}" target="_blank" rel="noopener">주문하기</a>`}
          ${r['수령일'] ? '<button type="button" class="mk-cal">수령일 알림 받기</button>' : ''}
        </div>
        <div class="mk-payinfo">계좌와 자세한 안내는 <b>주문서를 내신 뒤 화면과 회신 메일</b>로 받으십니다.
          이 화면에는 계좌·연락처를 두지 않습니다.</div>
        ${mine ? ownerBox(r) : `<button type="button" class="mk-report">🚩 이 글을 신고합니다</button>`}
        ${noticeBox()}
      </div>`;
    el.querySelector('.mk-back').onclick = () => go('#market');
    const ord = el.querySelector('a.mk-order');
    if (ord) ord.onclick = () => AA('market_order_click', r.id, r['품목']);
    const cal = el.querySelector('.mk-cal');
    if (cal) cal.onclick = () => addCal(r);
    const rep = el.querySelector('.mk-report');
    if (rep) rep.onclick = () => reportSheet(r);
    if (mine) wireOwner(el, r);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── 사진 ── 최대 석 장. 눌러서 크게 본다. */
  function photoStrip(r) {
    if (!r._photos || !r._photos.length) return '';
    return `<div class="mk-photos">${r._photos.map(p =>
      `<img src="${E(MKAPI.photoURL(r.id, p))}" alt="${E(r['품목'])} 사진" loading="lazy">`).join('')}</div>`;
  }

  const isMine = r => {
    const m = G.MKAPI && MKAPI.me();
    return !!(m && m.state === '승인' && m.nick && m.nick === r['판매자표시명']);
  };

  /* ── 신고 ── 사유를 고르게 한다. 그냥 '신고'만 있으면 무엇이 문제인지 알 수 없다. */
  const WHY = [
    ['banned',  '팔면 안 되는 물건입니다', '가공식품·술·영업신고 없는 달걀'],
    ['false',   '적힌 것과 다릅니다', '값·양·상태가 사실과 다름'],
    ['privacy', '전화번호나 계좌가 적혀 있습니다', ''],
    ['photo',   '사진이 이상합니다', ''],
    ['soldout', '이미 다 팔렸습니다', ''],
  ];
  function reportSheet(r) {
    const el = host(); if (!el) return;
    const box = document.createElement('div');
    box.className = 'mk-sheet';
    box.innerHTML = `<div class="mk-sheetbox">
      <div class="mk-h">무엇이 잘못되었나요</div>
      <p class="mk-hint">고른 내용은 <b>올리신 분에게 전해집니다.</b>
        고치면 글이 다시 올라가고, 사흘 동안 아무 답이 없으면 글이 내려갑니다.
        누가 신고했는지는 아무에게도 알려지지 않습니다.</p>
      ${WHY.map(w => `<button type="button" class="mk-why" data-why="${w[0]}">
        <b>${E(w[1])}</b>${w[2] ? `<span>${E(w[2])}</span>` : ''}</button>`).join('')}
      <button type="button" class="mk-sm" id="mkNo">그만두기</button></div>`;
    el.appendChild(box);
    box.querySelector('#mkNo').onclick = () => box.remove();
    box.onclick = e => { if (e.target === box) box.remove(); };
    box.querySelectorAll('.mk-why').forEach(b => b.onclick = async () => {
      box.querySelectorAll('button').forEach(x => x.disabled = true);
      const res = await MKAPI.report(r.id, b.dataset.why);
      box.remove();
      if (!res.ok) { alert(res.why || '신고하지 못했습니다'); return; }
      AA('market_report', r.id, b.dataset.why);
      alert(res.acted
        ? '신고를 받았습니다. 바로 조치했습니다.\n(' + res.acted + ')'
        : '신고를 받았습니다.\n같은 신고가 한 건 더 모이면 글이 확인 중으로 바뀝니다.');
      forget(); route();
    });
  }

  /* ── 내 글이면 여기서 다 한다 ── */
  function ownerBox(r) {
    return `<div class="mk-owner">
      <div class="t">내가 올린 글</div>
      <div class="mk-acts2">
        <button type="button" class="mk-sm" data-o="edit">고치기</button>
        <button type="button" class="mk-sm" data-o="sold">몇 개 나갔는지</button>
        ${r._state === '확인중' ? '<button type="button" class="mk-sm pri" data-o="nofix">고칠 것 없습니다</button>' : ''}
        ${!r._closed ? '<button type="button" class="mk-sm" data-o="done">다 팔렸어요</button>' : ''}
        <button type="button" class="mk-sm del" data-o="del">지우기</button>
      </div></div>`;
  }
  function wireOwner(el, r) {
    el.querySelectorAll('[data-o]').forEach(b => b.onclick = async () => {
      const a = b.dataset.o;
      if (a === 'edit') return go('#market/edit/' + r.id);
      b.disabled = true;
      let res;
      if (a === 'sold') {
        const n = prompt('지금까지 몇 개가 나갔습니까? (전체 ' + (r['수량'] || '') + '개)', String(r._left != null ? (+(r['수량'] || 0) - r._left) : 0));
        if (n == null) { b.disabled = false; return; }
        res = await MKAPI.setSold(r.id, Math.max(0, +n || 0));
      } else if (a === 'nofix') res = await MKAPI.noFix(r.id);
      else if (a === 'done') {
        if (!confirm('이 글을 마치고 지난 기록으로 넘깁니다.')) { b.disabled = false; return; }
        res = await MKAPI.allSold(r.id);
      } else if (a === 'del') {
        if (!confirm('이 글을 지웁니다. 사진도 함께 지워지고 되돌릴 수 없습니다.')) { b.disabled = false; return; }
        res = await MKAPI.remove(r.id);
      }
      b.disabled = false;
      if (!res.ok) { alert(res.why || '하지 못했습니다'); return; }
      if (res.note) alert(res.note);
      forget();
      go(a === 'del' ? '#market' : '#market/' + r.id);
    });
  }

  /* 수령일 알림 — 기존 캘린더 담기(buildICS/downloadICS)를 그대로 쓴다 */
  function addCal(r) {
    AA('market_calendar_add', r.id, r['품목']);
    const H = G.BWLAB_ICS;
    if (!H || !H.buildICS) { alert('이 브라우저에서는 알림을 만들 수 없습니다.'); return; }
    const t = (r['수령시각'] || '').match(/^(\d{1,2}):(\d{2})/);
    const lines = [{ lv: 1, txt: `기 간: ${String(r['수령일']).replace(/-/g, '. ')}.` }];
    if (t) lines.push({ lv: 1, txt: `일 시: ${String(r['수령일']).replace(/-/g, '. ')}. ${t[1]}:${t[2]}` });
    if (r['수령장소']) lines.push({ lv: 1, txt: `장 소: ${r['수령장소']}` });
    const fake = { _id: 'market:' + r.id, dept: '봉화 장터',
      title: `${r['품목']} 받는 날 — ${r['수령장소'] || ''}`.trim(),
      _icsNote: '봉화 장터 수령 안내\n판매자와 정한 시각에 맞춰 오세요.',
      list: [{ week: r['수령일'], item: { title: r['품목'], lines } }] };
    const txt = H.buildICS([fake]);
    if (!txt) { alert('알림을 만들 수 없습니다.'); return; }
    H.downloadICS(txt, '봉화장터_' + r.id + '.ics');
  }

  async function renderArchive() {
    const el = host(); if (!el) return;
    AV('market_archive_view');
    const d = await load();
    if (d.error) { el.innerHTML = `<div class="mk-err">${E(d.error)}</div>`; return; }
    const done = d.items.filter(r => r._closed);
    /* 월별 집계 — 품목별 거래 건수와 참여 농가 수 */
    const byMonth = {};
    done.forEach(r => {
      const mo = (r['등록일'] || '').slice(0, 7) || '기타';
      (byMonth[mo] = byMonth[mo] || []).push(r);
    });
    const months = Object.keys(byMonth).sort().reverse();
    const sum = months.map(mo => {
      const rows = byMonth[mo];
      const farms = new Set(rows.map(r => r['판매자표시명'])).size;
      const items = new Set(rows.map(r => r['품목'])).size;
      return `<div class="mk-sum"><b>${E(mo.replace('-', '년 '))}월</b>
        거래 ${rows.length}건 · 품목 ${items}가지 · 참여 농가 ${farms}곳</div>`;
    }).join('');
    el.innerHTML = `
      <button type="button" class="mk-back">← 장터 목록</button>
      <div class="mk-top"><div class="mk-h">지난 장터 기록</div>
        <div class="mk-sums">${sum || '<div class="mk-empty">아직 기록이 없습니다.</div>'}</div></div>
      ${months.map(mo => `<div class="mk-arch"><div class="mk-archh">${E(mo.replace('-', '년 '))}월</div>
        ${byMonth[mo].map(r => `<div class="mk-archrow">
          <span class="t">${E(r['품목'])}</span>
          <span class="s">${E(r['판매자표시명'])}</span>
          <span class="n">${E(r['수량'] || '')}</span>
          <span class="d">${E(r._state)}</span></div>`).join('')}</div>`).join('')}
      <div class="mk-payinfo">이 기록에는 <b>구매자 정보를 남기지 않습니다.</b></div>
      ${noticeBox()}`;
    el.querySelector('.mk-back').onclick = () => go('#market');
  }

  /* ═══════════════════════════════════════════════════════════
     내 글 — 올리기·고치기·사진
     ═══════════════════════════════════════════════════════════ */
  const F = [
    ['품목', '무엇을 파시나요', '햇고구마 (밤고구마)', 1],
    ['규격', '한 번에 얼마씩', '5kg 상자'],
    ['가격', '값 (원)', '22000', 1, 'number'],
    ['수량', '몇 개나 파시나요', '25', 1, 'number'],
    ['수령장소', '어디서 드리나요', '물야면사무소 앞'],
    ['수령일', '받는 날', '', 0, 'date'],
    ['수령시각', '받는 때', '10:00', 0, 'time'],
    ['마감일시', '주문 마감', '', 1, 'datetime-local'],
    ['주문링크', '주문서 주소 (구글 폼 등)', 'https://…'],
    ['원글링크', '밴드 글 주소 (있으시면)', 'https://band.us/…'],
  ];
  const dtIn = v => String(v || '').replace(' ', 'T').slice(0, 16);
  const dtOut = v => String(v || '').replace('T', ' ').slice(0, 16);

  async function renderForm(id) {
    const el = host(); if (!el) return;
    const m = G.MKAPI && MKAPI.me();
    if (!m || m.state !== '승인') return go('#market/seller');
    AV(id ? 'market_edit_view' : 'market_new_view');
    el.innerHTML = '<div class="mk-load">잠시만요…</div>';

    let row = null;
    if (id) {
      const r = await MKAPI.posts();
      row = (r.rows || []).find(x => x.id === id);
      if (!row) { el.innerHTML = '<div class="mk-empty">그 글을 찾지 못했습니다.</div>'; return; }
    }
    const d = (row && row.data) || {};
    el.innerHTML = `<button type="button" class="mk-back">← ${id ? '내 글' : '장터 목록'}</button>
      <div class="mk-detail">
        <div class="mk-h">${id ? '글 고치기' : '팔 것 올리기'}</div>
        ${row && row.notice ? `<div class="mk-hold">${E(row.notice)}</div>` : ''}
        <div class="mk-banned">${E(BANNED).replace(/\n/g, '<br>')}</div>
        ${id ? photoBox(row) : `<p class="mk-hint">사진은 <b>먼저 저장하신 뒤</b> 올리실 수 있습니다.</p>`}
        <label class="mk-lab" for="f설명">어떤 것인지 적어 주세요</label>
        <textarea class="mk-in mk-ta" id="f설명" rows="4"
          placeholder="물야에서 캔 밤고구마입니다.&#10;크기는 중자 위주로 담습니다.">${E(d['설명'] || '')}</textarea>
        <p class="mk-hint">전화번호나 계좌는 적지 마십시오. 적으면 저장되지 않습니다.</p>
        ${F.map(f => `<label class="mk-lab" for="f${f[0]}">${E(f[1])}${f[3] ? ' <b class="req">*</b>' : ''}</label>
          <input class="mk-in" id="f${f[0]}" type="${f[4] || 'text'}"
            placeholder="${E(f[2])}" value="${E(f[0] === '마감일시' ? dtIn(d[f[0]]) : (d[f[0]] || ''))}">`).join('')}
        <label class="mk-agree"><input type="checkbox" id="fSoon" ${d['상태'] === '수확예정' ? 'checked' : ''}>
          <span>아직 수확 전입니다 (예약만 받습니다)</span></label>
        <div class="mk-acts">
          <button type="button" class="mk-order" id="fGo" style="border:0">${id ? '고쳐서 올리기' : '올리기'}</button>
        </div>
        <p class="mk-err2" id="fErr" style="display:none"></p>
      </div>`;
    el.querySelector('.mk-back').onclick = () => go(id ? '#market/mine' : '#market');
    if (id) wirePhoto(el, row);

    const err = el.querySelector('#fErr');
    const say = t => { err.textContent = t; err.style.display = t ? 'block' : 'none'; };
    el.querySelector('#fGo').onclick = async e => {
      say('');
      const out = { 설명: el.querySelector('#f설명').value.trim() };
      F.forEach(f => { const v = (el.querySelector('#f' + f[0]).value || '').trim();
        if (v) out[f[0]] = (f[0] === '마감일시') ? dtOut(v) : v; });
      if (el.querySelector('#fSoon').checked) out['상태'] = '수확예정';
      if (!out['등록일']) out['등록일'] = new Date().toISOString().slice(0, 10);
      e.target.disabled = true; e.target.textContent = '보내는 중…';
      const res = id ? await MKAPI.edit(id, out) : await MKAPI.post(out);
      e.target.disabled = false; e.target.textContent = id ? '고쳐서 올리기' : '올리기';
      if (!res.ok) return say(res.why);
      forget();
      AA(id ? 'market_edit' : 'market_new', res.id || id, out['품목']);
      if (id) { alert(res.back ? '고치셨습니다. 신고가 풀리고 다시 올라갑니다.' : '고쳤습니다.'); go('#market/mine'); }
      else { alert((res.note || '올렸습니다.') + '\n이어서 사진을 올리실 수 있습니다.'); go('#market/edit/' + res.id); }
    };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── 사진 석 장 ── */
  function photoBox(row) {
    const ps = row.photos || [];
    return `<div class="mk-pbox">
      <div class="t">사진 <b>${ps.length}/3</b>${row.phold ? ' — 신고로 가려져 있습니다' : ''}</div>
      <div class="mk-plist">${ps.map(p =>
        `<div class="mk-pit"><img src="${E(MKAPI.photoURL(row.id, p))}" alt="">
          <button type="button" class="x" data-del="${E(p)}" aria-label="이 사진 지우기">✕</button></div>`).join('')}
        ${ps.length < 3 ? `<label class="mk-padd">＋ 사진<input type="file" accept="image/*" capture="environment" id="fPic" hidden></label>` : ''}
      </div>
      <p class="mk-hint">직접 찍은 사진만 올려 주십시오. 사람 얼굴이 나온 사진은 올리지 마십시오.<br>
        큰 사진은 <b>휴대폰에서 저절로 줄여</b> 보냅니다. 사진에 든 위치정보도 함께 지워집니다.</p>
      <p class="mk-hint">거래가 끝나고 <b>한 달이 지나면 사진은 저절로 지워집니다.</b></p>
    </div>`;
  }
  function wirePhoto(el, row) {
    const pic = el.querySelector('#fPic');
    if (pic) pic.onchange = async () => {
      const f = pic.files && pic.files[0]; if (!f) return;
      const box = el.querySelector('.mk-pbox .t'); const was = box.textContent;
      box.textContent = '사진을 줄여서 올리는 중…';
      const r = await MKAPI.addPhoto(row.id, f);
      if (!r.ok) { box.textContent = was; alert(r.why || '사진을 올리지 못했습니다'); return; }
      AA('market_photo_add', row.id);
      forget(); renderForm(row.id);
    };
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('이 사진을 지웁니다.')) return;
      b.disabled = true;
      const r = await MKAPI.delPhoto(row.id, b.dataset.del);
      if (!r.ok) { b.disabled = false; alert(r.why || '지우지 못했습니다'); return; }
      forget(); renderForm(row.id);
    });
  }

  /* ── 내 글 목록 ── */
  async function renderMine() {
    const el = host(); if (!el) return;
    const m = G.MKAPI && MKAPI.me();
    if (!m || m.state !== '승인') return go('#market/seller');
    AV('market_mine_view');
    el.innerHTML = '<div class="mk-load">내 글을 불러오는 중…</div>';
    const r = await MKAPI.posts();
    if (!r.ok) { el.innerHTML = `<div class="mk-err">${E(r.why)}</div>`; return; }
    const rows = r.rows || [];
    el.innerHTML = `<button type="button" class="mk-back">← 장터 목록</button>
      <div class="mk-top">
        <div class="mk-h">내 글 <b>${rows.length}건</b></div>
        <button type="button" class="mk-sellbtn ok" id="mkNew">＋ 팔 것 올리기</button>
      </div>
      <div class="mk-list">${rows.map(x => {
        const d = x.data || {};
        return `<div class="mk-card mine${x.state === '확인중' ? ' held' : ''}">
          ${x.notice ? `<div class="mk-hold">${E(x.notice)}</div>` : ''}
          <div class="mk-row1"><span class="mk-name">${E(d['품목'] || '(제목 없음)')}</span>
            <span class="mk-state s-${E(x.state)}">${E(x.state)}</span>
            ${x.showAt ? '<span class="mk-soon">' + E(x.showAt) + ' 부터 보임</span>' : ''}</div>
          <div class="mk-row3">사진 ${(x.photos || []).length}장 · 신고 ${x.reports}건 · 올린 때 ${E(x.at)}
            <span class="mk-left">${x.sold || 0}/${E(d['수량'] || '0')} 나감</span></div>
          <div class="mk-acts2">
            <button type="button" class="mk-sm" data-go="${E(x.id)}">고치기 · 사진</button>
            ${x.state === '확인중' ? `<button type="button" class="mk-sm pri" data-nofix="${E(x.id)}">고칠 것 없습니다</button>` : ''}
          </div></div>`;
      }).join('') || '<div class="mk-empty">아직 올리신 글이 없습니다.</div>'}</div>`;
    el.querySelector('.mk-back').onclick = () => go('#market');
    el.querySelector('#mkNew').onclick = () => go('#market/new');
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go('#market/edit/' + b.dataset.go));
    el.querySelectorAll('[data-nofix]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      const res = await MKAPI.noFix(b.dataset.nofix);
      if (!res.ok) { b.disabled = false; alert(res.why); return; }
      alert(res.note || '다시 올렸습니다.');
      forget(); renderMine();
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ═══════════════════════════════════════════════════════════
     판매자 등록 (§ 등록제)

     게이트를 '글'이 아니라 '사람'에 건다.
     신청 → 담당자가 전화 한 통으로 확인 → 승인.
     그 뒤로는 이 휴대폰에서 아무것도 묻지 않는다.
     ═══════════════════════════════════════════════════════════ */
  const CONSENT = `봉화군은 판매자 확인과 문제가 생겼을 때의 연락을 위해
이름과 휴대폰 번호를 받습니다.
이 두 가지는 장터 화면에 뜨지 않고 담당자만 봅니다.
판매를 그만두신 뒤 3개월이 지나면 지웁니다.
동의하지 않으셔도 장터를 보고 주문하시는 데에는 아무 지장이 없습니다.`;

  const STATE_MSG = {
    '승인': ['판매자로 등록되셨습니다',
      '이제 직접 기른 것을 올리실 수 있습니다.\n처음 올리신 글은 하루 뒤에 목록에 뜹니다.'],
    '정지': ['지금은 글을 올리실 수 없습니다',
      '신고가 거듭 쌓여 잠시 멈춰 두었습니다.'],
    '열쇠오류': ['이 기기의 수정키가 맞지 않습니다',
      '휴대폰을 바꾸셨다면 아래에서 판매자번호와 수정키로 되찾으실 수 있습니다.'],
  };
  const GRADE = {
    '새로 오신 분': '하루에 한 건까지 올리실 수 있습니다. 무사히 다섯 번 거래하시면 제한이 풀립니다.',
    '단골': '제한 없이 올리실 수 있고, 목록에서 앞자리에 놓입니다.',
    '쉬는 중': '신고가 두 번 쌓여 이레 동안 쉽니다. 날짜가 지나면 저절로 풀립니다.',
    '멈춤': '신고가 세 번 쌓여 멈춰 있습니다. 담당자에게 문의해 주십시오.',
  };

  async function renderSeller() {
    const el = host(); if (!el) return;
    AV('market_seller_view');
    const has = G.MKAPI && MKAPI.me();
    el.innerHTML = '<div class="mk-load">확인하는 중…</div>';
    const m = has ? await MKAPI.refresh() : null;
    el.innerHTML = `<button type="button" class="mk-back">← 장터 목록</button>
      <div class="mk-detail">${m ? statusHTML(m) : formHTML()}</div>`;
    el.querySelector('.mk-back').onclick = () => go('#market');
    m ? wireStatus(el, m) : wireForm(el);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function statusHTML(m) {
    const [h, sub] = STATE_MSG[m.state] || STATE_MSG['승인'];
    return `<div class="mk-h">${E(h)}</div>
      <div class="mk-desc">${E(sub).replace(/\n/g, '<br>')}</div>
      <dl class="mk-facts">
        <dt>장터에 뜰 이름</dt><dd>${E(m.nick || '')}</dd>
        <dt>판매자번호</dt><dd>${E(m.no || '')}</dd>
        <dt>등급</dt><dd>${E(m.grade || '')}</dd>
        <dt>끝낸 거래</dt><dd>${E(String(m.done || 0))}건</dd>
        ${m.until ? `<dt>쉬는 기간</dt><dd>${E(m.until)} 까지</dd>` : ''}
      </dl>
      <p class="mk-hint">${E(GRADE[m.grade] || '')}</p>
      ${m.state === '승인' ? `<div class="mk-acts">
        <button type="button" class="mk-order" id="mkGoNew" style="border:0">＋ 팔 것 올리기</button>
        <button type="button" class="mk-cal" id="mkGoMine">내 글 보기 (${E(String(m.posts || 0))}건)</button>
      </div>` : ''}
      <div class="mk-keybox">
        <div class="t">수정키</div>
        <div class="k" id="mkKey">••••-••••-••••</div>
        <div class="mk-acts2">
          <button type="button" class="mk-sm" id="mkShow">보기</button>
          <button type="button" class="mk-sm" id="mkCopy">복사</button>
        </div>
        <p class="mk-hint">이 휴대폰에는 저장되어 있어 평소엔 쓸 일이 없습니다.
          <b>휴대폰을 바꿀 때만</b> 판매자번호와 함께 쓰십니다.
          잊어버리셨으면 담당자에게 전화하시면 새로 발급해 드립니다.</p>
      </div>
      <div class="mk-acts"><button type="button" class="mk-cal" id="mkOut">이 휴대폰에서 내리기</button></div>`;
  }

  function wireStatus(el, m) {
    const gn = el.querySelector('#mkGoNew'); if (gn) gn.onclick = () => go('#market/new');
    const gm = el.querySelector('#mkGoMine'); if (gm) gm.onclick = () => go('#market/mine');
    const k = el.querySelector('#mkKey');
    el.querySelector('#mkShow').onclick = e => {
      const on = k.textContent.indexOf('•') < 0;
      k.textContent = on ? '••••-••••-••••' : (m.key || '');
      e.target.textContent = on ? '보기' : '가리기';
    };
    el.querySelector('#mkCopy').onclick = async e => {
      try { await navigator.clipboard.writeText(m.key || ''); e.target.textContent = '복사됨'; }
      catch (x) { k.textContent = m.key || ''; e.target.textContent = '위 글자를 적어 두세요'; }
    };
    el.querySelector('#mkOut').onclick = () => {
      if (!confirm('이 휴대폰에서 판매자 표시를 내립니다.\n판매자번호와 수정키가 있으면 다시 되찾을 수 있습니다.')) return;
      MKAPI.signOut(); renderSeller();
    };
  }

  const FLD = (id, label, ph, hint, type) =>
    `<label class="mk-lab" for="${id}">${E(label)}</label>
     <input class="mk-in" id="${id}" type="${type || 'text'}" placeholder="${E(ph || '')}"
       autocomplete="off">${hint ? `<p class="mk-hint">${E(hint)}</p>` : ''}`;

  function formHTML() {
    return `<div class="mk-h">판매자로 등록하기</div>
      <div class="mk-desc">직접 기른 것을 파시려면 먼저 한 번만 등록하시면 됩니다.<br>
        등록하시면 <b>바로 올리실 수 있습니다.</b>
        처음에는 하루 한 건까지, 첫 글은 하루 뒤에 뜹니다.</div>
      <div class="mk-banned">${E(BANNED).replace(/\n/g, '<br>')}</div>
      ${FLD('sfName', '이름 (실명)', '홍길동', '담당자만 봅니다. 장터에는 뜨지 않습니다.')}
      ${FLD('sfPhone', '휴대폰 번호', '010-0000-0000', '담당자가 이 번호로 전화드립니다.', 'tel')}
      ${FLD('sfNick', '장터에 뜰 이름', '춘양 김만식',
        '이웃이 보는 이름입니다. 실명을 쓰셔도 되고 ‘춘양 김씨’ 처럼 쓰셔도 됩니다.')}
      ${FLD('sfTown', '사시는 면·리', '춘양면 의양리')}
      ${FLD('sfCrops', '주로 파실 것', '사과, 고추')}
      ${FLD('sfAgrix', '농업경영체 등록번호 (있으시면)', '3145-2021-000812',
        '없어도 됩니다. 적어 주시면 확인이 빨라집니다.')}
      <label class="mk-agree"><input type="checkbox" id="sfAgree">
        <span>위 내용에 동의합니다</span></label>
      <div class="mk-consent">${E(CONSENT).replace(/\n/g, '<br>')}</div>
      <div class="mk-acts">
        <button type="button" class="mk-order" id="sfGo" style="border:0">등록 신청하기</button>
      </div>
      <p class="mk-err2" id="sfErr" style="display:none"></p>
      <div class="mk-acts"><button type="button" class="mk-cal" id="sfBack">휴대폰을 바꾸셨나요 — 쓰던 등록 되찾기</button></div>`;
  }

  function wireForm(el) {
    const v = id => (el.querySelector('#' + id).value || '').trim();
    const err = el.querySelector('#sfErr');
    const say = t => { err.textContent = t; err.style.display = t ? 'block' : 'none'; };
    el.querySelector('#sfGo').onclick = async e => {
      say('');
      if (!el.querySelector('#sfAgree').checked) return say('연락처 수집에 동의해 주셔야 접수됩니다.');
      e.target.disabled = true; e.target.textContent = '보내는 중…';
      const r = await MKAPI.register({ name: v('sfName'), phone: v('sfPhone'), nick: v('sfNick'),
        town: v('sfTown'), crops: v('sfCrops'), agrix: v('sfAgrix'), agree: true });
      e.target.disabled = false; e.target.textContent = '등록 신청하기';
      if (!r.ok) return say(r.why);
      AA('market_seller_apply');
      alert('등록되었습니다.\n\n판매자번호 ' + r.no + '\n수정키 ' + r.key +
        '\n\n이 휴대폰에 저장해 두었습니다. 적어 두지 않으셔도 됩니다.\n휴대폰을 바꾸실 때만 쓰십니다.');
      renderSeller();
    };
    el.querySelector('#sfBack').onclick = async () => {
      const no = prompt('판매자번호 네 자리를 넣어 주세요 (예: 0142)'); if (!no) return;
      const key = prompt('수정키를 넣어 주세요 (예: K7M2-9QXA-3F1B)'); if (!key) return;
      const r = await MKAPI.signIn(no, key);
      if (!r.ok) { alert(r.why); return; }
      forget(); renderSeller();
    };
  }

  /* ── 길 찾기 ── */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function isMarket() { return /^#market/.test(location.hash || ''); }
  function route() {
    const on = isMarket();
    document.body.classList.toggle('mode-market', on);
    if (!on) return;
    if (G.MKSETMODE) G.MKSETMODE();
    const m = location.hash.match(/^#market\/(.+)$/);
    if (location.hash === '#market/archive') renderArchive();
    else if (location.hash === '#market/seller') renderSeller();
    else if (location.hash === '#market/new') renderForm('');
    else if (location.hash === '#market/mine') renderMine();
    else if (/^#market\/edit\//.test(location.hash)) renderForm(location.hash.split('/')[2] || '');
    else if (m) renderDetail(decodeURIComponent(m[1]));
    else renderList();
  }
  addEventListener('hashchange', route);

  G.MARKET = { route, go, load, forget, isMarket, NOTICE, BANNED, CONSENT,
    /* 홈 화면 '이번 주 장터' 카드에 쓸 요약 */
    async summary() { const d = await load(); if (d.error) return null;
      const live = d.items.filter(r => !r._closed);
      return { live: live.length, soon: live.filter(r => r._soon).length,
        top: live.slice(0, 2).map(r => r['품목']) };
    } };
})(window);
