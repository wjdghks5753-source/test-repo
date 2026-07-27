import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { AlertList } from "../components/AlertList";
import { PlayerStatusPill } from "../components/StatusPill";
import { POSITION_LABEL, daysAgo, daysAgoLabel } from "../utils/format";
import type { PlayerSummary } from "../api/types";

const POSITIONS = ["전체", "G", "F", "C"] as const;

function PlayerCard({ player }: { player: PlayerSummary }) {
  const stale = (daysAgo(player.last_tested_at) ?? 999) > 90;

  return (
    <Link to={`/players/${player.id}`} className="player-card">
      <div className="player-top">
        <div className="avatar">{player.jersey_number}</div>
        <div style={{ minWidth: 0 }}>
          <div className="player-name">{player.name}</div>
          <div className="player-meta">
            {POSITION_LABEL[player.position]} · {player.height_cm}cm ·{" "}
            {player.weight_kg}kg
          </div>
        </div>
      </div>

      <div className="player-foot">
        <PlayerStatusPill status={player.status} />
        <span className={stale ? "" : "muted"} style={stale ? { color: "var(--status-warning)" } : undefined}>
          {daysAgoLabel(player.last_tested_at)}
          {player.alert_count > 0 && ` · 확인 ${player.alert_count}건`}
        </span>
      </div>
    </Link>
  );
}

export function TeamDashboard() {
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("전체");

  const players = useAsync(() => api.players(), []);
  const alerts = useAsync(() => api.alerts(), []);

  if (players.error) return <div className="notice bad">{players.error}</div>;
  if (!players.data) return <div className="empty">불러오는 중…</div>;

  const filtered =
    position === "전체"
      ? players.data
      : players.data.filter((p) => p.position === position);

  const alertCount = alerts.data?.filter((a) => a.severity === "alert").length ?? 0;
  const warnCount = alerts.data?.filter((a) => a.severity === "warn").length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>팀 현황</h1>
          <p className="subtle">
            선수 {players.data.length}명 · 확인 필요 {alertCount + warnCount}건
            {alertCount > 0 && ` (경고 ${alertCount}건)`}
          </p>
        </div>

        {/* 필터는 차트/목록 위 한 줄에 모아 둔다. */}
        <div className="row">
          {POSITIONS.map((p) => (
            <button
              key={p}
              className={`chip ${position === p ? "on" : ""}`}
              onClick={() => setPosition(p)}
            >
              {p === "전체" ? "전체" : `${p} · ${POSITION_LABEL[p]}`}
            </button>
          ))}
        </div>
      </div>

      <div className="split">
        <div className="section">
          <h2>로스터</h2>
          <div className="grid cols-3">
            {filtered.map((player) => (
              <PlayerCard key={player.id} player={player} />
            ))}
          </div>
          {!filtered.length && <div className="empty">해당 포지션 선수가 없습니다.</div>}
        </div>

        <div className="section">
          <h2>확인이 필요한 선수</h2>
          <div className="card">
            {alerts.error ? (
              <div className="notice bad">{alerts.error}</div>
            ) : alerts.data ? (
              <AlertList alerts={alerts.data} />
            ) : (
              <div className="empty">불러오는 중…</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
