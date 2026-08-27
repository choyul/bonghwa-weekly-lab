/* ═══════════════════════════════════════════════════════════════
   subsidy.js — 보조사업 조건 자가확인 (테스트본 전용 런타임)

   진입: index.html 의 onFooterMount 에서 BWLAB_SUBSIDY.mount(iss, foot, helpers) 한 줄.
   자료: subsidy-data.js (build/subsidy-extract.js 생성물)

   원칙
   - status === "reviewed" 인 사업만 문답을 연다. draft 는 안내문만 — 무응답은 미게시.
   - 답은 localStorage 'bhlab.profile' 한 키에만 남는다. 어디로도 전송하지 않는다.
   - "신청 가능/신청하세요/받으실 수 있습니다" 같은 단정 표현은 쓰지 않는다.
     최종 자격은 담당과 심사다.
   - ICS 는 기존 buildICS/downloadICS 를 그대로 재사용한다. 알림 두 개(마감 3일 전·전날)는
     생성된 문자열에 VALARM 블록을 더해 넣는다 — 새 생성기를 만들지 않는다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const DATA = (window.BW_SUBSIDY && window.BW_SUBSIDY.items) || [];
  const byKey = {}; DATA.forEach(it => { byKey[it.issueKey] = it; });
  const PKEY = 'bhlab.profile';
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function prof() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { return {}; } }
  function saveProf(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { } }

  /* 이 사업에서 물을 것만 고른다 — null 조건은 질문하지 않는다. 최대 5개. */
  function questionsOf(c) {
    const q = [];
    if (c.ageMin !== null || c.ageMax !== null) q.push('age');
    if (c.residency) q.push('residency');
    if (c.needsFarmRegistry) q.push('farm');
    if (c.gender) q.push('gender');
    return q.slice(0, 5);
  }

  function judge(c, a) {
    const fails = [], unknown = [];
    if (c.ageMin !== null || c.ageMax !== null) {
      if (a.age == null || a.age === '') unknown.push('나이');
      else {
        const n = +a.age;
        if (c.ageMin !== null && n < c.ageMin) fails.push(`나이(${c.ageMin}세 이상)`);
        if (c.ageMax !== null) {
          const over = c.ageMaxInclusive ? n > c.ageMax : n >= c.ageMax;
          if (over) fails.push(`나이(${c.ageMax}세 ${c.ageMaxInclusive ? '이하' : '미만'})`);
        }
      }
    }
    if (c.residency) {
      if (a.residency === 'no') fails.push(`거주(${c.residency})`);
      else if (a.residency !== 'yes') unknown.push('거주');
    }
    if (c.needsFarmRegistry) {
      if (a.farm === 'no') fails.push('농업경영체 등록');
      else if (a.farm !== 'yes') unknown.push('농업경영체 등록');
    }
    if (c.gender) {
      if (a.gender === 'no') fails.push(`대상(${c.gender})`);
      else if (a.gender !== 'yes') unknown.push('대상');
    }
    if (fails.length) return { r: 'no', fails };
    if (unknown.length) return { r: 'ask', unknown };
    return { r: 'ok' };
  }

  function dday(end, today) {
    const ms = new Date(end + 'T00:00:00') - new Date(today + 'T00:00:00');
    return Math.round(ms / 864e5);
  }

  /* 기존 buildICS 출력에 마감 3일 전·전날 알림을 더해 넣는다 */
  function icsWithAlarms(H, iss, endYmd, title) {
    const base = H.buildICS([iss]); if (!base) return null;
    const alarm = (days, msg) =>
      `BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${msg}\r\nTRIGGER:-P${days}D\r\nEND:VALARM\r\n`;
    /* 기존 VEVENT 끝에 두 알림을 끼워 넣는다 */
    return base.replace(/END:VEVENT/,
      alarm(3, `[마감 3일 전] ${title}`) + alarm(1, `[마감 전날] ${title}`) + 'END:VEVENT');
  }

  function open(iss, sub, H) {
    let m = document.getElementById('subModal');
    if (!m) { m = document.createElement('div'); m.id = 'subModal'; m.className = 'modal'; document.body.appendChild(m); }
    const c = sub.conditions, qs = questionsOf(c), P = prof();
    const a = { age: P.age ?? '', residency: P.residency ?? '', farm: P.farm ?? '', gender: P.gender ?? '' };

    const qHtml = {
      age: `<div class="sub-q">나이가 어떻게 되세요?</div>
        <div class="sub-opts"><input class="sub-age" id="subAge" type="number" min="0" max="120"
          inputmode="numeric" placeholder="예: 45" value="${E(a.age)}"> <span style="align-self:center">세</span></div>`,
      residency: `<div class="sub-q">봉화군에 주소를 두고 계신가요?</div>
        <div class="sub-opts" data-k="residency">
          <button type="button" data-v="yes">예</button><button type="button" data-v="no">아니오</button>
          <button type="button" data-v="idk">모르겠음</button></div>`,
      farm: `<div class="sub-q">농업경영체 등록을 하셨나요?</div>
        <div class="sub-opts" data-k="farm">
          <button type="button" data-v="yes">예</button><button type="button" data-v="no">아니오</button>
          <button type="button" data-v="idk">모르겠음</button></div>`,
      gender: `<div class="sub-q">주민등록상 ${E(c.gender)}이신가요?</div>
        <div class="sub-opts" data-k="gender">
          <button type="button" data-v="yes">예</button><button type="button" data-v="no">아니오</button>
          <button type="button" data-v="idk">모르겠음</button></div>`,
    };
    m.innerHTML = `<div class="mbox">
      <h2>내가 받을 수 있나</h2>
      <div class="note">${E(sub.title)}</div>
      ${qs.map(k => qHtml[k]).join('')}
      <div id="subOut"></div>
      <div class="sub-raw"><details><summary>근거 원문 보기</summary><pre>${E(sub.rawLines.join('\n'))}</pre></details></div>
      <div class="sub-note">답하신 내용은 이 휴대폰에만 저장되며 어디에도 전송되지 않습니다.<br>
        최종 결정은 담당 부서 심사로 정해집니다.</div>
      <div class="mfoot"><button id="subGo" class="pri">결과 보기</button>
        <span style="flex:1"></span><button id="subClose">닫기</button></div>
    </div>`;
    m.classList.add('open');
    m.querySelector('#subClose').onclick = () => m.classList.remove('open');
    m.onclick = e => { if (e.target === m) m.classList.remove('open'); };
    m.querySelectorAll('.sub-opts[data-k] button').forEach(b => {
      const k = b.parentElement.dataset.k;
      if (a[k] === b.dataset.v) b.classList.add('on');
      b.onclick = () => {
        a[k] = b.dataset.v;
        b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      };
    });

    m.querySelector('#subGo').onclick = () => {
      const ageI = m.querySelector('#subAge'); if (ageI) a.age = ageI.value;
      saveProf({ ...prof(), ...a });                    /* 다음 사업의 기본값으로 */
      const v = judge(c, a);
      const out = m.querySelector('#subOut');
      const today = window.BWUI ? BWUI.api.today : new Date().toISOString().slice(0, 10);
      if (v.r === 'no') {
        out.innerHTML = `<div class="sub-verdict no">${E(v.fails.join(', '))} 조건에서 해당되지 않습니다.</div>`;
      } else if (v.r === 'ask') {
        out.innerHTML = `<div class="sub-verdict ask">자동으로 판단할 수 없습니다. 담당과에 문의하세요.<br>
          <span style="font-weight:400">확인이 필요한 것: ${E(v.unknown.join(', '))}</span></div>`;
      } else {
        let follow = '';
        if (c.applyEnd) {
          const d = dday(c.applyEnd, today);
          follow += d < 0 ? `<div>접수가 끝났습니다. (마감 ${E(c.applyEnd)})</div>`
            : `<div>신청 마감까지 <b>${d === 0 ? '오늘까지' : d + '일'}</b> 남았습니다. (마감 ${E(c.applyEnd)})</div>`;
        }
        if (sub.apply && sub.apply.place) follow += `<div>접수처: ${E(sub.apply.place)}</div>`;
        if (sub.apply && sub.apply.documents && sub.apply.documents.length)
          follow += `<div>챙길 서류: ${E(sub.apply.documents.join(', '))}</div>`;
        const tel = H.tel || '';
        const canIcs = c.applyEnd && dday(c.applyEnd, today) >= 0;
        follow += `<div class="row">
          ${tel ? `<a class="callbtn" style="flex:1" href="tel:${E(tel)}">📞 담당과 전화</a>` : ''}
          ${canIcs ? `<button type="button" id="subIcs" class="callbtn" style="flex:1;background:var(--paper);color:var(--acc);border:1.5px solid var(--acc)">🔔 마감 알림</button>` : ''}
        </div>`;
        if (!sub.apply || !sub.apply.place) follow += `<div class="sub-note">접수처 안내가 아직 없습니다 — 담당과 전화로 확인하세요.</div>`;
        out.innerHTML = `<div class="sub-verdict ok">해당될 수 있습니다. 신청 전에 담당과에 확인하세요.</div>
          <div class="sub-follow">${follow}</div>`;
        const ib = out.querySelector('#subIcs');
        if (ib) ib.onclick = () => {
          /* 마감일 하루짜리 일정으로 — 기존 생성기를 그대로 쓰려고 가짜 현안을 만든다 */
          const fake = { _id: 'sublab:' + sub.id, title: '[신청 마감] ' + sub.title, dept: sub.dept,
            list: [{ week: sub.week, item: { title: sub.title, lines: [{ lv: 1, txt: `기간: ${c.applyEnd.replace(/-/g, '. ')}.` }] } }] };
          const txt = icsWithAlarms(H, fake, c.applyEnd, sub.title);
          if (txt) H.downloadICS(txt, '봉화군_마감알림_' + sub.id + '.ics');
        };
      }
      out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  }

  /* ── 목록에서 찾을 수 있게 ──
     검수된 사업만 문답이 열리는데, 목록에서는 어느 것이 그런지 알 수 없어
     '아무것도 안 바뀐 것 같다'는 인상을 준다. 카드 제목 옆에 작은 표식을 단다.
     index.html 을 더 고치지 않으려고 여기서 목록 변화를 지켜보며 붙인다. */
  const okKeys = new Set(DATA.filter(i => i.status === 'reviewed').map(i => i.issueKey));
  /* 카드 제목만으로는 같은 사업의 다른 연도와 헷갈린다 — 현안 키로 맞춘다 */
  let titleSet = null;
  function reviewedTitles() {
    if (titleSet || !window.BWUI || !BWUI.api || !BWUI.api.issues) return titleSet;
    titleSet = new Set(BWUI.api.issues.filter(i => okKeys.has(i.key)).map(i => i.title.trim()));
    return titleSet;
  }
  function markCards() {
    const T = reviewedTitles(); if (!T) return;
    document.querySelectorAll('#bwCards .card h3').forEach(h => {
      if (h.dataset.subMark) return;
      h.dataset.subMark = '1';
      if (!T.has(h.textContent.trim())) return;
      const b = document.createElement('span');
      b.className = 'sub-badge'; b.textContent = '조건 확인';
      h.appendChild(document.createTextNode(' ')); h.appendChild(b);
    });
  }
  function watchList() {
    const box = document.getElementById('bwCards'); if (!box) return setTimeout(watchList, 400);
    markCards();
    new MutationObserver(markCards).observe(box, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watchList); else watchList();

  window.BWLAB_SUBSIDY = {
    mount(iss, foot, H) {
      const sub = byKey[iss.key]; if (!sub) return;
      const row = foot.querySelector('div');   /* [알림 받기][문의] 줄 */
      if (!row) return;
      if (sub.status === 'reviewed') {
        const b = document.createElement('button');
        b.type = 'button'; b.id = 'subBtn'; b.className = 'callbtn';
        b.textContent = '✅ 내가 받을 수 있나';
        b.onclick = () => open(iss, sub, H);
        row.insertBefore(b, row.firstChild);
      } else {
        const d = document.createElement('div'); d.className = 'sub-hold';
        d.innerHTML = '조건 확인 필요 — <b>담당과에 문의하세요</b>';
        foot.insertBefore(d, foot.firstChild);
        const tel = row.querySelector('a[href^="tel:"]');
        if (tel) { tel.style.background = 'var(--acc)'; tel.style.color = '#fff'; tel.style.fontWeight = '800'; }
      }
    }
  };
})();
