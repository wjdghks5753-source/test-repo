export interface Player {
  id: number;
  name: string;
  jersey_number: number;
  position: "G" | "F" | "C";
  date_of_birth: string;
  height_cm: number;
  weight_kg: number;
  wingspan_cm: number | null;
  dominant_hand: string;
  status: string;
  photo_url: string | null;
  age: number;
}

export interface PlayerSummary extends Player {
  last_tested_at: string | null;
  alert_count: number;
}

export interface MetricTile {
  metric_key: string;
  display_name: string;
  unit: string;
  decimals: number;
  label: string;
  side: string;
  context: Record<string, unknown>;
  value: number;
  tested_at: string;
  previous_value: number | null;
  change: number | null;
  change_pct: number | null;
  higher_is_better: boolean;
  percentile: number | null;
  percentile_group_size: number;
  per_kg: number | null;
  per_kg_unit: string | null;
}

export type Severity = "ok" | "warn" | "alert";

export interface AsymmetryItem {
  metric_key: string;
  label: string;
  unit: string;
  left: number;
  right: number;
  diff_pct: number;
  dominant_side: "LEFT" | "RIGHT";
  severity: Severity;
  tested_at: string;
}

export interface HQRatioItem {
  side: string;
  speed_deg_s: number;
  flexion_peak_torque: number;
  extension_peak_torque: number;
  ratio: number;
  severity: Severity;
  tested_at: string;
}

export interface Alert {
  player_id: number;
  player_name: string;
  kind: "asymmetry" | "hq_ratio" | "stale_test";
  severity: "warn" | "alert";
  message: string;
}

export interface TestResult {
  id: number;
  metric_key: string;
  side: string;
  value: number;
  unit: string;
  context: Record<string, unknown>;
}

export interface TestSession {
  id: number;
  player_id: number;
  test_type: string;
  tested_at: string;
  device: string | null;
  notes: string | null;
  source: string | null;
  results: TestResult[];
}

export interface SessionIndexRow {
  id: number;
  test_type: string;
  tested_at: string;
  device: string | null;
  notes: string | null;
  source: string | null;
  result_count: number;
}

export interface PlayerOverview {
  player: Player;
  tiles: MetricTile[];
  asymmetries: AsymmetryItem[];
  hq_ratios: HQRatioItem[];
  alerts: Alert[];
  recent_sessions: TestSession[];
}

export interface TrendSeries {
  metric_key: string;
  label: string;
  unit: string;
  side: string;
  points: { tested_at: string; value: number }[];
}

export interface MetricDefinition {
  metric_key: string;
  display_name: string;
  unit: string;
  decimals: number;
  higher_is_better: boolean;
  asymmetry_warn_pct: number | null;
  asymmetry_alert_pct: number | null;
  test_type: string;
}

export interface DistributionEntry {
  player_id: number;
  player_name: string;
  position: string;
  jersey_number: number;
  value: number;
  unit: string;
  tested_at: string;
  percentile: number | null;
}

export interface Distribution {
  metric_key: string;
  display_name: string;
  label: string;
  unit: string;
  decimals: number;
  higher_is_better: boolean;
  context: Record<string, unknown>;
  side: string;
  summary: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
  } | null;
  entries: DistributionEntry[];
}

export interface ImportPreviewRow {
  metric_key: string;
  side: string;
  value: number;
  unit: string;
  context: Record<string, unknown>;
  raw_line: string | null;
}

export interface ImportPreview {
  source: string;
  test_type: string;
  rows: ImportPreviewRow[];
  warnings: string[];
}
