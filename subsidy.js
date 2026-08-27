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

  /* 물을 항목 — 관리자 설정(SUBCFG)이 있으면 그것을, 없으면 자동 추출값을 쓴다 */
  function cfgOf(sub) { return window.SUBCFG ? SUBCFG.forItem(sub) : { fields: [], online: false, ask: [] }; }

  function judgeFields(fields, a) {
    const fails = [], unknown = [];
    fields.forEach(f => {
      const v = a[f.k];
      const miss = () => { if (f.required !== false) unknown.push(labelOf(f)); };
      if (f.k === 'age' || f.k === 'farmArea') {
        if (v === '' || v == null) return miss();
        const n = +v;
        if (f.min != null && n < f.min)
          fails.push(`${labelOf(f)}(${f.min}${f.k === 'age' ? '세' : 'ha'} 이상)`);
        if (f.k === 'age' && f.max != null) {
          const over = f.maxInclusive ? n > f.max : n >= f.max;
          if (over) fails.push(`나이(${f.max}세 ${f.maxInclusive ? '이하' : '미만'})`);
        }
        return;
      }
      if (v === 'no') fails.push(labelOf(f));
      else if (v !== 'yes') miss();
    });
    if (fails.length) return { r: 'no', fails };
    if (unknown.length) return { r: 'ask', unknown };
    return { r: 'ok' };
  }
  function labelOf(f) {
    const F = window.SUBCFG ? SUBCFG.FIELDS[f.k] : null;
    if (f.k === 'residency') return `거주(${f.v || ''})`;
    if (f.k === 'gender') return `대상(${f.v || ''})`;
    return (F && F.label) || f.k;
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

  const LOGKEY = 'bhlab.apply.log';
  function applyLog() { try { return JSON.parse(localStorage.getItem(LOGKEY)) || []; } catch (e) { return []; } }
  function pushApply(rec) { const l = applyLog(); l.push(rec); try { localStorage.setItem(LOGKEY, JSON.stringify(l)); } catch (e) { } }

  /* 세 단계 — 질문 → 결과 → (자격 통과 + 관리자가 열어 둔 사업이면) 접수 */
  function open(iss, sub, H) {
    let m = document.getElementById('subModal');
    if (!m) { m = document.createElement('div'); m.id = 'subModal'; m.className = 'modal'; document.body.appendChild(m); }
    const cfg = cfgOf(sub), c = sub.conditions, P = prof();
    const fields = cfg.fields.filter(f => f.on !== false);
    const childAge = fields.some(f => f.k === 'age' && f.subject);
    const a = { residency: P.residency ?? '', farm: P.farm ?? '', farming: P.farming ?? '',
                gender: P.gender ?? '', biz: P.biz ?? '', income: '',
                age: childAge ? '' : (P.age ?? ''), farmArea: P.farmArea ?? '' };
    let agrix = null;

    const head = `<h2>내가 받을 수 있나</h2><div class="note">${E(sub.title)}</div>`;
    const foot = inner => `<div class="mfoot">${inner}<span style="flex:1"></span>
      <button type="button" id="subClose">닫기</button></div>`;
    const wire = () => {
      m.querySelector('#subClose').onclick = () => m.classList.remove('open');
      m.onclick = e => { if (e.target === m) m.classList.remove('open'); };
    };
    const num = f => f.k === 'age' ? '세' : 'ha';

    /* ── ① 질문 ── */
    function renderAsk() {
      const useAgrix = fields.some(f => window.AGRIX_MOCK && AGRIX_MOCK.covers(f.k));
      const qs = fields.map((f, i) => {
        const label = window.SUBCFG ? SUBCFG.qText(f) : f.q;
        const auto = agrix && window.AGRIX_MOCK && AGRIX_MOCK.covers(f.k);
        const badge = auto ? '<span class="sub-auto">경영체 정보로 확인됨</span>' : '';
        if (f.k === 'age' || f.k === 'farmArea')
          return `<div class="sub-q">${E(label)}${badge}</div>
            <div class="sub-opts"><input class="sub-age" data-k="${f.k}" type="number" step="${f.k === 'farmArea' ? '0.01' : '1'}"
              inputmode="decimal" placeholder="${f.k === 'age' ? '예: 45' : '예: 0.5'}" value="${E(a[f.k])}"
              ${auto ? 'readonly' : ''}> <span style="align-self:center">${num(f)}</span></div>`;
        return `<div class="sub-q">${E(label)}${badge}</div>
          <div class="sub-opts" data-k="${f.k}">
            <button type="button" data-v="yes">예</button><button type="button" data-v="no">아니오</button>
            <button type="button" data-v="idk">모르겠음</button></div>`;
      }).join('');
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          ${useAgrix && !agrix ? `<button type="button" id="subAgrix" class="sub-agrix">🌱 농업경영체 정보 불러오기
            <span>등록 상태·경작 면적을 자동으로 채웁니다</span></button>` : ''}
          ${agrix ? agrixCard(agrix) : ''}
          ${qs || '<p class="sub-note">물을 항목이 없습니다.</p>'}
          <div class="sub-note">답은 이 휴대폰에만 저장됩니다.</div></div>
        ${foot('<button type="button" id="subGo" class="pri">결과 보기</button>')}</div>`;
      wire();
      m.querySelectorAll('.sub-opts[data-k] button').forEach(b => {
        const k = b.parentElement.dataset.k;
        if (a[k] === b.dataset.v) b.classList.add('on');
        b.onclick = () => { a[k] = b.dataset.v;
          b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      });
      const ab = m.querySelector('#subAgrix'); if (ab) ab.onclick = agrixFlow;
      m.querySelector('#subGo').onclick = () => {
        m.querySelectorAll('input[data-k]').forEach(el => { a[el.dataset.k] = el.value; });
        const keep = { ...prof(), residency: a.residency, farm: a.farm, farming: a.farming,
                       gender: a.gender, biz: a.biz, farmArea: a.farmArea };
        if (!childAge) keep.age = a.age;
        saveProf(keep);
        renderResult(judgeFields(fields, a));
      };
    }

    function agrixCard(g) {
      return `<div class="sub-agrix-card">
        <div class="t">🌱 농업경영체 정보 <span class="mockflag">화면 목업</span></div>
        <div class="g"><span>등록번호</span><b>${E(g.no)}</b></div>
        <div class="g"><span>상태</span><b class="${g.status === '정상' ? 'ok' : 'no'}">${E(g.status)} (${E(g.statusAt)} 기준)</b></div>
        <div class="g"><span>경작 면적</span><b>${E(g.area)} ha</b></div>
        <div class="g"><span>주 품목</span><b>${E(g.crops.join(', '))}</b></div>
        <div class="g"><span>소재지</span><b>${E(g.addr)}</b></div>
      </div>`;
    }
    async function agrixFlow() {
      const pickHtml = AGRIX_MOCK.SAMPLE.map((s, i) =>
        `<button type="button" class="callbtn" data-p="${i}" style="margin-bottom:6px">${E(s.name)} · ${E(s.region)} · ${E(s.area)}ha</button>`).join('');
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          <div class="sub-q">본인 확인</div>
          <p class="sub-note" style="margin-top:0">실제로는 휴대폰 간편인증으로 본인을 확인합니다.
            <b>이 화면은 목업이라</b> 아래에서 시험용 경영체를 하나 고르시면 됩니다.</p>
          <div style="display:flex;flex-direction:column;gap:2px">${pickHtml}</div>
        </div>${foot('')}</div>`;
      wire();
      m.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => {
        m.querySelector('.sub-body').innerHTML = '<p class="sub-note">본인 확인 중입니다…</p>';
        agrix = await AGRIX_MOCK.verify(+b.dataset.p);
        Object.assign(a, AGRIX_MOCK.toAnswers(agrix));
        renderAsk();
      });
    }

    /* ── ② 결과 ── */
    function renderResult(v) {
      const today = window.BWUI ? BWUI.api.today : new Date().toISOString().slice(0, 10);
      const tel = H.tel || '';
      /* 담당자가 관리자 화면에서 정한 마감일이 원문보다 앞선다 */
      const endD = cfg.applyEnd || c.applyEnd;
      const closed = endD && dday(endD, today) < 0;
      const full = false;   /* 정원은 서버가 접수 순간에 다시 센다 — 기기별로 세면 동시에 넘어간다 */
      const already = window.LABAPI ? LABAPI.mine(sub.id) : applyLog().some(r => r.id === sub.id);
      let body = '', act = '';
      if (v.r === 'no') {
        body = `<div class="sub-verdict no">${E(v.fails.join(', '))} 조건에서 해당되지 않습니다.</div>
          <p class="sub-note">조건이 맞지 않아 온라인 접수는 열리지 않습니다.
            사정이 다르다고 보시면 담당과로 문의하세요.</p>
          ${tel ? `<div class="sub-follow"><a class="callbtn" href="tel:${E(tel)}">📞 담당과 전화</a></div>` : ''}`;
      } else if (v.r === 'ask') {
        body = `<div class="sub-verdict ask">자동으로 판단할 수 없습니다. 담당과에 문의하세요.<br>
            <span style="font-weight:400">확인이 필요한 것: ${E(v.unknown.join(', '))}</span></div>
          ${tel ? `<div class="sub-follow"><a class="callbtn" href="tel:${E(tel)}">📞 담당과 전화</a></div>` : ''}`;
      } else {
        let follow = '';
        if (endD) {
          const d = dday(endD, today);
          follow += d < 0 ? `<div>접수가 끝났습니다. (마감 ${E(endD)})</div>`
            : `<div>신청 마감까지 <b>${d === 0 ? '오늘까지' : d + '일'}</b> 남았습니다. (마감 ${E(endD)})</div>`;
        }
        if (sub.apply && sub.apply.place) follow += `<div>접수처: ${E(sub.apply.place)}</div>`;
        if (sub.apply && sub.apply.documents && sub.apply.documents.length)
          follow += `<div>챙길 서류: ${E(sub.apply.documents.join(', '))}</div>`;
        if (cfg.note) follow += `<div>${E(cfg.note)}</div>`;
        const canIcs = endD && !closed;
        follow += `<div class="row">
          ${tel ? `<a class="callbtn" style="flex:1" href="tel:${E(tel)}">📞 담당과 전화</a>` : ''}
          ${canIcs ? `<button type="button" id="subIcs" class="callbtn" style="flex:1;background:var(--paper);color:var(--acc);border:1.5px solid var(--acc)">🔔 마감 알림</button>` : ''}
        </div>`;
        body = `<div class="sub-verdict ok">해당될 수 있습니다. 신청 전에 담당과에 확인하세요.</div>
          <div class="sub-follow">${follow}</div>`;
        if (cfg.online) {
          if (already) body += `<p class="sub-note">이미 이 사업에 접수하셨습니다. 아래 [내 접수 내역]에서 보실 수 있습니다.</p>`;
          else if (closed) body += `<p class="sub-note">접수 기간이 지나 온라인 접수가 닫혔습니다.</p>`;
          else if (full) body += `<p class="sub-note">접수 정원(${cfg.capacity}명)이 찼습니다. 담당과로 문의하세요.</p>`;
          else act = '<button type="button" id="subApply" class="pri">📝 온라인 신청</button>';
        }
      }
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">${body}
          ${agrix ? agrixCard(agrix) : ''}
          <div class="sub-raw"><details><summary>근거 원문 보기</summary><pre>${E(sub.rawLines.join('\n'))}</pre></details></div>
          <div class="sub-note">${sub.status !== 'reviewed'
            ? '계획서에서 자동으로 읽은 초안이에요. 최종 자격은 담당과 심사로 정해집니다.'
            : '최종 자격은 담당과 심사로 정해집니다.'}</div></div>
        ${foot(act + '<button type="button" id="subBack">다시 답하기</button>')}</div>`;
      wire();
      m.querySelector('#subBack').onclick = renderAsk;
      const ap = m.querySelector('#subApply'); if (ap) ap.onclick = renderApply;
      const ib = m.querySelector('#subIcs');
      if (ib) ib.onclick = () => {
        const fake = { _id: 'sublab:' + sub.id, title: '[신청 마감] ' + sub.title, dept: sub.dept,
          list: [{ week: sub.week, item: { title: sub.title, lines: [{ lv: 1, txt: `기간: ${endD.replace(/-/g, '. ')}.` }] } }] };
        const txt = icsWithAlarms(H, fake, endD, sub.title);
        if (txt) H.downloadICS(txt, '봉화군_마감알림_' + sub.id + '.ics');
      };
    }

    /* ── ③ 온라인 접수 ── */
    function renderApply() {
      const A = window.SUBCFG ? SUBCFG.ASK : {};
      const pre = prof();
      const q = cfg.qty;
      const areaHa = (agrix && agrix.area != null) ? agrix.area : (a.farmArea || null);
      const cap = window.SUBCFG ? SUBCFG.qtyCap(q, areaHa) : null;
      const why = window.SUBCFG ? SUBCFG.qtyWhy(q, areaHa) : '';
      const rows = cfg.ask.map(k => {
        const f = A[k]; if (!f) return '';
        let val = pre['ap_' + k] || '';
        if (k === 'farmNo' && agrix) val = agrix.no;
        if (k === 'addr' && agrix) val = agrix.addr;
        const inp = f.type === 'textarea'
          ? `<textarea class="ap-in" data-k="${k}" rows="3">${E(val)}</textarea>`
          : `<input class="ap-in" data-k="${k}" type="${f.type}" value="${E(val)}" placeholder="${E(f.ph || '')}">`;
        return `<label class="ap-lab">${E(f.label)}${f.required ? ' <b>*</b>' : ''}</label>${inp}`;
      }).join('');
      const qtyRow = (q && q.on) ? `
        <label class="ap-lab">${E(q.label || '신청 수량')}${q.unit ? ` (${E(q.unit)})` : ''}</label>
        <input class="ap-in" id="apQty" type="number" min="0" inputmode="numeric"
          placeholder="${cap != null ? '최대 ' + cap : '숫자로 적어 주세요'}">
        <div class="ap-cap" id="apCap">${cap != null
          ? `신청할 수 있는 최대 <b>${cap}${E(q.unit || '')}</b>${why ? ` <span>(${E(why)})</span>` : ''}`
          : '경작 면적을 확인하면 받을 수 있는 최대 수량을 알려 드립니다.'}</div>
        <div class="ap-cap warn">신청한 수량이 그대로 나가지는 않습니다.
          <b>면적과 예산에 맞춰 자동으로 조정</b>되며, 최종 수량은 담당과 심사로 정해집니다.
          ${q.note ? E(q.note) : ''}</div>` : '';
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          <div class="sub-q" style="margin-top:2px">온라인 신청</div>
          ${rows || '<p class="sub-note">받을 정보가 정해지지 않았습니다.</p>'}
          ${qtyRow}
          ${cfg.agree !== false ? `<label class="ap-agree" id="apAgree"><input type="checkbox">
            적어 주신 내용을 이 사업 심사에 쓰는 데 동의합니다. 심사가 끝나면 지웁니다.</label>` : ''}
          <div class="sub-note">보내신 내용은 담당과가 확인합니다. 최종 자격은 담당과 심사로 정해집니다.</div>
        </div>
        ${foot('<button type="button" id="apGo" class="pri">접수하기</button><button type="button" id="apBack">뒤로</button>')}</div>`;
      wire();
      m.querySelector('#apBack').onclick = () => renderResult({ r: 'ok' });
      const qi = m.querySelector('#apQty');
      if (qi && cap != null) qi.oninput = () => {
        if (qi.value !== '' && +qi.value > cap) {
          qi.value = cap;
          const c = m.querySelector('#apCap');
          c.classList.add('cut');
          c.innerHTML = `신청하신 수량이 한도를 넘어 <b>${cap}${E(q.unit || '')}</b>로 맞췄습니다.` +
            (why ? ` <span>(${E(why)})</span>` : '');
        }
      };
      const ag = m.querySelector('#apAgree');
      if (ag) ag.onclick = () => ag.classList.toggle('on', ag.querySelector('input').checked);
      m.querySelector('#apGo').onclick = async () => {
        const d = {}; let miss = '';
        m.querySelectorAll('.ap-in').forEach(el => {
          d[el.dataset.k] = el.value.trim();
          const f = A[el.dataset.k];
          if (f && f.required && !el.value.trim() && !miss) miss = f.label;
        });
        if (miss) { alert(miss + '을(를) 적어 주세요.'); return; }
        if (ag && !ag.querySelector('input').checked) { alert('동의에 표시해 주세요.'); return; }
        if (qi) {
          if (qi.value === '') { alert((q.label || '신청 수량') + '을(를) 적어 주세요.'); return; }
          d.qty = (cap != null ? Math.min(+qi.value, cap) : +qi.value) + (q.unit || '');
          if (why) d.qtyWhy = why;
        }
        const btn = m.querySelector('#apGo'); btn.disabled = true; btn.textContent = '접수 중…';
        const rec = { sid: sub.id, title: sub.title, dept: sub.dept, data: d, agrix, capacity: cfg.capacity || null };
        const res = window.LABAPI ? await LABAPI.apply(rec)
          : { ok: true, no: 'B-LOCAL-' + (applyLog().length + 1) };
        if (!res.ok) { btn.disabled = false; btn.textContent = '접수하기'; alert(res.why); return; }
        const keep = { ...prof() }; Object.keys(d).forEach(k => { if (k !== 'memo' && k !== 'qty') keep['ap_' + k] = d[k]; });
        saveProf(keep);
        m.innerHTML = `<div class="mbox">${head}
          <div class="sub-body">
            <div class="sub-verdict ok">접수했습니다.<br><span style="font-weight:400">접수번호 <b>${E(res.no)}</b></span></div>
            ${d.qty ? `<p class="sub-note">신청 수량 <b>${E(d.qty)}</b>${
              why ? ` — ${E(why)} 기준으로 맞췄습니다.` : ''}<br>
              최종 수량은 면적·예산에 따라 담당과가 다시 정합니다.</p>` : ''}
            <p class="sub-note">담당과가 확인한 뒤 연락드립니다. 접수번호를 적어 두세요.
              ${sub.dept ? E(sub.dept) + ' ' : ''}${H.tel ? E(H.tel) : ''}</p>
          </div>${foot('')}</div>`;
        wire();
      };
    }

    renderAsk();
    m.classList.add('open');
  }

  /* ── 목록에서 찾을 수 있게 ──
     검수된 사업만 문답이 열리는데, 목록에서는 어느 것이 그런지 알 수 없어
     '아무것도 안 바뀐 것 같다'는 인상을 준다. 카드 제목 옆에 작은 표식을 단다.
     index.html 을 더 고치지 않으려고 여기서 목록 변화를 지켜보며 붙인다. */
  /* 테스트본에서는 검수 여부와 무관하게, 조건이 1개 이상 뽑힌 사업 전부에 문답을 연다.
     (운영 반영 시에는 reviewed 관문을 되살려야 한다 — 지시서 §4.4)
     검수 안 된 것은 결과 화면에 '자동으로 읽은 초안' 경고를 함께 붙인다. */
  /* 물을 것이 있거나, 물을 건 없어도 온라인 접수를 받는 사업이면 연다 */
  const askable = it => { const c = cfgOf(it);
    return (c.fields || []).some(f => f.on !== false) || !!c.online; };
  const onlineOK = it => !!cfgOf(it).online;
  const okKeys = new Set(DATA.filter(askable).map(i => i.issueKey));
  /* 카드 제목만으로는 같은 사업의 다른 연도와 헷갈린다 — 현안 키로 맞춘다 */
  let titleSet = null, onlineTitles = null;
  const onlineKeys = new Set(DATA.filter(onlineOK).map(i => i.issueKey));
  function reviewedTitles() {
    if (titleSet || !window.BWUI || !BWUI.api || !BWUI.api.issues) return titleSet;
    titleSet = new Set(BWUI.api.issues.filter(i => okKeys.has(i.key)).map(i => i.title.trim()));
    onlineTitles = new Set(BWUI.api.issues.filter(i => onlineKeys.has(i.key)).map(i => i.title.trim()));
    return titleSet;
  }
  /* 관리자 설정이 바뀌면(다른 탭에서 저장) 표식을 다시 계산한다 */
  addEventListener('storage', e => { if (e.key === 'bhlab.admin.cfg') location.reload(); });
  /* 담당자가 관리자 화면에서 정한 설정을 테스트 서버에서 받아 온다 */
  if (window.LABAPI && window.SUBCFG) LABAPI.pullCfg().then(r => {
    SUBCFG.setAll(r.cfg);
    titleSet = null;                       /* 표식을 다시 계산 */
    /* 엔진이 아직 시작 전이면 기다렸다 다시 그린다 —
       설정을 먼저 받아 놓고 render() 를 부르면 CFG 가 없어 터진다 */
    (function redraw(n) {
      const ready = window.BWUI && BWUI.api && BWUI.api.issues && BWUI.api.issues.length;
      if (ready) { try { BWUI.api.render(); } catch (e) { } return; }
      if (n < 40) setTimeout(() => redraw(n + 1), 250);
    })(0);
  });
  function markCards() {
    const T = reviewedTitles(); if (!T) return;
    document.querySelectorAll('#bwCards .card h3').forEach(h => {
      if (h.dataset.subMark) return;
      h.dataset.subMark = '1';
      if (!T.has(h.textContent.trim())) return;
      const b = document.createElement('span');
      const on = onlineTitles && onlineTitles.has(h.textContent.trim());
      b.className = 'sub-badge' + (on ? ' apply' : '');
      b.textContent = on ? '바로 접수' : '조건 확인';
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
    /* 목록 소팅 — 이 현안이 지금 바로 온라인 접수 되는가 */
    canApplyNow(iss) {
      const sub = byKey[iss.key]; if (!sub || !onlineOK(sub)) return false;
      const end = cfgOf(sub).applyEnd || sub.conditions.applyEnd;
      const today = window.BWUI ? BWUI.api.today : new Date().toISOString().slice(0, 10);
      return !end || end >= today;
    },
    mount(iss, foot, H) {
      const sub = byKey[iss.key]; if (!sub) return;
      const row = foot.querySelector('div');   /* [알림 받기][문의] 줄 */
      if (!row) return;
      if (askable(sub)) {
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
