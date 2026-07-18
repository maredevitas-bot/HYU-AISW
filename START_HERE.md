# NutriCycle 최종 제출 안내

## 웹에서 바로 실행

- 서비스 주소: <https://hyu-aisw.onrender.com>
- ZIP 안의 `00_OPEN_WEB_APP.html`을 더블클릭해도 같은 웹 서비스로 이동합니다.
- Render 무료 서버가 절전 상태이면 첫 화면이 나타날 때까지 약 30~60초가 걸릴 수 있습니다. 첫 로딩 뒤에는 정상 속도로 이용할 수 있습니다.

## 핵심 시연 경로

1. 급식 영양: <https://hyu-aisw.onrender.com/meal>
   - NEIS 공공데이터로 학교 급식을 조회합니다.
   - 급식판에서 실제로 담은 양을 선택하고 푸드 캘린더에 기록합니다.
2. 바코드·분리배출: <https://hyu-aisw.onrender.com/scan>
   - 카메라 또는 바코드 직접 입력으로 제품을 조회합니다.
   - 국내 푸드QR, HACCP, 식품영양성분 및 분리배출 공공데이터를 우선 사용합니다.
   - 조회한 제품을 오늘의 푸드 캘린더에 기록할 수 있습니다.
3. 푸드 캘린더: <https://hyu-aisw.onrender.com/calendar>
   - 급식, 바코드 제품, 직접 입력한 음식 기록을 날짜별로 확인합니다.

카메라 스캔은 Chrome 또는 Edge에서 사이트의 카메라 권한을 허용해야 합니다. 카메라 사용이 어려운 환경에서는 바코드 숫자를 직접 입력할 수 있습니다.

## 시연용 국내 제품 바코드

- `8801024949960`: 국산콩두부두모
- `8801062637560`: 빼빼로
- `8801069300276`: 초코에몽

## 소스코드

- GitHub: <https://github.com/maredevitas-bot/HYU-AISW>
- 구성: React + TypeScript 프론트엔드, Node.js 백엔드, SQLite 공공데이터 인덱스
- 서버의 API 키는 Render 환경변수에만 저장하며 GitHub와 제출 ZIP에는 포함하지 않았습니다.

로컬 실행이 필요한 경우 Node.js 22.13 이상에서 다음 명령을 사용합니다. 외부 공공 API까지 호출하려면 `.env.example`을 참고해 본인의 승인된 API 키를 환경변수로 설정해야 합니다.

```text
npm install
npm run build
npm start
```

## 제출 파일 보안

이 ZIP에는 실제 `.env`, API 인증키, `node_modules`, 빌드 캐시, 로컬 SQLite 실행 DB가 포함되지 않습니다. 심사 및 시연은 위 웹 서비스 주소를 이용하는 방식입니다.
