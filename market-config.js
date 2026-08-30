/* ═══════════════════════════════════════════════════════════════
   market-config.js — 장터 설정. 바뀌는 값은 전부 여기 한 곳에만 둔다.

   운영자가 구글 시트를 '웹에 게시(Publish to the web)'로 CSV 공개한 주소를 넣는다.
   설정 방법은 docs/market-operation.md 참고.
   ═══════════════════════════════════════════════════════════════ */
window.MARKET_CONFIG = {
  /* 개발 모드 — true 면 data/ 안의 샘플 CSV 를 읽는다.
     주소 뒤에 ?marketdev=1 을 붙여도 그때만 켤 수 있다. */
  dev: true,

  /* 탭 A(장터_판매) / 탭 B(장터_주문집계) 의 게시 CSV 주소 */
  sellCsv: '',
  orderCsv: '',

  /* 개발 모드에서 쓰는 샘플 */
  devSellCsv: 'data/sample_market.csv',
  devOrderCsv: 'data/sample_orders.csv',

  cacheMinutes: 5,          /* CSV 를 다시 받기까지 (§6) */
  soonHours: 6,             /* '마감 임박' 배지 기준 (§4-7) */
};
