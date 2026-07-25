import type { MetricTile } from "../api/types";
import { formatDate, num, signed } from "../utils/format";

/** 변화량의 색은 "좋아졌는가"로 정한다. 스프린트 기록처럼 낮을수록 좋은 지표는 반대. */
function deltaClass(tile: MetricTile): string {
  if (tile.change === null || tile.change === 0) return "flat";
  const improved = tile.higher_is_better ? tile.change > 0 : tile.change < 0;
  return improved ? "up" : "down";
}

export function MetricCard({ tile }: { tile: MetricTile }) {
  const delta = deltaClass(tile);

  return (
    <div className="card">
      <div className="tile-label">{tile.label}</div>

      <div className="tile-value">
        {num(tile.value, tile.decimals)}
        <span className="tile-unit">{tile.unit}</span>
      </div>

      {tile.per_kg !== null && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          체중 대비 {num(tile.per_kg, 2)} {tile.per_kg_unit}
        </div>
      )}

      <div className="tile-foot">
        <span className={`delta ${delta}`}>
          {tile.change === null
            ? "첫 측정"
            : `${signed(tile.change, tile.decimals)} ${
                tile.change_pct === null ? "" : `(${signed(tile.change_pct, 1)}%)`
              }`}
        </span>
        <span>{formatDate(tile.tested_at)}</span>
      </div>

      {tile.percentile !== null && (
        <>
          <div className="meter" title={`팀 내 백분위 ${Math.round(tile.percentile)}%`}>
            <div style={{ width: `${Math.max(2, tile.percentile)}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
            같은 포지션 {tile.percentile_group_size}명 중 상위{" "}
            {Math.round(100 - tile.percentile)}%
          </div>
        </>
      )}
    </div>
  );
}
