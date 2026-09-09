'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { JsonFile, DEFAULT_SETTINGS, DEFAULT_CACHE } = require('../src/main/store');
const { SyncEngine, isLocalId } = require('../src/main/sync');
const { NotionError } = require('../src/main/notion');
const D = require('../src/main/dates');

function tmpEngine(client) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
  const settings = new JsonFile(path.join(dir, 'config.json'), DEFAULT_SETTINGS);
  const cache = new JsonFile(path.join(dir, 'cache.json'), DEFAULT_CACHE);
  return new SyncEngine({ cache, settings, client, onChange: () => {} });
}

/** 노션 대신 쓰는 가짜 서버. 실패를 마음대로 주입할 수 있다. */
function fakeClient() {
  let seq = 0;
  const pages = new Map();
  const c = {
    configured: true,
    schema: new Set(['할 일', '완료', '마감일', '텍스트', '완료일시', '분류', '출처']),
    failNext: null,
    calls: [],

    _maybeFail() {
      if (c.failNext) { const e = c.failNext; c.failNext = null; throw e; }
    },
    async createTask(payload) {
      c._maybeFail();
      const id = `notion-${++seq}`;
      const task = { id, url: `https://notion.so/${id}`, done: false, note: '', doneAt: null,
                     category: null, source: null, due: null, ...payload, pending: false };
      pages.set(id, task);
      c.calls.push(['create', id]);
      return { ...task };
    },
    async updateTask(id, patch) {
      c._maybeFail();
      if (!pages.has(id)) throw new NotionError('없는 페이지', 404);
      Object.assign(pages.get(id), patch);
      c.calls.push(['update', id, patch]);
      return { ...pages.get(id), pending: false };
    },
    async archiveTask(id) { c._maybeFail(); pages.delete(id); c.calls.push(['archive', id]); },
    async queryOpenTasks() { return [...pages.values()].filter((t) => !t.done).map((t) => ({ ...t })); },
    async queryCompletedOn() { return [...pages.values()].filter((t) => t.done).map((t) => ({ ...t })); },
    async loadSchema() { return { title: 'fake', properties: [...c.schema], missing: [] }; },
  };
  return c;
}

test('추가한 할 일은 즉시 화면에 뜨고 outbox 에 쌓인다', () => {
  const engine = tmpEngine(fakeClient());
  const task = engine.addTask({ title: '논문 읽기' });

  assert.ok(isLocalId(task.id), '노션 반영 전에는 로컬 ID');
  assert.equal(task.pending, true);
  assert.equal(engine.tasks.length, 1);
  assert.equal(engine.outbox.length, 1);
  assert.equal(engine.outbox[0].type, 'create');
});

test('push 하면 로컬 ID 가 노션 ID 로 바뀐다', async () => {
  const engine = tmpEngine(fakeClient());
  engine.addTask({ title: '논문 읽기' });
  await engine.push();

  assert.equal(engine.outbox.length, 0);
  assert.equal(engine.tasks[0].id, 'notion-1');
  assert.equal(engine.tasks[0].pending, false);
});

test('노션에 올라가기 전에 체크하면 생성 요청 자체에 반영된다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  const task = engine.addTask({ title: '테이핑 스터디' });

  engine.patchTask(task.id, { done: true });

  assert.equal(engine.outbox.length, 1, '생성과 별도로 update 를 만들지 않는다');
  assert.equal(engine.outbox[0].payload.done, true);

  await engine.push();
  assert.deepEqual(client.calls.map((c) => c[0]), ['create']);
  assert.equal(engine.tasks[0].done, true);
});

test('완료 체크는 완료일시를 함께 남긴다', () => {
  const engine = tmpEngine(fakeClient());
  const task = engine.addTask({ title: 'PLICA 논문' });
  engine.patchTask(task.id, { done: true });

  const doneAt = engine.tasks[0].doneAt;
  assert.ok(doneAt, '완료일시가 채워져야 한다');
  assert.equal(D.toDateKey(doneAt), D.dateKey(), '오늘 날짜여야 한다');

  engine.patchTask(task.id, { done: false });
  assert.equal(engine.tasks[0].doneAt, null, '완료 취소하면 지워져야 한다');
});

test('인터넷이 끊기면 변경을 잃지 않고 다음에 이어서 보낸다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '오프라인 항목' });

  client.failNext = new NotionError('네트워크 오류', 0);   // fatal 아님
  await assert.rejects(() => engine.push());

  assert.equal(engine.outbox.length, 1, '작업이 남아 있어야 한다');
  assert.equal(engine.tasks[0].pending, true);

  await engine.push();                                     // 복구 후 재시도
  assert.equal(engine.outbox.length, 0);
  assert.equal(engine.tasks[0].id, 'notion-1');
});

test('토큰/권한 오류처럼 고쳐질 수 없는 실패는 큐를 막지 않는다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '실패할 항목' });
  engine.addTask({ title: '성공할 항목' });

  client.failNext = new NotionError('권한 없음', 403);      // fatal
  const failures = await engine.push();

  assert.equal(failures.length, 1);
  assert.equal(engine.outbox.length, 0, '뒤의 작업까지 막히면 안 된다');
  assert.ok(client.calls.some((c) => c[0] === 'create'), '두 번째 항목은 생성되어야 한다');
  assert.ok(engine.tasks.every((t) => t.pending === false));
});

test('pull 은 아직 못 올린 로컬 변경을 덮어쓰지 않는다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  engine.addTask({ title: '이미 올라간 항목' });
  await engine.push();

  // 노션에 반영되지 않은 로컬 변경을 하나 만든다
  engine.addTask({ title: '아직 못 올린 항목' });

  await engine.pull();

  const titles = engine.tasks.map((t) => t.title).sort();
  assert.deepEqual(titles, ['아직 못 올린 항목', '이미 올라간 항목']);
  assert.equal(engine.outbox.length, 1, 'pull 이 대기 중인 작업을 지우면 안 된다');
});

test('삭제하면 노션에서 보관 처리된다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '지울 항목' });
  await engine.push();

  const id = engine.tasks[0].id;
  engine.deleteTask(id);
  await engine.push();

  assert.equal(engine.tasks.length, 0);
  assert.ok(client.calls.some((c) => c[0] === 'archive' && c[1] === id));
});

test('아직 안 올린 항목을 지우면 노션 호출 없이 사라진다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  const task = engine.addTask({ title: '바로 지울 항목' });

  engine.deleteTask(task.id);

  assert.equal(engine.tasks.length, 0);
  assert.equal(engine.outbox.length, 0, '생성 요청도 함께 취소되어야 한다');
  await engine.push();
  assert.equal(client.calls.length, 0);
});

test('완료 항목은 최근에 끝낸 순으로 정렬된다', () => {
  const { sortTasks } = require('../src/main/sync');
  const list = [
    { done: true,  title: '아침',   due: null, doneAt: '2026-09-10T08:30:00+09:00' },
    { done: false, title: '남은 일', due: '2026-09-10T18:00:00+09:00', doneAt: null },
    { done: true,  title: '점심',   due: null, doneAt: '2026-09-10T13:10:00+09:00' },
  ].sort(sortTasks);

  assert.deepEqual(list.map((t) => t.title), ['남은 일', '점심', '아침'],
    '미완료가 위, 완료는 방금 끝낸 것부터');
});

test('동기화가 도는 중에 체크한 항목도 같은 번에 함께 올라간다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  // 첫 번째 생성 요청을 붙잡아 두고, 그 사이에 항목을 하나 더 추가한다.
  let release;
  const gate = new Promise((r) => { release = r; });
  const original = client.createTask;
  let held = false;
  client.createTask = async (payload) => {
    if (!held) { held = true; await gate; }
    return original(payload);
  };

  engine.addTask({ title: '첫 번째' });
  const running = engine.sync();

  await new Promise((r) => setImmediate(r));
  engine.addTask({ title: '두 번째' });
  engine.sync();            // 이미 도는 중이라 "끝나고 한 번 더" 표시만 남는다
  release();

  await running;

  assert.equal(engine.outbox.length, 0, '두 번째 항목이 다음 주기까지 밀리면 안 된다');
  assert.equal(engine.tasks.filter((t) => !isLocalId(t.id)).length, 2);
});

test('동기화가 실패하면 무한히 재시도하지 않는다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '안 올라갈 항목' });

  let attempts = 0;
  client.createTask = async () => { attempts += 1; throw new NotionError('네트워크 오류', 0); };

  const status = await engine.sync();

  assert.ok(status.error, '오류가 사용자에게 보여야 한다');
  assert.ok(attempts <= 5, `재시도 ${attempts}회 — 상한이 걸려 있어야 한다`);
  assert.equal(engine.outbox.length, 1, '변경 자체는 남아 다음 기회에 다시 시도한다');
});
