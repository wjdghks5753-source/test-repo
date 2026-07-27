"""FastAPI 앱 진입점."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, engine
from .routers import analytics, imports, players, tests

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="프로농구단 선수 데이터 관리",
    description="선수별 체력측정 데이터를 누적하고 비대칭·기준치 이탈을 추적한다.",
    version="1.0.0",
)

# 개발 중에는 프론트(Vite, 5173)가 다른 포트에서 뜬다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router)
app.include_router(tests.router)
app.include_router(analytics.router)
app.include_router(imports.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# 프론트를 빌드해 뒀다면(frontend/dist) 같은 서버에서 함께 서빙한다.
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount(
        "/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets"
    )

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        """SPA 라우팅: API가 아닌 경로는 전부 index.html로 넘긴다."""
        return FileResponse(FRONTEND_DIST / "index.html")
