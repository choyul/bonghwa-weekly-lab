# bonghwa-lab — 테스트본 전용 저장소

운영 통계(`bonghwa-stat`)와 **워커도 데이터베이스도 완전히 별개**다.
테스트 트래픽이 운영 통계에 섞이지 않는다.

- 주소: https://bonghwa-lab.balance-cho.workers.dev
- 관리자 코드: Cloudflare secret `ADMIN_CODE` (지금은 `bonghwa`)

## 다시 배포
    cd lab-server && npx wrangler deploy

## 표 만들기(처음 한 번)
    npx wrangler d1 execute bonghwa-lab --remote --file=schema.sql

## 주소
| 메서드 | 경로 | 누가 |
|---|---|---|
| GET | `/cfg` | 공개 — 주민 화면이 설정을 읽는다 |
| PUT | `/cfg` | 관리자 코드 |
| POST | `/apply` | 공개 — 온라인 접수 |
| GET | `/apply?code=` | 관리자 코드 — 접수 내역 |
| GET | `/market` | 공개 — 팔고 있는 글. **실명·전화는 나가지 않는다** |
| POST | `/seller` | 공개 — 판매자 등록 신청 |
| GET | `/seller/me` | 수정키(`x-lab-key`) + 누구인지(`x-lab-id`) |
| GET·POST | `/admin/seller` | 관리자 코드 — 승인·반려·정지·재발급 |
| GET·POST | `/admin/market` | 관리자 코드 — 글 승인·반려·숨김·삭제·수량 |

## 시나리오 시험
    npx wrangler dev --port 8787 --var ADMIN_CODE:bonghwa      # 다른 창에서
    npx wrangler d1 execute bonghwa-lab --local --config wrangler.jsonc \
      --command "DELETE FROM market;DELETE FROM seller;DELETE FROM report;DELETE FROM device;"
    node scenario.mjs

정상 5건과 문제 유형마다 5건씩을 실제로 등록·거래·신고·삭제해 본다(137가지).
72시간·7일·90일처럼 기다려야 하는 규칙은 자료의 시각을 뒤로 돌리고
`POST /admin/cron` 을 한 번 불러 확인한다.

## 장터 — 판매자 등록제
담당자가 상시로 보지 않는다는 전제다. 등록은 **자동 승인**이고,
대신 세 가지가 알아서 청소한다.

| 장치 | 규칙 |
|---|---|
| 신고 → 가림 | 서로 다른 기기 **2건**이면 확인중(주문 잠금). 사진·개인정보는 **1건** |
| 고치면 복귀 | 게시자가 글을 고치면 **신고가 저절로 풀린다**. 취하 버튼은 없다 |
| 무응답 정리 | 확인중인 채로 **72시간**이면 저절로 종료 |
| 반복 | 한 글 3회 가림 → 글 종료. 판매자 2회 → 이레 쉼, 3회 → 멈춤 |
| 이의 | "고칠 것 없습니다" → 복귀. **이레 뒤** 다시 봐서 재신고가 없으면 그 신고는 무고 |
| 무고 | 무고 3회 기기의 신고는 **세지 않는다**(알리지 않는다) |
| 순위 | 지우지 않고 뒤로 민다 — 신고 ×50, 가림 ×100, 끝낸 거래 ×-20 |
| 새로 오신 분 | 하루 1건, 첫 글은 24시간 뒤 노출. 거래 5건이면 단골 |
| 수명 | 마감일시 → 마감, 수령일+7일 → 종료, 종료+90일 → 내용 파기, 활동없음 90일 → 연락처 파기 |

숫자는 `src/worker.js` 맨 위 상수 한 곳에 모여 있다.
새벽 청소는 Cron(한국 시각 04:00)이 돌리고, `POST /admin/cron` 으로 손수 돌려 볼 수 있다.

- **수정키**는 서버가 만들어 **한 번만** 돌려주고, 저장은 `SHA-256(id + ':' + key)` 해시로만 한다.
  담당자도 원래 값을 볼 수 없다. 잃어버리면 `재발급` 으로 새로 만들어 전화로 불러 준다.
- `GET /market` 은 칸을 하나하나 적어서 꺼낸다. **`SELECT *` 로 바꾸지 말 것** —
  한 번이면 봉화 농가 전화번호가 통째로 공개 주소로 새어 나간다.
- 저장 전에 서버가 설명·품목·규격·수령장소에서 전화번호·계좌를 찾아 **승인을 막는다**(`leak`).

## 담당자 화면
`market-admin.html` — 판매자 승인과 글 승인만 한다. 실명·전화는 여기서만 보인다.

## 시트 자료 옮기기
    node seed-market.mjs > seed-market.sql
    npx wrangler d1 execute bonghwa-lab --remote --file=seed-market.sql

## 개인정보
- 접수한 사람이 적은 항목만 저장한다. 아이피·UA는 저장하지 않는다.
- 장터 판매자만은 **실명·휴대폰**을 보관한다(판매자 확인과 분쟁 연락).
  화면에 동의 문구를 두었고, 판매를 그만둔 뒤 3개월이 지나면 지운다 —
  지우는 명령은 `docs/market-operation.md` §7.
- '내가 이미 접수했는지'는 서버가 아니라 그 휴대폰의 기록으로만 본다
  (서버에 개인을 알아볼 열쇠를 두지 않으려고).
- 시험이 끝나면 `npx wrangler d1 execute bonghwa-lab --remote --command "DELETE FROM apply"` 로 지운다.
