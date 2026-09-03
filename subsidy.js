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
   - 판이 둘이다(lab-mode.js). 🔗연동판은 경영체 정보를 불러오고, ✋수기판은 불러오지 않는다.
     화면 흐름·질문·접수함은 같고, '확인이 어디서 일어나는가'만 다르다.
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
  /* 지금 어느 판인가 — lab-mode.js 가 없으면 예전처럼 연동판으로 본다 */
  const apiMode = () => !window.LABMODE || LABMODE.isApi();

  function judgeFields(fields, a) {
    const fails = [], unknown = [];
    /* 기초생활수급·차상위는 '둘 중 하나면 되는' 자격이다.
       둘 다 물었을 때 하나만 '예'여도 통과 — 둘 다 '아니오'일 때만 떨어진다.
       (장애인·한부모는 다르다 — 그 사업이 꼭 그 대상을 찾는 것이라 하나씩 본다) */
    const QUAL = ['basicBnf', 'nearPoor'];
    const qualFs = fields.filter(f => QUAL.includes(f.k));
    let skipQual = false;
    if (qualFs.length > 1) {
      skipQual = true;
      const vals = qualFs.map(f => a[f.k]);
      if (!vals.includes('yes')) {
        if (vals.every(v => v === 'no')) fails.push('수급 자격(기초생활수급·차상위 중 하나)');
        else if (qualFs.some(f => f.required !== false)) unknown.push('수급 자격');
      }
    }
    fields.forEach(f => {
      if (skipQual && QUAL.includes(f.k)) return;
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
    /* 이 사업의 자격 항목을 가장 많이 덮는 정보 제공처를 고른다.
       농업 항목이면 경영체 정보, 복지 항목이면 복지자격 정보 — 뼈대는 같다. */
    const PROV = (function () {
      let best = null, bn = 0;
      (window.BW_PROVIDERS || []).forEach(pr => {
        const n = fields.filter(f => pr.covers(f.k)).length;
        if (n > bn) { bn = n; best = pr; }
      });
      return best;
    })();
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
      const API = apiMode();
      const agrixable = !!PROV;
      const useAgrix = API && agrixable;
      /* 연동판에서는 '불러올 것'을 묻지 않는다 — 끌어오기 전에도 묻지 않는다.
         불러오기 단추 바로 밑에서 "등록을 하셨나요?"를 또 물으면,
         주민은 무엇을 해야 하는지 알 수 없다. 불러오면 알게 되는 것은 불러와서 안다.
         연동판에서 질문이 사라지는 그 모습 자체가 연동이 하는 일이다. */
      const covered = f => useAgrix && PROV.covers(f.k);
      const done = fields.filter(f => agrix && covered(f));
      const rest = fields.filter(f => !covered(f));
      const qs = rest.map(f => {
        const label = window.SUBCFG ? SUBCFG.qText(f) : f.q;
        if (f.k === 'age' || f.k === 'farmArea')
          return `<div class="sub-q">${E(label)}</div>
            <div class="sub-opts"><input class="sub-age" data-k="${f.k}" type="number" step="${f.k === 'farmArea' ? '0.01' : '1'}"
              inputmode="decimal" placeholder="${f.k === 'age' ? '예: 45' : '예: 0.5'}" value="${E(a[f.k])}">
              <span style="align-self:center">${num(f)}</span></div>`;
        return `<div class="sub-q">${E(label)}</div>
          <div class="sub-opts" data-k="${f.k}">
            <button type="button" data-v="yes">예</button><button type="button" data-v="no">아니오</button>
            <button type="button" data-v="idk">모르겠음</button></div>`;
      }).join('');
      /* 무엇이 그 정보로 갈음됐는지는 밝혀 둔다 — 묻지도 않고 넘어가면
         주민은 자기가 무엇으로 판정받는지 모른 채 결과를 받는다 */
      const doneNote = done.length
        ? `<div class="sub-done">${PROV.icon} 위 정보로 <b>${done.length}가지</b>가 확인되어 여쭙지 않았습니다
             <span>${E(done.map(f => (window.SUBCFG && SUBCFG.FIELDS[f.k] && SUBCFG.FIELDS[f.k].label) || f.k).join(' · '))}</span></div>`
        : '';
      /* 물을 것이 없고 아직 안 불러왔으면 [결과 보기]를 둘 이유가 없다 —
         불러오기가 곧 결과다. 누를 수 없는 단추를 두면 그것부터 눌러 보게 된다. */
      const needGo = rest.length > 0 || (!useAgrix) || !!agrix;
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          ${useAgrix && !agrix ? `<button type="button" id="subAgrix" class="sub-agrix">${PROV.icon} ${E(PROV.btn)}
            <span>${E(PROV.btnSub)}</span></button>` : ''}
          ${!API && agrixable ? `<div class="sub-manual">✋ 이 화면은 <b>${E(PROV.name)}를 불러오지 않습니다.</b>
            <span>기억나는 대로 적어 주세요.
            적어 주신 내용은 담당자가 나중에 대장과 대조합니다.</span></div>` : ''}
          ${agrix ? agrixCard(agrix) : ''}
          ${doneNote}
          ${qs || (useAgrix && !agrix
            ? '<p class="sub-note">위 단추를 누르면 본인 확인을 거쳐 바로 결과를 보여 드립니다.</p>'
            : '<p class="sub-note">물을 항목이 없습니다.</p>')}
          ${rest.length ? '<div class="sub-note">답은 이 휴대폰에만 저장됩니다.</div>' : ''}</div>
        ${foot(needGo ? '<button type="button" id="subGo" class="pri">결과 보기</button>' : '')}</div>`;
      wire();
      m.querySelectorAll('.sub-opts[data-k] button').forEach(b => {
        const k = b.parentElement.dataset.k;
        if (a[k] === b.dataset.v) b.classList.add('on');
        b.onclick = () => { a[k] = b.dataset.v;
          b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      });
      const ab = m.querySelector('#subAgrix'); if (ab) ab.onclick = agrixFlow;
      const go = m.querySelector('#subGo');
      if (go) go.onclick = () => {
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
        <div class="t">${PROV.icon} ${E(PROV.name)} <span class="mockflag">화면 목업</span></div>
        ${PROV.cardRows(g).map(r =>
          `<div class="g"><span>${E(r[0])}</span><b${r[2] ? ` class="${r[2]}"` : ''}>${E(r[1])}</b></div>`).join('')}
      </div>`;
    }
    async function agrixFlow() {
      const pickHtml = PROV.SAMPLE.map((s, i) =>
        `<button type="button" class="callbtn" data-p="${i}" style="margin-bottom:6px">${E(PROV.pickLabel(s))}</button>`).join('');
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          <div class="sub-q">본인 확인</div>
          <p class="sub-note" style="margin-top:0">실제로는 휴대폰 간편인증으로 본인을 확인합니다.
            <b>이 화면은 목업이라</b> 아래에서 시험용 사례를 하나 고르시면 됩니다.</p>
          <div style="display:flex;flex-direction:column;gap:2px">${pickHtml}</div>
        </div>${foot('')}</div>`;
      wire();
      m.querySelectorAll('[data-p]').forEach(b => b.onclick = async () => {
        m.querySelector('.sub-body').innerHTML = '<p class="sub-note">본인 확인 중입니다…</p>';
        const got = await PROV.verify(+b.dataset.p);
        /* 대장에 없는 사람도 있다 — 그때는 '없다'고 말해 주고 담당과로 보낸다.
           빈 화면이나 '해당 없음'으로 끝내면 왜 안 되는지 알 수 없다. */
        if (!got || got.found === false) { renderNotFound(); return; }
        agrix = got;
        Object.assign(a, PROV.toAnswers(agrix, fields));
        /* 불러온 것으로 다 채워졌으면 곧장 결과로 — 한 번 더 누르게 할 이유가 없다.
           아직 물을 것이 남았을 때만 질문 화면으로 되돌아간다. */
        const rest = fields.filter(f => !PROV.covers(f.k));
        if (rest.length) renderAsk();
        else renderResult(judgeFields(fields, a));
      });
    }

    /* 정보가 조회되지 않을 때 */
    function renderNotFound() {
      const tel = H.tel || '';
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          <div class="sub-verdict ask">${PROV.icon} ${E(PROV.name)}가 확인되지 않습니다.</div>
          <p class="sub-note">등록이 되어 있지 않거나, 이름·생년월일이 대장과 다를 수 있습니다.
            등록을 하셨는데도 이렇게 나오면 담당과로 문의해 주세요.</p>
          ${tel ? `<div class="sub-follow"><a class="callbtn" href="tel:${E(tel)}">📞 담당과 전화</a></div>` : ''}
        </div>
        ${foot('<button type="button" id="subRetry">다시 해 보기</button>')}</div>`;
      wire();
      m.querySelector('#subRetry').onclick = agrixFlow;
    }

    /* ── ② 결과 ── */
    function renderResult(v, stay) {
      const today = window.BWUI ? BWUI.api.today : new Date().toISOString().slice(0, 10);
      const tel = H.tel || '';
      /* 담당자가 관리자 화면에서 정한 마감일이 원문보다 앞선다 */
      const endD = cfg.applyEnd || c.applyEnd;
      const closed = endD && dday(endD, today) < 0;
      const full = false;   /* 정원은 서버가 접수 순간에 다시 센다 — 기기별로 세면 동시에 넘어간다 */
      const already = window.LABAPI ? LABAPI.mine(sub.id) : applyLog().some(r => r.id === sub.id);
      let body = '';
      if (v.r === 'no') {
        body = `<div class="sub-verdict no">${E(v.fails.join(', '))} 조건에서 해당되지 않습니다.</div>
          <p class="sub-note">조건이 맞지 않아 온라인 접수는 열리지 않습니다.
            사정이 다르다고 보시면 담당과로 문의하세요.</p>
          ${tel ? `<div class="sub-acts"><a class="callbtn" href="tel:${E(tel)}">📞 담당과 전화</a></div>` : ''}`;
      } else if (v.r === 'ask') {
        body = `<div class="sub-verdict ask">자동으로 판단할 수 없습니다. 담당과에 문의하세요.<br>
            <span style="font-weight:400">확인이 필요한 것: ${E(v.unknown.join(', '))}</span></div>
          ${tel ? `<div class="sub-acts"><a class="callbtn" href="tel:${E(tel)}">📞 담당과 전화</a></div>` : ''}`;
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
        /* 연동으로 확인한 건은 바로 밑 카드가 이미 출처를 말하고 있다 —
           같은 말을 한 줄 더 얹지 않는다. 본인 진술만은 밝혀 둔다(대신 말해 줄 카드가 없다). */
        const src = (apiMode() && agrix && PROV) ? ''
          : '<div class="sub-src">✋ 적어 주신 내용(본인 진술)만으로 본 결과입니다. 담당자가 서류로 다시 확인합니다.</div>';

        /* ── 여기서 할 수 있는 일 세 가지 ──
           예전에는 [온라인 신청]만 아래 발자리에 있고 전화·알림은 본문에 있어서,
           같은 줄에 있어야 할 것이 두 군데로 갈라져 있었다. 한자리에 모은다. */
        const canIcs = endD && !closed;
        let why = '';
        if (cfg.online) {
          if (already) why = '이미 이 사업에 접수하셨습니다.';
          else if (closed) why = '접수 기간이 지나 온라인 접수가 닫혔습니다.';
          else if (full) why = `접수 정원(${cfg.capacity}명)이 찼습니다. 담당과로 문의하세요.`;
        }
        const canApply = cfg.online && !already && !closed && !full;
        /* 신청할 수 있는 사람에게 '결과'를 한 번 더 보여 주고 또 누르게 할 이유가 없다.
           바로 신청서로 보낸다 — 자격 확인 내용은 신청서 맨 위에 그대로 얹는다. */
        if (canApply && !stay) { renderApply(v); return; }
        const acts = `<div class="sub-acts">
          ${canApply ? '<button type="button" id="subApply" class="pri">📝 온라인 신청</button>' : ''}
          <div class="row">
            ${tel ? `<a class="callbtn" style="flex:1" href="tel:${E(tel)}">📞 담당과 전화</a>` : ''}
            ${canIcs ? `<button type="button" id="subIcs" class="callbtn" style="flex:1;background:var(--paper);color:var(--acc);border:1.5px solid var(--acc)">🔔 마감 알림</button>` : ''}
          </div>
          ${why ? `<p class="sub-note" style="margin-top:2px">${E(why)}</p>` : ''}
        </div>`;

        /* 온라인 접수를 안 받는 사업이라 여기까지 온 것 — 어디서 어떻게 내는지가 답이다.
           '신청 전에 담당과에 확인하세요' 는 뺐다. 확인하러 전화하는 일 자체가
           농민에게도 담당자에게도 일이다. */
        body = `<div class="sub-verdict ok">해당됩니다. 아래 방법으로 신청하세요.</div>
          ${src}
          ${follow ? `<div class="sub-follow">${follow}</div>` : ''}
          ${acts}`;
      }
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">${body}
          ${agrix ? agrixCard(agrix) : ''}
          <div class="sub-raw"><details><summary>근거 원문 보기</summary><pre>${E(sub.rawLines.join('\n'))}</pre></details></div>
          <div class="sub-note">${sub.status !== 'reviewed'
            ? '계획서에서 자동으로 읽은 초안이에요. 최종 자격은 담당과 심사로 정해집니다.'
            : '최종 자격은 담당과 심사로 정해집니다.'}</div></div>
        ${foot(fields.some(f => !(apiMode() && PROV && PROV.covers(f.k)))
          ? '<button type="button" id="subBack">다시 답하기</button>' : '')}</div>`;
      wire();
      const bk = m.querySelector('#subBack'); if (bk) bk.onclick = renderAsk;
      const ap = m.querySelector('#subApply'); if (ap) ap.onclick = renderApply;
      /* 정원이 있는 사업이면 몇 자리 남았는지 서버에 물어 본다.
         답이 늦게 와도 화면이 이미 넘어갔으면(다시 답하기 등) 붙이지 않는다. */
      if (cfg.online && cfg.capacity && window.LABAPI && v.r === 'ok' && !already && !closed) {
        LABAPI.count(sub.id).then(n => {
          if (n == null || !m.querySelector('#subBack')) return;
          const left = cfg.capacity - n;
          const box = document.createElement('p'); box.className = 'sub-note';
          if (left <= 0) {
            const b2 = m.querySelector('#subApply'); if (b2) b2.remove();
            box.innerHTML = `접수 정원(${cfg.capacity}명)이 찼습니다.
              <b>심사 과정에서 정원이 늘어날 수 있으니</b> 담당과에 문의해 보세요.`;
          } else {
            box.innerHTML = `정원 ${cfg.capacity}명 중 <b>${n}명</b>이 접수했습니다 — 남은 자리 <b>${left}</b>`;
          }
          const sb = m.querySelector('.sub-body'); if (sb) sb.appendChild(box);
        });
      }
      const ib = m.querySelector('#subIcs');
      if (ib) ib.onclick = () => {
        const fake = { _id: 'sublab:' + sub.id, title: '[신청 마감] ' + sub.title, dept: sub.dept,
          list: [{ week: sub.week, item: { title: sub.title, lines: [{ lv: 1, txt: `기간: ${endD.replace(/-/g, '. ')}.` }] } }] };
        const txt = icsWithAlarms(H, fake, endD, sub.title);
        if (txt) H.downloadICS(txt, '봉화군_마감알림_' + sub.id + '.ics');
      };
    }

    /* ── ③ 온라인 접수 ──
       자격 확인을 거쳐 바로 들어오는 자리다. 그래서 맨 위에 '무엇으로 확인됐는지'를
       한 번 더 얹는다 — 결과 화면을 건너뛰었으니 여기서 그 자리를 대신해야 한다. */
    function renderApply(v) {
      const A = window.SUBCFG ? SUBCFG.ASK : {};
      const pre = prof();
      const q = cfg.qty;
      const areaHa = (agrix && agrix.area != null) ? agrix.area : (a.farmArea || null);
      const cap = window.SUBCFG ? SUBCFG.qtyCap(q, areaHa) : null;
      const why = window.SUBCFG ? SUBCFG.qtyWhy(q, areaHa) : '';
      const rows = cfg.ask.map(k => {
        const f = A[k]; if (!f) return '';
        let val = pre['ap_' + k] || '';
        if (agrix && PROV) { const pf = PROV.prefill(agrix); if (pf[k]) val = pf[k]; }
        const inp = f.type === 'textarea'
          ? `<textarea class="ap-in" data-k="${k}" rows="3">${E(val)}</textarea>`
          : `<input class="ap-in" data-k="${k}" type="${f.type}" value="${E(val)}" placeholder="${E(f.ph || '')}">`;
        return `<label class="ap-lab">${E(f.label)}${f.required ? ' <b>*</b>' : ''}</label>${inp}`;
      }).join('');
      /* ── 얼마까지 신청할 수 있나 ──
         적는 칸보다 한도가 먼저다. 얼마까지 되는지 모르고 숫자를 적으면
         적어 놓고 깎이는 일이 생긴다. 근거(면적·1인 한도)도 함께 적는다. */
      const qtyRow = (q && q.on) ? `
        <div class="ap-quota${cap != null ? '' : ' unknown'}">
          <div class="t">신청할 수 있는 ${E(q.label || '양')}</div>
          ${cap != null
            ? `<div class="n">${cap}<span>${E(q.unit || '')}</span></div>
               ${why ? `<div class="w">${E(why)}</div>` : ''}`
            : '<div class="w">경작 면적이 확인되면 받을 수 있는 최대 수량을 알려 드립니다.</div>'}
        </div>
        <label class="ap-lab">얼마나 신청하시겠어요?${q.unit ? ` (${E(q.unit)})` : ''}</label>
        <input class="ap-in" id="apQty" type="number" min="0" step="any" inputmode="decimal"
          value="${cap != null ? cap : ''}"
          placeholder="${cap != null ? '최대 ' + cap : '숫자로 적어 주세요'}">
        <div class="ap-cap" id="apCap">${cap != null
          ? `한도만큼 적어 두었습니다. <b>덜 필요하시면 고쳐 주세요.</b>`
          : ''}</div>
        <div class="ap-cap warn">신청한 수량이 그대로 나가지는 않습니다.
          <b>면적과 예산에 맞춰 자동으로 조정</b>되며, 최종 수량은 담당과 심사로 정해집니다.
          ${q.note ? E(q.note) : ''}</div>` : '';
      const today = window.BWUI ? BWUI.api.today : new Date().toISOString().slice(0, 10);
      const endD = cfg.applyEnd || c.applyEnd;
      const dleft = endD ? dday(endD, today) : null;
      /* 결과 화면을 건너뛰고 왔으므로, 무엇으로 자격이 확인됐는지를 여기 얹는다 */
      const okLine = (apiMode() && agrix && PROV)
        ? '<div class="ap-ok">✅ 자격이 확인되었습니다</div>' + agrixCard(agrix)
        : `<div class="ap-ok self">✅ 신청하실 수 있습니다
             <span>✋ 적어 주신 내용 기준입니다. 담당자가 서류로 다시 확인합니다.</span></div>`;
      m.innerHTML = `<div class="mbox">${head}
        <div class="sub-body">
          ${okLine}
          ${endD && dleft != null ? `<div class="sub-follow"><div>신청 마감까지
            <b>${dleft === 0 ? '오늘까지' : dleft + '일'}</b> 남았습니다. (마감 ${E(endD)})</div></div>` : ''}
          ${qtyRow}
          <div class="sub-q" style="margin-top:16px">신청서</div>
          ${!apiMode() && cfg.ask.includes('farmNo')
            ? '<div class="sub-manual">등록번호를 모르시면 비워 두셔도 됩니다 — 담당자가 대장에서 찾습니다.</div>' : ''}
          ${rows || '<p class="sub-note">받을 정보가 정해지지 않았습니다.</p>'}
          ${cfg.agree !== false ? `<label class="ap-agree" id="apAgree"><input type="checkbox">
            적어 주신 내용을 이 사업 심사에 쓰는 데 동의합니다. 심사가 끝나면 지웁니다.</label>` : ''}
          <div class="sub-acts" style="margin-top:16px">
            <button type="button" id="apGo" class="pri">📨 신청서 제출</button>
            ${H.tel ? `<a class="callbtn" href="tel:${E(H.tel)}"
              style="background:var(--paper);color:var(--acc);border:1.5px solid var(--acc)">📞 담당과에 문의하기</a>` : ''}
          </div>
          <div class="sub-note">보내신 내용은 담당과가 확인합니다. 최종 자격은 담당과 심사로 정해집니다.</div>
        </div>
        ${foot('<button type="button" id="apBack">자세히 보기</button>')}</div>`;
      wire();
      m.querySelector('#apBack').onclick = () => renderResult({ r: 'ok' }, true);
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
        const btn = m.querySelector('#apGo'); btn.disabled = true; btn.textContent = '보내는 중…';
        /* 담당자 화면이 두 판을 견주려면 건마다 '어느 판·무엇을 보고 통과했는지'가 남아야 한다 */
        const rec = { sid: sub.id, title: sub.title, dept: sub.dept, data: d, agrix,
          capacity: cfg.capacity || null,
          mode: apiMode() && agrix ? 'api' : 'manual',
          verify: (apiMode() && agrix && PROV)
            ? { ...PROV.brief(agrix),
                fields: fields.filter(f => PROV.covers(f.k)).map(f => f.k) }
            : { by: 'self', fields: fields.map(f => f.k) } };
        const res = window.LABAPI ? await LABAPI.apply(rec)
          : { ok: true, no: 'B-LOCAL-' + (applyLog().length + 1) };
        if (!res.ok) {
          btn.disabled = false; btn.textContent = '📨 신청서 제출';
          if (res.full) {
            /* 방금 마지막 자리가 나갔다 — 왜 안 되는지, 그다음 어디로 가는지를 그 자리에서 */
            const sb = m.querySelector('.sub-body');
            if (sb && !sb.querySelector('.sub-full')) sb.insertAdjacentHTML('afterbegin',
              `<div class="sub-verdict no sub-full">접수 정원이 찼습니다.<br>
                <span style="font-weight:400">심사에서 빠지는 분이 있거나 물량이 늘면 정원이 다시 열릴 수 있습니다.
                담당과에 문의해 보세요.</span></div>`);
          } else alert(res.why);
          return;
        }
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
