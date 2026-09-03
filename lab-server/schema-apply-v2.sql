-- ══════════════════════════════════════════════════════════════
-- apply 표 2차 — 접수를 '받는 것'에서 '처리하는 것'으로 (2026-09)
--
-- 지금까지 접수는 쌓이기만 했다. 담당자가 주간업무를 하면서
-- 한 건씩 보고 처리 상태를 남길 자리가 없었다.
-- 이 파일은 그 자리를 만든다. 한 번만 돌리면 된다.
--
--   npx wrangler d1 execute bonghwa-lab --remote --file=schema-apply-v2.sql
--
-- 이미 있는 칸을 또 더하면 "duplicate column name" 으로 멈춘다.
-- 그때는 이미 적용된 것이니 그냥 두면 된다.
-- ══════════════════════════════════════════════════════════════

-- 처리 상태 — 접수 → 확인 → 선정|제외|보류
ALTER TABLE apply ADD COLUMN state   TEXT NOT NULL DEFAULT '접수';
-- 담당자가 남긴 말 (왜 제외했는지 등. 나중에 민원이 오면 이것만 본다)
ALTER TABLE apply ADD COLUMN note    TEXT DEFAULT '';
-- 누가 언제 그 상태로 바꿨나
ALTER TABLE apply ADD COLUMN by      TEXT DEFAULT '';
ALTER TABLE apply ADD COLUMN stateAt TEXT DEFAULT '';
-- 수기판에서 담당자가 손으로 대조한 항목들 {"경영체대장":1,"주소":1,...}
ALTER TABLE apply ADD COLUMN checks  TEXT DEFAULT '{}';
-- 이 건이 어느 판으로 들어왔나 — 'api'(경영체 연동) | 'manual'(수기)
ALTER TABLE apply ADD COLUMN mode    TEXT DEFAULT 'manual';
-- 연동판에서 서버가 판정한 결과 {"ok":true,"why":[...]}
ALTER TABLE apply ADD COLUMN verify  TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS ix_apply_state ON apply(state);
