import { NavLink, Route, Routes } from "react-router-dom";
import { TeamDashboard } from "./pages/TeamDashboard";
import { PlayerLayout } from "./pages/PlayerLayout";
import { PlayerOverviewPage } from "./pages/PlayerOverview";
import { PlayerTestsPage } from "./pages/PlayerTests";
import { PlayerTrendsPage } from "./pages/PlayerTrends";
import { ImportPage } from "./pages/ImportPage";

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        선수 데이터 관리
        <span>체력측정 · 부상 위험 모니터링</span>
      </div>

      <nav className="nav">
        <div className="nav-heading">팀</div>
        <NavLink to="/" end>
          팀 현황
        </NavLink>

        <div className="nav-heading" style={{ marginTop: 14 }}>
          데이터
        </div>
        <NavLink to="/import">검사 결과 가져오기</NavLink>
      </nav>
    </aside>
  );
}

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<TeamDashboard />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/players/:playerId" element={<PlayerLayout />}>
            <Route index element={<PlayerOverviewPage />} />
            <Route path="tests" element={<PlayerTestsPage />} />
            <Route path="trends" element={<PlayerTrendsPage />} />
          </Route>
        </Routes>
      </main>
    </div>
  );
}
