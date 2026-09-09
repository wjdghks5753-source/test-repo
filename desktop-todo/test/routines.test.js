'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { JsonFile, DEFAULT_SETTINGS, DEFAULT_CACHE, DEFAULT_ROUTINES } = require('../src/main/store');
const { SyncEngine } = require('../src/main/sync');
const routines = require('../src/main/routines');
const D = require('../src/main/dates');

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-routine-'));
  const settings = new JsonFile(path.join(dir, 'config.json'), DEFAULT_SETTINGS);
  const cache = new JsonFile(path.join(dir, 'cache.json'), DEFAULT_CACHE);
  const routinesFile = new JsonFile(path.join(dir, 'routines.json'), DEFAULT_ROUTINES);
  const engine = new SyncEngine({ cache, settings, client: { configured: true }, onChange: () => {} });
  return { engine, cache, routinesFile };
}

const today = () => D.dateKey();
const todayWeekday = () => D.weekday(today());

test('오늘 요일에 해당하는 루틴만 만들어진다', () => {
  const { engine, cache, routinesFile } = harness();
  const wd = todayWeekday();

  routines.addRoutine(routinesFile, { title: '오늘 것', days: [wd], time: '09:00' });
  routines.addRoutine(routinesFile, { title: '내일 것', days: [(wd + 1) % 7] });

  const made = routines.materializeToday(engine, routinesFile, cache);

  assert.deepEqual(made, ['오늘 것']);
  assert.equal(engine.tasks.length, 1);
  assert.equal(engine.tasks[0].source, '루틴');
  assert.equal(D.toDateKey(engine.tasks[0].due), today());
});

test('두 번 실행해도 같은 루틴이 중복 생성되지 않는다', () => {
  const { engine, cache, routinesFile } = harness();
  routines.addRoutine(routinesFile, { title: '매일 스트레칭', days: [0, 1, 2, 3, 4, 5, 6] });

  routines.materializeToday(engine, routinesFile, cache);
  const second = routines.materializeToday(engine, routinesFile, cache);

  assert.deepEqual(second, [], '앱을 껐다 켜도 같은 항목이 또 생기면 안 된다');
  assert.equal(engine.tasks.length, 1);
});

test('중지한 루틴은 만들어지지 않는다', () => {
  const { engine, cache, routinesFile } = harness();
  const r = routines.addRoutine(routinesFile, { title: '쉬는 중', days: [0, 1, 2, 3, 4, 5, 6] });
  routines.updateRoutine(routinesFile, r.id, { enabled: false });

  assert.deepEqual(routines.materializeToday(engine, routinesFile, cache), []);
  assert.equal(engine.tasks.length, 0);
});

test('시각이 없는 루틴은 종일 항목이 된다', () => {
  const { engine, cache, routinesFile } = harness();
  routines.addRoutine(routinesFile, { title: '종일 항목', days: [todayWeekday()], time: null });
  routines.materializeToday(engine, routinesFile, cache);

  assert.equal(engine.tasks[0].due, today(), '시간 없는 날짜 문자열이어야 한다');
});

test('루틴 로그는 무한정 쌓이지 않는다', () => {
  const { engine, cache, routinesFile } = harness();
  cache.get('routineLog')['2020-01-01'] = ['old'];
  routines.addRoutine(routinesFile, { title: 'x', days: [todayWeekday()] });

  routines.materializeToday(engine, routinesFile, cache);

  assert.ok(!('2020-01-01' in cache.get('routineLog')), '60일 지난 로그는 지워진다');
  assert.ok(today() in cache.get('routineLog'));
});

test('describe 는 요일을 읽기 좋게 보여준다', () => {
  assert.equal(routines.describe({ days: [1, 3, 5], time: '07:30' }), '월·수·금 07:30');
  assert.equal(routines.describe({ days: [0, 1, 2, 3, 4, 5, 6], time: null }), '매일');
});
