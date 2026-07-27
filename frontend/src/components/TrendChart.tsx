import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendSeries } from "../api/types";
import { MAX_SERIES, SERIES_VARS, formatDate, num } from "../utils/format";

interface Row {
  ts: number;
  [seriesKey: string]: number | null | undefined;
}

/** 시리즈마다 측정일이 달라서, 날짜를 축으로 하나의 행 집합으로 합친다. */
function mergeByDate(series: TrendSeries[]): Row[] {
  const byTs = new Map<number, Row>();
  series.forEach((s, i) => {
    for (const point of s.points) {
      const ts = new Date(point.tested_at).getTime();
      const row = byTs.get(ts) ?? { ts };
      row[`s${i}`] = point.value;
      byTs.set(ts, row);
    }
  });
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function TrendTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: number;
  series: TrendSeries[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{formatDate(new Date(label!).toISOString())}</div>
      {payload.map((entry) => {
        const index = Number(entry.dataKey.replace("s", ""));
        const s = series[index];
        if (!s) return null;
        return (
          <div className="tooltip-row" key={entry.dataKey}>
            <span
              className="legend-key"
              style={{ background: SERIES_VARS[index % MAX_SERIES] }}
            />
            <span>{s.label}</span>
            <strong style={{ marginLeft: "auto" }}>
              {num(entry.value, 2)} {s.unit}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({
  series,
  thresholds = [],
  height = 320,
}: {
  series: TrendSeries[];
  /** 기준선. 예: H/Q 0.6 하한선 */
  thresholds?: { value: number; label: string }[];
  height?: number;
}) {
  const shown = series.slice(0, MAX_SERIES);
  const data = mergeByDate(shown);

  if (!data.length) {
    return <div className="empty">선택한 기간에 측정 기록이 없습니다.</div>;
  }

  return (
    <>
      {/* 시리즈가 2개 이상이면 범례를 항상 둔다 — 색만으로 구분하게 두지 않는다. */}
      {shown.length > 1 && (
        <div className="chart-legend">
          {shown.map((s, i) => (
            <span className="legend-item" key={`${s.metric_key}-${s.side}-${i}`}>
              <span
                className="legend-key"
                style={{ background: SERIES_VARS[i % MAX_SERIES] }}
              />
              {s.label}
              {s.unit ? ` (${s.unit})` : ""}
            </span>
          ))}
        </div>
      )}

      {series.length > MAX_SERIES && (
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
          지표가 많아 {MAX_SERIES}개만 표시합니다. 위에서 지표를 줄여 보세요.
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--gridline)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => formatDate(new Date(ts).toISOString()).slice(5)}
            stroke="var(--axis)"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            stroke="var(--axis)"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={52}
            // 선 그래프는 길이가 아니라 위치로 읽으므로 0에서 시작할 필요가 없다.
            // 0 기준으로 두면 여러 지표가 위쪽에 뭉쳐서 변화가 안 보인다.
            domain={["auto", "auto"]}
          />
          <Tooltip
            content={<TrendTooltip series={shown} />}
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
          />
          {thresholds.map((t) => (
            <ReferenceLine
              key={t.label}
              y={t.value}
              stroke="var(--status-critical)"
              strokeWidth={1}
              label={{
                value: t.label,
                position: "insideTopRight",
                fill: "var(--text-secondary)",
                fontSize: 11,
              }}
            />
          ))}
          {shown.map((s, i) => (
            <Line
              key={`${s.metric_key}-${s.side}-${i}`}
              type="monotone"
              dataKey={`s${i}`}
              stroke={SERIES_VARS[i % MAX_SERIES]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              // 점이 선을 가로지를 때도 읽히도록 표면색 링을 두른다.
              dot={{ r: 3, strokeWidth: 2, stroke: "var(--surface-1)" }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface-1)" }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}
