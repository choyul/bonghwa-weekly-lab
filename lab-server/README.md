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

## 개인정보
- 접수한 사람이 적은 항목만 저장한다. 아이피·UA는 저장하지 않는다.
- '내가 이미 접수했는지'는 서버가 아니라 그 휴대폰의 기록으로만 본다
  (서버에 개인을 알아볼 열쇠를 두지 않으려고).
- 시험이 끝나면 `npx wrangler d1 execute bonghwa-lab --remote --command "DELETE FROM apply"` 로 지운다.
