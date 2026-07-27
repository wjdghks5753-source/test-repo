import type { AsymmetryItem } from "../api/types";
import { SeverityPill } from "./StatusPill";
import { num } from "../utils/format";

const FILL: Record<string, string> = {
  ok: "var(--status-good)",
  warn: "var(--status-warning)",
  alert: "var(--status-critical)",
};

/**
 * 좌/우를 가운데 축 기준으로 마주보게 그린다. 두 막대의 길이 차이가
 * 그대로 비대칭이라, 숫자를 읽기 전에 눈으로 먼저 잡히게 하는 것이 목적이다.
 */
export function AsymmetryBar({ item }: { item: AsymmetryItem }) {
  const max = Math.max(item.left, item.right) || 1;
  const fill = FILL[item.severity];

  return (
    <div className="asym">
      <div className="asym-head">
        <span className="asym-name">{item.label}</span>
        <span className="asym-pct" style={{ color: fill }}>
          {num(item.diff_pct, 1)}%
        </span>
      </div>

      <div className="asym-bars">
        <div className="asym-track left">
          <div
            className="asym-fill"
            style={{ width: `${(item.left / max) * 100}%`, background: fill }}
          />
        </div>
        <div className="asym-side">좌 · 우</div>
        <div className="asym-track right">
          <div
            className="asym-fill"
            style={{ width: `${(item.right / max) * 100}%`, background: fill }}
          />
        </div>
      </div>

      <div className="asym-legend">
        <span>
          {num(item.left, 1)} {item.unit}
        </span>
        <SeverityPill severity={item.severity} />
        <span>
          {num(item.right, 1)} {item.unit}
        </span>
      </div>
    </div>
  );
}
