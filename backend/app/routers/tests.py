"""검사 세션 등록/조회, 지표 정의 조회."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import MetricDefinition, Player, TestResult, TestSession
from ..schemas import MetricDefinitionOut, TestSessionIn, TestSessionOut
from ..services import metrics

router = APIRouter(prefix="/api", tags=["tests"])


@router.get("/metrics", response_model=list[MetricDefinitionOut])
def list_metric_definitions(db: Session = Depends(get_db)):
    return db.query(MetricDefinition).order_by(MetricDefinition.metric_key).all()


@router.post("/sessions", response_model=TestSessionOut, status_code=201)
def create_session(payload: TestSessionIn, db: Session = Depends(get_db)):
    if db.get(Player, payload.player_id) is None:
        raise HTTPException(
            status_code=404, detail=f"선수를 찾을 수 없습니다 (id={payload.player_id})"
        )

    session = TestSession(
        player_id=payload.player_id,
        test_type=payload.test_type,
        # DB의 시각은 naive로 통일한다. (imports.py의 같은 처리 참고)
        tested_at=metrics.to_naive(payload.tested_at),
        device=payload.device,
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
        for r in payload.results
    ]
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions/{session_id}", response_model=TestSessionOut)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(TestSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"검사를 찾을 수 없습니다 (id={session_id})")
    return session


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(TestSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"검사를 찾을 수 없습니다 (id={session_id})")
    db.delete(session)
    db.commit()
