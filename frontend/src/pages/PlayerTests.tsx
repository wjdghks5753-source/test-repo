import { Fragment, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import type { PlayerOverview, TestSession } from "../api/types";
import {
  SIDE_LABEL,
  TEST_TYPE_LABEL,
  describeContext,
  formatDate,
  num,
} from "../utils/format";

/** 펼쳤을 때 보이는 원시 측정값 표. 화면에 계산된 값 말고 실제 값도 볼 수 있어야 한다. */
function SessionDetail({ sessionId }: { sessionId: number }) {
  const { data, error, loading } = useAsync<TestSession>(
    () => api.session(sessionId),
    [sessionId]
  );

  if (loading) return <div className="empty">불러오는 중…</div>;
  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return null;

  const sorted = [...data.results].sort(
    (a, b) =>
      a.metric_key.localeCompare(b.metric_key) ||
      describeContext(a.context).localeCompare(describeContext(b.context)) ||
      a.side.localeCompare(b.side)
  );

  return (
    <div className="table-scroll" style={{ padding: "4px 0 10px" }}>
      <table>
        <thead>
          <tr>
            <th>지표</th>
            <th>조건</th>
            <th>좌우</th>
            <th className="num">값</th>
            <th>단위</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((result) => (
            <tr key={result.id}>
              <td>{result.metric_key}</td>
              <td className="muted">{describeContext(result.context) || "—"}</td>
              <td>{SIDE_LABEL[result.side] ?? result.side}</td>
              <td className="num">{num(result.value, 2)}</td>
              <td className="muted">{result.unit || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlayerTestsPage() {
  const overview = useOutletContext<PlayerOverview>();
  const [openId, setOpenId] = useState<number | null>(null);
  const [testType, setTestType] = useState<string>("전체");

  const { data, error, loading } = useAsync(
    () => api.sessions(overview.player.id),
    [overview.player.id]
  );

  if (loading) return <div className="empty">불러오는 중…</div>;
  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return null;

  const types = ["전체", ...new Set(data.map((s) => s.test_type))];
  const rows = testType === "전체" ? data : data.filter((s) => s.test_type === testType);

  return (
    <div className="section">
      <div className="row" style={{ marginBottom: 14 }}>
        {types.map((type) => (
          <button
            key={type}
            className={`chip ${testType === type ? "on" : ""}`}
            onClick={() => setTestType(type)}
          >
            {type === "전체" ? "전체" : TEST_TYPE_LABEL[type] ?? type}
          </button>
        ))}
      </div>

      <div className="card table-scroll">
        <table>
          <thead>
            <tr>
              <th>측정일</th>
              <th>검사</th>
              <th>장비</th>
              <th className="num">측정값 수</th>
              <th>출처</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => (
              <Fragment key={session.id}>
                <tr>
                  <td>{formatDate(session.tested_at)}</td>
                  <td>{TEST_TYPE_LABEL[session.test_type] ?? session.test_type}</td>
                  <td className="muted">{session.device ?? "—"}</td>
                  <td className="num">{session.result_count}</td>
                  <td className="muted">{session.source ?? "—"}</td>
                  <td className="num">
                    <button
                      className="secondary"
                      style={{ padding: "3px 10px", fontSize: 12 }}
                      onClick={() =>
                        setOpenId(openId === session.id ? null : session.id)
                      }
                    >
                      {openId === session.id ? "접기" : "값 보기"}
                    </button>
                  </td>
                </tr>
                {openId === session.id && (
                  <tr>
                    <td colSpan={6} style={{ background: "var(--page)" }}>
                      <SessionDetail sessionId={session.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">검사 기록이 없습니다.</div>}
      </div>
    </div>
  );
}
