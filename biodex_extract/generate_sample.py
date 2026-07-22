#!/usr/bin/env python3
"""테스트용 가상 BIODEX 리포트(PNG, PDF)를 samples/ 폴더에 생성한다.

실제 BIODEX 장비에서 출력된 리포트가 없을 때, extract_biodex.py 파이프라인을
바로 확인해 볼 수 있도록 만든 데모용 스크립트다.
"""

from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont

LINES = [
    "BIODEX SYSTEM 4 PRO - ISOKINETIC STRENGTH TEST REPORT",
    "Patient: HONG GILDONG   Test Date: 2026-07-22",
    "Joint: KNEE   Test Speed: 60 DEG/SEC",
    "",
    "RIGHT",
    "EXTENSION",
    "  PEAK TORQUE (ft-lbs)            45.2   43.8   44.5",
    "  PEAK TORQUE/BODY WEIGHT (%)     62.3   60.1   61.0",
    "  TIME TO PEAK TORQUE (ms)        320    310    315",
    "  WORK FATIGUE (%)                18.4",
    "",
    "FLEXION",
    "  PEAK TORQUE (ft-lbs)            28.1   27.5   27.9",
    "  WORK FATIGUE (%)                15.2",
    "",
    "LEFT",
    "EXTENSION",
    "  PEAK TORQUE (ft-lbs)            42.0   41.5   41.8",
    "  WORK FATIGUE (%)                20.1",
    "",
    "FLEXION",
    "  PEAK TORQUE (ft-lbs)            26.3   25.9   26.0",
    "  WORK FATIGUE (%)                17.8",
]


def build_image() -> Image.Image:
    width, height = 1000, 700
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 18)
    except OSError:
        font = ImageFont.load_default()

    y = 20
    for line in LINES:
        draw.text((20, y), line, fill="black", font=font)
        y += 28
    return img


def main():
    out_dir = Path(__file__).parent / "samples"
    out_dir.mkdir(exist_ok=True)

    img = build_image()
    png_path = out_dir / "sample_report.png"
    img.save(png_path)
    print(f"생성됨: {png_path}")

    pdf_path = out_dir / "sample_report.pdf"
    img_rgb_path = out_dir / "_tmp_sample.png"
    img.save(img_rgb_path)

    doc = fitz.open()
    page = doc.new_page(width=img.width, height=img.height)
    page.insert_image(page.rect, filename=str(img_rgb_path))
    doc.save(pdf_path, garbage=4, deflate=True)
    doc.close()
    img_rgb_path.unlink()
    print(f"생성됨: {pdf_path}")


if __name__ == "__main__":
    main()
