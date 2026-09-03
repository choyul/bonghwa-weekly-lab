/* ═══════════════════════════════════════════════════════════════
   welfare-mock.js — 복지자격 정보 확인 '화면 목업'

   ※ 실제 사회보장정보시스템(행복e음)이나 어떤 복지 전산에도 연결하지 않는다.
      네트워크 호출도, 엔드포인트도 없다. 아래 표는 이 파일 안의 가짜 자료이며,
      연결이 됐다고 가정한 화면 흐름만 보여 준다.
      수급 자격은 민감한 개인정보다 — 실제 연계는 법적 근거·보안성 검토·
      보장기관 협의를 모두 거쳐야 하며, 그 전에는 어떤 코드도 두지 않는다.

   왜 이 파일이 있나 — 같은 구조가 농업에만 통하는 게 아니라는 것을 보이려고.
   농업은 농업경영체 정보(agrix-mock), 복지는 수급 자격 정보. 연결되는 정보가
   다를 뿐, '접수되는 자리에서 사실이 확인된다'는 뼈대는 하나다.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  /* 시험용 가짜 자격 — 이름·자격 모두 지어낸 것 */
  const SAMPLE = [
    { name: '박순애', quals: ['기초생활수급(생계·의료)'], since: '2023-04-01',
      statusAt: '2026-08-25', addr: '경상북도 봉화군 봉화읍 포저리', region: '봉화군',
      disab: false, singleP: false },
    { name: '김점례', quals: ['차상위계층'], since: '2024-11-12',
      statusAt: '2026-07-11', addr: '경상북도 봉화군 춘양면 의양리', region: '봉화군',
      disab: true, singleP: false },
    { name: '이만수', quals: [], since: '',
      statusAt: '2026-06-02', addr: '경상북도 영주시 휴천동', region: '영주시',
      disab: false, singleP: false },
    /* 전산에서 찾지 못하는 경우 — 화면이 말해 주지 않으면 왜 안 되는지 모른다 */
    { name: '조회되지 않는 경우', found: false },
  ];

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function verify(pick) {
    await delay(700);
    const r = SAMPLE[pick] || SAMPLE[0];
    await delay(500);
    return JSON.parse(JSON.stringify(r));
  }

  const has = (info, word) => (info.quals || []).some(q => q.includes(word));

  function toAnswers(info, fields) {
    const out = {
      basicBnf: has(info, '기초생활수급') ? 'yes' : 'no',
      nearPoor: has(info, '차상위') ? 'yes' : 'no',
      disab: info.disab ? 'yes' : 'no',
      singleP: info.singleP ? 'yes' : 'no',
      _welfare: info,
    };
    const res = (fields || []).find(f => f.k === 'residency');
    if (res) {
      const want = res.v || '봉화군';
      out.residency = (String(info.addr || '').includes(want) || info.region === want) ? 'yes' : 'no';
    }
    return out;
  }
  function covers(k) {
    return k === 'basicBnf' || k === 'nearPoor' || k === 'disab' || k === 'singleP' || k === 'residency';
  }

  G.WELFARE_MOCK = {
    id: 'welfare', icon: '🤝', name: '복지자격 정보', org: '사회보장정보(가정)',
    btn: '복지자격 정보 불러오기', btnSub: '수급·차상위 등 자격을 자동으로 확인합니다',
    SAMPLE, verify, toAnswers, covers,
    pickLabel: s => s.found === false ? `${s.name} — 전산에 없음`
      : `${s.name} · ${s.region} · ${s.quals.length ? s.quals.join(', ') : '자격 없음'}`,
    cardRows: g => [
      ['자격', g.quals.length ? g.quals.join(', ') : '해당 자격 없음', g.quals.length ? 'ok' : 'no'],
      ['기준일', g.statusAt, ''],
      ['장애인 등록', g.disab ? '있음' : '없음', ''],
      ['거주지', g.addr, ''],
    ],
    prefill: g => ({ addr: g.addr }),
    brief: g => ({ by: 'welfare', quals: g.quals, statusAt: g.statusAt, region: g.region,
                   addr: g.addr, disab: g.disab, singleP: g.singleP }),
  };
  (G.BW_PROVIDERS = G.BW_PROVIDERS || []).push(G.WELFARE_MOCK);
})(window);
