import { Outlet, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PlayerHeader } from "../components/PlayerHeader";

/** 선수 하위 3개 탭이 같은 개요 데이터를 공유하도록 한 번만 불러온다. */
export function PlayerLayout() {
  const { playerId } = useParams();
  const id = Number(playerId);

  const { data, error, loading } = useAsync(() => api.overview(id), [id]);

  if (loading) return <div className="empty">불러오는 중…</div>;
  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return null;

  return (
    <>
      <PlayerHeader player={data.player} />
      <Outlet context={data} />
    </>
  );
}
