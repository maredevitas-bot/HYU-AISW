# NutriCycle

청소년의 급식 영양 균형과 식품 포장 분리배출을 함께 안내하는 2026 전국 청소년 SW-AI 경진대회용 웹 앱입니다.

## 핵심 기능

- 학교명과 날짜를 입력해 NEIS 급식 정보를 조회합니다.
- 성별과 활동량을 기준으로 하루 영양 목표와 급식 영양량을 비교합니다.
- 밥, 국, 반찬, 채소/과일/유제품을 어느 정도 먹으면 좋을지 숟가락/국자 기준으로 안내합니다.
- 브라우저 카메라로 실제 상품 바코드를 스캔하거나 바코드 번호를 직접 입력합니다.
- 식약처 푸드QR로 국내 제품을 바코드 조회하고, HACCP 제품정보와 식품영양성분 DB로 정보를 보완합니다.
- 국내 공공데이터에 결과가 없을 때만 Open Food Facts와 UPCitemdb를 보조 조회합니다.
- 상품 포장 재질을 기준으로 기후에너지환경부 분리배출 정보조회 API를 연결해 배출 방법을 안내합니다.
- HACCP 전체 공개데이터를 SQLite에 동기화해 API가 지원하지 않는 바코드 역검색을 제공합니다.
- 조회 결과를 서버 DB에 캐시하되, 글로벌 커뮤니티 캐시는 국내 공공데이터 재조회를 건너뛰지 않습니다.
- 앱을 급식 영양, 바코드·분리배출, 푸드 캘린더의 세 페이지로 분리해 각 문제 해결 흐름에 집중합니다.
- NEIS 급식과 바코드 식품의 실제 섭취량을 날짜별 식단 노트에 저장하고 하루 영양소를 합산합니다.
- 푸드 캘린더는 영양 정보가 있는 기록의 합계만 보여주며 하루 전체 영양 상태를 판정하지 않습니다.
- 바코드 제품 조회 직후 오늘 푸드 캘린더에 기록할지 묻고, 실제 섭취한 포장 비율을 선택합니다.
- NEIS 급식 메뉴를 급식판 칸에 배치하고 음식별로 담은 양을 선택해 실제 섭취량을 추정합니다.

## 로컬 실행

Windows에서는 `RUN_APP.bat`을 실행하면 서버와 웹 앱이 함께 열립니다. 이 파일은 Windows 사용자 환경 변수에 저장된 API 키를 읽어 서버에 전달하지만, 키 값을 파일 안에 저장하지는 않습니다.

직접 실행하려면 아래 순서로 진행합니다.

```bash
npm install
npm run server
```

브라우저에서 `http://localhost:3000`으로 접속합니다. 카메라 바코드 스캔은 Chrome 또는 Edge 사용을 권장합니다.

처음 실행하거나 HACCP 데이터를 갱신할 때는 `SYNC_DATABASE.bat`을 실행합니다. 직접 실행할 때는 다음 명령을 사용합니다.

```bash
npm run db:sync
```

DB는 샘플 상품을 하드코딩한 파일이 아닙니다. 승인된 HACCP 공공 API에서 전체 데이터를 받아 `바코드 -> 품목제조보고번호` 검색 인덱스를 만드는 서버 데이터입니다. 기본 위치는 `data/nutricycle.sqlite`이며 Git에는 포함하지 않습니다.

식단 기록도 같은 SQLite의 `food_log_entries` 테이블에 저장됩니다. 로그인 없이 브라우저별 익명 식별자를 사용하므로 이름이나 연락처는 저장하지 않으며, 서로 다른 사용자의 기록은 섞이지 않습니다.

## API 키 설정

API 키는 코드에 직접 넣지 않고 실행 환경 변수로만 사용합니다. 이 방식이면 Git 저장소와 최종 제출 zip에 실제 키가 포함되지 않습니다.

```bash
set NEIS_API_KEY=발급받은_NEIS_키
set PUBLIC_DATA_API_KEY=공공데이터포털_일반인증키
set DATABASE_PATH=서버의_SQLite_파일_경로
set FOODSAFETY_API_KEY=발급받은_식약처_키
npm run server
```

`PUBLIC_DATA_API_KEY` 하나를 공공데이터포털에서 승인받은 푸드QR, HACCP 제품정보, 식품영양성분 DB, 분리배출 정보조회 서비스에 공통으로 사용합니다. `FOODSAFETY_API_KEY`는 기존 식품안전나라 API를 위한 보조 키이며 없어도 핵심 푸드QR 조회는 동작합니다.

현재 로컬 PC에는 사용자 환경 변수로 키를 설정해 두면 새 터미널에서 바로 `npm run server`만 실행해도 서버가 키를 읽습니다. 예시 형식은 `.env.example`에만 남겨두고, 실제 키가 들어간 `.env` 파일은 만들더라도 Git에 포함하지 않습니다.

## 웹 배포

Node.js 22.13 이상 서버 기준으로 배포합니다. Render 같은 Node Web Service에 올릴 때는 아래처럼 설정합니다.

- Build Command: `npm install && npm run build && npm run db:sync`
- Start Command: `npm start`
- Environment Variables: `NEIS_API_KEY`, `PUBLIC_DATA_API_KEY`, 선택적으로 `DATABASE_PATH`, `FOODSAFETY_API_KEY`, `APP_USER_AGENT`

`npm start`는 빌드된 `dist` 파일과 API 서버를 함께 제공하므로, 웹상에서도 급식 조회, 바코드 조회, 분리배출 조회가 같은 주소에서 동작합니다.

Render 재배포 뒤에도 조회 캐시를 유지하려면 Persistent Disk를 연결하고 `DATABASE_PATH`를 해당 디스크 경로로 지정합니다. 디스크가 없어도 빌드 과정에서 HACCP 공개데이터 DB를 다시 생성하므로 핵심 기능은 동작합니다.

단, 푸드 캘린더의 사용자 기록은 자동으로 다시 생성할 수 없습니다. Render의 임시 파일 시스템에서는 재배포나 인스턴스 교체 뒤 기록이 사라질 수 있으므로 최종 운영 전에는 Persistent Disk를 연결하거나 `food_log_entries`를 Supabase 같은 외부 PostgreSQL로 옮겨야 합니다.

## 페이지와 식단 기록 API

- `/meal`: NEIS 급식표, 급식판별 담은 양, 점심 영양 비교, 급식 기록
- `/scan`: 카메라 바코드 조회, 오늘 기록 확인창, 제품 영양, 포장재 분리배출
- `/calendar`: 월간 기록, 날짜별 식단 노트, 기록된 항목의 영양소 합계

식단 기록 API는 `GET /api/food-log`, `POST /api/food-log`, `DELETE /api/food-log/:id`로 구성됩니다. 프론트엔드가 발급한 익명 `ownerId`를 모든 요청에 함께 보내 사용자별 기록을 구분합니다.

## 제출 전 확인

```bash
npm run build
npm run lint
```

정적 파일과 서버를 함께 확인하려면 아래 명령을 사용합니다.

```bash
npm run server:static
```

## API 연결 순서

상품 바코드 조회는 로컬 샘플 DB로 성공처럼 보이게 만들지 않고, 실제 API 조회 결과와 실패 사유를 투명하게 표시합니다. 분리배출은 상품 포장재 후보를 만든 뒤 공공데이터포털 분리배출 정보조회 API로 품목별 대표 배출방법을 보강합니다.

바코드 조회 순서:

```text
식약처 푸드QR(바코드 직접 조회)
-> HACCP 공개데이터 SQLite(바코드 역조회)
-> HACCP 제품정보 + 식품영양성분 DB(품목제조보고번호 보강)
-> 기존 식품안전나라 API
-> Open Food Facts v3/v2
-> UPCitemdb
```

식약처 푸드QR, HACCP 공개데이터 DB, 식품안전나라 조회 결과에는 `국내 공공데이터` 등급을 붙입니다. Open Food Facts와 UPCitemdb 결과는 `글로벌 커뮤니티` 등급으로 분리하고 화면에 국내 공공데이터 미확인 안내를 표시합니다. 국내 결과는 7일, 글로벌 참고 결과는 6시간 캐시하며 글로벌 캐시가 있더라도 국내 조회를 먼저 다시 수행합니다.

분리배출 조회 순서:

```text
푸드QR 포장재질 -> 기후에너지환경부 분리배출 정보조회 API getItem -> API 미응답 시 재질별 기본 안내
```
