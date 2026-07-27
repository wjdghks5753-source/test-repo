import type {
  Alert,
  Distribution,
  ImportPreview,
  ImportPreviewRow,
  MetricDefinition,
  PlayerOverview,
  PlayerSummary,
  SessionIndexRow,
  TestSession,
  TrendSeries,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    // FastAPI는 오류를 {detail: "..."} 로 준다. 사용자에게 그대로 보여준다.
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* 본문이 JSON이 아니면 상태 코드만 쓴다 */
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  players: () => request<PlayerSummary[]>("/api/players"),

  overview: (playerId: number) =>
    request<PlayerOverview>(`/api/players/${playerId}/overview`),

  sessions: (playerId: number) =>
    request<SessionIndexRow[]>(`/api/players/${playerId}/sessions`),

  session: (sessionId: number) =>
    request<TestSession>(`/api/sessions/${sessionId}`),

  trends: (playerId: number, metricKeys: string[], since?: Date) => {
    const params = new URLSearchParams();
    metricKeys.forEach((key) => params.append("metric_key", key));
    if (since) params.set("since", since.toISOString());
    return request<TrendSeries[]>(
      `/api/players/${playerId}/trends?${params.toString()}`
    );
  },

  metrics: () => request<MetricDefinition[]>("/api/metrics"),

  alerts: () => request<Alert[]>("/api/analytics/alerts"),

  distribution: (metricKey: string, side: string, context: Record<string, string>) => {
    const params = new URLSearchParams({ metric_key: metricKey, side, ...context });
    return request<Distribution>(`/api/analytics/distribution?${params.toString()}`);
  },

  previewImport: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportPreview>("/api/imports/biodex/preview", {
      method: "POST",
      body: form,
    });
  },

  commitImport: (payload: {
    player_id: number;
    tested_at: string;
    test_type: string;
    source?: string | null;
    device?: string | null;
    notes?: string | null;
    rows: ImportPreviewRow[];
  }) =>
    request<TestSession>("/api/imports/biodex/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
