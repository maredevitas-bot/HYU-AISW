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
- 조회 결과를 서버 DB에 캐시해 외부 API가 일시적으로 실패해도 최근 결과를 보여줍니다.

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

분리배출 조회 순서:

```text
푸드QR 포장재질 -> 기후에너지환경부 분리배출 정보조회 API getItem -> API 미응답 시 재질별 기본 안내
```
