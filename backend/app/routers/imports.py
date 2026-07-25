"""BIODEX 리포트 가져오기 — 미리보기 후 확정 저장."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Player, TestResult, TestSession
from ..schemas import ImportCommit, ImportPreview, TestSessionOut
from ..services import biodex_import, metrics

router = APIRouter(prefix="/api/imports", tags=["imports"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@router.post("/biodex/preview", response_model=ImportPreview)
async def preview_biodex(file: UploadFile = File(...)):
    """업로드 파일을 파싱만 해서 돌려준다. 이 단계에서는 저장하지 않는다.

    바로 저장하지 않는 이유: OCR/파싱은 리포트 레이아웃에 따라 틀릴 수 있어서,
    사람이 값을 확인한 뒤 확정하는 편이 안전하다.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="빈 파일입니다")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="파일이 너무 큽니다 (최대 20MB)")

    filename = file.filename or "upload"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    try:
        if suffix == "csv":
            return biodex_import.parse_csv(content, filename)
        if suffix in ("pdf", "png", "jpg", "jpeg"):
            return biodex_import.parse_report(content, filename)
    except biodex_import.ImportUnavailable as exc:
        # 앱 결함이 아니라 환경 구성 문제이므로 503으로 구분해서 알린다.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    raise HTTPException(
        status_code=400,
        detail=f"지원하지 않는 형식입니다: .{suffix or '?'} (csv, pdf, png, jpg만 가능)",
    )


@router.post("/biodex/commit", response_model=TestSessionOut, status_code=201)
def commit_biodex(payload: ImportCommit, db: Session = Depends(get_db)):
    """미리보기에서 확인한 행들을 실제 검사 세션으로 저장한다."""
    if db.get(Player, payload.player_id) is None:
        raise HTTPException(
            status_code=404, detail=f"선수를 찾을 수 없습니다 (id={payload.player_id})"
        )
    if not payload.rows:
        raise HTTPException(status_code=400, detail="저장할 측정값이 없습니다")

    session = TestSession(
        player_id=payload.player_id,
        test_type=payload.test_type,
        # 브라우저는 UTC ISO(…Z)로 보내는데 DB의 시각은 naive다. 섞이면
        # 이후 비교·정렬에서 전부 깨지므로 저장 시점에 맞춰 둔다.
        tested_at=metrics.to_naive(payload.tested_at),
        device=payload.device or "BIODEX",
        notes=payload.notes,
        source=payload.source,
    )
    session.results = [
        TestResult(
            metric_key=r.metric_key,
            side=r.side,
            value=r.value,
            unit=r.unit,
            context=r.context,
        )
        for r in payload.rows
    ]
    db.add(session)
    db.commit()
    db.refresh(session)
    return session
