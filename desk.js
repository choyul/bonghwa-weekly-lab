/* ═══════════════════════════════════════════════════════════════
   desk.js — 주간업무 접수 처리 화면(apply-desk.html)의 속내용.

   여기서 하려는 것은 두 가지다.
   ① 담당자가 주간업무를 하면서 접수를 실제로 끝낼 수 있게 한다
      (보고, 확인, 선정·제외, 내부 시스템으로 넘기기까지 한 자리에서).
   ② 같은 접수함을 두 판으로 처리해 보이고, 그 차이를 숫자로 남긴다.
      🔗 연동판 — 경영체 정보가 붙어 있어 다섯 가지 대조 중 넷이 이미 끝나 있다.
      ✋ 수기판 — 붙어 있지 않아 담당자가 다섯 가지를 손으로 한다.

   숫자를 지어내지 않는다. 아래 CHECKS 표의 '항목별 예상 분'을 더한 값만 쓴다.
   무엇을 더했는지 화면에도 적어 둔다.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const E = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ITEMS = (window.BW_SUBSIDY && BW_SUBSIDY.items) || [];
  const byId = {}; ITEMS.forEach(i => { byId[i.id] = i; });
  const CODE = 'bonghwa', GKEY = 'bhlab.desk.in', WKEY = 'bhlab.desk.who';
  const TODAY = new Date().toISOString().slice(0, 10);

  let ROWS = [], MODE = 'api', SID = null, WHO = '', SRV = 'local', BUSY = false;

  /* ── 한 건을 처리하려면 무엇을 대조해야 하는가 ──
     'auto' 가 붙은 것은 연동 정보가 있으면 그 자리에서 끝난다.
     'dup'(중복·기수혜)만은 어느 분야든 연동해도 남는다 — 우리 부서 지난 대장은
     제공 기관이 모른다. min 은 한 건당 예상 분. 시간 계산은 이 표만 더한 값이다.

     분야가 다르면 대조할 것도 다르다 — 농업은 경영체, 복지는 수급 자격.
     구조는 같아서 표만 갈아 끼우면 된다. 이것이 '다른 분야로도 늘어난다'의 실체다. */
  const CHECKSETS = {
    agrix: [
      { k: 'reg',  min: 2, auto: true,  t: '농업경영체 등록 대장 조회',
        d: '농관원 시스템에 따로 들어가 등록번호로 찾는다' },
      { k: 'stat', min: 1, auto: true,  t: '등록 상태·기준일 확인',
        d: '휴업·폐업이면 대상이 아니다' },
      { k: 'addr', min: 1, auto: true,  t: '주소지 관내 여부 확인',
        d: '적어 낸 주소와 경영체 소재지를 함께 본다' },
      { k: 'area', min: 1, auto: true,  t: '경작 면적 확인',
        d: '신청 수량을 깎을 근거가 된다' },
      { k: 'dup',  min: 1, auto: false, t: '중복·기수혜 여부 확인',
        d: '우리 부서 지난 대장을 연다 — 연동해도 이것만은 남는다' },
    ],
    welfare: [
      { k: 'reg',  min: 2, auto: true,  t: '수급 자격 전산 조회',
        d: '사회보장 전산을 따로 열어 자격을 찾는다' },
      { k: 'stat', min: 1, auto: true,  t: '자격 구분·기준일 확인',
        d: '수급·차상위·장애·한부모 — 서류마다 발급처가 다르다' },
      { k: 'addr', min: 1, auto: true,  t: '주소지 관내 여부 확인',
        d: '주민등록 주소를 함께 본다' },
      { k: 'dup',  min: 1, auto: false, t: '중복·기수혜 여부 확인',
        d: '우리 부서 지난 대장을 연다 — 연동해도 이것만은 남는다' },
    ],
  };
  const CHECKS = CHECKSETS.agrix;               /* 나란히 비교 화면의 본보기로 쓴다 */
  const manualMin = set => set.reduce((a, c) => a + c.min, 0);
  const apiMin = set => set.filter(c => !c.auto).reduce((a, c) => a + c.min, 0);
  const MIN_MANUAL = manualMin(CHECKS);
  const MIN_API = apiMin(CHECKS);
  /* 이 건은 어느 분야인가 — 접수에 남은 표시가 먼저, 없으면 사업의 자격 항목으로 */
  function provOf(r) {
    const v = r.verify; if (v && v.by === 'welfare') return 'welfare'; if (v && v.by === 'agrix') return 'agrix';
    const t = r._truth; if (t && t.kind === 'welfare') return 'welfare'; if (t) return 'agrix';
    const F = (cfgOf(r.sid).fields || []);
    if (window.SUBCFG && F.some(f => SUBCFG.FIELDS[f.k] && SUBCFG.FIELDS[f.k].welfare)) return 'welfare';
    return 'agrix';
  }
  const checksOf = r => CHECKSETS[provOf(r)];
  const hhmm = m => m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + '분' : ''}`.trim() : `${m}분`;

  /* ═══ 시연 표본 ═══
     테스트 서버에 접수가 몇 건 없을 수 있다. 발표 자리에서 빈 화면을 볼 수는 없으므로
     표본을 이 기기에서 만들어 섞는다. 표본에는 보라색 '표본' 딱지를 붙인다.

     표본이 지어낸 것은 사람 이름뿐이고, 나머지는 실제 사업 자료에서 가져온다.
     _truth 는 '경영체 대장에 적힌 사실', data 는 '주민이 적어 낸 말'이다.
     둘이 어긋나는 사람을 일부러 섞어 두었다 — 수기판에서는 그 어긋남이
     담당자가 대장을 열기 전까지 보이지 않는다. 그것이 이 화면의 핵심이다. */
  const DKEY = 'bhlab.desk.demo';
  const PEOPLE = [
    { n: '김순분', p: '010-2431-88**', reg: '3145-2016-000241', st: '정상', ar: 1.42, rg: '봉화군', say: 1.4 },
    { n: '박대식', p: '010-9902-41**', reg: '3145-2018-003318', st: '정상', ar: 0.38, rg: '봉화군', say: 0.9 },
    { n: '정말순', p: '010-3387-70**', reg: '3145-2015-001902', st: '정상', ar: 2.10, rg: '봉화군', say: 2.1 },
    { n: '이영달', p: '010-4410-25**', reg: '3145-2021-000812', st: '휴업', ar: 0.75, rg: '봉화군', say: 0.8, sayFarm: 'yes' },
    { n: '최복동', p: '010-2277-63**', reg: '3145-2019-004417', st: '정상', ar: 0.62, rg: '봉화군', say: 0.6 },
    { n: '권오남', p: '010-5518-09**', reg: '3145-2020-002255', st: '정상', ar: 3.05, rg: '봉화군', say: 3.0 },
    { n: '홍말자', p: '010-8823-14**', reg: '3145-2017-000733', st: '정상', ar: 0.21, rg: '봉화군', say: 0.5 },
    { n: '조기범', p: '010-3140-77**', reg: '3145-2022-001064', st: '정상', ar: 1.08, rg: '안동시', say: 1.1 },
    { n: '남상우', p: '010-6672-30**', reg: '3145-2016-002480', st: '정상', ar: 0.94, rg: '봉화군', say: 0.9 },
    { n: '유정임', p: '010-2098-55**', reg: '',                 st: '미등록', ar: 0,   rg: '봉화군', say: 1.2, sayFarm: 'yes' },
    { n: '배동철', p: '010-7731-42**', reg: '3145-2023-000159', st: '정상', ar: 1.76, rg: '봉화군', say: 1.8 },
    { n: '서금순', p: '010-4406-91**', reg: '3145-2014-003027', st: '정상', ar: 0.45, rg: '봉화군', say: 0.4 },
  ];
  /* 복지 표본 — 자격을 지어낸 사람들. claim 은 '본인이 적어 낸 것', truth 는 '전산에 있는 것'.
     둘이 어긋나는 사람을 넷 중 셋 꼴로 두지 않는다 — 대부분은 맞고, 몇이 어긋난다. */
  const WPEOPLE = [
    { n: '박순애', p: '010-4321-55**', claim: '기초생활수급', quals: ['기초생활수급(생계·의료)'] },
    { n: '정막딸', p: '010-8810-27**', claim: '기초생활수급', quals: ['차상위계층'] },
    { n: '서말녀', p: '010-2245-90**', claim: '차상위계층', quals: ['차상위계층'] },
    { n: '황차돌', p: '010-9034-18**', claim: '차상위계층', quals: [] },
    { n: '전병출', p: '010-5512-73**', claim: '기초생활수급', quals: ['기초생활수급(생계)'] },
    { n: '윤복례', p: '010-3308-44**', claim: '기초생활수급', quals: ['기초생활수급(주거)'], rg: '영주시' },
    { n: '노분이', p: '010-7726-51**', claim: '차상위계층', quals: ['차상위계층'] },
    { n: '구만복', p: '010-1187-62**', claim: '기초생활수급', quals: ['기초생활수급(의료)'] },
  ];
  /* 표본을 얹을 사업 — 농업경영체가 걸린 사업 둘 + 복지 사업 하나 */
  function demoTargets() {
    const farmy = ITEMS.filter(i => i.conditions &&
      (i.conditions.needsFarmRegistry || i.conditions.farmAreaMin != null || i.conditions.needsFarming));
    const byWeek = a => a.slice().sort((x, y) => (y.week < x.week ? -1 : 1));
    const pick = byWeek(farmy.length ? farmy : ITEMS).slice(0, 2);
    const wf = byWeek(ITEMS.filter(i =>
      /수급|차상위|장애|한부모|저소득|취약계층|어르신|경로|노인돌봄|복지/.test((i.title || '') + ' ' + (i.dept || ''))
      && !pick.includes(i)))[0];
    return wf ? pick.concat([wf]) : pick;
  }
  function demoRows() {
    try { const c = JSON.parse(localStorage.getItem(DKEY)); if (c && c.length) return c; } catch (e) { }
    return [];
  }
  function makeDemo() {
    const tg = demoTargets(); if (!tg.length) return [];
    const out = [];
    const TOWN = ['봉화읍', '물야면', '봉성면', '법전면', '춘양면', '소천면', '재산면'];
    tg.forEach((it, ti) => {
      const welfare = ti === 2;                     /* 셋째 사업은 복지 표본 */
      const take = welfare ? WPEOPLE : (ti === 0 ? PEOPLE : PEOPLE.slice(0, 7));
      take.forEach((p, i) => {
        const d = new Date(Date.now() - (ti * 3 + i) * 7.7e7).toISOString().slice(0, 19).replace('T', ' ');
        const row = {
          no: `B-표본-${ti + 1}${String(i + 1).padStart(2, '0')}`,
          sid: it.id, title: it.title, dept: it.dept, at: d,
          state: '접수', note: '', by: '', checks: {}, _demo: true,
        };
        if (welfare) {
          /* 주민이 적어 낸 말(claim)과 전산(truth) — 몇 건은 어긋난다 */
          row.data = { name: p.n, phone: p.p, addr: '봉화군 ' + TOWN[i % 7], claim: p.claim };
          row._truth = { kind: 'welfare', quals: p.quals, statusAt: '2026-08-25',
                         region: p.rg || '봉화군', addr: `경상북도 ${p.rg || '봉화군'} ` };
        } else {
          row.data = { name: p.n, phone: p.p, addr: '봉화군 ' + TOWN[i % 7],
                       farmNo: p.reg || '', farmArea: String(p.say) };
          row._truth = { no: p.reg, status: p.st, statusAt: '2026-08-20', area: p.ar, region: p.rg,
                         addr: `경상북도 ${p.rg} ` };
        }
        out.push(row);
      });
    });
    try { localStorage.setItem(DKEY, JSON.stringify(out)); } catch (e) { }
    return out;
  }
  function clearDemo() { try { localStorage.removeItem(DKEY); } catch (e) { } }

  /* ═══ 들어가기 ═══ */
  function enter() {
    const c = $('#code').value.trim();
    if (c !== CODE) { alert('코드가 다릅니다'); return; }
    try { sessionStorage.setItem(GKEY, '1'); } catch (e) { }
    LABAPI.setCode(c); show();
  }
  $('#go').onclick = enter;
  $('#code').onkeydown = e => { if (e.key === 'Enter') enter(); };
  try { if (sessionStorage.getItem(GKEY) === '1') show(); } catch (e) { }

  async function show() {
    $('#gate').style.display = 'none'; $('#app').style.display = '';
    try { WHO = localStorage.getItem(WKEY) || ''; } catch (e) { }
    if (window.LABMODE) MODE = LABMODE.get();
    $('#main').innerHTML = '<div class="card">불러오는 중…</div>';
    const cfgr = await LABAPI.pullCfg(); SUBCFG.setAll(cfgr.cfg); SRV = cfgr.from;
    await reload();
    wireTabs();
  }

  async function reload() {
    const server = await LABAPI.applyList();
    const demo = demoRows();
    /* 서버 것이 앞, 표본이 뒤. 접수번호가 겹치면 서버 것을 남긴다 */
    const seen = new Set(server.map(r => r.no));
    ROWS = server.concat(demo.filter(r => !seen.has(r.no)));
    /* 표본의 처리 상태는 이 기기에 남겨 둔 것을 덮어씌운다 */
    let st = {}; try { st = JSON.parse(localStorage.getItem(LABAPI.SKEY)) || {}; } catch (e) { }
    ROWS.forEach(r => { const s = st[r.no]; if (s && r._demo) Object.assign(r, s); });
    render();
  }

  function wireTabs() {
    $('#modeTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
      MODE = b.dataset.m;
      if (window.LABMODE && MODE !== 'both') LABMODE.set(MODE);
      render();
    });
  }

  /* ═══ 한 건을 어느 눈으로 볼 것인가 ═══
     연동판으로 보되, 그 건에 경영체 정보가 없으면(수기로 들어온 건) 수기판으로 본다. */
  function truthOf(r) {
    return r._truth || (r.verify && (r.verify.by === 'agrix' || r.verify.by === 'welfare') && r.verify)
      || r.agrix || null;
  }
  function viewOf(r) { return (MODE === 'api' && truthOf(r)) ? 'api' : 'manual'; }
  function cfgOf(sid) { const it = byId[sid]; return it ? SUBCFG.forItem(it) : { fields: [], ask: [], online: false }; }

  /* 연동 정보로 자격을 판정한다 — 담당자가 눈으로 훑을 수 있게 근거를 함께 낸다 */
  function judge(r) {
    const t = truthOf(r); if (!t) return { r: 'self' };
    if (provOf(r) === 'welfare') return judgeWelfare(r, t);
    const cfg = cfgOf(r.sid), F = cfg.fields || [];
    const fails = [], oks = [], warns = [];
    if (t.status !== '정상') fails.push(`경영체 ${t.status}`);
    else oks.push(`경영체 정상 (${t.statusAt || '기준일 미상'})`);
    const fa = F.find(f => f.k === 'farmArea');
    if (fa && fa.min != null) {
      if (+t.area < +fa.min) fails.push(`경작 면적 ${t.area}ha (${fa.min}ha 이상)`);
      else oks.push(`경작 면적 ${t.area}ha`);
    } else if (t.area != null) oks.push(`경작 면적 ${t.area}ha`);
    /* 관내 여부 — 조건에 안 적혀 있더라도 군 사업이니 관외는 그냥 넘기지 않는다.
       조건에 적혀 있으면 탈락, 안 적혀 있으면 '확인해 보라'고만 한다.
       계획서에서 못 읽은 조건까지 담당자 대신 판단하지는 않는다. */
    const rs = F.find(f => f.k === 'residency');
    const want = (rs && rs.v) || '봉화군';
    /* '경상북도에 주소' 같은 상위 지역 조건은 주소 전문으로 대조한다 —
       확인 요약에 주소가 없으면(옛 접수) 붙어 있는 원본에서라도 찾는다 */
    const taddr = String(t.addr || (r.agrix && r.agrix.addr) || '');
    const inside = !t.region || t.region === want || taddr.includes(want);
    if (inside) { if (t.region) oks.push(`소재지 ${t.region}`); }
    else if (rs) fails.push(`소재지 ${t.region} (${want} 아님)`);
    else warns.push(`소재지가 ${t.region}입니다 — 이 사업 조건에 관내 요건이 적혀 있지 않아 자동으로 떨어뜨리지 않았습니다. 담당자가 보셔야 합니다`);
    /* 적어 낸 값과 대장이 다르면, 대장 값으로 바로잡았다는 사실을 남긴다.
       상태·소재지는 이미 위에서 말했으니 여기서 또 말하지 않는다. */
    const g = (gap(r) || []).filter(x => /^(면적|등록번호)/.test(x));
    return { r: fails.length ? 'no' : 'ok', fails, oks, warns, fixed: g };
  }

  /* 복지 사업의 자격 판정 — 경영체 대신 수급 자격을 본다.
     사업이 수급·차상위를 여럿 걸어 두었으면 '그중 하나면 된다'로 본다(대개 그렇다).
     사업 조건에 자격 항목이 안 적혀 있으면 판정하지 않고 전산 내용만 보여 준다. */
  function judgeWelfare(r, t) {
    const cfg = cfgOf(r.sid), F = cfg.fields || [];
    const fails = [], oks = [], warns = [];
    const quals = t.quals || [];
    const at = t.statusAt || '기준일 미상';
    const NEED = { basicBnf: '기초생활수급', nearPoor: '차상위' };
    const wanted = F.filter(f => window.SUBCFG && SUBCFG.FIELDS[f.k] && SUBCFG.FIELDS[f.k].welfare);
    const qualF = wanted.filter(f => NEED[f.k]);
    if (qualF.length) {
      const hit = qualF.some(f => quals.some(q => q.includes(NEED[f.k])));
      hit ? oks.push(`자격 확인: ${quals.join(', ')} (${at})`)
          : fails.push(`요구 자격(${qualF.map(f => NEED[f.k]).join('·')}) 없음 — 전산 기준 ${at}`);
    }
    wanted.filter(f => f.k === 'disab').forEach(() =>
      t.disab ? oks.push('장애인 등록 확인') : fails.push('장애인 등록 없음'));
    wanted.filter(f => f.k === 'singleP').forEach(() =>
      t.singleP ? oks.push('한부모가족 확인') : fails.push('한부모가족 등록 없음'));
    if (!wanted.length) {
      quals.length ? oks.push(`전산 자격: ${quals.join(', ')} (${at})`)
        : warns.push('전산에 수급 자격이 없습니다 — 이 사업 조건에 자격 요건이 적혀 있지 않아 자동으로 떨어뜨리지 않았습니다. 담당자가 보셔야 합니다');
    }
    const rs = F.find(f => f.k === 'residency');
    const want = (rs && rs.v) || '봉화군';
    const taddr = String(t.addr || ((r.data || {}).addr) || '');
    const inside = !t.region || t.region === want || taddr.includes(want);
    if (inside) { if (t.region) oks.push(`소재지 ${t.region}`); }
    else if (rs) fails.push(`소재지 ${t.region} (${want} 아님)`);
    else warns.push(`소재지가 ${t.region}입니다 — 조건에 관내 요건이 적혀 있지 않아 자동으로 떨어뜨리지 않았습니다. 담당자가 보셔야 합니다`);
    const g = (gap(r) || []).filter(x => /^자격/.test(x));
    return { r: fails.length ? 'no' : 'ok', fails, oks, warns, fixed: g };
  }
  /* 주민이 적어 낸 말과 대장이 어긋나는가 — 수기판에서 대장을 열어야 비로소 보인다 */
  function gap(r) {
    const t = r._truth; if (!t) return null;
    const said = r.data || {}, out = [];
    if (t.kind === 'welfare') {
      const quals = t.quals || [];
      if (said.claim && !quals.some(q => q.includes(said.claim)))
        out.push(`자격 — 적어 낸 것 '${said.claim}' / 전산에는 ${quals.length ? quals.join(', ') : '자격 없음'}`);
      if (t.region && t.region !== '봉화군') out.push(`소재지 — 전산에는 ${t.region}`);
      return out.length ? out : null;
    }
    if (said.farmArea != null && said.farmArea !== '' && Math.abs(+said.farmArea - +t.area) > 0.05)
      out.push(`면적 — 적어 낸 값 ${said.farmArea}ha / 대장 ${t.area}ha`);
    if (t.status !== '정상') out.push(`상태 — 대장에는 ${t.status}`);
    if (!t.no) out.push('등록번호 — 대장에 없음(미등록)');
    if (t.region !== '봉화군') out.push(`소재지 — 대장에는 ${t.region}`);
    return out.length ? out : null;
  }

  /* 그 건에 남은 손일 — 아직 누르지 않은 대조 항목 */
  function todo(r) {
    const v = viewOf(r), c = r.checks || {};
    return checksOf(r).filter(k => (v === 'api' && k.auto) ? false : !c[k.k]);
  }
  const minsOf = r => todo(r).reduce((a, c) => a + c.min, 0);
  const DONE = s => s === '선정' || s === '제외';

  /* ═══ 그리기 ═══ */
  function render() {
    /* 다시 그리면 화면이 맨 위로 튀어 오른다 — 열두 건짜리 목록에서 여덟 번째 칸을
       누른 담당자는 자기가 어디 있었는지 잃는다. 있던 자리를 그대로 둔다. */
    const keep = window.scrollY;
    $('#modeTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === MODE));
    $('#modeWhy').innerHTML = MODE === 'both'
      ? '같은 접수 <b>한 건</b>을 두 판으로 처리하면 무엇이 달라지는지 아래에 나란히 뒀습니다.'
      : (MODE === 'api'
        ? '🔗 <b>경영체 정보가 붙어 있는 판.</b> 다섯 가지 대조 중 넷이 접수되는 순간 이미 끝나 있습니다.'
        : '✋ <b>지금 그대로의 판.</b> 주민이 적어 낸 말만 들어옵니다. 다섯 가지를 담당자가 손으로 대조합니다.');
    $('#main').innerHTML = MODE === 'both' ? viewCompare() : (SID ? viewRows() : viewList());
    MODE === 'both' ? wireCompare() : (SID ? wireRows() : wireList());
    if (keep) window.scrollTo(0, keep);
  }

  /* ── 사업 목록 + 이번 주 요약 ── */
  function bizes() {
    const m = {};
    ROWS.forEach(r => {
      const b = m[r.sid] || (m[r.sid] = { sid: r.sid, title: r.title, dept: r.dept, rows: [], demo: false });
      b.rows.push(r); if (r._demo) b.demo = true;
    });
    return Object.values(m).sort((a, b) => b.rows.length - a.rows.length);
  }
  function endOf(sid) {
    const it = byId[sid]; if (!it) return null;
    const c = SUBCFG.forItem(it);
    return c.applyEnd || (it.conditions && it.conditions.applyEnd) || null;
  }
  const dday = e => Math.round((new Date(e + 'T00:00:00') - new Date(TODAY + 'T00:00:00')) / 864e5);

  function viewList() {
    const B = bizes();
    const all = ROWS, waiting = all.filter(r => !DONE(r.state));
    const mins = waiting.reduce((a, r) => a + minsOf(r), 0);
    const otherMins = waiting.reduce((a, r) =>
      a + (MODE === 'api' ? manualMin(checksOf(r)) : apiMin(checksOf(r))), 0);
    const soon = B.filter(b => { const e = endOf(b.sid); return e && dday(e) >= 0 && dday(e) <= 7; });

    const cards = B.map(b => {
      const e = endOf(b.sid), d = e ? dday(e) : null;
      const done = b.rows.filter(r => DONE(r.state)).length;
      const pct = b.rows.length ? Math.round(done / b.rows.length * 100) : 0;
      const api = b.rows.filter(r => truthOf(r)).length;
      return `<div class="biz" data-sid="${E(b.sid)}">
        <div class="t"><b>${E(b.title)}</b>
          <small>${E(b.dept || '부서 미상')}${e ? ' · 마감 ' + E(e) : ''}</small>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
        <div class="n"><b>${b.rows.length}건</b>
          ${done ? `<span class="pill done">처리 ${done}</span>` : `<span>미처리 ${b.rows.length - done}</span>`}
          ${b.demo ? '<span class="pill demo">표본</span>' : ''}
          ${d != null && d >= 0 && d <= 7 ? `<span class="pill dday">D-${d}</span>` : ''}
          ${MODE === 'api' ? `<span class="pill api">🔗 ${api}</span>` : ''}</div>
      </div>`;
    }).join('') || '<p class="hint">아직 들어온 접수가 없습니다. 아래 [시연 표본 만들기]로 채워 보세요.</p>';

    return `<div class="card">
      <h2>이번 주 접수 현황</h2>
      <div class="stats">
        <div class="stat"><div class="n">${all.length}</div><div class="l">전체 접수</div></div>
        <div class="stat hot"><div class="n">${waiting.length}</div><div class="l">아직 처리 안 한 건</div></div>
        <div class="stat ok"><div class="n">${all.length - waiting.length}</div><div class="l">선정·제외 끝</div></div>
        <div class="stat blue"><div class="n">${soon.length}</div><div class="l">이레 안에 마감될 사업</div></div>
      </div>
      <div class="cost ${MODE === 'api' ? 'api' : 'manual'}">
        지금 판(${MODE === 'api' ? '🔗 연동' : '✋ 수기'})으로 남은 ${waiting.length}건을 끝내는 데
        <b>약 ${hhmm(mins)}</b>이 듭니다.
        ${waiting.length ? `다른 판이면 약 ${hhmm(otherMins)}입니다.` : ''}
        <div class="hint" style="color:inherit;opacity:.8">
          대조 항목별 예상 시간을 더한 값입니다 — 농업 사업은 경영체 5항목(수기 6분),
          복지 사업은 수급자격 4항목(수기 5분). 연동하면 어느 쪽이든 <b>중복·기수혜 확인 1분</b>만 남습니다.</div>
      </div>
      ${SRV === 'local' ? '<p class="hint">⚠️ 테스트 서버에 닿지 못했습니다 — 이 기기에 남은 것만 보입니다.</p>' : ''}
    </div>

    <div class="card">
      <h2>사업별로 열기</h2>
      ${cards}
    </div>

    <div class="card">
      <h2>시연 자료</h2>
      <div class="row">
        <button id="mkDemo">시연 표본 만들기</button>
        <button id="rmDemo">표본 지우기</button>
        <span class="sp"></span>
        <button id="reload">새로 불러오기</button>
      </div>
      <p class="hint">표본은 <b>이 기기에만</b> 만들어집니다. 서버에도, 실제 접수함에도 들어가지 않습니다.
        사람 이름은 지어낸 것이고, 사업·부서·마감일은 실제 주간업무 자료에서 가져옵니다.</p>
    </div>`;
  }
  function wireList() {
    document.querySelectorAll('.biz').forEach(el => el.onclick = () => {
      SID = el.dataset.sid; window.scrollTo(0, 0); render(); });
    const md = $('#mkDemo'); if (md) md.onclick = () => { makeDemo(); reload(); };
    const rd = $('#rmDemo'); if (rd) rd.onclick = () => { clearDemo(); reload(); };
    const rl = $('#reload'); if (rl) rl.onclick = () => reload();
  }

  /* ── 사업 하나의 접수 목록 ── */
  function viewRows() {
    const it = byId[SID], cfg = cfgOf(SID);
    const rows = ROWS.filter(r => r.sid === SID);
    const e = endOf(SID);
    const waiting = rows.filter(r => !DONE(r.state));
    const mins = waiting.reduce((a, r) => a + minsOf(r), 0);
    const cnt = s => rows.filter(r => r.state === s).length;

    return `<div class="card">
      <div class="row"><button id="back" class="sm">← 사업 목록</button><span class="sp"></span>
        <input id="who" placeholder="처리한 사람(선택)" value="${E(WHO)}" style="width:170px"></div>
      <h2 style="margin-top:12px">${E(it ? it.title : SID)}</h2>
      <p class="lead" style="margin-bottom:10px">${E((it && it.dept) || '')}${e ? ` · 마감 ${E(e)}${dday(e) >= 0 ? ` (D-${dday(e)})` : ' (지남)'}` : ''}
        ${cfg.capacity ? ` · 정원 ${cfg.capacity}명` : ''}</p>
      <div class="stats">
        <div class="stat"><div class="n">${rows.length}</div><div class="l">접수</div></div>
        <div class="stat ok"><div class="n">${cnt('선정')}</div><div class="l">선정</div></div>
        <div class="stat"><div class="n">${cnt('보류')}</div><div class="l">보류</div></div>
        <div class="stat hot"><div class="n">${cnt('제외')}</div><div class="l">제외</div></div>
      </div>
      <div class="cost ${MODE === 'api' ? 'api' : 'manual'}">남은 ${waiting.length}건 · 약 <b>${hhmm(mins)}</b></div>
      ${capRow(cfg, rows)}
    </div>

    <div class="card">
      <h2>접수 ${rows.length}건</h2>
      ${rows.map(rowHtml).join('') || '<p class="hint">접수가 없습니다.</p>'}
    </div>

    ${reportCard(it, rows)}
    ${linkCard(it, cfg, rows)}`;
  }

  /* ── 정원과 물량 ──
     보조사업은 자리가 차면 닫히고, 심사에서 빠지거나 물량이 늘면 다시 열린다.
     그 조절이 담당자 손에 있어야 한다 — 여기서 바로 늘리고 줄인다.
     (강제는 서버가 한다: 접수 순간 다시 세므로 여러 명이 동시에 눌러도 안 넘친다) */
  function capRow(cfg, rows) {
    const cap = cfg.capacity;
    /* 정원은 서버가 실제 접수만 세서 막는다 — 표본을 섞어 세면
       주민 화면의 '남은 자리'와 어긋난 숫자를 담당자가 보게 된다 */
    const real = rows.filter(r => !r._demo).length;
    const demo = rows.length - real;
    const full = cap && real >= cap;
    /* 신청 수량 누계 — 묘목처럼 '얼마나'를 받는 사업이면 물량이 정원보다 중요하다 */
    let qsum = 0, qunit = (cfg.qty && cfg.qty.unit) || '';
    rows.forEach(r => { const q = parseFloat((r.data || {}).qty); if (!isNaN(q)) qsum += q; });
    return `<div class="row" style="margin-top:10px">
      ${cap ? `<span class="pill ${full ? 'dday' : 'done'}">정원 ${cap}명 · 접수 ${real}건${full ? ' — 가득 참' : ` · 남은 자리 ${cap - real}`}</span>`
            : '<span class="pill" style="background:var(--bg);color:var(--sub)">정원 제한 없음</span>'}
      ${demo ? `<span class="pill demo">표본 ${demo}건은 정원에 안 셈</span>` : ''}
      ${qsum ? `<span class="pill man">신청 수량 누계 ${qsum}${E(qunit)}</span>` : ''}
      <span class="sp"></span>
      <button class="sm" id="capBtn">정원 조정</button>
    </div>
    ${full ? `<p class="hint">정원이 차서 주민 화면의 온라인 신청이 닫혀 있습니다.
      심사에서 빠지는 분이 있거나 물량이 늘면 [정원 조정]으로 그 자리에서 다시 여세요.</p>` : ''}`;
  }

  function rowHtml(r) {
    const v = viewOf(r), d = r.data || {}, c = r.checks || {};
    const SET = checksOf(r), isW = provOf(r) === 'welfare';
    const left = todo(r);
    const cls = r.state === '선정' ? 'sel' : r.state === '제외' ? 'out' : '';
    let mid = '';

    if (v === 'api') {
      const j = judge(r);
      mid = (j.r === 'ok'
        ? `<div class="verdict ok">🔗 자격 확인됨 — ${E(j.oks.join(' · '))}
             <small>접수되는 순간 대조가 끝났습니다. 담당자는 눈으로 한 번 훑기만 하면 됩니다.</small></div>`
        : `<div class="verdict no">🔗 해당되지 않음 — ${E(j.fails.join(' · '))}
             <small>${E(j.oks.join(' · '))}${j.oks.length ? ' 은(는) 맞습니다.' : ''}</small></div>`)
        + (j.fixed.length ? `<div class="verdict ask">적어 낸 내용을 대장 값으로 바로잡았습니다 —
             ${j.fixed.map(x => '<br>· ' + E(x)).join('')}
             <small>수기판이었다면 이 어긋남은 담당자가 대장을 열기 전까지 보이지 않습니다.</small></div>` : '')
        + (j.warns.length ? `<div class="warnbox">${j.warns.map(E).join('<br>')}</div>` : '');
    } else {
      const g = c.reg ? gap(r) : null;
      mid = `<div class="verdict ask">✋ 본인이 적어 낸 내용만 들어왔습니다.
          <small>아래 ${SET.length}가지를 대조해야 선정할 수 있습니다. 한 건 ${manualMin(SET)}분.</small></div>
        ${c.reg && g ? `<div class="warnbox">대장을 열어 보니 적어 낸 내용과 다릅니다 —
            ${g.map(x => '<br>· ' + E(x)).join('')}
            <br><b>연동판이었다면 이 어긋남은 접수하는 그 자리에서 걸러졌습니다.</b></div>` : ''}
        ${c.reg && !g && r._truth ? '<div class="verdict ok" style="margin-top:6px">대장과 맞습니다.</div>' : ''}`;
    }

    const autoWord = isW ? '복지자격 정보로 자동 확인됨' : '경영체 정보로 자동 확인됨';
    const checks = SET.map(k => {
      const auto = v === 'api' && k.auto;
      const on = auto || !!c[k.k];
      return `<button type="button" class="chk ${auto ? 'auto' : (on ? 'on' : '')}" data-no="${E(r.no)}" data-ck="${k.k}"
        ${auto ? 'disabled' : ''}><span class="bx">✓</span><span>${E(k.t)}
        <em>${auto ? autoWord : E(k.d) + ' · 약 ' + k.min + '분'}</em></span></button>`;
    }).join('');

    return `<div class="ap ${cls}" data-no="${E(r.no)}">
      <div class="h">
        <b>${E(d.name || '이름 미상')}</b>
        <span class="who">${E(d.phone || '')}</span>
        <span class="pill ${v === 'api' ? 'api' : 'man'}">${v === 'api' ? '🔗 연동 확인' : '✋ 본인 진술'}</span>
        ${r._demo ? '<span class="pill demo">표본</span>' : ''}
        <span class="sp"></span>
        <span class="state ${E(r.state || '접수')}">${E(r.state || '접수')}</span>
        <span class="who">${E(r.no)}</span>
      </div>
      <div class="b">
        <div class="grid">
          <div><span>접수</span>${E((r.at || '').slice(0, 16))}</div>
          <div><span>주소</span>${E(d.addr || '—')}</div>
          ${isW ? `<div><span>적어 낸 자격</span>${E(d.claim || '적지 않음')}</div>`
            : `<div><span>경영체번호</span>${E(d.farmNo || '적지 않음')}</div>
          <div><span>적어 낸 면적</span>${E(d.farmArea != null && d.farmArea !== '' ? d.farmArea + 'ha' : '—')}</div>`}
          ${d.qty ? `<div><span>신청 수량</span>${E(d.qty)}</div>` : ''}
          ${d.memo ? `<div style="grid-column:1/-1"><span>남긴 말</span>${E(d.memo)}</div>` : ''}
        </div>
        ${mid}
        <div class="checks">${checks}</div>
        <div class="acts">
          <input class="memo" data-memo="${E(r.no)}" placeholder="남길 말 (제외 사유 등)" value="${E(r.note || '')}">
          <button class="sm go" data-act="선정" data-no="${E(r.no)}" ${left.length ? 'disabled' : ''}>선정</button>
          <button class="sm" data-act="보류" data-no="${E(r.no)}">보류</button>
          <button class="sm no" data-act="제외" data-no="${E(r.no)}">제외</button>
        </div>
        ${left.length ? `<p class="hint">아직 ${left.length}가지가 남았습니다 —
          ${E(left.map(x => x.t).join(', '))} (약 ${left.reduce((a, x) => a + x.min, 0)}분)</p>` : ''}
        ${r.stateAt ? `<p class="hint">${E(r.state)} · ${E((r.stateAt || '').slice(0, 16))}${r.by ? ' · ' + E(r.by) : ''}</p>` : ''}
      </div>
    </div>`;
  }

  function wireRows() {
    $('#back').onclick = () => { SID = null; window.scrollTo(0, 0); render(); };
    const cb = $('#capBtn');
    if (cb) cb.onclick = async () => {
      const cfg = cfgOf(SID);
      const now = cfg.capacity != null ? String(cfg.capacity) : '';
      const v = prompt('접수 정원을 몇 명으로 할까요? (비우면 제한 없음)', now);
      if (v === null) return;
      const nv = v.trim() === '' ? null : Math.max(1, parseInt(v, 10) || 0);
      if (v.trim() !== '' && !nv) { alert('숫자로 적어 주세요.'); return; }
      cfg.capacity = nv;
      SUBCFG.put(SID, cfg);                     /* 이 기기 먼저 */
      const r = await LABAPI.pushCfg(SID, cfg, WHO || '담당자');
      render();
      if (!r.ok) alert(r.why + ' — 이 기기에는 반영했습니다.');
    };
    const w = $('#who'); if (w) w.oninput = () => { WHO = w.value; try { localStorage.setItem(WKEY, WHO); } catch (e) { } };

    document.querySelectorAll('.chk[data-ck]').forEach(b => b.onclick = () => {
      const r = ROWS.find(x => x.no === b.dataset.no); if (!r) return;
      r.checks = r.checks || {};
      r.checks[b.dataset.ck] = !r.checks[b.dataset.ck];
      save(r, r.state === '접수' ? '확인' : r.state);
    });
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const r = ROWS.find(x => x.no === b.dataset.no); if (!r) return;
      const mi = document.querySelector(`[data-memo="${CSS.escape(r.no)}"]`);
      if (mi) r.note = mi.value;
      if (b.dataset.act === '제외' && !r.note) { alert('제외할 때는 사유를 적어 주세요. 나중에 물어보러 오십니다.'); mi && mi.focus(); return; }
      save(r, b.dataset.act);
    });
    wireExport();
  }

  async function save(r, state) {
    if (BUSY) return; BUSY = true;
    r.state = state; r.by = WHO; r.stateAt = new Date().toISOString();
    render();                                  /* 먼저 화면을 바꾼다 — 기다림이 보이지 않게 */
    const res = await LABAPI.setState(r.no, state, { note: r.note, by: WHO, checks: r.checks });
    BUSY = false;
    if (!res.ok && !r._demo) console.warn(res.why);
  }

  /* ── 주간업무 보고 문장 ── */
  function reportCard(it, rows) {
    const c = s => rows.filter(r => r.state === s).length;
    const e = endOf(SID);
    const txt = `${(it && it.title) || ''} — 온라인 접수 ${rows.length}건 `
      + `(선정 ${c('선정')} · 보류 ${c('보류')} · 제외 ${c('제외')} · 미처리 ${rows.filter(r => r.state === '접수' || r.state === '확인').length})`
      + `${e ? `, 접수마감 ${e}` : ''}. ${TODAY} 기준.`;
    return `<div class="card">
      <h2>주간업무 보고 문장</h2>
      <textarea class="out" id="rpt" style="min-height:70px">${E(txt)}</textarea>
      <div class="row" style="margin-top:8px"><button id="cpRpt">복사</button></div>
      <p class="hint">주간업무계획서에 그대로 붙일 수 있게 한 줄로 만들어 둡니다.</p>
    </div>`;
  }

  /* ── 내부 시스템으로 넘기기 ── */
  function linkCard(it, cfg, rows) {
    const spec = SUBCFG.linkSpec(cfg);
    return `<div class="card">
      <h2>내부 시스템으로 넘기기</h2>
      <p class="hint" style="margin:0 0 10px">담당자가 [받을 정보]를 고른 것만으로 넘길 규격이 이렇게 정해집니다.
        칸 이름을 바꾸려면 <b>설정 화면(admin.html) ⑤ 내부 시스템 연동</b>에서 고치세요.</p>
      <div style="overflow-x:auto"><table class="spec">
        <tr><th>내보낼 칸</th><th>뜻</th><th>이 판에서 채워지나</th></tr>
        ${spec.map(s => `<tr><td><code>${E(s.col)}</code></td><td>${E(s.label)}</td>
          <td>${s.agrix
            ? (MODE === 'api' ? '<span class="pill api">🔗 자동</span>' : '<span class="pill man">빈칸 — 손으로 채움</span>')
            : '<span class="pill done">채워짐</span>'}</td></tr>`).join('')}
      </table></div>
      <div class="row" style="margin-top:10px">
        <button id="csv">CSV 내려받기</button>
        <button id="jsn">표준 JSON 내려받기</button>
        <button id="spec">연동 명세서 보기</button>
      </div>
      <textarea class="out" id="out" style="display:none;margin-top:10px" readonly></textarea>
    </div>`;
  }

  /* 한 건을 규격에 맞춰 편다 */
  function toSpec(r, spec) {
    const d = r.data || {}, t = (MODE === 'api') ? truthOf(r) : null;
    const o = {};
    spec.forEach(s => {
      let v = '';
      if (s.k === '_no') v = r.no;
      else if (s.k === '_at') v = r.at;
      else if (s.k === '_title') v = r.title;
      else if (s.k === '_dept') v = r.dept;
      else if (s.k === '_state') v = r.state || '접수';
      else if (s.k === '_verify') v = (MODE === 'api' && t) ? '연동확인' : '본인진술';
      else if (s.k === '_area') v = t ? t.area : '';
      else if (s.k === '_fstatus') v = t ? t.status : '';
      else if (s.k === '_fat') v = t ? (t.statusAt || '') : '';
      else v = d[s.k] != null ? d[s.k] : '';
      o[s.col] = v == null ? '' : String(v);
    });
    return o;
  }
  function dl(name, text, type) {
    const b = new Blob(['﻿' + text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
  }
  function wireExport() {
    const cp = $('#cpRpt');
    if (cp) cp.onclick = () => { const t = $('#rpt'); t.select(); document.execCommand('copy'); cp.textContent = '복사했습니다'; };
    const cfg = cfgOf(SID), it = byId[SID];
    const rows = ROWS.filter(r => r.sid === SID);
    const spec = SUBCFG.linkSpec(cfg);
    const base = `봉화군_${(it && it.title || SID).replace(/[\\/:*?"<>|]/g, '')}_${TODAY}`;
    const c = $('#csv'); if (c) c.onclick = () => {
      const head = spec.map(s => s.col).join(',');
      const body = rows.map(r => { const o = toSpec(r, spec);
        return spec.map(s => `"${String(o[s.col]).replace(/"/g, '""')}"`).join(','); }).join('\r\n');
      dl(base + '.csv', head + '\r\n' + body, 'text/csv;charset=utf-8');
    };
    const j = $('#jsn'); if (j) j.onclick = () => {
      dl(base + '.json', JSON.stringify({ 사업: it && it.title, 부서: it && it.dept, 기준일: TODAY,
        자격확인방식: MODE === 'api' ? '농업경영체 정보 연동' : '본인 진술 + 담당자 수기 대조',
        건수: rows.length, 자료: rows.map(r => toSpec(r, spec)) }, null, 2), 'application/json');
    };
    const sp = $('#spec'); if (sp) sp.onclick = () => {
      const t = $('#out'); t.style.display = '';
      t.value = JSON.stringify({ 사업: it && it.title,
        설명: '이 사업의 온라인 접수를 내부 시스템으로 넘길 때 쓰는 칸 규격입니다. 담당자가 [받을 정보]를 고르면 자동으로 만들어집니다.',
        칸: spec.map(s => ({ 칸이름: s.col, 뜻: s.label,
          채우는쪽: s.agrix ? '농업경영체 정보(연동 시 자동, 미연동 시 빈칸)' : '신청인 입력' })) }, null, 2);
      t.select();
    };
  }

  /* ═══ 나란히 비교 ═══ */
  function viewCompare() {
    const rows = ROWS.filter(r => !DONE(r.state));
    const wrong = ROWS.filter(r => r._truth && gap(r)).length;
    const tot = ROWS.filter(r => r._truth).length;
    /* 합계는 건마다 제 분야 표로 센다 — 농업 6분, 복지 5분이 섞여 있다.
       한 벌로 뭉뚱그리면 위 요약 카드의 숫자와 어긋난다. */
    const sumMan = rows.reduce((a, r) => a + manualMin(checksOf(r)), 0);
    const sumApi = rows.reduce((a, r) => a + apiMin(checksOf(r)), 0);
    const nW = rows.filter(r => provOf(r) === 'welfare').length;
    const li = (k, auto) => `<li class="${auto ? 'auto' : 'hand'}">${E(k.t)} — ${auto ? '접수 때 자동으로 끝남' : `담당자가 함 (약 ${k.min}분)`}</li>`;
    const pair = (set, name, icon) => `<div class="cmp" style="margin-bottom:10px">
        <div class="col a"><div class="ch">✋ 수기판 — ${E(name)}</div>
          <ol>${set.map(k => li(k, false)).join('')}</ol>
          <div class="foot">한 건 <b>${manualMin(set)}분</b></div></div>
        <div class="col b"><div class="ch">${icon} 연동판 — 정보가 붙어 있을 때</div>
          <ol>${set.map(k => li(k, k.auto)).join('')}</ol>
          <div class="foot">한 건 <b>${apiMin(set)}분</b></div></div>
      </div>`;
    return `<div class="card">
      <h2>같은 접수 한 건, 두 가지 처리</h2>
      <p class="lead">아래 대조는 어느 판에서든 반드시 해야 합니다. 다른 것은 <b>누가 하느냐</b>뿐입니다.
        분야가 달라도 <b>구조는 하나</b>입니다 — 연동되는 정보만 바뀝니다.</p>
      ${pair(CHECKSETS.agrix, '농업 사업 (경영체)', '🌱')}
      ${pair(CHECKSETS.welfare, '복지 사업 (수급 자격)', '🤝')}
      <div class="cost api" style="margin-top:12px">
        미처리 ${rows.length}건${nW ? ` (복지 ${nW}건 포함)` : ''} 기준 —
        수기판 <b>${hhmm(sumMan)}</b> → 연동판 <b>${hhmm(sumApi)}</b>,
        <b>${hhmm(sumMan - sumApi)}</b>이 줄어듭니다.
        <div class="hint" style="color:inherit;opacity:.85">
          어느 분야든 <b>중복·기수혜 확인 1가지는 그대로 남습니다</b> —
          우리 부서 지난 대장은 농관원도 복지 전산도 알지 못합니다.
          연동은 만능이 아니라 사실 확인만 덜어 줍니다.</div>
      </div>
    </div>

    <div class="card">
      <h2>시간보다 중요한 것 — 틀린 채로 접수되는 건</h2>
      ${tot ? `<div class="stats">
        <div class="stat hot"><div class="n">${wrong}건</div><div class="l">적어 낸 내용과 대장이 다름</div></div>
        <div class="stat"><div class="n">${tot}건</div><div class="l">연동으로 확인되는 접수</div></div>
        <div class="stat blue"><div class="n">${Math.round(wrong / tot * 100)}%</div><div class="l">수기판에서 손으로 잡아내야 하는 몫</div></div>
      </div>
      <p class="hint">수기판에서는 이 ${wrong}건이 <b>담당자가 대장·전산을 열기 전까지 정상 접수로 보입니다.</b>
        빠뜨리면 자격 없는 사람에게 보조금이 나가고, 나중에 환수해야 합니다.
        연동판에서는 접수 단추를 누르는 그 자리에서 걸러집니다.</p>
      <p class="hint">위 숫자는 시연 표본으로 센 것입니다 — [시연 표본 만들기]를 누르면 채워집니다.</p>`
      : '<p class="hint">시연 표본이 없습니다. [🔗 연동판] 또는 [✋ 수기판]에서 <b>시연 표본 만들기</b>를 먼저 누르세요.</p>'}
    </div>

    <div class="card">
      <h2>연동이 없어도 남는 일 — 정직하게</h2>
      <table class="spec">
        <tr><th>일</th><th>연동판</th><th>수기판</th></tr>
        <tr><td>등록·자격·상태·소재지 대조<div style="font-size:11.5px;color:var(--faint)">농업은 경영체, 복지는 수급 자격</div></td>
          <td><span class="pill api">자동</span></td><td><span class="pill man">손으로 4~5분</span></td></tr>
        <tr><td>중복·기수혜 확인</td><td><span class="pill man">손으로 1분</span></td><td><span class="pill man">손으로 1분</span></td></tr>
        <tr><td>사업별 특수 요건(교육 이수, 마을 추천 등)</td><td><span class="pill man">손으로</span></td><td><span class="pill man">손으로</span></td></tr>
        <tr><td>최종 선정·예산 배분</td><td><span class="pill man">사람이</span></td><td><span class="pill man">사람이</span></td></tr>
      </table>
      <p class="hint">연동은 심사를 대신하지 않습니다. <b>사실 확인만</b> 대신합니다.
        그런데 담당자 시간의 대부분이 거기에 들어갑니다.</p>
      <p class="hint" style="margin-top:10px"><b>그래서 문을 한 번 열면 분야마다 다시 씁니다.</b>
        다만 문은 분야마다 따로 있습니다 — 농업은 농관원, 복지는 복지 전산.
        군 담당자 혼자서는 같은 문을 몇 번이고 두드리게 됩니다.</p>
    </div>`;
  }
  function wireCompare() { }

})();
