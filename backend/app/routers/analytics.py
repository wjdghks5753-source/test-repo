"""팀 단위 분석 — 경고 목록과 지표 분포."""

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Player
from ..schemas import Alert
from ..services import metrics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/alerts", response_model=list[Alert])
def team_alerts(
    db: Session = Depends(get_db),
    severity: str | None = Query(None, description="alert 또는 warn만 보기"),
):
    """팀 전체 경고를 심각도 순으로 모아준다. 대시보드 첫 화면용."""
    defs = metrics.load_definitions(db)
    collected: list[Alert] = []
    for player in db.query(Player).order_by(Player.jersey_number).all():
        asymmetries = metrics.build_asymmetries(player, defs)
        hq_ratios = metrics.build_hq_ratios(player)
        collected.extend(metrics.build_alerts(player, asymmetries, hq_ratios))

    if severity:
        collected = [a for a in collected if a.severity == severity]

    order = {"alert": 0, "warn": 1}
    collected.sort(key=lambda a: (order.get(a.severity, 2), a.player_name))
    return collected


@router.get("/distribution")
def metric_distribution(
    metric_key: str = Query(..., description="예: peak_torque, jump_height"),
    side: str = Query("NA"),
    speed_deg_s: float | None = Query(None),
    motion: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """지표 하나에 대한 팀 전체 최신값 분포. 이상치를 한눈에 보기 위한 것."""
    context: dict = {}
    if motion:
        context["motion"] = motion
    if speed_deg_s is not None:
        context["speed_deg_s"] = speed_deg_s
    ctx_key = metrics.context_key(context)

    defs = metrics.load_definitions(db)
    definition = metrics.definition_for(defs, metric_key)

    entries = []
    for player in db.query(Player).order_by(Player.jersey_number).all():
        grouped = metrics.collect_measurements(player.sessions)
        series = grouped.get((metric_key, side, ctx_key))
        if not series:
            continue
        tested_at, value, unit = series[-1]
        entries.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "position": player.position,
                "jersey_number": player.jersey_number,
                "value": value,
                "unit": unit or definition.unit,
                "tested_at": tested_at,
            }
        )

    values = [e["value"] for e in entries]
    for entry in entries:
        entry["percentile"] = metrics.percentile_rank(
            entry["value"], values, definition.higher_is_better
        )

    entries.sort(key=lambda e: e["value"], reverse=definition.higher_is_better)

    summary = None
    if values:
        ordered = sorted(values)
        mid = len(ordered) // 2
        median = (
            ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
        )
        summary = {
            "count": len(values),
            "min": min(values),
            "max": max(values),
            "mean": sum(values) / len(values),
            "median": median,
        }

    return {
        "metric_key": metric_key,
        "display_name": definition.display_name,
        "label": metrics.build_label(definition.display_name, side, context),
        "unit": definition.unit,
        "decimals": definition.decimals,
        "higher_is_better": definition.higher_is_better,
        "context": json.loads(ctx_key),
        "side": side,
        "summary": summary,
        "entries": entries,
    }
