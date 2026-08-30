-- 테스트본 전용 저장소 (운영 통계 bonghwa-stat 과 완전히 별개)
CREATE TABLE IF NOT EXISTS cfg (
  id   TEXT PRIMARY KEY,      -- 사업 id (sub_xxxxxxxx)
  json TEXT NOT NULL,         -- 관리자가 정한 설정
  at   TEXT NOT NULL,         -- 마지막 저장 시각
  by   TEXT DEFAULT ''        -- 저장한 사람이 적어 둔 이름(선택)
);
CREATE TABLE IF NOT EXISTS apply (
  no    TEXT PRIMARY KEY,     -- 접수번호
  sid   TEXT NOT NULL,        -- 사업 id
  title TEXT NOT NULL,
  dept  TEXT DEFAULT '',
  at    TEXT NOT NULL,
  data  TEXT NOT NULL,        -- 주민이 적은 항목
  agrix TEXT DEFAULT ''       -- 경영체 조회 결과(목업)
);
CREATE INDEX IF NOT EXISTS ix_apply_sid ON apply(sid);

-- ══════════════════════════════════════════════════════════════
-- 장터 — 판매자 등록제 + 자율정화 (2026-08)
--
-- 관리자가 상시로 보지 않는다. 그래서 세 가지에 기댄다.
--   ① 모든 것에 수명이 있다 (마감·종료·파기가 저절로 온다)
--   ② 신고는 '가림'이지 '삭제'가 아니다 (게시자가 고치면 저절로 풀린다)
--   ③ 무응답은 저절로 정리된다 (72시간 뒤 종료)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS seller (
  id      TEXT PRIMARY KEY,      -- s_xxxxxxxx
  no      TEXT NOT NULL,         -- 판매자번호 '0142' (본인 확인·재발급 문의용)
  nick    TEXT NOT NULL,         -- 화면에 뜨는 표시명 (본인이 정한다)
  keyhash TEXT NOT NULL,         -- 수정키 해시. 원본은 어디에도 저장하지 않는다
  name    TEXT NOT NULL,         -- 실명   ┐ 분쟁 때 연락하려고 둔다.
  phone   TEXT NOT NULL,         -- 휴대폰 ┘ 공개 주소로는 절대 나가지 않는다
  town    TEXT DEFAULT '',       -- 면·리
  crops   TEXT DEFAULT '',       -- 주로 파는 품목
  agrix   TEXT DEFAULT '',       -- 농업경영체 등록번호(적어 낸 경우)
  memo    TEXT DEFAULT '',
  state   TEXT NOT NULL DEFAULT '승인',  -- 승인|정지|탈퇴
  until   TEXT DEFAULT '',       -- 정지가 풀리는 시각 (비면 무기한)
  done    INTEGER DEFAULT 0,     -- 무사히 끝낸 거래 — 이것으로 등급이 오른다
  holds   INTEGER DEFAULT 0,     -- 자동 가림을 당한 횟수
  at      TEXT NOT NULL,         -- 등록 시각
  seenAt  TEXT DEFAULT ''        -- 마지막 활동 (90일 지나면 연락처를 지운다)
);
CREATE INDEX IF NOT EXISTS ix_seller_state ON seller(state);
CREATE UNIQUE INDEX IF NOT EXISTS ux_seller_phone ON seller(phone);

CREATE TABLE IF NOT EXISTS market (
  id      TEXT PRIMARY KEY,      -- m_xxxxxxxx
  seller  TEXT NOT NULL DEFAULT '',
  nick    TEXT NOT NULL DEFAULT '',  -- 그때의 표시명 (이름을 바꿔도 지난 글은 그대로)
  data    TEXT NOT NULL,         -- 품목·가격·수량·마감 등
  state   TEXT NOT NULL DEFAULT '판매중',  -- 판매중|수확예정|확인중|마감|종료|삭제됨
  prev    TEXT DEFAULT '',       -- 확인중이 되기 직전의 상태 (복귀할 자리)
  sold    INTEGER DEFAULT 0,     -- 주문 들어온 수량
  holds   INTEGER DEFAULT 0,     -- 확인중이 된 횟수. 3이면 그 글은 끝난다
  heldAt  TEXT DEFAULT '',       -- 확인중이 된 시각 (+72시간이면 자동 종료)
  backAt  TEXT DEFAULT '',       -- 복귀한 시각
  showAt  TEXT DEFAULT '',       -- 이 시각이 지나야 목록에 뜬다 (첫 글 24시간)
  notice  TEXT DEFAULT '',       -- 게시자에게 보일 통보
  photos  TEXT DEFAULT '[]',     -- 사진 이름들. 사진 자체는 R2 에 있다 (최대 3장)
  phold   INTEGER DEFAULT 0,     -- 사진 신고로 가려졌는가 (글은 그대로 둔다)
  at      TEXT NOT NULL,
  edited  TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_market_state ON market(state);
CREATE INDEX IF NOT EXISTS ix_market_seller ON market(seller);

-- 신고. 지우는 장치가 아니라 '가리고 알리는' 장치다.
CREATE TABLE IF NOT EXISTS report (
  id      TEXT PRIMARY KEY,
  mid     TEXT NOT NULL,         -- 신고당한 글
  dev     TEXT NOT NULL,         -- 신고한 기기 (임의의 값. 누구인지는 모른다)
  why     TEXT NOT NULL,         -- photo|privacy|banned|false|soldout
  at      TEXT NOT NULL,
  state   TEXT NOT NULL DEFAULT '유효',  -- 유효|해소|이의|무효
  judgeAt TEXT DEFAULT '',       -- 이의가 들어온 신고를 다시 볼 시각 (+7일)
  holdsAt INTEGER DEFAULT 0      -- 이의 시점의 holds — 그 뒤 또 가려졌으면 신고가 옳았다
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_report ON report(mid, dev);
CREATE INDEX IF NOT EXISTS ix_report_mid ON report(mid);

-- 신고를 무기로 쓰는 기기를 조용히 무력화한다. 알려주면 기기를 바꿔서 또 한다.
CREATE TABLE IF NOT EXISTS device (
  dev  TEXT PRIMARY KEY,
  bad  INTEGER DEFAULT 0,        -- 무고로 판정된 횟수. 3이면 가중치가 0이 된다
  at   TEXT DEFAULT ''
);
