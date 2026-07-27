# 프로농구단 선수 데이터 관리

선수 프로필을 중심으로 체력측정 데이터를 시계열로 쌓고, **좌우 비대칭·기준치 이탈이
자동으로 눈에 띄게** 하는 웹 시스템. VALD Hub 형태의 선수 프로필 화면을 참고했다.

기존에 있던 `biodex_extract` CLI는 측정값을 CSV로 뽑아주기만 해서 파일이 흩어지고
누적 비교가 불가능했다. 이 시스템은 그 출력을 그대로 받아 선수 기록으로 누적한다.

```
biodex_extract/   BIODEX 리포트(PDF/PNG) → PEAK TORQUE·FATIGUE 추출 CLI (기존)
backend/          FastAPI + SQLite. 측정값 저장과 파생 지표 계산
frontend/         React + TypeScript. 대시보드와 선수 프로필 화면
```

## 실행

```bash
# 1) 백엔드
cd backend
pip install -r requirements.txt
python -m app.seed              # 데모용 가상 선수 15명 + 약 6개월치 검사 이력
uvicorn app.main:app --reload   # http://localhost:8000/docs 에서 API 확인

# 2) 프론트엔드 (별도 터미널)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

`npm run build`로 빌드해 두면 백엔드가 `frontend/dist`를 같이 서빙하므로
`http://localhost:8000` 하나만 띄워도 된다.

시드 데이터를 다시 만들려면 `python -m app.seed --reset`.

## 화면

| 화면 | 내용 |
|---|---|
| 팀 현황 `/` | 로스터 카드, 확인이 필요한 선수 목록(심각도 순) |
| 선수 개요 `/players/:id` | 최신 지표 타일, 좌우 비대칭, H/Q 비율, 최근 검사 |
| 검사 이력 `/players/:id/tests` | 검사 목록. 펼치면 조건별 원시 측정값 |
| 추세 `/players/:id/trends` | 지표·기간을 골라 보는 시계열 + 측정값 표 |
| 가져오기 `/import` | 리포트 업로드 → 값 확인 → 선수 기록으로 저장 |

## 데이터 모델

측정값은 `TestResult`에 **key-value로 일반화**해서 저장한다.

```
Player ──< TestSession ──< TestResult(metric_key, side, value, unit, context)
```

`context`에 각속도·동작 같은 조건이 들어가므로, BIODEX의
`각속도 × 신전/굴곡 × 좌/우` 격자와 점프 높이 같은 단일 스칼라를 한 테이블에 담는다.
장비나 지표가 늘어도 스키마를 바꿀 필요가 없다.

지표의 표시명·단위·비대칭 임계값은 코드가 아니라 `MetricDefinition` 테이블이 정한다.
임계값을 바꾸려면 그 행만 고치면 된다.

## 파생 지표

단순 저장이 아니라 판단 가능한 값을 계산하는 부분 (`backend/app/services/metrics.py`):

| 지표 | 정의 | 기준 |
|---|---|---|
| 좌우 비대칭률 | `(큰값 − 작은값) / 큰값 × 100` | 10% 주의 / 15% 경고 |
| 체중 대비 토크 | `피크토크 ÷ 체중` (Nm/kg) | 체격 차가 큰 포지션 간 비교용 |
| H/Q 비율 | 굴곡(햄스트링) ÷ 신전(대퇴사두) 피크토크 | 60°/s에서 0.60 미만 경고 |
| 팀 내 백분위 | 같은 포지션군의 최신값 대비 순위 | 3명 미만이면 팀 전체로 확대 |
| 추세 | 직전 검사 대비 변화량·변화율 | 낮을수록 좋은 지표는 방향 반전 |

경고 목록은 "누구를 먼저 볼지" 고르는 화면이라, 한 선수의 같은 문제는
가장 심한 항목 하나만 올린다. 전체 내역은 선수 개요에서 볼 수 있다.

## BIODEX 리포트 가져오기

기존 CLI(`biodex_extract/extract_biodex.py`)의 파싱 함수를 그대로 재사용한다.
CLI 코드는 수정하지 않았다.

두 경로가 있다:

- **CSV** — CLI가 만든 `*_biodex.csv`. 추가 의존성이 필요 없다.
- **PDF/PNG** — 서버에서 직접 OCR. 아래 패키지가 필요하며, 없으면 앱이 죽는 대신
  설치 안내가 담긴 503을 돌려준다.

```bash
pip install pytesseract PyMuPDF Pillow
apt-get install -y tesseract-ocr tesseract-ocr-kor
```

가져오기는 **미리보기 → 확정** 2단계다. OCR·파싱은 리포트 서식에 따라 틀릴 수 있어서
값을 사람이 확인한 뒤에만 저장된다. 예를 들어 CLI는 `PEAK TORQUE/BODY WEIGHT (%)`
줄도 PEAK TORQUE로 잡는데, 가져오기 쪽에서 이를 `peak_torque_bw_pct`로 분리하고
반복 측정값이 여러 개면 어느 값을 썼는지 경고로 알려준다.

## 테스트

```bash
cd backend && python -m pytest tests -q
```

## 참고

- 시드 데이터의 선수와 측정값은 전부 **가상**이다. 실제 선수 기록이 아니다.
- 인증·권한은 없다. 팀 내부망 등 신뢰된 환경을 전제로 한 데모 수준이다.
