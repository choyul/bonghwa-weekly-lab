# 당신의 봉화 — 군민용 주간업무 안내

봉화군 홈페이지에 공개된 주간업무 계획을 군민이 보기 쉽게 정리한 정적 웹사이트입니다.
달력·주제·대상·지역으로 이번 주 봉화군에서 무슨 일이 있는지 찾아볼 수 있습니다.

- 공개 주소: GitHub Pages (Settings → Pages 에서 확인)
- 자료 출처: 봉화군 홈페이지 행정정보 > 군정소식 > 주간업무(행사)
- **매일 새벽 자동 갱신** (`.github/workflows/weekly.yml`) — 새 주간업무가 올라오면 data.js를 다시 만들어 반영합니다.

## 자동 갱신 방식

1. `build/fetch_latest.py` — 봉화군 홈페이지에서 새 주차의 주간업무계획(HWP)을 내려받아 md로 변환
2. `build/build.js` — md 폴더 전체를 읽어 `data.js` 재생성
3. 변경이 있으면 자동 커밋·푸시 → GitHub Pages가 새 내용으로 배포

수동으로 지금 갱신하려면: 저장소의 **Actions 탭 → 주간업무 자동 갱신 → Run workflow**.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 군민용 화면 |
| `core.js` `ui.js` `ui.css` | 공용 로직·화면·디자인 |
| `data.js` | 업무 데이터 (자동 생성물) |
| `md/` | 주간업무계획 변환본 (data.js 원천) |
| `build/` | 내려받기·빌드 스크립트 |
| `sw.js` `public.webmanifest` | PWA (홈 화면 추가·오프라인) |

개인정보는 담겨 있지 않습니다. 부서 대표번호는 `build/dept-phones.json`에
공개 번호만 채우면 화면 문의처에 표시됩니다.
