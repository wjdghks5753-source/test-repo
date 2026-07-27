"""API 입출력 스키마."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PlayerBase(BaseModel):
    name: str
    jersey_number: int
    position: str = Field(pattern="^(G|F|C)$")
    date_of_birth: date
    height_cm: float
    weight_kg: float
    wingspan_cm: float | None = None
    dominant_hand: str = "RIGHT"
    status: str = "active"
    photo_url: str | None = None


class PlayerCreate(PlayerBase):
    pass


class PlayerUpdate(BaseModel):
    name: str | None = None
    jersey_number: int | None = None
    position: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    wingspan_cm: float | None = None
    status: str | None = None
    photo_url: str | None = None


class PlayerOut(PlayerBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    age: int


class PlayerSummary(PlayerOut):
    """로스터 카드용. 최근 검사일과 미해결 경고 수를 함께 내려준다."""

    last_tested_at: datetime | None = None
    alert_count: int = 0


class TestResultIn(BaseModel):
    metric_key: str
    side: str = "NA"
    value: float
    unit: str = ""
    context: dict = Field(default_factory=dict)


class TestResultOut(TestResultIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class TestSessionIn(BaseModel):
    player_id: int
    test_type: str
    tested_at: datetime
    device: str | None = None
    notes: str | None = None
    source: str | None = None
    results: list[TestResultIn] = Field(default_factory=list)


class TestSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    player_id: int
    test_type: str
    tested_at: datetime
    device: str | None
    notes: str | None
    source: str | None
    results: list[TestResultOut]


class MetricDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    metric_key: str
    display_name: str
    unit: str
    decimals: int
    higher_is_better: bool
    asymmetry_warn_pct: float | None
    asymmetry_alert_pct: float | None
    test_type: str


# --- 분석 결과 ---


class MetricTile(BaseModel):
    """선수 개요 화면의 지표 타일 하나."""

    metric_key: str
    display_name: str
    unit: str
    decimals: int
    label: str  # 문맥까지 붙인 표시명. 예: "우 신전 피크토크 60°/s"
    side: str = "NA"
    context: dict = Field(default_factory=dict)
    value: float
    tested_at: datetime
    previous_value: float | None = None
    change: float | None = None
    change_pct: float | None = None
    higher_is_better: bool = True
    percentile: float | None = None  # 같은 포지션군 내 백분위
    percentile_group_size: int = 0
    # 체중 대비 토크. 체격 차가 큰 포지션 간 비교에 쓴다.
    per_kg: float | None = None
    per_kg_unit: str | None = None


class AsymmetryItem(BaseModel):
    metric_key: str
    label: str
    unit: str
    left: float
    right: float
    diff_pct: float  # (max-min)/max*100
    dominant_side: str  # 값이 큰 쪽
    severity: str  # ok / warn / alert
    tested_at: datetime


class HQRatioItem(BaseModel):
    """햄스트링/대퇴사두 비율 — ACL 부상 위험 지표."""

    side: str
    speed_deg_s: float
    flexion_peak_torque: float
    extension_peak_torque: float
    ratio: float
    severity: str  # ok / warn / alert
    tested_at: datetime


class TrendPoint(BaseModel):
    tested_at: datetime
    value: float


class TrendSeries(BaseModel):
    metric_key: str
    label: str
    unit: str
    side: str
    points: list[TrendPoint]


class Alert(BaseModel):
    player_id: int
    player_name: str
    kind: str  # asymmetry / hq_ratio / stale_test
    severity: str  # warn / alert
    message: str


class PlayerOverview(BaseModel):
    player: PlayerOut
    tiles: list[MetricTile]
    asymmetries: list[AsymmetryItem]
    hq_ratios: list[HQRatioItem]
    alerts: list[Alert]
    recent_sessions: list[TestSessionOut]


class ImportPreviewRow(BaseModel):
    metric_key: str
    side: str
    value: float
    unit: str
    context: dict
    raw_line: str | None = None


class ImportPreview(BaseModel):
    source: str
    test_type: str
    rows: list[ImportPreviewRow]
    warnings: list[str] = Field(default_factory=list)


class ImportCommit(BaseModel):
    player_id: int
    tested_at: datetime
    test_type: str
    source: str | None = None
    device: str | None = None
    notes: str | None = None
    rows: list[ImportPreviewRow]
