import type { Severity } from "../api/types";

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: "정상",
  warn: "주의",
  alert: "경고",
};

/** 상태는 색만으로 전달하지 않는다. 점(색) + 글자를 항상 함께 낸다. */
export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span className="pill">
      <span className={`dot dot-${severity}`} />
      {SEVERITY_TEXT[severity]}
    </span>
  );
}

export function PlayerStatusPill({ status }: { status: string }) {
  const dot =
    status === "injured" ? "dot-alert" : status === "rehab" ? "dot-warn" : "dot-ok";
  const label =
    status === "injured" ? "부상" : status === "rehab" ? "재활" : "정상";
  return (
    <span className="pill">
      <span className={`dot ${dot}`} />
      {label}
    </span>
  );
}
