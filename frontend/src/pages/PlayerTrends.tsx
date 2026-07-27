import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { TrendChart } from "../components/TrendChart";
import type { PlayerOverview } from "../api/types";
import { TEST_TYPE_LABEL } from "../utils/format";

const RANGES = [
  { label: "3개월", months: 3 },
  { label: "6개월", months: 6 },
  { label: "전체", months: 0 },
];

export function PlayerTrendsPage() {
  const overview = useOutletContext<PlayerOverview>();
  const [selected, setSelected] = useState<string[]>(["peak_torque"]);
  const [months, setMonths] = useState(6);

  const definitions = useAsync(() => api.metrics(), []);

  const since = useMemo(() => {
    if (!months) return undefined;
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d;
  }, [months]);

  const trends = useAsync(
    () => api.trends(overview.player.id, selected, since),
    [overview.player.id, selected.join(","), since?.toISOString()]
  );

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key]
    );
  }

  // H/Q 기준선은 비율 지표를 볼 때만 의미가 있으므로 그때만 그린다.
  const thresholds =
    selected.length === 1 && selected[0] === "hq_ratio"
      ? [{ value: 0.6, label: "H/Q 0.60" }]
      : [];

  const grouped = useMemo(() => {
    const byType = new Map<string, { key: string; name: string }[]>();
    for (const def of definitions.data ?? []) {
      const list = byType.get(def.test_type) ?? [];
      list.push({ key: def.metric_key, name: def.display_name });
      byType.set(def.test_type, list);
    }
    return [...byType.entries()];
  }, [definitions.data]);

  return (
    <div className="section">
      {/* 필터는 차트 위 한 줄에. */}
      <div className="card" style={{ marginBottom: 16 }}>
        {grouped.map(([testType, metrics]) => (
          <div key={testType} style={{ marginBottom: 12 }}>
            <div className="vital-label" style={{ marginBottom: 6 }}>
              {TEST_TYPE_LABEL[testType] ?? testType}
            </div>
            <div className="row">
              {metrics.map((metric) => (
                <button
                  key={metric.key}
                  className={`chip ${selected.includes(metric.key) ? "on" : ""}`}
                  onClick={() => toggle(metric.key)}
                >
                  {metric.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div style={{ borderTop: "1px solid var(--gridline)", paddingTop: 12 }}>
          <div className="vital-label" style={{ marginBottom: 6 }}>
            기간
          </div>
          <div className="row">
            {RANGES.map((range) => (
              <button
                key={range.label}
                className={`chip ${months === range.months ? "on" : ""}`}
                onClick={() => setMonths(range.months)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        {!selected.length ? (
          <div className="empty">위에서 볼 지표를 하나 이상 고르세요.</div>
        ) : trends.error ? (
          <div className="notice bad">{trends.error}</div>
        ) : trends.data ? (
          <TrendChart series={trends.data} thresholds={thresholds} height={380} />
        ) : (
          <div className="empty">불러오는 중…</div>
        )}
      </div>

      {/* 차트에서 읽기 어려운 값을 위한 표 — 색에만 기대지 않기 위한 대체 경로. */}
      {trends.data && trends.data.length > 0 && (
        <div className="section" style={{ marginTop: 20 }}>
          <h2>측정값 표</h2>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th>지표</th>
                  <th className="num">측정 횟수</th>
                  <th className="num">최초</th>
                  <th className="num">최근</th>
                  <th className="num">변화</th>
                </tr>
              </thead>
              <tbody>
                {trends.data.map((series) => {
                  const first = series.points[0]?.value;
                  const last = series.points[series.points.length - 1]?.value;
                  const change =
                    first !== undefined && last !== undefined ? last - first : null;
                  return (
                    <tr key={`${series.metric_key}-${series.side}-${series.label}`}>
                      <td>
                        {series.label}
                        {series.unit ? ` (${series.unit})` : ""}
                      </td>
                      <td className="num">{series.points.length}</td>
                      <td className="num">{first?.toFixed(2) ?? "—"}</td>
                      <td className="num">{last?.toFixed(2) ?? "—"}</td>
                      <td className="num">
                        {change === null
                          ? "—"
                          : `${change > 0 ? "+" : ""}${change.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
