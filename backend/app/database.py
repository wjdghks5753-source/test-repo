"""SQLite 연결과 세션 관리."""

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("HOOPS_DB", str(BASE_DIR / "hoops.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False: uvicorn이 여러 스레드에서 같은 연결을 쓰기 때문에 필요.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
