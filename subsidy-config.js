/* ═══════════════════════════════════════════════════════════════
   subsidy-config.js — 사업별 '자격 확인 항목'과 '온라인 접수' 설정을 다루는 공용 코드.
   관리자 화면(admin.html)과 주민 화면(subsidy.js)이 같은 파일을 쓴다.

   서버가 없으므로 설정은 이 기기의 localStorage 에만 쌓인다(bhlab.admin.cfg).
   담당자가 [설정 내보내기]로 JSON 을 받아 build/subsidy-review.json 에 넣으면
   모든 사람에게 고정된다 — 그때까지는 이 기기에서만 보이는 시험용 설정이다.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  const CKEY = 'bhlab.admin.cfg';

  /* 물어볼 수 있는 자격 항목 — 관리자가 켜고 끄고 문구를 고친다.
     agrix:true 는 농업경영체 정보로 자동 확인이 되는 항목이다. */
  const FIELDS = {
    age:        { label: '나이', q: '나이가 어떻게 되세요?', type: 'number', unit: '세' },
    residency:  { label: '거주지', q: '{값}에 주소를 두고 계신가요?', type: 'yesno' },
    farm:       { label: '농업경영체 등록', q: '농업경영체 등록을 하셨나요?', type: 'yesno', agrix: true },
    farming:    { label: '계속 영농종사', q: '지금도 농사를 짓고 계신가요?', type: 'yesno', agrix: true },
    farmArea:   { label: '경작 면적', q: '경작 면적이 어떻게 되세요?', type: 'number', unit: 'ha', agrix: true },
    gender:     { label: '성별', q: '주민등록상 {값}이신가요?', type: 'yesno' },
    biz:        { label: '사업자등록', q: '사업자등록을 하셨나요?', type: 'yesno' },
    income:     { label: '소득기준', q: '소득 기준이 있는 사업입니다. 확인이 필요하세요?', type: 'yesno' },
    /* 복지 분야 — welfare:true 는 복지자격 정보(목업)로 자동 확인이 되는 항목이다.
       농업의 agrix:true 와 같은 자리: 연동되는 정보가 다를 뿐 뼈대는 하나다. */
    basicBnf:   { label: '기초생활수급', q: '기초생활수급자이신가요?', type: 'yesno', welfare: true },
    nearPoor:   { label: '차상위계층', q: '차상위계층에 해당하시나요?', type: 'yesno', welfare: true },
    disab:      { label: '장애인 등록', q: '장애인 등록이 되어 있으신가요?', type: 'yesno', welfare: true },
    singleP:    { label: '한부모가족', q: '한부모가족으로 등록되어 있으신가요?', type: 'yesno', welfare: true },
  };

  /* 온라인 접수 때 받을 수 있는 정보 — 관리자가 고른 것만 입력받는다. */
  const ASK = {
    name:    { label: '이름', type: 'text', required: true },
    phone:   { label: '연락처', type: 'tel', ph: '010-0000-0000' },
    birth:   { label: '생년월일', type: 'date' },
    addr:    { label: '주소', type: 'text', ph: '봉화군 ○○면 ○○리' },
    farmNo:  { label: '농업경영체 등록번호', type: 'text', agrix: true },
    account: { label: '입금 계좌', type: 'text', ph: '은행 / 계좌번호 / 예금주' },
    memo:    { label: '남기실 말', type: 'textarea' },
  };

  /* ═══ 내부 시스템으로 넘길 때 쓰는 표준 항목명 ═══
     담당자가 [받을 정보]를 고르기만 하면, 넘길 규격이 여기서 저절로 만들어진다.
     따로 개발을 시키지 않아도 되도록 — 이것이 '연동이 쉽다'는 말의 실체다.

     이름은 행정정보 공동이용에서 쓰는 투로 맞췄다. 실제 내부 시스템의 칸 이름이
     다르면 관리자 화면에서 그 한 줄만 고쳐 쓰면 된다. */
  const LINK = {
    /* 접수 자체에 딸린 것 — 고르지 않아도 늘 나간다 */
    _no:     { col: 'RCPT_NO',        label: '접수번호',       always: true },
    _at:     { col: 'RCPT_DT',        label: '접수일시',       always: true },
    _title:  { col: 'BSNS_NM',        label: '사업명',         always: true },
    _dept:   { col: 'CHRG_DEPT_NM',   label: '담당부서',       always: true },
    _state:  { col: 'PROCS_STTUS',    label: '처리상태',       always: true },
    _verify: { col: 'QLFC_CNFIRM_SE', label: '자격확인구분',   always: true,
               note: '연동확인 | 본인진술 — 이 한 칸이 심사 부담을 가른다' },
    /* 담당자가 고른 것 */
    name:    { col: 'APLCNT_NM',      label: '신청인성명' },
    phone:   { col: 'APLCNT_TELNO',   label: '신청인연락처' },
    birth:   { col: 'APLCNT_BRDT',    label: '신청인생년월일' },
    addr:    { col: 'APLCNT_ADDR',    label: '신청인주소' },
    farmNo:  { col: 'FRMR_MNG_NO',    label: '농업경영체등록번호', agrix: true },
    account: { col: 'RCPMNY_ACNUT',   label: '입금계좌' },
    memo:    { col: 'APLCNT_MEMO',    label: '신청인메모' },
    qty:     { col: 'APLY_QTY',       label: '신청수량' },
    /* 연동판에서만 채워지는 것 — 수기판에서는 늘 빈칸이다 */
    _area:   { col: 'CTVT_AR',        label: '경작면적(ha)',   agrix: true },
    _fstatus:{ col: 'FRMR_STTUS',     label: '경영체상태',     agrix: true },
    _fat:    { col: 'FRMR_STTUS_DE',  label: '경영체상태기준일', agrix: true },
    /* 복지 분야 사업이면 경영체 칸 대신 이 칸이 실린다 */
    _bnfq:   { col: 'BNFQ_SE',        label: '수급자격구분',   welfare: true },
    _bnfat:  { col: 'BNFQ_STDDE',     label: '자격기준일',     welfare: true },
  };

  /* 그 사업의 연동 규격 — 고른 항목 + 늘 나가는 항목.
     자격 항목에 복지 항목이 섞여 있으면 복지 칸을, 아니면 경영체 칸을 싣는다. */
  function linkSpec(cfg) {
    const picked = (cfg && cfg.ask) || [];
    const q = cfg && cfg.qty && cfg.qty.on;
    const over = (cfg && cfg.link && cfg.link.map) || {};
    const wf = ((cfg && cfg.fields) || []).some(f => FIELDS[f.k] && FIELDS[f.k].welfare);
    const keys = Object.keys(LINK).filter(k => {
      if (LINK[k].always) return true;
      if (k === 'qty') return !!q;
      if (LINK[k].welfare) return wf;
      if (LINK[k].agrix && k.startsWith('_')) return !wf;
      if (k.startsWith('_')) return true;
      return picked.includes(k);
    });
    return keys.map(k => ({ k, col: over[k] || LINK[k].col, label: LINK[k].label,
                            agrix: !!(LINK[k].agrix || LINK[k].welfare), always: !!LINK[k].always,
                            note: LINK[k].note || '' }));
  }

  /* 자동 추출 조건 → 기본 자격 항목 */
  function defaultsFrom(c) {
    const out = [];
    const add = (k, v) => out.push({ k, on: true, required: true, v: v === undefined ? null : v,
                                     q: FIELDS[k].q });
    if (c.ageMin !== null || c.ageMax !== null)
      out.push({ k: 'age', on: true, required: true, min: c.ageMin, max: c.ageMax,
                 maxInclusive: c.ageMaxInclusive, subject: c.ageSubject || null,
                 q: c.ageSubject ? `해당되는 ${c.ageSubject}의 나이가 어떻게 되세요?` : FIELDS.age.q });
    if (c.residency) add('residency', c.residency);
    if (c.needsFarmRegistry) add('farm');
    if (c.needsFarming) add('farming');
    if (c.farmAreaMin !== null && c.farmAreaMin !== undefined)
      out.push({ k: 'farmArea', on: true, required: true, min: c.farmAreaMin, q: FIELDS.farmArea.q });
    if (c.gender) add('gender', c.gender);
    if (c.needsBizRegistry) add('biz');
    if (c.hasIncomeRule) out.push({ k: 'income', on: true, required: false, q: FIELDS.income.q });
    return out;
  }

  function load() { try { return JSON.parse(localStorage.getItem(CKEY)) || {}; } catch (e) { return {}; } }
  function save(all) { try { localStorage.setItem(CKEY, JSON.stringify(all)); } catch (e) { } }

  /* 그 사업의 최종 설정 — 저장해 둔 것이 없으면 자동 추출값으로 만든다 */
  function forItem(sub) {
    const all = load();
    if (all[sub.id]) return all[sub.id];
    return { fields: defaultsFrom(sub.conditions), online: false, ask: ['name', 'phone'],
             agree: true, capacity: null, note: '', qty: null };
  }
  function put(id, cfg) { const all = load(); all[id] = cfg; save(all); }
  function reset(id) { const all = load(); delete all[id]; save(all); }

  /* ── 신청량 ──
     묘목·자재처럼 '얼마나 받을지'를 적는 사업이 있다. 신청한 만큼 다 나오는 게 아니라
     경작 면적에 맞춰 깎이므로, 적는 자리에서 미리 한도를 보여 주고 넘으면 스스로 줄인다.
     qty = { on, label, unit, perHa, max, note } */
  function qtyCap(q, areaHa) {
    if (!q || !q.on) return null;
    let cap = q.max != null ? q.max : Infinity;
    if (q.perHa != null && areaHa != null && areaHa !== '' && !isNaN(+areaHa))
      cap = Math.min(cap, Math.floor(+areaHa * q.perHa));
    return cap === Infinity ? null : Math.max(0, cap);
  }
  function qtyWhy(q, areaHa) {
    if (!q || !q.on) return '';
    const bits = [];
    if (q.perHa != null && areaHa) bits.push(`경작 면적 ${areaHa}ha × ${q.perHa}${q.unit || ''}`);
    if (q.max != null) bits.push(`한 사람 최대 ${q.max}${q.unit || ''}`);
    return bits.join(' · ');
  }

  /* 질문 문구 — {값} 을 실제 값(봉화군/여성 등)으로 바꾼다 */
  function qText(f) { return (f.q || (FIELDS[f.k] && FIELDS[f.k].q) || f.k).replace('{값}', f.v || ''); }

  /* 서버에서 받아 온 설정을 통째로 갈아 끼운다 (lab-api 가 부른다) */
  function setAll(all) { save(all || {}); }

  G.SUBCFG = { FIELDS, ASK, LINK, linkSpec, defaultsFrom, load, save, setAll, forItem, put, reset, qText,
               qtyCap, qtyWhy, CKEY };
})(window);
