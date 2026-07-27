import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import type { ImportPreview } from "../api/types";
import { SIDE_LABEL, describeContext, num } from "../utils/format";

function todayLocalDatetime(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function ImportPage() {
  const navigate = useNavigate();
  const players = useAsync(() => api.players(), []);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [playerId, setPlayerId] = useState<string>("");
  const [testedAt, setTestedAt] = useState(todayLocalDatetime());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function runPreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setPreview(null);
    try {
      setPreview(await api.previewImport(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || !playerId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.commitImport({
        player_id: Number(playerId),
        tested_at: new Date(testedAt).toISOString(),
        test_type: preview.test_type,
        source: preview.source,
        device: "BIODEX",
        rows: preview.rows,
      });
      setDone(`검사 ${session.id}번으로 저장했습니다.`);
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>검사 결과 가져오기</h1>
          <p className="subtle">
            BIODEX 리포트(PDF·PNG) 또는 추출 도구가 만든 CSV를 올려 선수 기록에
            추가합니다.
          </p>
        </div>
      </div>

      <div className="split">
        <div>
          <div className="card section">
            <h2>1. 파일 선택</h2>
            <input
              type="file"
              accept=".csv,.pdf,.png,.jpg,.jpeg"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
                setDone(null);
              }}
            />
            <div style={{ marginTop: 12 }}>
              <button onClick={runPreview} disabled={!file || busy}>
                {busy ? "읽는 중…" : "내용 확인"}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
              PDF·PNG는 서버에서 OCR로 읽습니다. OCR 패키지가 설치돼 있지 않으면
              CLI로 CSV를 먼저 만든 뒤 그 CSV를 올리세요.
            </p>
          </div>

          {error && <div className="notice bad section">{error}</div>}
          {done && (
            <div className="notice section">
              {done}{" "}
              <button
                className="secondary"
                style={{ marginLeft: 8, padding: "3px 10px", fontSize: 12 }}
                onClick={() => navigate(`/players/${playerId}`)}
              >
                선수 프로필 보기
              </button>
            </div>
          )}

          {preview && (
            <div className="card section">
              <h2>
                2. 읽은 값 확인{" "}
                <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  {preview.rows.length}건 · {preview.source}
                </span>
              </h2>

              {preview.warnings.length > 0 && (
                <div className="notice" style={{ marginBottom: 12 }}>
                  {preview.warnings.map((warning, i) => (
                    <div key={i}>· {warning}</div>
                  ))}
                </div>
              )}

              <div className="table-scroll">
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
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        <td>{row.metric_key}</td>
                        <td className="muted">
                          {describeContext(row.context) || "—"}
                        </td>
                        <td>{SIDE_LABEL[row.side] ?? row.side}</td>
                        <td className="num">{num(row.value, 1)}</td>
                        <td className="muted">{row.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>3. 저장 대상</h2>

          <div style={{ marginBottom: 14 }}>
            <label className="field" htmlFor="player">
              선수
            </label>
            <select
              id="player"
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
            >
              <option value="">선택하세요</option>
              {(players.data ?? []).map((player) => (
                <option key={player.id} value={player.id}>
                  {player.jersey_number}. {player.name} ({player.position})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="field" htmlFor="tested-at">
              측정 일시
            </label>
            <input
              id="tested-at"
              type="datetime-local"
              value={testedAt}
              onChange={(e) => setTestedAt(e.target.value)}
            />
          </div>

          <button
            onClick={commit}
            disabled={!preview || !playerId || busy || !preview.rows.length}
          >
            {busy ? "저장 중…" : "이 선수 기록으로 저장"}
          </button>

          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            OCR·파싱은 리포트 서식에 따라 틀릴 수 있어서, 값을 확인한 뒤에만
            저장되도록 두 단계로 나눠 두었습니다.
          </p>
        </div>
      </div>
    </>
  );
}
