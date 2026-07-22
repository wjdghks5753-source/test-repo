#!/usr/bin/env python3
"""BIODEX 등속성 검사 리포트(PNG/PDF)에서 PEAK TORQUE, FATIGUE 값을 추출해 표로 정리한다.

사용법:
    python3 extract_biodex.py 리포트.pdf
    python3 extract_biodex.py 리포트.png --debug
"""

import argparse
import csv
import re
import sys
from pathlib import Path

from PIL import Image
import pytesseract

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from openpyxl import Workbook
except ImportError:
    Workbook = None


SIDE_PATTERN = re.compile(r"\b(RIGHT|LEFT|우측|좌측)\b", re.IGNORECASE)
MOTION_PATTERN = re.compile(r"\b(EXTENSION|FLEXION|EXT|FLEX|신전|굴곡)\b", re.IGNORECASE)
SPEED_PATTERN = re.compile(r"(\d+)\s*(?:°|DEG(?:REE)?S?)?\s*/\s*SEC", re.IGNORECASE)
NUMBER_PATTERN = re.compile(r"-?\d+\.\d+|-?\d+")

# "TIME TO PEAK TORQUE", "PEAK TORQUE ANGLE" 등은 실제로는 별개 지표이므로 제외한다.
PEAK_TORQUE_PATTERN = re.compile(
    r"^(?!.*\bTIME\s*TO\b)(?!.*\bANGLE\b).*PEAK\s*TORQ", re.IGNORECASE
)
FATIGUE_PATTERN = re.compile(r"FATIGUE", re.IGNORECASE)


def load_pages(path: Path, dpi: int = 300):
    """파일 경로(PNG/JPG/PDF)를 받아 PIL 이미지 리스트로 변환한다."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        if fitz is None:
            sys.exit("PDF 처리를 위해 PyMuPDF가 필요합니다: pip install pymupdf")
        doc = fitz.open(path)
        zoom = dpi / 72
        matrix = fitz.Matrix(zoom, zoom)
        pages = []
        for page in doc:
            pix = page.get_pixmap(matrix=matrix)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            pages.append(img)
        return pages
    return [Image.open(path)]


def ocr_page(img: Image.Image, lang: str) -> str:
    gray = img.convert("L")
    return pytesseract.image_to_string(gray, lang=lang)


def normalize_side(token: str) -> str:
    token = token.upper()
    return {"우측": "RIGHT", "좌측": "LEFT"}.get(token, token)


def normalize_motion(token: str) -> str:
    token = token.upper()
    if token.startswith("EXT") or token == "신전":
        return "EXTENSION"
    if token.startswith("FLEX") or token == "굴곡":
        return "FLEXION"
    return token


def parse_text(text: str, page_no: int):
    """OCR 텍스트에서 PEAK TORQUE / FATIGUE 라인을 찾아 문맥(좌우/동작/속도)과 함께 레코드로 만든다."""
    records = []
    side = motion = speed = ""

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        side_match = SIDE_PATTERN.search(line)
        if side_match:
            side = normalize_side(side_match.group(1))

        motion_match = MOTION_PATTERN.search(line)
        if motion_match:
            motion = normalize_motion(motion_match.group(1))

        speed_match = SPEED_PATTERN.search(line)
        if speed_match:
            speed = f"{speed_match.group(1)}°/sec"

        item = None
        if PEAK_TORQUE_PATTERN.search(line):
            item = "PEAK TORQUE"
        elif FATIGUE_PATTERN.search(line):
            item = "FATIGUE"

        if item:
            values = NUMBER_PATTERN.findall(line)
            if values:
                records.append(
                    {
                        "page": page_no,
                        "item": item,
                        "side": side,
                        "motion": motion,
                        "speed": speed,
                        "values": values,
                        "raw_line": line,
                    }
                )
    return records


def build_rows(records):
    rows = [
        {
            "Page": r["page"],
            "Item": r["item"],
            "Side": r["side"],
            "Motion": r["motion"],
            "Speed": r["speed"],
            "Values": ", ".join(r["values"]),
            "RawLine": r["raw_line"],
        }
        for r in records
    ]
    # 항목(PEAK TORQUE/FATIGUE) -> 좌우 -> 동작 -> 속도 순으로 표를 정리한다.
    rows.sort(key=lambda x: (x["Item"], x["Side"], x["Motion"], x["Speed"]))
    return rows


def print_table(rows):
    if not rows:
        print("PEAK TORQUE / FATIGUE 항목을 찾지 못했습니다. --debug 옵션으로 원본 OCR 텍스트를 확인해 보세요.")
        return
    headers = ["Page", "Item", "Side", "Motion", "Speed", "Values"]
    widths = {h: max(len(h), max((len(str(row[h])) for row in rows), default=0)) for h in headers}
    header_line = " | ".join(h.ljust(widths[h]) for h in headers)
    print(header_line)
    print("-" * len(header_line))
    for row in rows:
        print(" | ".join(str(row[h]).ljust(widths[h]) for h in headers))


def save_csv(rows, out_path: Path):
    headers = ["Page", "Item", "Side", "Motion", "Speed", "Values", "RawLine"]
    with out_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def save_xlsx(rows, out_path: Path):
    if Workbook is None:
        return
    wb = Workbook()
    ws = wb.active
    ws.title = "BIODEX"
    headers = ["Page", "Item", "Side", "Motion", "Speed", "Values", "RawLine"]
    ws.append(headers)
    for row in rows:
        ws.append([row[h] for h in headers])
    for col in ws.columns:
        width = max((len(str(c.value)) if c.value is not None else 0 for c in col), default=0) + 2
        ws.column_dimensions[col[0].column_letter].width = width
    wb.save(out_path)


def main():
    parser = argparse.ArgumentParser(description="BIODEX 리포트(PNG/PDF)에서 PEAK TORQUE, FATIGUE 값을 추출합니다.")
    parser.add_argument("input", type=Path, help="입력 PNG 또는 PDF 파일 경로")
    parser.add_argument("-o", "--output", type=Path, default=None, help="출력 파일 접두 경로 (기본값: 입력 파일명 기반)")
    parser.add_argument("--lang", default="eng+kor", help="OCR 언어 (기본값: eng+kor)")
    parser.add_argument("--dpi", type=int, default=300, help="PDF 렌더링 해상도 (기본값: 300)")
    parser.add_argument("--debug", action="store_true", help="페이지별 원본 OCR 텍스트를 출력")
    args = parser.parse_args()

    if not args.input.exists():
        sys.exit(f"파일을 찾을 수 없습니다: {args.input}")

    pages = load_pages(args.input, dpi=args.dpi)

    all_records = []
    for i, img in enumerate(pages, start=1):
        text = ocr_page(img, lang=args.lang)
        if args.debug:
            print(f"\n===== Page {i} OCR RAW TEXT =====")
            print(text)
        all_records.extend(parse_text(text, i))

    rows = build_rows(all_records)
    print_table(rows)

    out_prefix = args.output or args.input.with_suffix("")
    csv_path = Path(f"{out_prefix}_biodex.csv")
    save_csv(rows, csv_path)
    print(f"\nCSV 저장됨: {csv_path}")

    if Workbook is not None:
        xlsx_path = Path(f"{out_prefix}_biodex.xlsx")
        save_xlsx(rows, xlsx_path)
        print(f"Excel 저장됨: {xlsx_path}")


if __name__ == "__main__":
    main()
