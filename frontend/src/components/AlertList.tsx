import { Link } from "react-router-dom";
import type { Alert } from "../api/types";

const KIND_LABEL: Record<Alert["kind"], string> = {
  asymmetry: "좌우 비대칭",
  hq_ratio: "H/Q 비율",
  stale_test: "검사 주기",
};

/** 심각도는 색 + 기호 + 글자를 함께 쓴다. 색 하나에 의미를 싣지 않는다. */
export function AlertList({
  alerts,
  showPlayer = true,
  emptyText = "확인이 필요한 항목이 없습니다.",
}: {
  alerts: Alert[];
  showPlayer?: boolean;
  emptyText?: string;
}) {
  if (!alerts.length) return <div className="empty">{emptyText}</div>;

  return (
    <div>
      {alerts.map((alert, i) => (
        <div className="alert-row" key={`${alert.player_id}-${alert.kind}-${i}`}>
          <span
            className={`alert-icon ${alert.severity}`}
            aria-label={alert.severity === "alert" ? "경고" : "주의"}
          >
            !
          </span>
          <div className="alert-body">
            {showPlayer && (
              <Link to={`/players/${alert.player_id}`} className="alert-who">
                {alert.player_name}
              </Link>
            )}
            <div className="alert-msg">
              <span className="muted">[{KIND_LABEL[alert.kind]}]</span>{" "}
              {alert.message}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
