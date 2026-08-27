/* ═══════════════════════════════════════════════════════════════
   agrix-mock.js — 농업경영체 정보 확인 '화면 목업'

   ※ 실제 농업경영체 통합정보시스템(Agrix)에 연결하지 않는다.
      네트워크 호출도, 엔드포인트도, 호출 스텁도 이 파일에 없다.
      아래 표는 이 파일 안에 든 가짜 자료이며, 연결이 됐다고 가정한
      화면 흐름(간편인증 → 조회 → 결과 반영)만 보여 준다.
      실제 연결은 농림축산식품부·농정원에 공문으로 이용신청 후
      심의·협약을 거쳐야 하며, 그 전에는 어떤 코드도 두지 않는다.
   ═══════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';
  /* 시험용 가짜 경영체 — 이름 끝자리로 아무나 하나 고르게 한다 */
  const SAMPLE = [
    { no: '3145-2021-000812', name: '홍길동', status: '정상', statusAt: '2026-03-14',
      addr: '경상북도 봉화군 봉화읍 내성리', area: 1.24,
      crops: ['벼', '고추'], since: '2016-04-02', region: '봉화군' },
    { no: '3145-2019-004417', name: '김봉화', status: '정상', statusAt: '2026-01-08',
      addr: '경상북도 봉화군 물야면 오전리', area: 0.42,
      crops: ['사과'], since: '2019-06-11', region: '봉화군' },
    { no: '3145-2023-001190', name: '이서준', status: '휴업', statusAt: '2025-11-20',
      addr: '경상북도 안동시 풍천면', area: 0.85,
      crops: ['콩'], since: '2023-02-15', region: '안동시' },
  ];

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* 간편인증 → 조회. 실제로는 아무 데도 가지 않고 위 표에서 고른다. */
  async function verify(pick) {
    await delay(700);                       /* 인증 기다리는 느낌만 */
    const r = SAMPLE[pick] || SAMPLE[0];
    await delay(500);
    return JSON.parse(JSON.stringify(r));
  }

  /* 조회 결과를 자격 항목에 자동으로 채워 넣는다 */
  function toAnswers(info) {
    return {
      farm: info.status === '정상' ? 'yes' : 'no',
      farming: info.status === '정상' ? 'yes' : 'no',
      farmArea: String(info.area),
      _agrix: info,
    };
  }
  /* 자동으로 채울 수 있는 항목인가 */
  function covers(k) { return k === 'farm' || k === 'farming' || k === 'farmArea'; }

  G.AGRIX_MOCK = { SAMPLE, verify, toAnswers, covers };
})(window);
