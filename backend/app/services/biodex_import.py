"""BIODEX 리포트를 선수 검사 데이터로 가져온다.

기존 CLI(`biodex_extract/extract_biodex.py`)의 파싱 로직을 그대로 재사용한다.
CLI 쪽 코드는 건드리지 않고 import만 한다.

두 가지 경로를 지원한다:
  1) CSV — CLI가 이미 뽑아둔 `*_biodex.csv`. 추가 의존성이 필요 없다.
  2) PDF/PNG — OCR을 직접 돌린다. tesseract/PyMuPDF가 없으면 명확한 에러를 낸다.
"""

import csv
import io
import re
import sys
from pathlib import Path

from ..models import SIDE_LEFT, SIDE_NA, SIDE_RIGHT, TEST_BIODEX
from ..schemas import ImportPreview, ImportPreviewRow

# 저장소 루트의 biodex_extract를 import 경로에 올린다.
REPO_ROOT = Path(__file__).resolve().parents[3]
BIODEX_DIR = REPO_ROOT / "biodex_extract"
if str(BIODEX_DIR) not in sys.path:
    sys.path.insert(0, str(BIODEX_DIR))

UNIT_PATTERN = re.compile(r"\(([^)]+)\)")
NUMBER_PATTERN = re.compile(r"-?\d+\.\d+|-?\d+")
CSV_HEADERS = {"Page", "Item", "Side", "Motion", "Speed", "Values", "RawLine"}


class ImportUnavailable(RuntimeError):
    """OCR 의존성이 없어 리포트 직접 업로드를 처리할 수 없을 때."""


def _normalize_side(raw: str) -> str:
    raw = (raw or "").strip().upper()
    if raw in (SIDE_LEFT, SIDE_RIGHT):
        return raw
    return SIDE_NA


def _parse_speed(raw: str) -> float | None:
    if not raw:
        return None
    match = NUMBER_PATTERN.search(raw)
    return float(match.group()) if match else None


def _unit_from_line(raw_line: str, default: str) -> str:
    """리포트 줄의 괄호에서 단위를 읽는다. 예: "PEAK TORQUE (ft-lbs)" -> "ft-lbs"."""
    match = UNIT_PATTERN.search(raw_line or "")
    if not match:
        return default
    unit = match.group(1).strip()
    # "%"나 "Nm"처럼 짧은 단위만 신뢰한다. 긴 문자열은 단위가 아닐 가능성이 높다.
    return unit if 0 < len(unit) <= 10 else default


def _classify(item: str, raw_line: str) -> tuple[str, str] | None:
    """(metric_key, 기본 단위)를 정한다. 다루지 않는 줄이면 None."""
    item = (item or "").strip().upper()
    line = (raw_line or "").upper()

    if item == "PEAK TORQUE":
        # CLI의 정규식은 "PEAK TORQUE/BODY WEIGHT (%)" 줄도 함께 잡는다.
        # 절대 토크와 체중 대비 비율은 전혀 다른 지표이므로 분리해서 저장한다.
        if "BODY WEIGHT" in line or "BODY WT" in line:
            return "peak_torque_bw_pct", "%"
        return "peak_torque", "Nm"
    if item == "FATIGUE":
        return "fatigue", "%"
    return None


def _row_from_record(
    item: str, side: str, motion: str, speed: str, values: list[float], raw_line: str
) -> tuple[ImportPreviewRow | None, list[str]]:
    warnings: list[str] = []
    classified = _classify(item, raw_line)
    if classified is None:
        return None, warnings

    metric_key, default_unit = classified
    if not values:
        warnings.append(f"값을 읽지 못해 건너뜀: {raw_line.strip()[:80]}")
        return None, warnings

    if metric_key == "peak_torque":
        # 리포트에 반복 횟수만큼 값이 나열된다. PEAK TORQUE는 최대값이 정의에 맞다.
        value = max(values)
    else:
        value = values[0]

    if len(values) > 1:
        warnings.append(
            f"{raw_line.strip()[:60]} — 값이 {len(values)}개라 "
            f"{'최대값' if metric_key == 'peak_torque' else '첫 값'} {value}을 사용했습니다. 확인 필요."
        )

    unit = _unit_from_line(raw_line, default_unit)
    if metric_key == "peak_torque" and unit != "Nm":
        warnings.append(
            f"토크 단위가 '{unit}'입니다. 체중 대비(Nm/kg) 계산은 Nm일 때만 적용됩니다."
        )

    context: dict = {}
    motion = (motion or "").strip().upper()
    if motion in ("EXTENSION", "FLEXION"):
        context["motion"] = motion
    speed_val = _parse_speed(speed)
    if speed_val is not None:
        context["speed_deg_s"] = speed_val
    if len(values) > 1:
        context["rep_values"] = values

    return (
        ImportPreviewRow(
            metric_key=metric_key,
            side=_normalize_side(side),
            value=value,
            unit=unit,
            context=context,
            raw_line=raw_line.strip() or None,
        ),
        warnings,
    )


def parse_csv(content: bytes, filename: str) -> ImportPreview:
    """CLI가 만든 `*_biodex.csv`를 읽는다."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames or not CSV_HEADERS.issubset(set(reader.fieldnames)):
        found = ", ".join(reader.fieldnames or []) or "(없음)"
        raise ValueError(
            "BIODEX CSV 형식이 아닙니다. "
            f"필요한 열: {', '.join(sorted(CSV_HEADERS))} / 실제 열: {found}"
        )

    rows: list[ImportPreviewRow] = []
    warnings: list[str] = []
    for record in reader:
        values = [float(v) for v in NUMBER_PATTERN.findall(record.get("Values") or "")]
        row, row_warnings = _row_from_record(
            item=record.get("Item", ""),
            side=record.get("Side", ""),
            motion=record.get("Motion", ""),
            speed=record.get("Speed", ""),
            values=values,
            raw_line=record.get("RawLine", ""),
        )
        warnings.extend(row_warnings)
        if row:
            rows.append(row)

    if not rows:
        warnings.append("가져올 수 있는 PEAK TORQUE / FATIGUE 행이 없습니다.")

    return ImportPreview(
        source=filename, test_type=TEST_BIODEX, rows=rows, warnings=warnings
    )


def parse_report(content: bytes, filename: str, lang: str = "eng+kor", dpi: int = 300) -> ImportPreview:
    """PDF/PNG를 OCR로 직접 읽는다. 기존 CLI의 함수를 그대로 쓴다."""
    # 지연 import: OCR 패키지가 없어도 앱 기동과 CSV 경로는 멀쩡해야 한다.
    try:
        from extract_biodex import build_rows, load_pages, ocr_page, parse_text
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise ImportUnavailable(
            "리포트 직접 업로드에는 OCR 패키지가 필요합니다.\n"
            "  pip install pytesseract PyMuPDF Pillow\n"
            "  apt-get install -y tesseract-ocr tesseract-ocr-kor\n"
            "설치 없이 쓰려면 CLI로 CSV를 먼저 만든 뒤 CSV 가져오기를 이용하세요:\n"
            "  python3 biodex_extract/extract_biodex.py 리포트.pdf\n"
            f"(원인: {exc})"
        ) from exc

    suffix = Path(filename).suffix or ".pdf"
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(content)
        tmp.flush()
        try:
            pages = load_pages(Path(tmp.name), dpi=dpi)
        except SystemExit as exc:  # CLI는 의존성 부족 시 sys.exit을 부른다.
            raise ImportUnavailable(str(exc)) from exc

        records = []
        for page_no, img in enumerate(pages, start=1):
            records.extend(parse_text(ocr_page(img, lang=lang), page_no))

    rows: list[ImportPreviewRow] = []
    warnings: list[str] = []
    for record in build_rows(records):
        values = [float(v) for v in NUMBER_PATTERN.findall(record["Values"])]
        row, row_warnings = _row_from_record(
            item=record["Item"],
            side=record["Side"],
            motion=record["Motion"],
            speed=record["Speed"],
            values=values,
            raw_line=record["RawLine"],
        )
        warnings.extend(row_warnings)
        if row:
            rows.append(row)

    if not rows:
        warnings.append(
            "OCR 결과에서 PEAK TORQUE / FATIGUE를 찾지 못했습니다. "
            "스캔 품질(300dpi 이상, 기울어짐 없음)을 확인하세요."
        )

    return ImportPreview(
        source=filename, test_type=TEST_BIODEX, rows=rows, warnings=warnings
    )
