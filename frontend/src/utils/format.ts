export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

/** 시리즈 색은 슬롯 순서를 고정해서 쓴다. 8개를 넘으면 순환시키지 않고 잘라낸다. */
export const MAX_SERIES = SERIES_VARS.length;

export function num(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function signed(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${num(value, decimals)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / 86_400_000);
}

export function daysAgoLabel(iso: string | null | undefined): string {
  const days = daysAgo(iso);
  if (days === null) return "검사 없음";
  if (days <= 0) return "오늘";
  return `${days}일 전`;
}

export const POSITION_LABEL: Record<string, string> = {
  G: "가드",
  F: "포워드",
  C: "센터",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "정상",
  injured: "부상",
  rehab: "재활",
};

export const TEST_TYPE_LABEL: Record<string, string> = {
  BIODEX_ISOKINETIC: "등속성 근력",
  CMJ: "수직 점프",
  SPRINT: "스프린트",
};

export const SIDE_LABEL: Record<string, string> = {
  LEFT: "좌",
  RIGHT: "우",
  NA: "—",
};

export const MOTION_LABEL: Record<string, string> = {
  EXTENSION: "신전",
  FLEXION: "굴곡",
};

/** 측정 문맥(각속도/동작)을 사람이 읽는 문자열로. */
export function describeContext(context: Record<string, unknown>): string {
  const parts: string[] = [];
  const motion = context.motion as string | undefined;
  if (motion) parts.push(MOTION_LABEL[motion] ?? motion);
  const speed = context.speed_deg_s as number | undefined;
  if (speed !== undefined) parts.push(`${speed}°/s`);
  return parts.join(" ");
}
