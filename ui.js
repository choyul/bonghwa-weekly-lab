/* ═══════════════════════════════════════════════════════════════
   ui.js — 세 화면 공통 대시보드 엔진
   군정 전반을 같은 방식으로 훑게 하고, 역할별 기능만 각 화면이 끼워 넣는다.
   군수 전용 코드(체크·메모·연락처)는 여기 두지 않는다 — mayor.html 안에만 있다.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  const E = BW.escH;
  const $ = s => document.querySelector(s);

  let D, CFG, ISSUES = [], IDF, ANNUAL, TODAY;
  /* 기간은 달력이 정한다.
       scope 'week'  이번 주 (기본)
             'day'   달력에서 고른 하루
             'month' 달력 제목을 눌러 그 달 전체
             'all'   검색할 때 지난 1년까지
     axis : 화면이 정의하는 분류축(주제·대상·지역 등)의 선택값 */
  const S = {
    scope: 'week', month: '', day: '', week: '', from: '', to: '',
    q: '', status: '', dept: '', type: '', annual: false, custom: '', axis: {}, limit: 60,
    onLimit: 12,       /* '전부터 이어지는' 묶음에서 한 번에 보여줄 개수 */
    govOpen: false,    /* '군청이 하는 일' 접힘 상태 — 군민용(옛 방식)에서만 쓴다 */
    grpTab: 'apply'    /* 갈래 탭 — apply(신청·참여) | gov(군정 소식) | notice(고시·공고) */
  };
  let curIssue = null, simExpanded = false, onSig = '';
  let GRP_COUNTS = null;   /* 갈래 탭 건수 — 화면(히어로 등)이 읽어 간다 */

  /* ───────── 토스트 ───────── */
  let toastT;
  function toast(m) {
    let t = $('#bwToast');
    if (!t) { t = document.createElement('div'); t.id = 'bwToast'; document.body.appendChild(t); }
    t.textContent = m; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
  }

  /* ───────── 라벨 ───────── */
  const ST_LABEL = { done: '종료', ongoing: '진행중', upcoming: '예정', none: '기간 미기재' };
  function typeLabel(t) { return CFG.publicLabels ? (BW.PUBLIC_TYPE_LABELS[t] || t) : t; }
  /* 화면이 자기 분류를 쓰면(군민용 주제 등) 그것을 태그에 쓴다 — 축과 태그가 어긋나면 안 된다 */
  function tagOf(iss) { return CFG.typeTag ? CFG.typeTag(iss) : { v: iss.type, label: typeLabel(iss.type) }; }

  /* ───────── 초기화 ───────── */
  function start(cfg) {
    CFG = Object.assign({
      role: 'staff', publicLabels: false, progAsStage: false,
      cardActions: null, detailBlocks: null, detailFooter: null,
      topSections: null, headerButtons: [], hideTiles: false
    }, cfg);
    D = global.BW_DATA;
    TODAY = BW.ymd(new Date());

    /* 현안 구성 — 부서 단위 군집 (검증된 기존 로직) */
    D.depts.forEach(dept => {
      BW.groupIssues(D.occ.filter(o => o.dept === dept), D.rules).forEach(iss => {
        iss.dept = dept;
        iss._id = dept + '|' + iss.key;
        ISSUES.push(iss);
      });
    });
    IDF = BW.buildIdf(ISSUES);
    ANNUAL = BW.annualGroups(D.occ);
    ISSUES.forEach(iss => {
      iss._st = BW.issuePeriodStatus(iss, TODAY) || 'none';     /* 기간 기준 3상태 */
      iss._range = BW.issueDateRange(iss);
      iss._ann = BW.annualInfo(iss, ANNUAL);                    /* 매년 이맘때 */
      iss._stale = BW.statusByRecency(iss, D.weekStart) === 'stale';
      iss._text = (iss.title + ' ' + iss.list.map(o => o.item.lines.map(l => l.txt).join(' ')).join(' ')).toLowerCase();
    });
    ISSUES.sort((a, b) => a.last < b.last ? 1 : -1);

    buildShell();
    render();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
    if (CFG.onReady) CFG.onReady({ issues: ISSUES, data: D, today: TODAY });
  }

  /* ───────── 화면 뼈대 ───────── */
  function buildShell() {
    const hb = CFG.headerButtons.map((b, i) => `<button class="hbtn" data-hb="${i}">${E(b.label)}</button>`).join('');
    document.body.insertAdjacentHTML('afterbegin', `
      <header class="bw-head"><div class="in">
        <h1>${E(CFG.title || '주간업무')}</h1>
        <span class="sp"></span>${hb}
        <div class="wk">${E(BW.weekKo(D.weekStart))} 자료 · ${E(BW.weekLabel(D.weekStart))}</div>
      </div></header>
      <div class="bw-wrap">
        <div id="bwCal"></div>
        <div class="searchbar"><input id="bwQ" type="search" placeholder="${E(CFG.searchPlaceholder || '업무명·내용 검색')}"></div>
        ${CFG.hideTiles ? '' : '<div class="tiles" id="bwTiles"></div>'}
        <div id="bwAxes"></div>
        <div id="bwTop"></div>
        <div class="activef" id="bwFilters"></div>
        <div class="listinfo" id="bwInfo"></div>
        <div class="cards ${CFG.listStyle === 'rows' ? 'rows' : ''}" id="bwCards"></div>
        <div id="bwMore"></div>
      </div>
      <div id="bwSheet"><div class="sheet">
        <div class="shd"><h2 id="bwShTitle"></h2><span id="bwShActs"></span><button id="bwShClose" aria-label="닫기">✕</button></div>
        <div class="sbd" id="bwShBody"></div>
        <div class="sft" id="bwShFoot" style="display:none"></div>
      </div></div>`);

    document.querySelectorAll('[data-hb]').forEach(b =>
      b.onclick = () => CFG.headerButtons[+b.dataset.hb].on());

    S.month = D.weekStart.slice(0, 7);

    const q = $('#bwQ'); let t;
    q.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const had = S.q;
        S.q = q.value.trim();
        /* 검색은 지난 1년 전체에서. 검색어를 지우면 이번 주로 돌아온다. */
        if (S.q && !had) S.scope = 'all';
        if (!S.q && had) { S.scope = 'week'; S.day = ''; }
        S.limit = 60; render();
      }, 200);
    };

    $('#bwShClose').onclick = closeSheet;
    $('#bwSheet').onclick = e => { if (e.target.id === 'bwSheet') closeSheet(); };

    if (CFG.topSections) CFG.topSections($('#bwTop'), api);
  }

  /* ───────── 필터 ───────── */
  /* 어떤 일이 [from,to] 와 겹치는가 — 기재된 기간을 못 읽으면 그 주(월~일)를 그 일의 기간으로 본다 */
  function overlapsDates(iss, from, to) {
    return iss.list.some(o => {
      const r = BW.parseDateRange(o.item, o.week);
      let a, b;
      if (r && r.start) { a = r.start; b = r.end || r.start; }
      else { a = o.week; b = BW.ymd(new Date(BW.d2(o.week).getTime() + 6 * 864e5)); }
      return a <= to && b >= from;
    });
  }
  function inRange(iss) {
    if (S.scope === 'all') return true;
    /* 화면이 '이번 주'를 달력 주(일~토)처럼 따로 정해 주면 그 날짜 창으로 거른다.
       (안 정하면 예전처럼 주간계획이 실린 주 단위로 — 군수·직원용은 그대로) */
    if (S.scope === 'week' && CFG.weekWindow) { const w = CFG.weekWindow(); return overlapsDates(iss, w[0], w[1]); }
    if (S.scope === 'week') return iss.list.some(o => o.week === (S.week || D.weekStart));
    if (S.scope === 'month') return iss.list.some(o => o.week.slice(0, 7) === S.month);
    if (S.scope === 'day') {
      return iss.list.some(o => BW.coversDate(o.item, o.week, S.day));
    }
    /* 직접 고른 기간(S.from~S.to) — 일이 실제로 걸쳐 있으면 걸린다.
       기재된 기간을 읽을 수 없는 건은 그 주(월~일)를 그 일의 기간으로 본다. */
    if (S.scope === 'range') {
      if (!S.from || !S.to) return true;
      return overlapsDates(iss, S.from, S.to);
    }
    return true;
  }
  /* 날짜를 뺀 나머지 조건 (주제·대상·지역·검색어 …) — '계속 진행 중' 목록도 이 조건은 똑같이 따른다 */
  function matchesExceptRange(iss) {
    for (const ax of (CFG.axes || [])) {
      const v = S.axis[ax.key];
      if (v && !ax.match(iss, v)) return false;
    }
    if (S.status && iss._st !== S.status) return false;
    if (S.dept && iss.dept !== S.dept) return false;
    if (S.type && iss.type !== S.type) return false;
    if (S.annual && !iss._ann) return false;
    if (S.custom && CFG.customFilters && CFG.customFilters[S.custom] && !CFG.customFilters[S.custom].fn(iss)) return false;
    if (S.q && !iss._text.includes(S.q.toLowerCase())) return false;
    return true;
  }
  function matches(iss) {
    return inRange(iss) && matchesExceptRange(iss);
  }

  /* ── 지금 고른 기간을 실제 날짜 구간으로 — '계속 진행 중' 판단에 쓴다 ── */
  function periodBounds() {
    if (S.scope === 'all') return null;                      /* 전체 기간이면 이미 다 보인다 */
    if (S.scope === 'day') return [S.day, S.day];
    if (S.scope === 'range') return (S.from && S.to) ? [S.from, S.to] : null;
    if (S.scope === 'month') {
      const [y, m] = S.month.split('-').map(Number);
      return [S.month + '-01', BW.ymd(new Date(y, m, 0))];
    }
    if (CFG.weekWindow) return CFG.weekWindow();              /* 화면이 정한 달력 주 */
    const w = S.week || D.weekStart;                          /* week */
    return [w, BW.ymd(new Date(BW.d2(w).getTime() + 6 * 864e5))];
  }
  /* 그 일의 기재 기간이 [from,to] 와 겹치는가 (끝이 없으면 계속 진행으로 본다) */
  function periodOverlaps(iss, from, to) {
    const r = iss._range;
    if (!r || !r.start) return false;
    const end = r.openEnded ? '9999-12-31' : (r.end || r.start);
    return r.start <= to && end >= from;
  }
  /* 고른 기간의 '주간계획에는 없지만 아직 진행 중'인 일 — 놓치기 쉬운 것들을 이어서 보여준다 */
  function ongoingExtra(shown) {
    const b = periodBounds(); if (!b) return [];
    const seen = new Set(shown.map(i => i._id));
    const out = ISSUES.filter(i => !seen.has(i._id) && periodOverlaps(i, b[0], b[1]) && matchesExceptRange(i));
    /* 마감이 가까운 것부터 — 끝나는 날이 없는 상시 사업은 뒤로 */
    const endOf = i => (i._range && !i._range.openEnded && (i._range.end || i._range.start)) || '9999-12-31';
    out.sort((a, c) => endOf(a) < endOf(c) ? -1 : endOf(a) > endOf(c) ? 1 : 0);
    return out;
  }
  function setFilter(k, v) {
    S[k] = (S[k] === v) ? (typeof v === 'boolean' ? false : '') : v;
    S.limit = 60; render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ───────── 월별 달력 ─────────
     기간 버튼 대신 달력이 '언제'를 맡는다. 이번 주 줄은 늘 눈에 띄게 둔다.
     날짜별 건수는 달마다 한 번만 세어 둔다 (3천 건을 매번 훑지 않도록). */
  const dayCountCache = {};
  /* 격자에 보이는 날짜 전부를 센다 — 이번 주가 달을 걸치면 다음 달 칸도 세어야 한다 */
  function dayCounts(from, to) {
    const key = from + '~' + to;
    if (dayCountCache[key]) return dayCountCache[key];
    const map = {};
    D.occ.forEach(o => {
      const ws = o.week, we = BW.ymd(BW.addD(BW.d2(o.week), 6));
      if (we < from || ws > to) return;
      for (let i = 0; i < 7; i++) {
        const d = BW.ymd(BW.addD(BW.d2(o.week), i));
        if (d < from || d > to) continue;
        if (BW.coversDate(o.item, o.week, d)) (map[d] = map[d] || new Set()).add(o.dept + '|' + BW.normKey(o.item.title));
      }
    });
    const out = {}; Object.entries(map).forEach(([d, s]) => out[d] = s.size);
    return dayCountCache[key] = out;
  }
  const MONTHS = () => [...new Set(D.weeks.map(w => w.slice(0, 7)))].sort();

  let calOpen = null;   /* null 이면 CFG.calendarOpen 기본값을 따른다 */
  function renderCalendar() {
    const host = $('#bwCal');
    if (CFG.showCalendar === false) { host.innerHTML = ''; return; }
    if (calOpen === null) calOpen = CFG.calendarOpen !== false;
    /* 접힘 상태 — 지금 보고 있는 기간만 한 줄로 알리고 자리를 비운다 */
    if (!calOpen) {
      const lbl = S.scope === 'week' ? '이번 주'
        : S.scope === 'day' ? (() => { const d = BW.d2(S.day); return `${d.getMonth() + 1}월 ${d.getDate()}일(${BW.DOW[d.getDay()]})`; })()
          : S.scope === 'month' ? (() => { const [y, m] = S.month.split('-'); return `${+y}년 ${+m}월`; })()
            : '지난 1년';
      host.innerHTML = `<button class="calfold" id="bwCalOpen">📅 ${E(lbl)} <span class="hint">· 날짜로 보기</span></button>`;
      $('#bwCalOpen').onclick = () => { calOpen = true; render(); };
      return;
    }
    const months = MONTHS();
    const mi = months.indexOf(S.month);
    const [y, m] = S.month.split('-').map(Number);
    const thisWeekEnd = BW.ymd(BW.addD(BW.d2(D.weekStart), 6));

    /* 월요일 시작 격자 */
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7;
    const start = BW.addD(first, -lead);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = BW.addD(start, i);
      const v = BW.ymd(d);
      if (i >= 35 && v.slice(0, 7) !== S.month) break;
      cells.push({
        v, day: d.getDate(), out: v.slice(0, 7) !== S.month,
        thisWeek: v >= D.weekStart && v <= thisWeekEnd,
        weekend: d.getDay() === 0 || d.getDay() === 6
      });
    }
    const counts = dayCounts(cells[0].v, cells[cells.length - 1].v);
    cells.forEach(c => c.n = counts[c.v] || 0);
    host.innerHTML = `
      <div class="mcal">
        <div class="mhead">
          <button class="mnav" data-mv="-1" ${mi <= 0 ? 'disabled' : ''} aria-label="이전 달">‹</button>
          <button class="mtitle ${S.scope === 'month' ? 'on' : ''}" data-scope="month">${y}년 ${m}월</button>
          <button class="mnav" data-mv="1" ${mi >= months.length - 1 ? 'disabled' : ''} aria-label="다음 달">›</button>
          <span style="flex:1"></span>
          <button class="mthis ${S.scope === 'week' ? 'on' : ''}" data-scope="week">이번 주</button>
          ${CFG.calendarOpen === false ? '<button class="mnav" id="bwCalClose" aria-label="달력 접기">✕</button>' : ''}
        </div>
        <div class="mdow">${['월', '화', '수', '목', '금', '토', '일'].map((d, i) =>
      `<span class="${i >= 5 ? 'we' : ''}">${d}</span>`).join('')}</div>
        <div class="mgrid">${cells.map(c => `
          <button class="mday ${c.out ? 'out' : ''} ${c.thisWeek ? 'tw' : ''} ${c.weekend ? 'we' : ''}
            ${S.scope === 'day' && S.day === c.v ? 'on' : ''} ${c.n ? '' : 'zero'}" data-day="${c.v}">
            <span class="d">${c.day}</span>${c.n ? `<span class="n">${c.n}</span>` : ''}
          </button>`).join('')}</div>
        <div class="mfoot">
          <span class="hint">${S.scope === 'week' ? '이번 주 줄이 밝게 표시됩니다. 날짜를 누르면 그날 것만 봅니다.'
        : S.scope === 'day' ? BW.weekKo(S.day) + ' · 날짜를 다시 누르면 이번 주로 돌아갑니다.'
          : S.scope === 'month' ? '이 달에 올라온 일 전체입니다.'
            : '지난 1년에서 찾고 있습니다.'}</span>
        </div>
      </div>`;
    const cc = $('#bwCalClose'); if (cc) cc.onclick = () => { calOpen = false; render(); };
    host.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const ni = mi + (+b.dataset.mv); if (ni < 0 || ni >= months.length) return;
      S.month = months[ni]; S.scope = 'month'; S.day = ''; S.limit = 60; render();
    });
    host.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => {
      S.scope = b.dataset.scope; S.day = '';
      if (S.scope === 'week') S.month = D.weekStart.slice(0, 7);
      S.q = ''; $('#bwQ').value = '';
      S.limit = 60; render();
    });
    host.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
      const v = b.dataset.day;
      if (S.scope === 'day' && S.day === v) { S.scope = 'week'; S.day = ''; S.month = D.weekStart.slice(0, 7); }
      else { S.scope = 'day'; S.day = v; S.month = v.slice(0, 7); }
      S.q = ''; $('#bwQ').value = '';
      S.limit = 60; render();
    });
  }

  function renderTiles() {
    if (CFG.hideTiles) return;
    /* 타일은 지금 보고 있는 기간 안에서의 상태 분포 */
    const all = ISSUES.filter(i => {
      const keep = S.status; S.status = ''; const r = matches(i); S.status = keep; return r;
    });
    const c = { ongoing: 0, upcoming: 0, done: 0, none: 0 };
    all.forEach(i => c[i._st]++);
    const tiles = [
      { k: '', cls: 't-all', n: all.length, l: '전체' },
      { k: 'ongoing', cls: 't-ongoing', n: c.ongoing, l: '진행중' },
      { k: 'upcoming', cls: 't-upcoming', n: c.upcoming, l: '예정' },
      { k: 'done', cls: 't-done', n: c.done, l: '종료' }
    ];
    $('#bwTiles').innerHTML = tiles.map(t =>
      `<button class="tile ${t.cls} ${S.status === t.k ? 'on' : ''}" data-st="${t.k}">
        <div class="n">${t.n}</div><div class="l">${t.l}</div></button>`).join('');
    $('#bwTiles').querySelectorAll('[data-st]').forEach(b =>
      b.onclick = () => { S.status = b.dataset.st; S.limit = 60; render(); });
  }

  /* ───────── 분류축 (달력 / 주제 / 대상 / 지역) ─────────
     화면이 CFG.axes 로 정의한다. 값마다 건수를 세어 보여주고,
     비어 있는 값은 흐리게 둔다 — 눌렀는데 아무것도 없는 일을 막는다. */
  function countFor(ax, v) {
    const keep = S.axis[ax.key]; S.axis[ax.key] = '';
    /* 키워드처럼 '1년 동안'을 세야 하는 축은 지금 보고 있는 기간을 무시한다 */
    const keepScope = S.scope;
    if (ax.globalCount) S.scope = 'all';
    const n = v === '' ? ISSUES.filter(matches).length
      : ISSUES.filter(i => matches(i) && ax.match(i, v)).length;
    S.scope = keepScope;
    S.axis[ax.key] = keep;
    return n;
  }
  /* 값 목록 앞에 '전체'를 붙인다. 아무것도 안 고른 상태가 곧 전체이므로 v 는 빈 값. */
  function axValues(ax) {
    const vals = typeof ax.values === 'function' ? ax.values() : ax.values;
    return ax.allLabel ? [{ v: '', label: ax.allLabel, icon: ax.allIcon || '' }].concat(vals) : vals;
  }
  function pickAxis(key, v) {
    const ax = (CFG.axes || []).find(a => a.key === key);
    S.axis[key] = S.axis[key] === v ? '' : v;
    /* 1년 단위로 보는 축(키워드)은 고르는 순간 기간을 1년으로 넓힌다.
       이번 주 안에서만 세면 대부분 0건이라 기능이 죽는다. */
    if (ax && ax.expandScope && S.axis[key]) { S.scope = 'all'; S.day = ''; }
    S.limit = 60; render();
  }
  let axesOpen = null;
  function renderAxes() {
    const host = $('#bwAxes'); if (!CFG.axes || !CFG.axes.length) return;
    if (axesOpen === null) axesOpen = CFG.axesOpen !== false;
    /* 축이 여럿이면 접어 둘 수 있게 — 목록까지 가는 길을 막지 않는다 */
    if (CFG.axesOpen === false) {
      const picked = CFG.axes.filter(ax => S.axis[ax.key]).length;
      const axLabel = CFG.axesLabel || '갈라 보기';
      if (!axesOpen) {
        host.innerHTML = `<button class="calfold" id="bwAxOpen">🔎 ${E(axLabel)}
          ${picked ? `<span class="axbadge">${picked}</span>` : ''}</button>`;
        $('#bwAxOpen').onclick = () => { axesOpen = true; render(); };
        return;
      }
    }
    host.innerHTML = (CFG.axesOpen === false
      ? `<button class="calfold" id="bwAxClose" style="margin-bottom:8px">🔎 ${E(CFG.axesLabel || '갈라 보기')} <span class="hint">· 접기</span></button>` : '')
      + CFG.axes.map(ax => {
      if (ax.when && !ax.when(S)) return '';
      const vals = axValues(ax);
      const cur = S.axis[ax.key] || '';
      if (ax.render === 'calendar') {
        return `<div class="axis"><p class="axh">${E(ax.label)}</p>
          <div class="cal">${vals.map(v => {
          const n = countFor(ax, v.v);
          return `<button class="calday ${cur === v.v ? 'on' : ''} ${n ? '' : 'zero'} ${v.weekend ? 'we' : ''}" data-ax="${ax.key}" data-v="${E(v.v)}">
              <span class="dow">${E(v.dow)}</span><span class="d">${E(v.day)}</span>
              <span class="cnt">${n ? n : '·'}</span></button>`;
        }).join('')}</div></div>`;
      }
      if (ax.render === 'circles') {
        return `<div class="axis"><p class="axh">${E(ax.label)}</p>
          <div class="circles">${vals.map(v => {
          const n = countFor(ax, v.v);
          return `<button class="circ ${cur === v.v ? 'on' : ''} ${n ? '' : 'zero'}" data-ax="${ax.key}" data-v="${E(v.v)}">
              <span class="ic">${v.icon || ''}</span><span class="lb">${E(v.label)}</span><span class="n">${n}</span></button>`;
        }).join('')}</div></div>`;
      }
      if (ax.render === 'cards') {
        return `<div class="axis"><p class="axh">${E(ax.label)}</p>
          <div class="topics">${vals.map(v => {
          const n = countFor(ax, v.v);
          return `<button class="topic ${cur === v.v ? 'on' : ''} ${n ? '' : 'zero'}" data-ax="${ax.key}" data-v="${E(v.v)}">
              <span class="ic">${v.icon || ''}</span><span class="lb">${E(v.label)}</span><span class="n">${n}건</span></button>`;
        }).join('')}</div></div>`;
      }
      /* chips */
      return `<div class="axis ${ax.kwStyle ? 'kw' : ''}"><p class="axh">${E(ax.label)}</p>
        <div class="axchips">${vals.map(v => {
        const n = countFor(ax, v.v);
        return `<button class="axchip ${cur === v.v ? 'on' : ''} ${n ? '' : 'zero'}" data-ax="${ax.key}" data-v="${E(v.v)}">
            ${E(v.label)} <span class="n">${n}</span></button>`;
      }).join('')}</div></div>`;
    }).join('');
    const ac = $('#bwAxClose'); if (ac) ac.onclick = () => { axesOpen = false; render(); };
    host.querySelectorAll('[data-ax]').forEach(b =>
      b.onclick = () => pickAxis(b.dataset.ax, b.dataset.v));
  }

  function renderActiveFilters() {
    const chips = [];
    if (S.status) chips.push({ k: 'status', t: '기간: ' + ST_LABEL[S.status] });
    if (S.dept) chips.push({ k: 'dept', t: '부서: ' + S.dept });
    if (S.type) chips.push({ k: 'type', t: '유형: ' + typeLabel(S.type) });
    if (S.annual) chips.push({ k: 'annual', t: '매년 이맘때' });
    if (S.custom && CFG.customFilters) chips.push({ k: 'custom', t: CFG.customFilters[S.custom].label });
    if (S.q) chips.push({ k: 'q', t: '검색: ' + S.q });
    (CFG.axes || []).forEach(ax => {
      const v = S.axis[ax.key]; if (!v) return;
      const vals = axValues(ax);
      const f = vals.find(x => x.v === v);
      chips.push({ k: 'axis:' + ax.key, t: (ax.chipLabel || ax.label) + ': ' + ((f && (f.chip || f.label)) || v) });
    });
    const el = $('#bwFilters');
    el.innerHTML = chips.map(c => `<button class="fchip" data-f="${c.k}">${E(c.t)} <span class="x">✕</span></button>`).join('')
      + (chips.length > 1 ? '<button class="fchip ghost" data-f="all">모두 해제</button>' : '');
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
      const k = b.dataset.f;
      if (k === 'all') { S.status = ''; S.dept = ''; S.type = ''; S.annual = false; S.custom = ''; S.q = ''; S.axis = {}; $('#bwQ').value = ''; }
      else if (k === 'annual') S.annual = false;
      else if (k === 'q') { S.q = ''; $('#bwQ').value = ''; }
      else if (k.startsWith('axis:')) S.axis[k.slice(5)] = '';
      else S[k] = '';
      S.limit = 60; render();
    });
  }

  /* ───────── 목록 ───────── */
  function render() {
    const rows = ISSUES.filter(matches);
    if (CFG.sortWith) rows.sort((a, b) => CFG.sortWith(a, b) || (a.last < b.last ? 1 : -1));
    else if (CFG.sortPriority) {
      const P = CFG.sortPriority;
      rows.sort((a, b) => (P[a.type] ?? 9) - (P[b.type] ?? 9) || (a.last < b.last ? 1 : -1));
    }
    renderCalendar();
    renderTiles();
    renderAxes();
    renderActiveFilters();
    const scopeLabel =
      S.scope === 'week' ? '이번 주'
        : S.scope === 'day' ? (() => { const d = BW.d2(S.day); return `${d.getMonth() + 1}월 ${d.getDate()}일(${BW.DOW[d.getDay()]})`; })()
          : S.scope === 'month' ? (() => { const [y, m] = S.month.split('-'); return `${+y}년 ${+m}월`; })()
            : '지난 1년';
    $('#bwInfo').innerHTML = CFG.groupTabs
      /* 갈래 탭 화면에는 목록 제목을 두지 않는다 —
         기간은 위 달력이, 건수와 갈래는 탭이 이미 말하고 있어 한 줄이 더 있으면 겹친다 */
      ? ''
      : CFG.listTitle
      ? `<span class="listh">${E(scopeLabel)} ${E(CFG.listTitle)}</span> <span class="hint">${rows.length}건</span>`
      : `${E(scopeLabel)} ${rows.length}건 <span class="hint">· 태그를 누르면 그 조건으로 모아 봅니다</span>`;
    const box = $('#bwCards'); box.innerHTML = '';
    /* 갈래 탭 화면은 rows 가 0건이어도 탭을 그려야 한다 —
       '진행 중'에서 끌어오는 것과 고시·공고는 rows 밖에 있기 때문이다. */
    if (CFG.groupTabs && CFG.splitAdmin) {
      /* ── 갈래 탭: 한 번에 한 갈래만 ──
         예전 화면은 [이번 주 신청 가능] [군청이 하는 일] [지금도 진행 중 172건] [고시·공고]가
         한 두루마리에 이어져 8화면을 넘겼다. '이번 주 계획서에 실렸나 지난 것에 실렸나'는
         군청 내부 사정일 뿐이라, 기간 안의 것과 아직 진행 중인 것을 합쳐
         [신청·참여 | 군정 소식 | 고시·공고] 세 갈래로만 가르고 한 갈래씩 보여 준다. */
      const extra = CFG.ongoingSection ? ongoingExtra(rows) : [];
      const isApply = iss => CFG.splitAdmin(iss);
      const endOf = i => (i._range && !i._range.openEnded && (i._range.end || i._range.start)) || '';
      /* 마감 가까운 순 — ①앞으로 마감될 것(가까운 순) ②막 끝난 것(최근 순) ③기한 없는 상시 */
      const applyKey = i => { const e = endOf(i);
        if (!e) return '2~';
        return e >= TODAY ? '0~' + e : '1~' + (99999999 - +e.replace(/-/g, ''));
      };
      const bySoon = (a, c) => { const x = applyKey(a), y = applyKey(c); return x < y ? -1 : x > y ? 1 : 0; };
      /* 이번 계획에 새로 실린 것(rows)과, 지난 계획에 실렸지만 아직 기간이 남은 것(extra)을
         섞지 않고 나눠 둔다 — 마감순으로만 늘어놓으면 몇 달 된 사업이 맨 위로 올라와
         '이번 주 새 소식'을 보러 온 사람이 헤맨다. */
      /* 기간·필터·갈래가 바뀌면 '더 보기'로 늘려 둔 개수를 처음으로 되돌린다 */
      const gsig = JSON.stringify([S.scope, S.day, S.month, S.week, S.from, S.to, S.q,
        S.axis, S.custom, S.grpTab]);
      if (gsig !== onSig) { S.limit = 60; S.onLimit = 12; onSig = gsig; }
      const applyNew = rows.filter(isApply).sort(bySoon);
      const applyOld = extra.filter(isApply).sort(bySoon);
      const govNew = rows.filter(i => !isApply(i)).sort(bySoon);
      const govOld = extra.filter(i => !isApply(i)).sort(bySoon);
      const ntN = CFG.noticeTab ? CFG.noticeTab.count() : 0;
      GRP_COUNTS = { apply: applyNew.length + applyOld.length,
                     gov: govNew.length + govOld.length, notice: ntN };
      /* 탭은 #bwCards 밖에 둔다 — 안에 두면 다음 렌더의 innerHTML='' 로 같이 지워지고,
         맞춤설정(#bwAxes)을 안으로 옮기면 그것까지 사라진다.
         자리는 맞춤설정 바로 위 — [갈래 탭] → [맞춤설정] → [목록] 차례가 된다. */
      const axHost = $('#bwAxes');
      let bar = $('#bwGrpTabs');
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'grptabs'; bar.id = 'bwGrpTabs';
        if (axHost && axHost.parentNode) axHost.parentNode.insertBefore(bar, axHost);
        else box.parentNode.insertBefore(bar, box);
      }
      bar.innerHTML = [['apply', '📝', '신청·참여', GRP_COUNTS.apply], ['gov', '🏛', '군정 소식', GRP_COUNTS.gov],
        ['notice', '📢', '고시·공고', ntN]].map(([k, i, l, n]) =>
          `<button type="button" data-g="${k}" class="${S.grpTab === k ? 'on' : ''}">
             <span class="gi">${i}</span><span class="gl">${l}</span><span class="gn">${n}</span></button>`).join('');
      bar.querySelectorAll('button').forEach(b => b.onclick = () => {
        if (S.grpTab === b.dataset.g) return;
        S.grpTab = b.dataset.g; S.limit = 60;
        if (CFG.onGroupTab) CFG.onGroupTab(S.grpTab);
        render();
        /* 탭은 화면 위에 붙어 있으므로 자리는 그대로 두고 목록만 바뀐다 */
      });
      const note = t => { const d = document.createElement('div'); d.className = 'grpnote'; d.textContent = t; box.appendChild(d); };
      const sub = (icon, text, n) => {
        const d = document.createElement('div'); d.className = 'grpsub';
        d.innerHTML = `<span class="gsi">${icon}</span><span class="gst">${E(text)}</span><span class="gsn">${n}건</span>`;
        box.appendChild(d);
      };
      $('#bwMore').innerHTML = '';
      if (S.grpTab === 'notice') {
        if (ntN && CFG.noticeTab) CFG.noticeTab.render(box);
        else if (CFG.noticeTab && CFG.noticeTab.renderRecent) {
          /* 고른 기간(예: 오늘)에 새 공고가 없어도 빈 화면으로 두지 않는다 */
          note('이 기간에 새로 올라온 고시·공고는 없어요 — 최근 것을 보여 드려요');
          CFG.noticeTab.renderRecent(box);
        } else note('이 조건에 맞는 고시·공고가 없어요');
      } else {
        const gov = S.grpTab === 'gov';
        const fresh = gov ? govNew : applyNew, cont = gov ? govOld : applyOld;
        if (!fresh.length && !cont.length) {
          note(gov ? '이 조건에 맞는 군정 소식이 없어요' : '이 조건으로 신청·참여할 수 있는 일은 없어요');
        } else {
          /* 두 묶음에 각자 한도를 준다 — 하나로 묶으면 새 소식이 한도를 다 먹어
             '전부터 이어지는 소식'이 아예 화면에 안 나온다 */
          const sect = (icon, text, list, key) => {
            if (!list.length) return;
            sub(icon, text, list.length);
            list.slice(0, S[key]).forEach(iss => box.appendChild(cardEl(iss)));
            if (list.length > S[key]) {
              const b = document.createElement('button'); b.className = 'morebtn';
              b.textContent = `${list.length - S[key]}건 더 보기`;
              b.onclick = () => { S[key] += 60; render(); };
              box.appendChild(b);
            }
          };
          sect('🆕', gov ? '새로 올라온 일' : '새로 올라온 소식', fresh, 'limit');
          sect('⏳', gov ? '전부터 이어지는 일' : '전에 올라왔지만 아직 신청할 수 있어요', cont, 'onLimit');
        }
      }
    } else if (!rows.length) {
      $('#bwGrpTabs')?.remove();
      box.innerHTML = '<div class="empty">해당하는 업무가 없습니다</div>'; $('#bwMore').innerHTML = '';
    } else if (CFG.splitAdmin) {
      /* ── 군민용: '내가 할 수 있는 일' 과 '군청이 하는 일' 을 갈라 놓는다 ──
         한 주 업무의 3분의 2 남짓은 회의·점검·정산 같은 내부 행정이라,
         섞어 두면 신청할 수 있는 일이 그 사이에 묻힌다.
         그렇다고 지우면 군정이 궁금한 분이 볼 곳이 없어지므로, 접어서 아래에 둔다. */
      const mine = [], gov = [];
      rows.forEach(iss => (CFG.splitAdmin(iss) ? mine : gov).push(iss));
      /* 두 구역 모두 있을 때만 제목을 단다 — 한쪽뿐이면 제목이 군더더기다 */
      const both = mine.length && gov.length;
      if (both) {
        const h = document.createElement('div'); h.className = 'grp-head mine';
        h.innerHTML = `<span class="gh-i">📝</span><span class="gh-t">신청·참여할 수 있는 일</span>
          <span class="gh-n">${mine.length}건</span>`;
        box.appendChild(h);
      }
      if (mine.length) {
        mine.slice(0, S.limit).forEach(iss => box.appendChild(cardEl(iss)));
        $('#bwMore').innerHTML = mine.length > S.limit
          ? `<button class="morebtn">${mine.length - S.limit}건 더 보기</button>` : '';
        const mb = $('#bwMore').querySelector('button');
        if (mb) mb.onclick = () => { S.limit += 120; render(); };
      } else {
        $('#bwMore').innerHTML = '';
        box.appendChild(Object.assign(document.createElement('div'),
          { className: 'empty', textContent: '이 조건으로 신청·참여할 수 있는 일은 없어요' }));
      }
      if (gov.length) {
        const sec = document.createElement('div'); sec.id = 'bwGov'; sec.className = 'govsec';
        const dv = document.createElement('button'); dv.type = 'button'; dv.className = 'grp-head gov';
        const list = document.createElement('div'); list.className = 'cards gov-body';
        const paint = () => {
          dv.innerHTML = `<span class="gh-i">🏛</span>
            <span class="gh-t">군청이 하는 일<em>참여하는 일은 아니에요</em></span>
            <span class="gh-n">${gov.length}건</span>
            <span class="gh-x">${S.govOpen ? '접기 ▴' : '펼쳐 보기 ▾'}</span>`;
          dv.setAttribute('aria-expanded', S.govOpen ? 'true' : 'false');
          sec.classList.toggle('open', !!S.govOpen);
          list.hidden = !S.govOpen;
          if (S.govOpen && !list.childElementCount)
            gov.slice(0, 200).forEach(iss => list.appendChild(cardEl(iss)));
        };
        dv.onclick = () => { S.govOpen = !S.govOpen; paint(); if (CFG.onGovToggle) CFG.onGovToggle(S.govOpen, gov.length); };
        paint();
        sec.appendChild(dv); sec.appendChild(list); box.appendChild(sec);
      }
    } else {
      rows.slice(0, S.limit).forEach(iss => box.appendChild(cardEl(iss)));
      $('#bwMore').innerHTML = rows.length > S.limit
        ? `<button class="morebtn">${rows.length - S.limit}건 더 보기</button>` : '';
      const mb = $('#bwMore').querySelector('button');
      if (mb) mb.onclick = () => { S.limit += 120; render(); };
    }
    /* ── 주간계획에는 안 실렸지만 아직 진행 중인 일 ──
       주간계획은 '그 주에 새로 적은 일'만 담기므로, 신청기간이 몇 달씩 이어지는
       사업(문화누리카드·에너지바우처 등)은 첫 주가 지나면 목록에서 사라진다.
       이름을 모르는 사람은 영영 못 찾게 되므로, 기간이 겹치면 이어서 계속 보여준다. */
    if (CFG.ongoingSection && !CFG.groupTabs) {   /* 갈래 탭 화면에서는 탭이 이 목록을 흡수한다 */
      /* 조건이 바뀌면 '더 보기'로 늘려 둔 개수를 처음으로 되돌린다 */
      const sig = JSON.stringify([S.scope, S.day, S.month, S.week, S.from, S.to, S.q,
        S.axis, S.custom, S.dept, S.status, S.type, S.annual]);
      if (sig !== onSig) { S.onLimit = 12; onSig = sig; }
      const extra = ongoingExtra(rows);
      if (extra.length) {
        /* 위 목록이 0건이면 '없습니다' 안내는 지운다 — 아래에 보여 줄 게 있으니 */
        if (!rows.length) box.innerHTML = '';
        const sec = document.createElement('div'); sec.id = 'bwOngoing';
        const dv = document.createElement('div'); dv.className = 'feed-divider';
        dv.textContent = `⏳ 지금도 신청·진행 중이에요 ${extra.length}건`;
        sec.appendChild(dv);
        const list = document.createElement('div'); list.className = 'cards';
        extra.slice(0, S.onLimit).forEach(iss => list.appendChild(cardEl(iss)));
        sec.appendChild(list);
        if (extra.length > S.onLimit) {
          const more = document.createElement('button'); more.className = 'morebtn';
          more.textContent = `${extra.length - S.onLimit}건 더 보기`;
          more.onclick = () => { S.onLimit += 60; render(); };
          sec.appendChild(more);
        }
        box.appendChild(sec);
      }
    }
    /* rows가 0건이어도 onRender는 늘 부른다 — 화면이 이 훅으로 다른 목록(예: 관련 소식)을
       이어 붙이는 경우, 여기서 건너뛰면 그 목록이 갱신되지 않고 멈춰 버린다. */
    if (CFG.onRender) CFG.onRender();
  }

  /* 압축 행 — 바쁜 사람이 훑기 위한 목록.
     제목 한 줄 + 요약 한 줄. 카드보다 절반 높이라 한 화면에 두 배가 들어온다. */
  function rowEl(iss) {
    const el = document.createElement('div'); el.className = 'lrow';
    const acts = CFG.cardActions ? CFG.cardActions(iss) : [];
    const sub = CFG.rowMeta ? CFG.rowMeta(iss) : '';
    el.innerHTML = `
      <span class="bar st-${iss._st}" title="${ST_LABEL[iss._st]}"></span>
      <div class="tx">
        <div class="t">${E(iss.title)}${iss._ann ? '<span class="mini-ann">매년</span>' : ''}</div>
        ${sub ? `<div class="s">${E(sub)}</div>` : ''}
      </div>
      ${acts.map((a, i) => `<button class="iconb sm ${a.active ? 'on' : ''}" data-a="${i}" title="${E(a.title || '')}">${a.icon}</button>`).join('')}`;
    el.querySelector('.tx').onclick = () => openSheet(iss);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = e => {
      e.stopPropagation(); acts[+b.dataset.a].on(iss); render();
      if (CFG.onQuickAct) CFG.onQuickAct(iss);
    });
    return el;
  }

  function cardEl(iss) {
    if (CFG.listStyle === 'rows') return rowEl(iss);
    const el = document.createElement('div'); el.className = 'card';
    const acts = CFG.cardActions ? CFG.cardActions(iss) : [];
    el.innerHTML = `
      <div class="top">
        <h3>${E(iss.title)}</h3>
        ${acts.length ? `<div class="acts">${acts.map((a, i) =>
      `<button class="iconb ${a.active ? 'on' : ''}" data-a="${i}" title="${E(a.title || '')}">${a.icon}</button>`).join('')}</div>` : ''}
      </div>
      <div class="tagrow">
        <button class="tag st st-${iss._st}" data-f="status" data-v="${iss._st}">${ST_LABEL[iss._st]}</button>
        ${CFG.hideDeptTag ? '' : `<button class="tag dept" data-f="dept" data-v="${E(iss.dept)}">${E(iss.dept)}</button>`}
        ${(() => { const t = tagOf(iss); return `<button class="tag type" data-f="${t.axis ? 'axis:' + t.axis : 'type'}" data-v="${E(t.v)}">${E(t.label)}</button>`; })()}
        ${iss._ann ? `<button class="tag annual" data-f="annual" data-v="1">매년 이맘때</button>` : ''}
      </div>
      ${cardMetaHtml(iss)}
      ${progHtml(iss)}`;
    el.querySelector('h3').onclick = () => openSheet(iss);
    el.querySelectorAll('.tag').forEach(b => b.onclick = () => {
      const f = b.dataset.f;
      if (f.startsWith('axis:')) pickAxis(f.slice(5), b.dataset.v);
      else setFilter(f, f === 'annual' ? true : b.dataset.v);
    });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = e => {
      e.stopPropagation(); acts[+b.dataset.a].on(iss); render();
    });
    return el;
  }

  /* 카드 아래 한 줄. 화면이 cardMeta 를 주면 그것을, 아니면 등장 기록을 쓴다. */
  function cardMetaHtml(iss) {
    if (CFG.cardMeta) { const t = CFG.cardMeta(iss); return t ? `<div class="meta">${E(t)}</div>` : ''; }
    if (CFG.showAppearance === false) return '';
    return `<div class="meta">${E(BW.persistenceSentence(iss, D.weekStart))}</div>`;
  }

  function progHtml(iss) {
    if (iss.prog == null) return '';
    if (CFG.progAsStage) return `<div class="prog">${E(BW.progStage(iss.prog))}</div>`;
    return `<div class="prog">공정률 ${iss.prog}% <span class="hint">(담당자 기재값)</span> ${BW.sparkline(iss.progSeries)}</div>`;
  }

  /* ───────── 상세 ───────── */
  function closeSheet() { $('#bwSheet').classList.remove('open'); if (CFG.onSheetClose) CFG.onSheetClose(); render(); }

  function openSheet(iss) {
    curIssue = iss; simExpanded = false;
    $('#bwShTitle').textContent = iss.title;
    const body = $('#bwShBody'); body.innerHTML = '';

    /* 제목 옆 동작 버튼 (즐겨찾기 등) — 본문에 같은 체크박스를 또 두지 않는다.
       누르면 버튼 모양만 바꾼다. 시트를 다시 그리면 읽던 자리를 잃는다. */
    const sa = $('#bwShActs');
    const paintActs = () => {
      const acts = CFG.sheetActions ? CFG.sheetActions(iss) : [];
      sa.innerHTML = acts.map((a, i) =>
        `<button class="iconb ${a.active ? 'on' : ''}" data-sa="${i}" title="${E(a.title || '')}">${a.icon}</button>`).join('');
      sa.querySelectorAll('[data-sa]').forEach(b => b.onclick = () => {
        acts[+b.dataset.sa].on(iss);
        paintActs();
      });
    };
    paintActs();

    /* 맨 위 — 화면이 detailTop 을 주면 그것을 쓰고, 아니면 기본 메타를 쓴다.
       같은 사실을 두 번 적지 않으려면 둘 중 하나만 있어야 한다. */
    if (CFG.detailTop) CFG.detailTop(iss, body, api);
    else {
      const r = iss._range;
      const period = r ? `${r.start || '시작 미상'} ~ ${r.end || (r.openEnded ? '계속' : '종료 미상')}` : '기간이 적혀 있지 않음';
      body.insertAdjacentHTML('beforeend', `
        <div class="blk">
          <div class="tagrow" style="margin-bottom:8px">
            <span class="tag st st-${iss._st}" style="cursor:default">${ST_LABEL[iss._st]}</span>
            <span class="tag dept" style="cursor:default">${E(iss.dept)}</span>
            <span class="tag type" style="cursor:default">${E(typeLabel(iss.type))}</span>
          </div>
          <div class="hint">계획서에 적힌 기간: ${E(period)}</div>
        </div>`);
    }

    /* 매년 이맘때 — 작년 행정 참고 (§검토 3) */
    if (iss._ann) {
      const ly = iss._ann.lastYear;
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><h3>매년 이맘때</h3>
          <div class="annualbox">
            <b>해마다 이 시기에 하는 일입니다.</b> ${E(iss._ann.years.join('년, '))}년에 올라왔습니다.<br>
            작년에는 <b>${E(BW.fmtWeekKo(ly.week))}</b>에 「${E(ly.item.title)}」로 올라왔습니다.
            <span class="lnk" id="bwAnnLnk">작년 그때 원문 보기</span>
          </div>
          <div id="bwAnnBody"></div>
        </div>`);
      $('#bwAnnLnk').onclick = () => {
        const t = $('#bwAnnBody');
        if (t.innerHTML) { t.innerHTML = ''; return; }
        t.innerHTML = `<div class="occ" style="margin-top:8px"><div class="w">${ly.week} 주차 · ${E(ly.dept)}</div>
          ${ly.item.lines.map(l => `<p class="${l.lv > 1 ? 'l2' : ''}">${E(l.txt)}</p>`).join('')}</div>`;
      };
    }

    /* 내용 — 가장 최근 등장분.
       화면이 contentLines 를 주면 위에서 이미 보여준 줄을 빼고 남은 것만 싣는다. */
    /* 어느 주차의 기재분을 대표로 볼지 화면이 정할 수 있다.
       (작년 이맘때 화면은 그때 실린 내용을 보여줘야 한다) */
    const last = CFG.pickOcc ? CFG.pickOcc(iss) : iss.list[iss.list.length - 1];
    const lines = CFG.contentLines ? CFG.contentLines(iss, last.item.lines) : last.item.lines;
    if (lines && lines.length) {
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><h3>${E(CFG.contentTitle || ('내용 · ' + last.week + ' 주차 기재'))}</h3>
          ${lines.map(l => `<p class="${l.lv > 1 ? 'l2' : ''}">${E(l.txt)}</p>`).join('')}</div>`);
    } else if (!CFG.contentLines) {
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><h3>내용 · ${last.week} 주차 기재</h3><p class="l2">본문 없음</p></div>`);
    }
    /* 화면이 내용 바로 뒤에 끼워 넣을 것이 있으면 여기서 (군수용 지시 칸) */
    if (CFG.afterContent) CFG.afterContent(iss, body, api);

    /* 위에서 걸러낸 줄이 있으면 원문 전체를 접어서 남겨 둔다 */
    if (CFG.contentLines && last.item.lines.length > (lines ? lines.length : 0)) {
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><button class="simtoggle" id="bwRawT">계획서 원문 그대로 보기</button>
          <div id="bwRawB" style="margin-top:8px"></div></div>`);
      $('#bwRawT').onclick = () => {
        const t = $('#bwRawB');
        if (t.innerHTML) { t.innerHTML = ''; $('#bwRawT').textContent = '계획서 원문 그대로 보기'; return; }
        t.innerHTML = `<div class="occ"><div class="w">${last.week} 주차 · ${E(last.dept)}</div>
          ${last.item.lines.map(l => `<p class="${l.lv > 1 ? 'l2' : ''}">${E(l.txt)}</p>`).join('')}</div>`;
        $('#bwRawT').textContent = '접기';
      };
    }

    /* 회차별 진행 (§검토 4) */
    const rv = BW.roundsView(iss);
    if (rv) {
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><h3>회차별 진행 · 모두 ${rv.count}번</h3>
          ${rv.fixed.length ? `<div class="fixedlist">${rv.fixed.map(f =>
        `<p><span class="hint">${E(f.label)}</span> ${E(f.val)}</p>`).join('')}
            <div class="hint">위 항목은 회차마다 같습니다. 아래는 회차별로 달라진 부분입니다.</div></div>` : ''}
          <div class="rounds">
            <div class="rh"><span style="width:76px;flex:none">주차</span><span>${rv.varying.map(E).join(' · ')}</span></div>
            ${rv.rows.map(row => `<div class="rr">
              <span class="w">${row.week.slice(2)}</span>
              <span class="v">${row.raw ? E(row.raw)
          : rv.varying.map(k => row.cells[k]
            ? `<span><span class="lab">${E(k)}</span> ${E(row.cells[k])}</span>` : '').join('')}</span>
            </div>`).join('')}
          </div></div>`);
    }

    /* 추이 — 공정률(기재값)과 등장 기록(추정)을 구분해서 (§4.4).
       군민용은 등장 기록을 내보내지 않는다 (§8.2: 맥락 없는 내부 지표) */
    const showApp = CFG.showAppearance !== false;
    if (CFG.showTrend !== false && (iss.prog != null || showApp)) {
      body.insertAdjacentHTML('beforeend', `
        <div class="blk trend"><h3>추이</h3>
          ${iss.prog != null ? (CFG.progAsStage
          ? `<div class="progline">${E(BW.progStage(iss.prog))}</div>`
          : `<div class="progline">공정률 ${iss.prog}% <span class="hint">(담당자가 적은 값)</span> ${BW.sparkline(iss.progSeries)}</div>`) : ''}
          ${showApp ? `<div class="appear"><em>문서 등장 기록</em> · ${E(BW.persistenceSentence(iss, D.weekStart))}
            <div class="hint" style="margin-top:4px">계획 문서에 몇 번 올라왔는지일 뿐, 실제 진척도가 아닙니다.</div></div>` : ''}
        </div>`);
    }

    /* 유사업무 (§검토 6·7) — 직원·군수용. 군민용에는 내부 참고 성격이라 두지 않는다. */
    if (CFG.showSimilar !== false) {
      body.insertAdjacentHTML('beforeend', `<div class="blk" id="bwSim"><h3>비슷한 일을 한 다른 과</h3><div id="bwSimBody"></div></div>`);
      renderSimilar(iss);
    }

    /* 발생 이력 */
    if (CFG.showHistory !== false && iss.list.length > 1) {
      const hTitle = CFG.historyTitle ? CFG.historyTitle(iss) : '발생 이력 · 주차별 원문';
      const hOpen = CFG.historyBtn ? CFG.historyBtn(iss) : `${iss.list.length}개 주차 원문 펼치기`;
      body.insertAdjacentHTML('beforeend', `
        <div class="blk"><h3>${E(hTitle)}</h3>
          <button class="simtoggle" id="bwOccT">${E(hOpen)}</button>
          <div id="bwOccB" style="margin-top:8px"></div></div>`);
      $('#bwOccT').onclick = () => {
        const t = $('#bwOccB');
        if (t.innerHTML) { t.innerHTML = ''; $('#bwOccT').textContent = hOpen; return; }
        t.innerHTML = iss.list.slice().reverse().map(o => `<div class="occ">
          <div class="w">${o.week} 주차 · ${E(o.item.title)}</div>
          ${o.item.lines.map(l => `<p class="${l.lv > 1 ? 'l2' : ''}">${E(l.txt)}</p>`).join('')}</div>`).join('');
        $('#bwOccT').textContent = '접기';
      };
    }

    /* 역할별 블록 */
    if (CFG.detailBlocks) CFG.detailBlocks(iss, body, api);
    const foot = $('#bwShFoot');
    if (CFG.detailFooter) { const h = CFG.detailFooter(iss, api); foot.style.display = h ? '' : 'none'; foot.innerHTML = h || ''; if (CFG.onFooterMount) CFG.onFooterMount(iss, foot, api); }
    else foot.style.display = 'none';

    $('#bwSheet').classList.add('open');
    $('#bwShBody').scrollTop = 0;
  }

  /* 유사업무를 '왜 묶였는지'로 나눠 보여준다 */
  function renderSimilar(iss) {
    const all = BW.findSimilar(iss, ISSUES, IDF, { windowWeeks: 8 });
    const G = [
      { k: 'same', h: '같은 현안을 함께 하는 과', w: '업무명이 같은 계열입니다. 협의 상대일 가능성이 높습니다.' },
      { k: 'annual', h: '작년 이맘때 같은 일을 한 과', w: '작년 이 시기에 같은 성격의 일을 했습니다.' },
      { k: 'recent', h: '요즘 비슷한 일을 하는 과', w: '최근 8주 안에 올라왔고, 업무명에서 특징적인 말이 겹칩니다.' },
      { k: 'past', h: '예전 사례', w: '근거는 같지만 시기가 떨어져 있습니다. 지금 상황과 다를 수 있습니다.' }
    ];
    const box = $('#bwSimBody'); box.innerHTML = '';
    const shown = G.filter(g => g.k !== 'past' || simExpanded);
    let n = 0;
    shown.forEach(g => {
      const rows = all.filter(x => x.kind === g.k);
      if (!rows.length) return;
      n += rows.length;
      const wrap = document.createElement('div'); wrap.className = 'simgroup';
      wrap.innerHTML = `<p class="gh">${g.h} (${rows.length})</p><p class="gw">${g.w}</p>` +
        rows.slice(0, 8).map((x, i) => `
          <div class="sim" data-i="${i}" data-k="${g.k}">
            <div class="t">${E(x.iss.title)}</div>
            <div class="m">${E(x.iss.dept)} · ${E(typeLabel(x.iss.type))} · 마지막 ${x.iss.last}${CFG.showContact ? ' · ' + CFG.showContact(x.iss.dept) : ''}</div>
            ${x.shared && x.shared.length ? `<div class="words"><span class="lb">겹치는 말</span>${x.shared.map(w =>
          `<span class="word ${x.keyWords && x.keyWords.includes(w) ? 'key' : ''}">${E(w)}</span>`).join('')}</div>` : ''}
          </div>`).join('');
      wrap.querySelectorAll('.sim').forEach(el => el.onclick = ev => {
        if (ev.target.tagName === 'A') return;
        openSheet(all.filter(x => x.kind === el.dataset.k)[+el.dataset.i].iss);
      });
      box.appendChild(wrap);
    });
    const pastN = all.filter(x => x.kind === 'past').length;
    if (!n && !pastN) box.innerHTML = '<div class="hint">비슷한 일을 한 다른 과를 찾지 못했습니다. 이 과에서만 하는 업무로 보입니다.</div>';
    if (pastN) {
      const b = document.createElement('button'); b.className = 'simtoggle';
      b.textContent = simExpanded ? '예전 사례 접기' : `예전 사례 ${pastN}건 더 보기 (시기가 떨어진 건)`;
      b.onclick = () => { simExpanded = !simExpanded; renderSimilar(iss); };
      box.appendChild(b);
    }
  }

  /* ───────── 역할 화면이 쓰는 공개 API ───────── */
  const api = {
    get issues() { return ISSUES }, get data() { return D }, get today() { return TODAY },
    openSheet, closeSheet, render, toast, setFilter,
    setCustom(name) { S.custom = S.custom === name ? '' : name; S.limit = 60; render(); },
    get state() { return S },
    get groupCounts() { return GRP_COUNTS },
    ST_LABEL, typeLabel, E
  };
  global.BWUI = { start, toast, api };
})(window);
