"""데이터 모델.

측정값은 `TestResult`에 metric_key/side/context 형태의 key-value로 저장한다.
BIODEX 등속성 검사처럼 "각속도 × 신전/굴곡 × 좌/우" 격자로 나오는 데이터와
점프 높이 같은 단일 스칼라를 한 테이블에 담기 위한 구조이며, 장비가 늘어나도
스키마를 바꾸지 않아도 된다.
"""

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# 검사 종류
TEST_BIODEX = "BIODEX_ISOKINETIC"
TEST_CMJ = "CMJ"
TEST_SPRINT = "SPRINT"

# 좌우 구분. 좌우가 없는 지표(점프 높이 등)는 NA를 쓴다.
SIDE_LEFT = "LEFT"
SIDE_RIGHT = "RIGHT"
SIDE_NA = "NA"


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), index=True)
    jersey_number: Mapped[int] = mapped_column(Integer)
    position: Mapped[str] = mapped_column(String(2))  # G / F / C
    date_of_birth: Mapped[date] = mapped_column(Date)
    height_cm: Mapped[float] = mapped_column(Float)
    weight_kg: Mapped[float] = mapped_column(Float)
    wingspan_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    dominant_hand: Mapped[str] = mapped_column(String(10), default="RIGHT")
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/injured/rehab
    photo_url: Mapped[str | None] = mapped_column(String(300), nullable=True)

    sessions: Mapped[list["TestSession"]] = relationship(
        back_populates="player", cascade="all, delete-orphan", order_by="TestSession.tested_at"
    )

    @property
    def age(self) -> int:
        today = date.today()
        return (
            today.year
            - self.date_of_birth.year
            - ((today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day))
        )


class TestSession(Base):
    __tablename__ = "test_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    test_type: Mapped[str] = mapped_column(String(30), index=True)
    tested_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    device: Mapped[str | None] = mapped_column(String(60), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 가져오기 출처 추적용 (수기 입력 / CSV 파일명 / OCR 파일명)
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)

    player: Mapped["Player"] = relationship(back_populates="sessions")
    results: Mapped[list["TestResult"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class TestResult(Base):
    __tablename__ = "test_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("test_sessions.id", ondelete="CASCADE"), index=True
    )
    metric_key: Mapped[str] = mapped_column(String(60), index=True)
    side: Mapped[str] = mapped_column(String(10), default=SIDE_NA)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20), default="")
    # 등속성 검사의 각속도/동작 등 추가 문맥. 예: {"speed_deg_s": 60, "motion": "EXTENSION"}
    context: Mapped[dict] = mapped_column(JSON, default=dict)

    session: Mapped["TestSession"] = relationship(back_populates="results")


class MetricDefinition(Base):
    """지표의 표시 방법과 임계값. UI 라벨/임계값을 코드에 박지 않기 위한 테이블."""

    __tablename__ = "metric_definitions"
    __table_args__ = (UniqueConstraint("metric_key", name="uq_metric_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    metric_key: Mapped[str] = mapped_column(String(60), index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(20), default="")
    decimals: Mapped[int] = mapped_column(Integer, default=1)
    higher_is_better: Mapped[bool] = mapped_column(default=True)
    # 좌우 비대칭 경고 임계값(%). 좌우가 없는 지표는 None.
    asymmetry_warn_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    asymmetry_alert_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    test_type: Mapped[str] = mapped_column(String(30), default=TEST_BIODEX)
