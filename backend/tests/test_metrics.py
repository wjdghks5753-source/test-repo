"""파생 지표 계산 검증.

화면에 뜨는 숫자가 정의대로 나오는지 확인한다. 여기 값들은 손으로 계산해
확인한 것이다.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.models import (
    SIDE_LEFT,
    SIDE_NA,
    SIDE_RIGHT,
    TEST_BIODEX,
    MetricDefinition,
    Player,
    TestResult,
    TestSession,
)
from app.services import metrics


def make_definition(**overrides) -> MetricDefinition:
    values = dict(
        metric_key="peak_torque",
        display_name="피크토크",
        unit="Nm",
        decimals=1,
        higher_is_better=True,
        asymmetry_warn_pct=10.0,
        asymmetry_alert_pct=15.0,
        test_type=TEST_BIODEX,
    )
    values.update(overrides)
    return MetricDefinition(**values)


def torque(side: str, motion: str, speed: float, value: float) -> TestResult:
    return TestResult(
        metric_key="peak_torque",
        side=side,
        value=value,
        unit="Nm",
        context={"motion": motion, "speed_deg_s": speed},
    )


def make_player(sessions: list[TestSession]) -> Player:
    player = Player(
        id=1,
        name="테스트",
        jersey_number=1,
        position="G",
        date_of_birth=datetime(2000, 1, 1).date(),
        height_cm=185.0,
        weight_kg=80.0,
    )
    player.sessions = sessions
    return player


# --- 비대칭률 ---


@pytest.mark.parametrize(
    "left,right,expected",
    [
        (100.0, 100.0, 0.0),
        (80.0, 100.0, 20.0),  # (100-80)/100
        (100.0, 80.0, 20.0),  # 방향과 무관하게 같은 값
        (72.2, 87.8, pytest.approx(17.767, abs=0.01)),
        (0.0, 0.0, 0.0),  # 0으로 나누지 않는다
    ],
)
def test_asymmetry_pct(left, right, expected):
    assert metrics.asymmetry_pct(left, right) == expected


@pytest.mark.parametrize(
    "diff,expected",
    [(9.9, "ok"), (10.0, "warn"), (14.9, "warn"), (15.0, "alert"), (30.0, "alert")],
)
def test_asymmetry_severity_boundaries(diff, expected):
    assert metrics.asymmetry_severity(diff, make_definition()) == expected


def test_asymmetry_severity_without_thresholds_is_ok():
    definition = make_definition(asymmetry_warn_pct=None, asymmetry_alert_pct=None)
    assert metrics.asymmetry_severity(99.0, definition) == "ok"


# --- 백분위 ---


def test_percentile_rank_higher_is_better():
    population = [10.0, 20.0, 30.0, 40.0]
    # 30보다 작은 값 2개 + 동점(자기 자신) 0.5개 = 2.5 / 4 = 62.5%
    assert metrics.percentile_rank(30.0, population, True) == 62.5


def test_percentile_rank_lower_is_better_is_inverted():
    population = [10.0, 20.0, 30.0, 40.0]
    assert metrics.percentile_rank(30.0, population, False) == 37.5


def test_percentile_rank_needs_a_comparison_group():
    assert metrics.percentile_rank(10.0, [10.0], True) is None
    assert metrics.percentile_rank(10.0, [], True) is None


# --- H/Q 비율 ---


def test_hq_ratio_pairs_flexion_over_extension():
    session = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    session.results = [
        torque(SIDE_LEFT, "EXTENSION", 60, 200.0),
        torque(SIDE_LEFT, "FLEXION", 60, 110.0),
        torque(SIDE_RIGHT, "EXTENSION", 60, 200.0),
        torque(SIDE_RIGHT, "FLEXION", 60, 130.0),
    ]

    ratios = {(i.side, i.speed_deg_s): i for i in metrics.build_hq_ratios(make_player([session]))}

    left = ratios[(SIDE_LEFT, 60.0)]
    assert left.ratio == pytest.approx(0.55)
    assert left.severity == "alert"  # 0.60 미만

    right = ratios[(SIDE_RIGHT, 60.0)]
    assert right.ratio == pytest.approx(0.65)
    assert right.severity == "ok"


def test_hq_ratio_uses_only_the_latest_session():
    old = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 1, 1))
    old.results = [
        torque(SIDE_LEFT, "EXTENSION", 60, 200.0),
        torque(SIDE_LEFT, "FLEXION", 60, 100.0),
    ]
    new = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    new.results = [
        torque(SIDE_LEFT, "EXTENSION", 60, 200.0),
        torque(SIDE_LEFT, "FLEXION", 60, 140.0),
    ]

    ratios = metrics.build_hq_ratios(make_player([old, new]))
    assert len(ratios) == 1
    assert ratios[0].ratio == pytest.approx(0.70)


def test_hq_ratio_skips_incomplete_pairs():
    session = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    session.results = [torque(SIDE_LEFT, "EXTENSION", 60, 200.0)]  # 굴곡 없음
    assert metrics.build_hq_ratios(make_player([session])) == []


# --- 비대칭 목록 ---


def _asymmetry_session() -> TestSession:
    session = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    session.results = [
        torque(SIDE_LEFT, "EXTENSION", 60, 170.0),
        torque(SIDE_RIGHT, "EXTENSION", 60, 200.0),
    ]
    return session


def test_build_asymmetries_reports_diff_and_dominant_side():
    defs = {"peak_torque": make_definition()}
    items = metrics.build_asymmetries(make_player([_asymmetry_session()]), defs)

    assert len(items) == 1
    assert items[0].diff_pct == pytest.approx(15.0)
    assert items[0].dominant_side == SIDE_RIGHT
    assert items[0].severity == "alert"


def test_build_asymmetries_skips_metrics_without_thresholds():
    """임계값이 없는 지표를 목록에 넣으면 전부 '정상'으로 그려져,
    실제로는 큰 좌우 차이를 문제없다고 말하는 화면이 된다."""
    defs = {"peak_torque": make_definition(asymmetry_warn_pct=None, asymmetry_alert_pct=None)}
    assert metrics.build_asymmetries(make_player([_asymmetry_session()]), defs) == []


def test_build_asymmetries_skips_sides_measured_on_different_days():
    left = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    left.results = [torque(SIDE_LEFT, "EXTENSION", 60, 170.0)]
    right = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 8))
    right.results = [torque(SIDE_RIGHT, "EXTENSION", 60, 200.0)]

    defs = {"peak_torque": make_definition()}
    assert metrics.build_asymmetries(make_player([left, right]), defs) == []


# --- 경고 ---


def test_alerts_keep_only_the_worst_item_per_metric():
    session = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    session.results = [
        torque(SIDE_LEFT, "EXTENSION", 60, 170.0),  # 15.0%
        torque(SIDE_RIGHT, "EXTENSION", 60, 200.0),
        torque(SIDE_LEFT, "FLEXION", 60, 80.0),  # 20.0%
        torque(SIDE_RIGHT, "FLEXION", 60, 100.0),
    ]
    player = make_player([session])
    defs = {"peak_torque": make_definition()}

    asymmetries = metrics.build_asymmetries(player, defs)
    assert len(asymmetries) == 2  # 개요 화면에는 둘 다 보인다

    alerts = metrics.build_alerts(player, asymmetries, [], now=datetime(2026, 7, 2))
    asymmetry_alerts = [a for a in alerts if a.kind == "asymmetry"]
    assert len(asymmetry_alerts) == 1  # 경고 목록에는 심한 것 하나만
    assert "20.0%" in asymmetry_alerts[0].message


def test_alerts_only_flag_hq_at_the_reference_speed():
    """H/Q 정상 범위는 각속도에 따라 달라진다. 기준값 0.60은 60°/s 기준이다."""
    session = TestSession(test_type=TEST_BIODEX, tested_at=datetime(2026, 7, 1))
    session.results = [
        torque(SIDE_LEFT, "EXTENSION", 180, 200.0),
        torque(SIDE_LEFT, "FLEXION", 180, 100.0),  # 0.50 — 180°/s라 경고 대상 아님
    ]
    player = make_player([session])

    hq_ratios = metrics.build_hq_ratios(player)
    assert hq_ratios[0].severity == "alert"  # 값 자체는 낮게 표시된다

    alerts = metrics.build_alerts(player, [], hq_ratios, now=datetime(2026, 7, 2))
    assert [a for a in alerts if a.kind == "hq_ratio"] == []


def test_stale_test_alert_after_the_cutoff():
    now = datetime(2026, 7, 1)
    session = TestSession(
        test_type=TEST_BIODEX, tested_at=now - timedelta(days=metrics.STALE_TEST_DAYS + 1)
    )
    session.results = [torque(SIDE_NA, "EXTENSION", 60, 100.0)]

    alerts = metrics.build_alerts(make_player([session]), [], [], now=now)
    assert [a.kind for a in alerts] == ["stale_test"]


def test_player_without_tests_is_flagged():
    alerts = metrics.build_alerts(make_player([]), [], [], now=datetime(2026, 7, 1))
    assert alerts[0].kind == "stale_test"
    assert "검사 기록 없음" in alerts[0].message


# --- 시각 정규화 ---


def test_to_naive_converts_aware_datetimes():
    """브라우저는 UTC ISO(…Z)로 보내는데 DB의 시각은 naive다. 안 맞추면 비교가 터진다."""
    aware = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    result = metrics.to_naive(aware)

    assert result is not None
    assert result.tzinfo is None
    assert result == aware.astimezone().replace(tzinfo=None)


def test_to_naive_passes_through_naive_and_none():
    naive = datetime(2026, 7, 1, 12, 0)
    assert metrics.to_naive(naive) is naive
    assert metrics.to_naive(None) is None


# --- 라벨 ---


def test_build_label_reads_naturally():
    label = metrics.build_label("피크토크", SIDE_RIGHT, {"motion": "EXTENSION", "speed_deg_s": 60})
    assert label == "우 신전 피크토크 60°/s"


def test_build_label_without_context():
    assert metrics.build_label("점프 높이", SIDE_NA, {}) == "점프 높이"
