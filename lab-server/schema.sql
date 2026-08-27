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
