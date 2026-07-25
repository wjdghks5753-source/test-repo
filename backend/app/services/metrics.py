"""측정 원시값에서 판단 가능한 파생 지표를 계산한다.

여기서 다루는 것:
  - 좌우 비대칭률
  - 체중 대비 토크 (Nm/kg)
  - H/Q 비율 (햄스트링/대퇴사두)
  - 팀(포지션군) 내 백분위
  - 직전 검사 대비 변화

계산 규칙은 등속성 검사 리포트에서 통용되는 정의를 따랐다. 임계값은
MetricDefinition 테이블에서 읽어오므로 코드 수정 없이 조정할 수 있다.
"""

import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..models import (
    SIDE_LEFT,
    SIDE_NA,
    SIDE_RIGHT,
    TEST_BIODEX,
    MetricDefinition,
    Player,
    TestResult,
    TestSession,
)
from ..schemas import (
    Alert,
    AsymmetryItem,
    HQRatioItem,
    MetricTile,
    TrendPoint,
    TrendSeries,
)

# 마지막 검사 이후 이 일수를 넘기면 "검사 오래됨" 경고를 띄운다.
STALE_TEST_DAYS = 90

# H/Q 비율 기준. 0.6 미만은 햄스트링 상대 약화로 ACL 부상 위험 신호로 본다.
HQ_ALERT_BELOW = 0.60
HQ_WARN_BELOW = 0.62

# H/Q 비율은 각속도에 따라 정상 범위가 달라진다. 통상적인 기준값(0.6)은
# 60°/s 기준이므로, 경고는 이 속도에서만 낸다. 다른 속도의 값도 화면에는
# 그대로 보여주되 경고로는 올리지 않는다.
HQ_ALERT_SPEED = 60.0

SIDE_KO = {SIDE_LEFT: "좌", SIDE_RIGHT: "우", SIDE_NA: ""}
MOTION_KO = {"EXTENSION": "신전", "FLEXION": "굴곡"}

# 선수 개요 화면에 띄울 대표 지표. (metric_key, context 부분일치)
# 나머지 원시값은 '검사 이력'과 '추세' 화면에서 전부 볼 수 있다.
HEADLINE_SPECS: list[tuple[str, dict]] = [
    ("peak_torque", {"speed_deg_s": 60, "motion": "EXTENSION"}),
    ("peak_torque", {"speed_deg_s": 60, "motion": "FLEXION"}),
    ("jump_height", {}),
    ("peak_power", {}),
    ("sprint_10m", {}),
    ("sprint_20m", {}),
]


def to_naive(value: datetime | None) -> datetime | None:
    """타임존이 붙은 시각을 로컬 기준 naive로 바꾼다.

    DB의 tested_at은 naive로 저장돼 있는데, 브라우저는 쿼리 파라미터를 UTC
    ISO 문자열(…Z)로 보낸다. 그대로 비교하면 TypeError가 난다.
    """
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone().replace(tzinfo=None)


def context_key(context: dict | None) -> str:
    """dict를 그룹핑용 안정적인 문자열 키로 바꾼다."""
    return json.dumps(context or {}, sort_keys=True, ensure_ascii=False)


def describe_context(context: dict | None) -> str:
    """{"speed_deg_s": 60, "motion": "EXTENSION"} -> "신전 60°/s" """
    context = context or {}
    parts = []
    motion = context.get("motion")
    if motion:
        parts.append(MOTION_KO.get(motion, motion))
    speed = context.get("speed_deg_s")
    if speed is not None:
        parts.append(f"{int(speed)}°/s")
    return " ".join(parts)


def build_label(display_name: str, side: str, context: dict | None) -> str:
    """사람이 읽는 지표 이름을 만든다. 예: "우 신전 피크토크 60°/s" """
    bits = []
    side_ko = SIDE_KO.get(side, "")
    if side_ko:
        bits.append(side_ko)
    ctx = describe_context(context)
    motion_part, _, speed_part = ctx.partition(" ")
    # 동작은 지표명 앞, 각속도는 뒤에 붙이는 게 읽기 자연스럽다.
    if motion_part and motion_part in MOTION_KO.values():
        bits.append(motion_part)
        bits.append(display_name)
        if speed_part:
            bits.append(speed_part)
    else:
        bits.append(display_name)
        if ctx:
            bits.append(ctx)
    return " ".join(b for b in bits if b)


def load_definitions(db: Session) -> dict[str, MetricDefinition]:
    return {d.metric_key: d for d in db.query(MetricDefinition).all()}


def _fallback_definition(metric_key: str) -> MetricDefinition:
    """정의가 없는 지표도 화면이 깨지지 않게 기본값으로 감싼다."""
    return MetricDefinition(
        metric_key=metric_key,
        display_name=metric_key,
        unit="",
        decimals=1,
        higher_is_better=True,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_BIODEX,
    )


def definition_for(defs: dict[str, MetricDefinition], metric_key: str) -> MetricDefinition:
    return defs.get(metric_key) or _fallback_definition(metric_key)


# --- 값 그룹핑 -------------------------------------------------------------


def collect_measurements(sessions: list[TestSession]) -> dict[tuple, list[tuple[datetime, float, str]]]:
    """(metric_key, side, context_key) -> [(측정시각, 값, 단위)] (시간 오름차순)."""
    grouped: dict[tuple, list[tuple[datetime, float, str]]] = {}
    for session in sessions:
        for r in session.results:
            key = (r.metric_key, r.side, context_key(r.context))
            grouped.setdefault(key, []).append((session.tested_at, r.value, r.unit))
    for series in grouped.values():
        series.sort(key=lambda x: x[0])
    return grouped


def asymmetry_pct(left: float, right: float) -> float:
    """좌우 차이를 큰 쪽 대비 백분율로. 두 값이 모두 0이면 0."""
    hi, lo = max(left, right), min(left, right)
    if hi == 0:
        return 0.0
    return (hi - lo) / hi * 100.0


def asymmetry_severity(diff_pct: float, definition: MetricDefinition) -> str:
    alert = definition.asymmetry_alert_pct
    warn = definition.asymmetry_warn_pct
    if alert is not None and diff_pct >= alert:
        return "alert"
    if warn is not None and diff_pct >= warn:
        return "warn"
    return "ok"


def percentile_rank(value: float, population: list[float], higher_is_better: bool) -> float | None:
    """모집단 안에서 value의 백분위(0~100).

    동점은 절반만 인정하는 표준 백분위 순위 방식을 쓴다.
    낮을수록 좋은 지표(스프린트 기록 등)는 방향을 뒤집는다.
    """
    if len(population) < 2:
        return None
    below = sum(1 for v in population if v < value)
    equal = sum(1 for v in population if v == value)
    pct = (below + 0.5 * equal) / len(population) * 100.0
    return pct if higher_is_better else 100.0 - pct


# --- 화면용 계산 -----------------------------------------------------------


def build_tiles(
    db: Session,
    player: Player,
    defs: dict[str, MetricDefinition],
    headline_only: bool = True,
) -> list[MetricTile]:
    grouped = collect_measurements(player.sessions)
    tiles: list[MetricTile] = []

    for (metric_key, side, ctx_key), series in grouped.items():
        context = json.loads(ctx_key)
        if headline_only and not _is_headline(metric_key, context):
            continue

        definition = definition_for(defs, metric_key)
        tested_at, value, unit = series[-1]
        previous = series[-2][1] if len(series) > 1 else None

        change = change_pct = None
        if previous is not None:
            change = value - previous
            if previous != 0:
                change_pct = change / abs(previous) * 100.0

        population = team_population(db, metric_key, side, ctx_key, player.position)
        pct = percentile_rank(value, population, definition.higher_is_better)

        per_kg = None
        if unit == "Nm" and player.weight_kg:
            per_kg = value / player.weight_kg

        tiles.append(
            MetricTile(
                metric_key=metric_key,
                display_name=definition.display_name,
                unit=unit or definition.unit,
                decimals=definition.decimals,
                label=build_label(definition.display_name, side, context),
                side=side,
                context=context,
                value=value,
                tested_at=tested_at,
                previous_value=previous,
                change=change,
                change_pct=change_pct,
                higher_is_better=definition.higher_is_better,
                percentile=pct,
                percentile_group_size=len(population),
                per_kg=per_kg,
                per_kg_unit="Nm/kg" if per_kg is not None else None,
            )
        )

    tiles.sort(key=lambda t: (_headline_order(t.metric_key, t.context), t.side))
    return tiles


def _is_headline(metric_key: str, context: dict) -> bool:
    for key, ctx in HEADLINE_SPECS:
        if key == metric_key and all(context.get(k) == v for k, v in ctx.items()):
            return True
    return False


def _headline_order(metric_key: str, context: dict) -> int:
    for i, (key, ctx) in enumerate(HEADLINE_SPECS):
        if key == metric_key and all(context.get(k) == v for k, v in ctx.items()):
            return i
    return len(HEADLINE_SPECS)


def team_population(
    db: Session, metric_key: str, side: str, ctx_key: str, position: str
) -> list[float]:
    """같은 포지션군 선수들의 해당 지표 '최신값' 목록.

    포지션군 인원이 너무 적으면(3명 미만) 팀 전체로 넓힌다. 비교 대상이
    한둘뿐인 백분위는 의미가 없기 때문.
    """
    values = _latest_values(db, metric_key, side, ctx_key, position)
    if len(values) < 3:
        values = _latest_values(db, metric_key, side, ctx_key, position=None)
    return values


def _latest_values(
    db: Session, metric_key: str, side: str, ctx_key: str, position: str | None
) -> list[float]:
    q = (
        db.query(Player.id, TestSession.tested_at, TestResult.value, TestResult.context)
        .join(TestSession, TestSession.player_id == Player.id)
        .join(TestResult, TestResult.session_id == TestSession.id)
        .filter(TestResult.metric_key == metric_key, TestResult.side == side)
    )
    if position:
        q = q.filter(Player.position == position)

    latest: dict[int, tuple[datetime, float]] = {}
    for player_id, tested_at, value, context in q.all():
        if context_key(context) != ctx_key:
            continue
        current = latest.get(player_id)
        if current is None or tested_at > current[0]:
            latest[player_id] = (tested_at, value)
    return [v for _, v in latest.values()]


def build_asymmetries(
    player: Player, defs: dict[str, MetricDefinition]
) -> list[AsymmetryItem]:
    """좌/우가 모두 있는 지표에 대해 최신 비대칭률을 계산한다."""
    grouped = collect_measurements(player.sessions)
    # (metric_key, context_key) -> {side: (tested_at, value, unit)}
    pairs: dict[tuple[str, str], dict[str, tuple[datetime, float, str]]] = {}
    for (metric_key, side, ctx_key), series in grouped.items():
        if side not in (SIDE_LEFT, SIDE_RIGHT):
            continue
        pairs.setdefault((metric_key, ctx_key), {})[side] = series[-1]

    items: list[AsymmetryItem] = []
    for (metric_key, ctx_key), sides in pairs.items():
        if SIDE_LEFT not in sides or SIDE_RIGHT not in sides:
            continue

        # 임계값이 없는 지표는 "비대칭을 판정하지 않는 지표"라는 뜻이다.
        # 그런 지표를 목록에 넣으면 전부 severity=ok로 그려져서, 실제로는
        # 큰 좌우 차이를 '정상'이라고 말하는 화면이 된다. 아예 빼는 게 맞다.
        # (체중 대비 피크토크가 대표 사례 — 피크토크와 비대칭률이 같다.)
        definition = definition_for(defs, metric_key)
        if definition.asymmetry_warn_pct is None and definition.asymmetry_alert_pct is None:
            continue
        left_at, left, unit = sides[SIDE_LEFT]
        right_at, right, _ = sides[SIDE_RIGHT]
        # 좌우가 다른 날짜에 측정됐다면 비교 의미가 약하므로 건너뛴다.
        if left_at != right_at:
            continue

        diff = asymmetry_pct(left, right)
        context = json.loads(ctx_key)
        items.append(
            AsymmetryItem(
                metric_key=metric_key,
                label=build_label(definition.display_name, SIDE_NA, context),
                unit=unit or definition.unit,
                left=left,
                right=right,
                diff_pct=diff,
                dominant_side=SIDE_RIGHT if right >= left else SIDE_LEFT,
                severity=asymmetry_severity(diff, definition),
                tested_at=left_at,
            )
        )

    items.sort(key=lambda i: i.diff_pct, reverse=True)
    return items


def build_hq_ratios(player: Player) -> list[HQRatioItem]:
    """H/Q 비율 = 굴곡(햄스트링) 피크토크 / 신전(대퇴사두) 피크토크.

    같은 좌우·같은 각속도끼리 짝지어 계산하며, 가장 최근 등속성 검사만 본다.
    """
    biodex = [s for s in player.sessions if s.test_type == TEST_BIODEX]
    if not biodex:
        return []
    latest = max(biodex, key=lambda s: s.tested_at)

    # (side, speed) -> {motion: value}
    buckets: dict[tuple[str, float], dict[str, float]] = {}
    for r in latest.results:
        if r.metric_key != "peak_torque":
            continue
        ctx = r.context or {}
        motion, speed = ctx.get("motion"), ctx.get("speed_deg_s")
        if motion is None or speed is None:
            continue
        buckets.setdefault((r.side, float(speed)), {})[motion] = r.value

    items: list[HQRatioItem] = []
    for (side, speed), motions in buckets.items():
        flexion = motions.get("FLEXION")
        extension = motions.get("EXTENSION")
        if flexion is None or not extension:
            continue
        ratio = flexion / extension
        if ratio < HQ_ALERT_BELOW:
            severity = "alert"
        elif ratio < HQ_WARN_BELOW:
            severity = "warn"
        else:
            severity = "ok"
        items.append(
            HQRatioItem(
                side=side,
                speed_deg_s=speed,
                flexion_peak_torque=flexion,
                extension_peak_torque=extension,
                ratio=ratio,
                severity=severity,
                tested_at=latest.tested_at,
            )
        )

    items.sort(key=lambda i: (i.speed_deg_s, i.side))
    return items


def build_trends(
    player: Player,
    defs: dict[str, MetricDefinition],
    metric_keys: list[str] | None = None,
    since: datetime | None = None,
) -> list[TrendSeries]:
    grouped = collect_measurements(player.sessions)
    series_list: list[TrendSeries] = []
    since = to_naive(since)

    for (metric_key, side, ctx_key), series in grouped.items():
        if metric_keys and metric_key not in metric_keys:
            continue
        points = [
            TrendPoint(tested_at=at, value=v)
            for at, v, _ in series
            if since is None or at >= since
        ]
        if not points:
            continue
        definition = definition_for(defs, metric_key)
        context = json.loads(ctx_key)
        series_list.append(
            TrendSeries(
                metric_key=metric_key,
                label=build_label(definition.display_name, side, context),
                unit=series[-1][2] or definition.unit,
                side=side,
                points=points,
            )
        )

    series_list.sort(key=lambda s: s.label)
    return series_list


def build_alerts(
    player: Player,
    asymmetries: list[AsymmetryItem],
    hq_ratios: list[HQRatioItem],
    now: datetime | None = None,
) -> list[Alert]:
    now = now or datetime.now()
    alerts: list[Alert] = []

    # 경고 목록은 "누구를 먼저 봐야 하는가"를 고르는 화면이다. 한 선수가
    # 같은 문제로 여러 줄을 차지하면 목록이 쓸모없어지므로, 문제 종류별로
    # 가장 심한 항목 하나만 올린다. 전체 내역은 선수 개요 화면에서 볼 수 있다.
    worst_asymmetry: dict[str, AsymmetryItem] = {}
    for item in asymmetries:
        if item.severity == "ok":
            continue
        current = worst_asymmetry.get(item.metric_key)
        if current is None or item.diff_pct > current.diff_pct:
            worst_asymmetry[item.metric_key] = item

    for item in worst_asymmetry.values():
        side_ko = SIDE_KO.get(item.dominant_side, item.dominant_side)
        alerts.append(
            Alert(
                player_id=player.id,
                player_name=player.name,
                kind="asymmetry",
                severity=item.severity,
                message=f"{item.label} 좌우 차이 {item.diff_pct:.1f}% ({side_ko}측 우세)",
            )
        )

    hq_candidates = [
        i for i in hq_ratios if i.severity != "ok" and i.speed_deg_s == HQ_ALERT_SPEED
    ]
    if hq_candidates:
        worst_hq = min(hq_candidates, key=lambda i: i.ratio)
        side_ko = SIDE_KO.get(worst_hq.side, worst_hq.side)
        alerts.append(
            Alert(
                player_id=player.id,
                player_name=player.name,
                kind="hq_ratio",
                severity=worst_hq.severity,
                message=(
                    f"{side_ko}측 H/Q 비율 {worst_hq.ratio:.2f} "
                    f"({int(worst_hq.speed_deg_s)}°/s) — 햄스트링 상대 약화"
                ),
            )
        )

    if player.sessions:
        last = max(s.tested_at for s in player.sessions)
        days = (now - last).days
        if days > STALE_TEST_DAYS:
            alerts.append(
                Alert(
                    player_id=player.id,
                    player_name=player.name,
                    kind="stale_test",
                    severity="warn",
                    message=f"마지막 검사 후 {days}일 경과",
                )
            )
    else:
        alerts.append(
            Alert(
                player_id=player.id,
                player_name=player.name,
                kind="stale_test",
                severity="warn",
                message="검사 기록 없음",
            )
        )

    order = {"alert": 0, "warn": 1}
    alerts.sort(key=lambda a: order.get(a.severity, 2))
    return alerts


def stale_cutoff(now: datetime | None = None) -> datetime:
    return (now or datetime.now()) - timedelta(days=STALE_TEST_DAYS)
