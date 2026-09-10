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
