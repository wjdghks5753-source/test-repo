# BIODEX PEAK TORQUE / FATIGUE 추출기

BIODEX 등속성 검사(isokinetic test) 리포트(PNG 또는 PDF)에서 **PEAK TORQUE**와
**FATIGUE** 값을 OCR로 읽어, 좌/우·신전(Extension)/굴곡(Flexion)·속도별로
표에 정리해 화면에 출력하고 CSV/Excel 파일로 저장한다.

## 설치

```bash
# 시스템 OCR 엔진 (Ubuntu/Debian 기준)
sudo apt-get install -y tesseract-ocr tesseract-ocr-kor

# Python 패키지
pip install -r requirements.txt
```

## 사용법

```bash
python3 extract_biodex.py 리포트.pdf
python3 extract_biodex.py 리포트.png
```

옵션:
- `-o, --output`: 출력 파일 접두 경로 (기본값: 입력 파일명 기반, 예: `리포트_biodex.csv`)
- `--lang`: OCR 언어 (기본값 `eng+kor`)
- `--dpi`: PDF를 이미지로 변환할 때 해상도 (기본값 300, 스캔 품질이 낮으면 올려볼 것)
- `--debug`: 페이지별 원본 OCR 텍스트를 함께 출력 (인식이 잘 안 될 때 확인용)

실행하면 다음이 만들어진다:
- 터미널에 정리된 표
- `<입력파일명>_biodex.csv`
- `<입력파일명>_biodex.xlsx` (openpyxl 설치 시)

## 테스트용 샘플 만들기

실제 BIODEX 출력물이 없어도 파이프라인을 바로 확인해 볼 수 있도록, 전형적인
리포트 레이아웃을 흉내 낸 가상 샘플을 생성하는 스크립트가 있다.

```bash
python3 generate_sample.py   # samples/sample_report.png, samples/sample_report.pdf 생성
python3 extract_biodex.py samples/sample_report.pdf
```

## 인식 로직과 한계

- 각 줄에서 `PEAK TORQUE`(단, `TIME TO PEAK TORQUE`, `PEAK TORQUE ANGLE`처럼
  다른 지표는 제외) 또는 `FATIGUE`가 포함된 줄을 찾아 그 줄의 숫자를 값으로
  추출한다.
- 같은 줄 위쪽에서 가장 최근에 나온 `LEFT/RIGHT`, `EXTENSION/FLEXION`,
  `속도(°/sec)` 정보를 문맥으로 붙여 표로 정리한다.
- **실제 장비/스캔본의 레이아웃이 다르면 결과가 달라질 수 있다.** 값이 잘
  안 잡히면 `--debug`로 원본 OCR 텍스트를 확인한 뒤, `extract_biodex.py`의
  정규식(`SIDE_PATTERN`, `MOTION_PATTERN`, `SPEED_PATTERN`,
  `PEAK_TORQUE_PATTERN`, `FATIGUE_PATTERN`)을 리포트 형식에 맞게 조정하면 된다.
- 스캔 이미지 품질이 낮으면(기울어짐, 저해상도, 흐림) OCR 정확도가 떨어질 수
  있으니 가능하면 300dpi 이상, 반듯하게 스캔된 파일을 사용할 것.
