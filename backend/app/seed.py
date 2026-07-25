"""데모용 시드 데이터 생성.

여기 들어가는 선수와 측정값은 전부 **가상 데이터**다. 실제 선수 기록이 아니며,
화면과 계산 로직을 검증하기 위한 것이다. 값의 범위는 성인 남자 농구 선수의
일반적인 등속성/점프/스프린트 측정 범위를 참고해 잡았다.

실행:
    python -m app.seed            # 비어 있을 때만 생성
    python -m app.seed --reset    # 기존 데이터를 지우고 다시 생성
"""

import argparse
import random
from datetime import date, datetime, timedelta

from .database import Base, SessionLocal, engine
from .models import (
    SIDE_LEFT,
    SIDE_NA,
    SIDE_RIGHT,
    TEST_BIODEX,
    TEST_CMJ,
    TEST_SPRINT,
    MetricDefinition,
    Player,
    TestResult,
    TestSession,
)

SEED = 20260725  # 실행할 때마다 같은 데이터가 나오도록 고정

METRIC_DEFINITIONS = [
    dict(
        metric_key="peak_torque",
        display_name="피크토크",
        unit="Nm",
        decimals=1,
        higher_is_better=True,
        asymmetry_warn_pct=10.0,
        asymmetry_alert_pct=15.0,
        test_type=TEST_BIODEX,
    ),
    dict(
        metric_key="peak_torque_bw_pct",
        display_name="체중 대비 피크토크",
        unit="%",
        decimals=1,
        higher_is_better=True,
        # 이 값은 피크토크를 체중으로 나눈 것이라 좌우 비대칭률이 피크토크와
        # 수학적으로 동일하다. 같은 경고를 두 번 내지 않도록 임계값을 두지 않는다.
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_BIODEX,
    ),
    dict(
        metric_key="fatigue",
        display_name="피로도",
        unit="%",
        decimals=1,
        higher_is_better=False,
        asymmetry_warn_pct=15.0,
        asymmetry_alert_pct=20.0,
        test_type=TEST_BIODEX,
    ),
    dict(
        metric_key="jump_height",
        display_name="점프 높이",
        unit="cm",
        decimals=1,
        higher_is_better=True,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_CMJ,
    ),
    dict(
        metric_key="peak_power",
        display_name="최고 파워",
        unit="W",
        decimals=0,
        higher_is_better=True,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_CMJ,
    ),
    dict(
        metric_key="takeoff_force",
        display_name="이지 최대힘",
        unit="N",
        decimals=0,
        higher_is_better=True,
        asymmetry_warn_pct=10.0,
        asymmetry_alert_pct=15.0,
        test_type=TEST_CMJ,
    ),
    dict(
        metric_key="rsi_mod",
        display_name="RSI(수정)",
        unit="",
        decimals=2,
        higher_is_better=True,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_CMJ,
    ),
    dict(
        metric_key="sprint_10m",
        display_name="10m 스프린트",
        unit="s",
        decimals=2,
        higher_is_better=False,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_SPRINT,
    ),
    dict(
        metric_key="sprint_20m",
        display_name="20m 스프린트",
        unit="s",
        decimals=2,
        higher_is_better=False,
        asymmetry_warn_pct=None,
        asymmetry_alert_pct=None,
        test_type=TEST_SPRINT,
    ),
]

# (이름, 등번호, 포지션, 출생연도, 신장cm, 체중kg, 윙스팬cm, 상태)
# note: 화면 검증을 위해 일부러 문제 상황을 심어둔 선수가 있다 (아래 PROFILE_OVERRIDES).
ROSTER = [
    ("김도현", 1, "G", 1998, 183.0, 80.5, 190.0, "active"),
    ("이준서", 3, "G", 2000, 187.5, 84.0, 194.0, "active"),
    ("박시우", 5, "G", 1996, 180.5, 78.0, 186.0, "active"),
    ("최민재", 7, "G", 2001, 189.0, 85.5, 197.0, "active"),
    ("정하준", 8, "G", 1999, 185.0, 82.0, 192.0, "rehab"),
    ("강태윤", 10, "F", 1997, 197.0, 93.5, 205.0, "active"),
    ("조성민", 11, "F", 1995, 199.5, 97.0, 208.0, "active"),
    ("윤지호", 13, "F", 2002, 196.0, 91.0, 203.0, "active"),
    ("임현우", 14, "F", 1998, 201.0, 99.5, 210.0, "active"),
    ("한승우", 15, "F", 2000, 195.5, 90.0, 202.0, "injured"),
    ("오재현", 17, "F", 1994, 198.0, 95.5, 206.0, "active"),
    ("서건우", 20, "C", 1996, 204.0, 106.0, 214.0, "active"),
    ("남기훈", 22, "C", 1999, 206.5, 110.5, 217.0, "active"),
    ("배주원", 24, "C", 2001, 203.0, 103.0, 212.0, "active"),
    ("문세빈", 32, "C", 1997, 208.0, 113.0, 219.0, "active"),
]

# 화면에서 경고 로직이 실제로 동작하는지 보려면 문제가 있는 케이스가 필요하다.
PROFILE_OVERRIDES = {
    "한승우": dict(asymmetry=0.19, stale_days=140),  # 부상 이탈 + 큰 좌우 차이
    "정하준": dict(asymmetry=0.135, hq=0.58),  # 재활 중 + 햄스트링 약화
    "박시우": dict(hq=0.57),  # H/Q 단독 경고
    "배주원": dict(asymmetry=0.115),  # 주의 수준 비대칭
}

# 각속도별 토크 감소 계수. 빠를수록 낼 수 있는 토크가 줄어든다.
SPEED_FACTORS = {60: 1.0, 180: 0.62}


def make_profile(rng: random.Random, name: str, position: str, weight: float) -> dict:
    """선수별 기준 능력치. 검사할 때마다 이 값 주변에서 흔들린다."""
    override = PROFILE_OVERRIDES.get(name, {})

    # 체중이 클수록 절대 토크가 크지만, 체중에 완전 비례하지는 않는다.
    base_ext = 2.55 * weight + rng.uniform(-18, 18)

    profile = dict(
        base_ext=base_ext,
        hq=override.get("hq", rng.uniform(0.62, 0.72)),
        asymmetry=override.get("asymmetry", rng.uniform(0.01, 0.075)),
        weak_side=rng.choice([SIDE_LEFT, SIDE_RIGHT]),
        fatigue=rng.uniform(27, 42),
        jump=rng.uniform(52, 68) - {"G": 0, "F": 2.5, "C": 6.0}[position],
        rsi=rng.uniform(0.42, 0.62),
        sprint10=rng.uniform(1.66, 1.80) + {"G": 0, "F": 0.03, "C": 0.07}[position],
        # 장기 추세: 시즌이 갈수록 조금 좋아지거나 조금 나빠진다.
        trend=rng.uniform(-0.02, 0.05),
        stale_days=override.get("stale_days", 0),
    )
    return profile


def side_factor(side: str, profile: dict) -> float:
    """약한 쪽에 비대칭만큼 낮은 계수를 준다."""
    return 1.0 - profile["asymmetry"] if side == profile["weak_side"] else 1.0


def jitter(rng: random.Random, pct: float) -> float:
    return 1.0 + rng.uniform(-pct, pct)


def biodex_results(rng: random.Random, profile: dict, weight: float, progress: float):
    """등속성 검사 한 회차의 측정값."""
    results = []
    growth = 1.0 + profile["trend"] * progress

    for speed, factor in SPEED_FACTORS.items():
        # H/Q 비율은 각속도가 올라갈수록 함께 올라간다(신전근이 굴곡근보다
        # 속도에 따라 더 크게 떨어지기 때문). 그 경향을 반영한다.
        hq_at_speed = profile["hq"] * (1 + 0.06 * (speed - 60) / 120)

        for side in (SIDE_LEFT, SIDE_RIGHT):
            ext = profile["base_ext"] * factor * side_factor(side, profile) * growth
            ext *= jitter(rng, 0.04)
            flex = ext * hq_at_speed * jitter(rng, 0.05)

            for motion, value in (("EXTENSION", ext), ("FLEXION", flex)):
                context = {"motion": motion, "speed_deg_s": speed}
                results.append(
                    TestResult(
                        metric_key="peak_torque",
                        side=side,
                        value=round(value, 1),
                        unit="Nm",
                        context=context,
                    )
                )
                results.append(
                    TestResult(
                        metric_key="peak_torque_bw_pct",
                        side=side,
                        value=round(value / weight * 100, 1),
                        unit="%",
                        context=context,
                    )
                )

            # 피로도는 빠른 속도(180°/s)에서만 측정하는 게 일반적이다.
            if speed == 180:
                for motion in ("EXTENSION", "FLEXION"):
                    results.append(
                        TestResult(
                            metric_key="fatigue",
                            side=side,
                            value=round(profile["fatigue"] * jitter(rng, 0.12), 1),
                            unit="%",
                            context={"motion": motion, "speed_deg_s": speed},
                        )
                    )
    return results


def cmj_results(rng: random.Random, profile: dict, weight: float, progress: float):
    growth = 1.0 + profile["trend"] * progress
    height = profile["jump"] * growth * jitter(rng, 0.05)
    # 대략적인 관계식으로 파워를 만든다(데모용 근사값).
    power = weight * 9.81 * (2 * 9.81 * height / 100) ** 0.5 * 2.6 * jitter(rng, 0.04)

    results = [
        TestResult(metric_key="jump_height", side=SIDE_NA, value=round(height, 1), unit="cm", context={}),
        TestResult(metric_key="peak_power", side=SIDE_NA, value=round(power), unit="W", context={}),
        TestResult(
            metric_key="rsi_mod",
            side=SIDE_NA,
            value=round(profile["rsi"] * growth * jitter(rng, 0.07), 2),
            unit="",
            context={},
        ),
    ]

    # 이지 최대힘은 좌우로 나뉘므로 등속성과 같은 비대칭 경향을 따르게 한다.
    for side in (SIDE_LEFT, SIDE_RIGHT):
        force = weight * 9.81 * 1.35 * side_factor(side, profile) * jitter(rng, 0.04)
        results.append(
            TestResult(
                metric_key="takeoff_force",
                side=side,
                value=round(force),
                unit="N",
                context={},
            )
        )
    return results


def sprint_results(rng: random.Random, profile: dict, progress: float):
    # 기록은 낮을수록 좋으므로 추세를 반대로 적용한다.
    improve = 1.0 - profile["trend"] * progress * 0.5
    t10 = profile["sprint10"] * improve * jitter(rng, 0.015)
    t20 = t10 * rng.uniform(1.72, 1.80)
    return [
        TestResult(metric_key="sprint_10m", side=SIDE_NA, value=round(t10, 2), unit="s", context={}),
        TestResult(metric_key="sprint_20m", side=SIDE_NA, value=round(t20, 2), unit="s", context={}),
    ]


def build_sessions(rng: random.Random, player: Player, profile: dict, today: date):
    """최근 약 6개월치 검사 이력을 만든다."""
    sessions: list[TestSession] = []
    # 부상 등으로 최근 검사가 없는 선수는 기준일을 과거로 당긴다.
    end = today - timedelta(days=profile["stale_days"])

    schedule = [
        (TEST_BIODEX, 70, "BIODEX System 4 Pro", biodex_results),
        (TEST_CMJ, 21, "Force Plate", cmj_results),
        (TEST_SPRINT, 42, "Timing Gate", sprint_results),
    ]

    for test_type, interval_days, device, builder in schedule:
        day = end
        occurrence = 0
        while day > today - timedelta(days=185) and occurrence < 12:
            # 0(가장 오래됨) ~ 1(최신) 사이의 진행도. 장기 추세 계산에 쓴다.
            progress = 1.0 - (end - day).days / 185.0
            tested_at = datetime.combine(day, datetime.min.time()) + timedelta(
                hours=rng.randint(9, 17)
            )

            if test_type == TEST_BIODEX:
                results = builder(rng, profile, player.weight_kg, progress)
            elif test_type == TEST_CMJ:
                results = builder(rng, profile, player.weight_kg, progress)
            else:
                results = builder(rng, profile, progress)

            session = TestSession(
                test_type=test_type,
                tested_at=tested_at,
                device=device,
                source="시드 데이터(가상)",
            )
            session.results = results
            sessions.append(session)

            day -= timedelta(days=interval_days)
            occurrence += 1

    sessions.sort(key=lambda s: s.tested_at)
    return sessions


def seed(reset: bool = False) -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if reset:
            db.query(TestResult).delete()
            db.query(TestSession).delete()
            db.query(Player).delete()
            db.query(MetricDefinition).delete()
            db.commit()
        elif db.query(Player).count() > 0:
            print("이미 데이터가 있습니다. 다시 만들려면 --reset 을 쓰세요.")
            return

        for definition in METRIC_DEFINITIONS:
            db.add(MetricDefinition(**definition))
        db.commit()

        rng = random.Random(SEED)
        today = date.today()

        for name, jersey, position, birth_year, height, weight, wingspan, status in ROSTER:
            player = Player(
                name=name,
                jersey_number=jersey,
                position=position,
                date_of_birth=date(birth_year, rng.randint(1, 12), rng.randint(1, 28)),
                height_cm=height,
                weight_kg=weight,
                wingspan_cm=wingspan,
                dominant_hand=rng.choices(["RIGHT", "LEFT"], weights=[85, 15])[0],
                status=status,
            )
            profile = make_profile(rng, name, position, weight)
            player.sessions = build_sessions(rng, player, profile, today)
            db.add(player)

        db.commit()

        players = db.query(Player).count()
        sessions = db.query(TestSession).count()
        results = db.query(TestResult).count()
        print(f"시드 완료: 선수 {players}명 / 검사 {sessions}건 / 측정값 {results}개")
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="데모용 가상 선수 데이터를 생성합니다.")
    parser.add_argument("--reset", action="store_true", help="기존 데이터를 지우고 다시 생성")
    args = parser.parse_args()
    seed(reset=args.reset)


if __name__ == "__main__":
    main()
