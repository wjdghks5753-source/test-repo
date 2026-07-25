import { useOutletContext } from "react-router-dom";
import type { PlayerOverview as Overview } from "../api/types";
import { MetricCard } from "../components/MetricCard";
import { AsymmetryBar } from "../components/AsymmetryBar";
import { AlertList } from "../components/AlertList";
import { SeverityPill } from "../components/StatusPill";
import { TEST_TYPE_LABEL, SIDE_LABEL, formatDate, num } from "../utils/format";

export function PlayerOverviewPage() {
  const overview = useOutletContext<Overview>();

  return (
    <>
      <div className="section">
        <h2>최신 측정</h2>
        {overview.tiles.length ? (
          <div className="grid cols-4">
            {overview.tiles.map((tile) => (
              <MetricCard
                key={`${tile.metric_key}-${tile.side}-${JSON.stringify(tile.context)}`}
                tile={tile}
              />
            ))}
          </div>
        ) : (
          <div className="empty">측정 기록이 없습니다.</div>
        )}
      </div>

      <div className="split">
        <div className="section">
          <h2>좌우 비대칭</h2>
          <div className="card">
            {overview.asymmetries.length ? (
              overview.asymmetries
                .slice(0, 8)
                .map((item) => (
                  <AsymmetryBar
                    key={`${item.metric_key}-${item.label}`}
                    item={item}
                  />
                ))
            ) : (
              <div className="empty">좌우로 측정된 지표가 없습니다.</div>
            )}
          </div>
        </div>

        <div>
          <div className="section">
            <h2>확인이 필요한 항목</h2>
            <div className="card">
              <AlertList
                alerts={overview.alerts}
                showPlayer={false}
                emptyText="특이사항이 없습니다."
              />
            </div>
          </div>

          <div className="section">
            <h2>
              H/Q 비율{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                햄스트링 ÷ 대퇴사두
              </span>
            </h2>
            <div className="card">
              {overview.hq_ratios.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>측정</th>
                        <th className="num">굴곡</th>
                        <th className="num">신전</th>
                        <th className="num">비율</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.hq_ratios.map((item) => (
                        <tr key={`${item.side}-${item.speed_deg_s}`}>
                          <td>
                            {SIDE_LABEL[item.side]} · {item.speed_deg_s}°/s
                          </td>
                          <td className="num">
                            {num(item.flexion_peak_torque, 1)}
                          </td>
                          <td className="num">
                            {num(item.extension_peak_torque, 1)}
                          </td>
                          <td className="num">
                            <strong>{num(item.ratio, 2)}</strong>
                          </td>
                          <td>
                            <SeverityPill severity={item.severity} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">등속성 검사 기록이 없습니다.</div>
              )}
              <p className="muted" style={{ fontSize: 11.5, marginTop: 10, marginBottom: 0 }}>
                60°/s에서 0.60 미만이면 햄스트링이 상대적으로 약한 것으로 보고
                경고를 띄운다.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>최근 검사</h2>
        <div className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th>측정일</th>
                <th>검사</th>
                <th>장비</th>
                <th className="num">측정값 수</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {overview.recent_sessions.map((session) => (
                <tr key={session.id}>
                  <td>{formatDate(session.tested_at)}</td>
                  <td>{TEST_TYPE_LABEL[session.test_type] ?? session.test_type}</td>
                  <td className="muted">{session.device ?? "—"}</td>
                  <td className="num">{session.results.length}</td>
                  <td className="muted">{session.source ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!overview.recent_sessions.length && (
            <div className="empty">검사 기록이 없습니다.</div>
          )}
        </div>
      </div>
    </>
  );
}
