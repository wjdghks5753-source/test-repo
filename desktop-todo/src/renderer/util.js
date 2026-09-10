/**
 * 화면과 테스트가 함께 쓰는 계산 로직.
 * 브라우저에서는 window.TodoUtil, 테스트에서는 require 로 불러온다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TodoUtil = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  // 이 비율 이상이면 100%로 올려 보여준다.
  // 79/80 처럼 거의 다 끝낸 날 99%에서 멈춰 있으면 남는 인상이 좋지 않다.
  // 정확한 숫자는 바로 아래 "완료 / 전체 · 남은 N건" 이 항상 같이 알려준다.
  const ROUND_UP_FROM = 99;

  /** 완료율 — 항목 개수 기준 */
  function completionPercent(doneCount, total) {
    if (!total || doneCount <= 0) return 0;
    if (doneCount >= total) return 100;

    const percent = Math.round((doneCount / total) * 100);
    if (percent >= ROUND_UP_FROM) return 100;
    if (percent === 0) return 1;   // 한 건이라도 했으면 0%로 두지 않는다
    return percent;
  }

  /** 날짜/시각 입력값 -> 노션 date 속성에 넣을 문자열 */
  function buildDue(dateStr, timeStr) {
    if (!dateStr) return null;              // 마감일 없음
    if (!timeStr) return dateStr;           // 종일 (시간 없는 날짜)

    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date(`${dateStr}T00:00:00`);
    d.setHours(h, m, 0, 0);

    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${dateStr}T${pad(h)}:${pad(m)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  /** 'YYYY-MM-DD' 에서 n일 이동 */
  function shiftDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return { completionPercent, buildDue, shiftDate, ROUND_UP_FROM };
}));
