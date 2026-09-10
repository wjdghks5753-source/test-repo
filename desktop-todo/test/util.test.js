'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { completionPercent, buildDue, shiftDate, ROUND_UP_FROM } = require('../src/renderer/util');

test('완료율은 항목 개수 기준으로 계산된다', () => {
  assert.equal(completionPercent(0, 0), 0, '할 일이 없으면 0%');
  assert.equal(completionPercent(0, 5), 0);
  assert.equal(completionPercent(1, 4), 25);
  assert.equal(completionPercent(4, 5), 80);
  assert.equal(completionPercent(5, 5), 100);
});

test('거의 다 끝냈으면 100%로 올려 보여준다', () => {
  assert.equal(completionPercent(79, 80), 100, '98.75% -> 100%');
  assert.equal(completionPercent(99, 100), 100);
  assert.equal(completionPercent(198, 200), 100, '99% -> 100%');
});

test('아직 멀었으면 올려주지 않는다', () => {
  assert.equal(completionPercent(9, 10), 90);
  assert.equal(completionPercent(48, 50), 96);
  assert.ok(completionPercent(48, 50) < ROUND_UP_FROM);
});

test('한 건이라도 했으면 0%로 표시하지 않는다', () => {
  assert.equal(completionPercent(1, 400), 1, '0.25% 여도 0% 는 한 것이 없다는 뜻이 된다');
  assert.equal(completionPercent(0, 400), 0);
});

test('마감일 없음 / 종일 / 시각 지정을 구분해 만든다', () => {
  assert.equal(buildDue('', '13:50'), null, '날짜가 없으면 마감일 없음');
  assert.equal(buildDue(null, null), null);
  assert.equal(buildDue('2026-09-10', ''), '2026-09-10', '시각이 없으면 종일');
  assert.match(buildDue('2026-09-10', '13:50'), /^2026-09-10T13:50:00[+-]\d{2}:\d{2}$/);
});

test('한 자리 시각도 두 자리로 채운다', () => {
  assert.match(buildDue('2026-09-10', '09:05'), /^2026-09-10T09:05:00/);
  assert.match(buildDue('2026-09-10', '0:00'), /^2026-09-10T00:00:00/);
});

test('내일로 미루기는 달을 넘어가도 맞는다', () => {
  assert.equal(shiftDate('2026-09-10', 1), '2026-09-11');
  assert.equal(shiftDate('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29', '윤년');
});

// ── 오늘치 집계 ────────────────────────────────────────
// 완료율의 분모는 "마감일이 오늘인 항목"이어야 한다.
// 밀린 일을 한꺼번에 정리한 날 98%, 100% 가 뜨던 문제를 막는다.

const { todayStats, dateKeyOf } = require('../src/renderer/util');

const TODAY = '2026-09-10';
const at = (day, time) => `${day}T${time}:00+00:00`;   // 테스트는 UTC 기준으로 고정

test('밀린 일을 오늘 정리해도 오늘 완료율에는 들어가지 않는다', () => {
  const tasks = [
    { done: false, due: at(TODAY, '13:50'), doneAt: null },
    ...Array.from({ length: 79 }, () => ({ done: true, due: '2026-02-10', doneAt: at(TODAY, '08:30') })),
  ];

  const s = todayStats(tasks, TODAY);
  assert.equal(s.dueToday, 1, '오늘 마감은 커피 한 건뿐');
  assert.equal(s.doneToday, 0);
  assert.equal(s.percent, 0, '79/80 = 98% 가 아니라 0% 여야 한다');
  assert.equal(s.otherDone, 79, '오늘 처리한 것은 따로 센다');
  assert.equal(s.cleared, false);
});

test('오늘 마감을 다 끝내면 100%가 되고 완주로 표시된다', () => {
  const tasks = [
    { done: true, due: at(TODAY, '09:00'), doneAt: at(TODAY, '09:30') },
    { done: true, due: TODAY, doneAt: at(TODAY, '11:00') },
  ];

  const s = todayStats(tasks, TODAY);
  assert.equal(s.percent, 100);
  assert.equal(s.cleared, true, '지연이 없을 때만 초록색이 된다');
});

test('오늘 마감이 하나도 없으면 분모가 없다', () => {
  const tasks = [
    { done: false, due: '2026-02-10', doneAt: null },
    { done: false, due: null, doneAt: null },
  ];

  const s = todayStats(tasks, TODAY);
  assert.equal(s.dueToday, 0);
  assert.equal(s.percent, 0);
  assert.equal(s.overdue, 1, '마감일 지난 미완료만 지연으로 센다');
  assert.equal(s.open, 2);
});

test('절반 했으면 절반으로 나온다', () => {
  const tasks = [
    { done: true,  due: TODAY, doneAt: at(TODAY, '10:00') },
    { done: true,  due: TODAY, doneAt: at(TODAY, '11:00') },
    { done: false, due: TODAY, doneAt: null },
    { done: false, due: TODAY, doneAt: null },
  ];

  const s = todayStats(tasks, TODAY);
  assert.equal(s.dueToday, 4);
  assert.equal(s.doneToday, 2);
  assert.equal(s.percent, 50);
});

test('마감 시각이 있어도 날짜만 보고 오늘인지 판단한다', () => {
  assert.equal(dateKeyOf(at(TODAY, '23:30')), TODAY);
  assert.equal(dateKeyOf(TODAY), TODAY, '종일 항목');
  assert.equal(dateKeyOf(null), null);
});

test('빈 목록에서도 터지지 않는다', () => {
  assert.deepEqual(todayStats([], TODAY).percent, 0);
  assert.deepEqual(todayStats(undefined, TODAY).dueToday, 0);
});
