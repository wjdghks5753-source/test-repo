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

  /** 노션 date 문자열 -> 로컬 'YYYY-MM-DD' (시간이 있으면 로컬 시간대로 환산) */
  function dateKeyOf(value) {
    if (!value) return null;
    if (!value.includes('T')) return value.slice(0, 10);
    const d = new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * 오늘치 집계.
   *
   * 완료율의 분모는 "마감일이 오늘인 항목"뿐이다.
   * 몇 달 밀린 걸 오늘 한꺼번에 정리하면 그건 오늘의 몫이 아닌데도
   * 분모에 들어가 98%, 100% 같은 무의미한 숫자를 만든다.
   * 그렇게 처리한 건들은 따로 세서 '그 외 오늘 처리'로 보여준다.
   */
  function todayStats(tasks, today) {
    let dueToday = 0;      // 마감일이 오늘인 항목
    let doneToday = 0;     // 그중 끝낸 것
    let otherDone = 0;     // 오늘 체크했지만 마감일은 오늘이 아니던 것
    let overdue = 0;       // 마감일이 지났는데 아직 미완료
    let open = 0;          // 전체 미완료

    for (const task of tasks || []) {
      const due = dateKeyOf(task.due);

      if (due === today) {
        dueToday += 1;
        if (task.done) doneToday += 1;
      } else if (task.done && dateKeyOf(task.doneAt) === today) {
        otherDone += 1;
      }

      if (!task.done) {
        open += 1;
        if (due && due < today) overdue += 1;
      }
    }

    return {
      dueToday,
      doneToday,
      otherDone,
      overdue,
      open,
      percent: completionPercent(doneToday, dueToday),
      cleared: dueToday > 0 && doneToday === dueToday,
    };
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

  /**
   * 지금 기준 "다음에 할 것" 하나.
   * 앞으로 올 시각이 있으면 그중 가장 이른 것, 전부 지났으면 가장 오래 밀린 것.
   * 하루 종일 이 창만 본다면 가장 크게 보여야 할 정보다.
   */
  function nextUp(tasks, now) {
    const at = now || new Date();
    const timed = (tasks || [])
      .filter((t) => !t.done && t.due && t.due.includes('T'))
      .map((t) => ({ task: t, when: new Date(t.due) }))
      .sort((a, b) => a.when - b.when);

    if (!timed.length) return null;
    return timed.find((x) => x.when >= at) || timed[0];
  }

  /** '25분 뒤' / '지금' / '2시간 지남' */
  function untilLabel(when, now) {
    const mins = Math.round((when - (now || new Date())) / 60000);
    if (mins <= -60) return `${Math.floor(-mins / 60)}시간 지남`;
    if (mins < -1) return `${-mins}분 지남`;
    if (mins <= 1) return '지금';
    if (mins < 60) return `${mins}분 뒤`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}시간 ${m}분 뒤` : `${h}시간 뒤`;
  }

  /** 'YYYY-MM-DD' 에서 n일 이동 */
  function shiftDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return {
    completionPercent, todayStats, dateKeyOf,
    nextUp, untilLabel,
    buildDue, shiftDate, ROUND_UP_FROM,
  };
}));
