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

  /* ── CSV 읽기 ── (따옴표 안의 줄바꿈·쉼표까지 다룬다) */
  function parseCSV(text) {
    const rows = []; let row = [], val = '', q = false;
    text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else q = false; }
        else val += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(val); val = ''; }
      else if (ch === '\n') { row.push(val); rows.push(row); row = []; val = ''; }
      else val += ch;
    }
    if (val !== '' || row.length) { row.push(val); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).filter(r => r.some(c => c.trim() !== ''))
      .map(r => { const o = {}; head.forEach((h, i) => o[h] = (r[i] || '').trim()); return o; });
  }

  /* ── 개인정보 방어 (§3-3) ──
     게시된 CSV 는 누구나 열 수 있는 주소다. 운영자가 실수로 전화번호나 계좌를
     적어 넣으면 그 값을 화면에 그리지 않고 콘솔에만 남긴다. */
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
  const devOn = () => CFG.dev || /[?&]marketdev=1/.test(location.search);
  function urls() {
    return devOn() ? [CFG.devSellCsv, CFG.devOrderCsv] : [CFG.sellCsv, CFG.orderCsv];
  }
  async function load(force) {
    const ms = (CFG.cacheMinutes || 5) * 60000;
    if (!force && cache && Date.now() - cachedAt < ms) return cache;
    if (loading) return loading;
    const [su, ou] = urls();
    if (!su) return { error: '장터 주소가 아직 설정되지 않았습니다.' };
    loading = (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(su, { cache: 'no-store' }).then(r => { if (!r.ok) throw 0; return r.text(); }),
          ou ? fetch(ou, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '') : '',
        ]);
        const orders = {};
        parseCSV(b || '').forEach(o => { orders[o.id] = +(o['주문수량합계'] || 0) || 0; });
        const items = parseCSV(a).map(scrub)
          .filter(r => r.id && (r['노출'] || 'Y').toUpperCase() !== 'N')
          .map(r => decorate(r, orders));
        cache = { items }; cachedAt = Date.now();
        return cache;
      } catch (e) {
        return { error: '장터 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' };
      } finally { loading = null; }
    })();
    return loading;
  }

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
    r._closed = (r._state === '마감' || r._state === '종료');
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
  const ORDER = { '판매중': 0, '수확예정': 1, '마감': 2, '종료': 3 };
  function sorted(items) {
    return items.slice().sort((a, b) =>
      (ORDER[a._state] ?? 9) - (ORDER[b._state] ?? 9) ||
      ((a._deadline ? a._deadline.getTime() : 9e15) - (b._deadline ? b._deadline.getTime() : 9e15)));
  }
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
        ${devOn() ? '<div class="mk-dev">샘플 자료로 보고 있습니다 (개발 모드)</div>' : ''}
        <div class="mk-banned">${E(BANNED).replace(/\n/g, '<br>')}</div>
        ${noticeBox()}
      </div>
      <div class="mk-list">${rows.map(card).join('') || '<div class="mk-empty">올라온 장터 글이 없습니다.</div>'}</div>
      ${noticeBox()}`;
    el.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => go('#market/' + b.dataset.mk));
  }

  function card(r) {
    return `<button type="button" class="mk-card${r._closed ? ' off' : ''}" data-mk="${E(r.id)}">
      <div class="mk-row1">
        <span class="mk-name">${E(r['품목'])}</span>
        <span class="mk-state s-${E(r._state)}">${E(r._state)}</span>
        ${r._soon ? '<span class="mk-soon">마감 임박</span>' : ''}
      </div>
      <div class="mk-row2">${E(r['판매자표시명'])} · <b>${won(r._price)}</b>${
        r['규격'] ? ' · ' + E(r['규격']) : ''}</div>
      <div class="mk-row3">${r['수령일'] ? '받는 날 ' + E(dLabel(r['수령일'])) : ''}${
        r['수령시각'] ? ' ' + E(r['수령시각']) : ''}
        <span class="mk-left">${r._closed ? '마감' : '남은 수량 ' + r._left}</span></div>
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
      ['남은 수량', r._closed ? '마감' : r._left + (r['수량'] ? ' / ' + E(r['수량']) : '')],
      ['받는 날', (r['수령일'] ? E(dLabel(r['수령일'])) : '') + (r['수령시각'] ? ' ' + E(r['수령시각']) : '')],
      ['받는 곳', E(r['수령장소'])],
      ['주문 마감', r['마감일시'] ? E(r['마감일시']) : ''],
      ['판매자', E(r['판매자표시명'])],
    ].filter(x => x[1]);
    el.innerHTML = `
      <button type="button" class="mk-back">← 장터 목록</button>
      <div class="mk-detail">
        <div class="mk-row1"><span class="mk-name big">${E(r['품목'])}</span>
          <span class="mk-state s-${E(r._state)}">${E(r._state)}</span>
          ${r._soon ? '<span class="mk-soon">마감 임박</span>' : ''}</div>
        ${(r['대리게시'] || '').toUpperCase() === 'Y'
          ? '<div class="mk-proxy">이웃을 대신해 올린 글입니다</div>' : ''}
        <div class="mk-desc">${E(r['설명']).replace(/\n/g, '<br>')}</div>
        <dl class="mk-facts">${rows.map(x =>
          `<dt>${E(x[0])}</dt><dd>${x[1]}</dd>`).join('')}</dl>
        ${r['원글링크'] ? `<a class="mk-band" href="${E(r['원글링크'])}" target="_blank" rel="noopener">밴드에서 사진·댓글 보기</a>` : ''}
        <div class="mk-acts">
          ${r._closed
            ? '<div class="mk-order off">마감되었습니다</div>'
            : `<a class="mk-order" href="${E(r['주문링크'])}" target="_blank" rel="noopener">주문하기</a>`}
          ${r['수령일'] ? '<button type="button" class="mk-cal">수령일 알림 받기</button>' : ''}
        </div>
        <div class="mk-payinfo">계좌와 자세한 안내는 <b>주문서를 내신 뒤 화면과 회신 메일</b>로 받으십니다.
          이 화면에는 계좌·연락처를 두지 않습니다.</div>
        ${noticeBox()}
      </div>`;
    el.querySelector('.mk-back').onclick = () => go('#market');
    const ord = el.querySelector('a.mk-order');
    if (ord) ord.onclick = () => AA('market_order_click', r.id, r['품목']);
    const cal = el.querySelector('.mk-cal');
    if (cal) cal.onclick = () => addCal(r);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    else if (m) renderDetail(decodeURIComponent(m[1]));
    else renderList();
  }
  addEventListener('hashchange', route);

  G.MARKET = { route, go, load, isMarket, NOTICE, BANNED,
    /* 홈 화면 '이번 주 장터' 카드에 쓸 요약 */
    async summary() { const d = await load(); if (d.error) return null;
      const live = d.items.filter(r => !r._closed);
      return { live: live.length, soon: live.filter(r => r._soon).length,
        top: live.slice(0, 2).map(r => r['품목']) };
    } };
})(window);
