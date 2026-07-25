import { NavLink } from "react-router-dom";
import type { Player } from "../api/types";
import { PlayerStatusPill } from "./StatusPill";
import { POSITION_LABEL, num } from "../utils/format";

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="vital-label">{label}</div>
      <div className="vital-value">{value}</div>
    </div>
  );
}

export function PlayerHeader({ player }: { player: Player }) {
  return (
    <>
      <div className="card">
        <div className="profile-head">
          <div className="avatar avatar-lg">{player.jersey_number}</div>

          <div>
            <h1>{player.name}</h1>
            <p className="subtle">
              {POSITION_LABEL[player.position] ?? player.position} · 만 {player.age}세
              · {player.dominant_hand === "LEFT" ? "왼손잡이" : "오른손잡이"}
            </p>
            <div style={{ marginTop: 8 }}>
              <PlayerStatusPill status={player.status} />
            </div>
          </div>

          <div className="vitals">
            <Vital label="신장" value={`${num(player.height_cm, 1)} cm`} />
            <Vital label="체중" value={`${num(player.weight_kg, 1)} kg`} />
            <Vital
              label="윙스팬"
              value={player.wingspan_cm ? `${num(player.wingspan_cm, 1)} cm` : "—"}
            />
          </div>
        </div>
      </div>

      <nav className="tabs">
        <NavLink to={`/players/${player.id}`} end>
          개요
        </NavLink>
        <NavLink to={`/players/${player.id}/tests`}>검사 이력</NavLink>
        <NavLink to={`/players/${player.id}/trends`}>추세</NavLink>
      </nav>
    </>
  );
}
