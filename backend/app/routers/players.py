"""선수 CRUD와 프로필 개요."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Player, TestSession
from ..schemas import (
    PlayerCreate,
    PlayerOut,
    PlayerOverview,
    PlayerSummary,
    PlayerUpdate,
    TrendSeries,
)
from ..services import metrics

router = APIRouter(prefix="/api/players", tags=["players"])


def _get_player(db: Session, player_id: int) -> Player:
    player = db.get(Player, player_id)
    if player is None:
        raise HTTPException(status_code=404, detail=f"선수를 찾을 수 없습니다 (id={player_id})")
    return player


@router.get("", response_model=list[PlayerSummary])
def list_players(
    db: Session = Depends(get_db),
    position: str | None = Query(None, description="G/F/C로 필터"),
    status: str | None = Query(None, description="active/injured/rehab로 필터"),
):
    query = db.query(Player)
    if position:
        query = query.filter(Player.position == position)
    if status:
        query = query.filter(Player.status == status)

    defs = metrics.load_definitions(db)
    summaries: list[PlayerSummary] = []
    for player in query.order_by(Player.jersey_number).all():
        asymmetries = metrics.build_asymmetries(player, defs)
        alerts = metrics.build_alerts(player, asymmetries, metrics.build_hq_ratios(player))
        last_tested = max((s.tested_at for s in player.sessions), default=None)
        summaries.append(
            PlayerSummary(
                **PlayerOut.model_validate(player).model_dump(),
                last_tested_at=last_tested,
                alert_count=len(alerts),
            )
        )
    return summaries


@router.post("", response_model=PlayerOut, status_code=201)
def create_player(payload: PlayerCreate, db: Session = Depends(get_db)):
    existing = db.query(Player).filter(Player.jersey_number == payload.jersey_number).first()
    if existing:
        raise HTTPException(
            status_code=409, detail=f"등번호 {payload.jersey_number}번은 이미 사용 중입니다"
        )
    player = Player(**payload.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.get("/{player_id}", response_model=PlayerOut)
def get_player(player_id: int, db: Session = Depends(get_db)):
    return _get_player(db, player_id)


@router.patch("/{player_id}", response_model=PlayerOut)
def update_player(player_id: int, payload: PlayerUpdate, db: Session = Depends(get_db)):
    player = _get_player(db, player_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(player, field, value)
    db.commit()
    db.refresh(player)
    return player


@router.delete("/{player_id}", status_code=204)
def delete_player(player_id: int, db: Session = Depends(get_db)):
    db.delete(_get_player(db, player_id))
    db.commit()


@router.get("/{player_id}/overview", response_model=PlayerOverview)
def player_overview(
    player_id: int,
    db: Session = Depends(get_db),
    headline_only: bool = Query(True, description="대표 지표만 타일로 낼지 여부"),
):
    """선수 프로필 화면 한 장에 필요한 것을 한 번에 내려준다."""
    player = _get_player(db, player_id)
    defs = metrics.load_definitions(db)

    asymmetries = metrics.build_asymmetries(player, defs)
    hq_ratios = metrics.build_hq_ratios(player)
    recent = sorted(player.sessions, key=lambda s: s.tested_at, reverse=True)[:10]

    return PlayerOverview(
        player=PlayerOut.model_validate(player),
        tiles=metrics.build_tiles(db, player, defs, headline_only=headline_only),
        asymmetries=asymmetries,
        hq_ratios=hq_ratios,
        alerts=metrics.build_alerts(player, asymmetries, hq_ratios),
        recent_sessions=recent,
    )


@router.get("/{player_id}/trends", response_model=list[TrendSeries])
def player_trends(
    player_id: int,
    db: Session = Depends(get_db),
    metric_key: list[str] | None = Query(None, description="지표 키. 여러 번 지정 가능"),
    since: datetime | None = Query(None, description="이 시각 이후 측정분만"),
):
    player = _get_player(db, player_id)
    return metrics.build_trends(player, metrics.load_definitions(db), metric_key, since)


@router.get("/{player_id}/sessions", response_model=list[dict])
def player_session_index(player_id: int, db: Session = Depends(get_db)):
    """검사 이력 화면용 목록 (결과 개수만 요약)."""
    _get_player(db, player_id)
    rows = (
        db.query(TestSession)
        .filter(TestSession.player_id == player_id)
        .order_by(TestSession.tested_at.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "test_type": s.test_type,
            "tested_at": s.tested_at,
            "device": s.device,
            "notes": s.notes,
            "source": s.source,
            "result_count": len(s.results),
        }
        for s in rows
    ]
