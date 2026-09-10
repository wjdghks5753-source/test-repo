'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const { JsonFile, DEFAULT_SETTINGS, DEFAULT_CACHE } = require('../src/main/store');
const { SyncEngine, isLocalId, sortTasks } = require('../src/main/sync');
const { NotionError } = require('../src/main/notion');
const D = require('../src/main/dates');

const PERSONAL = {
  id: 'personal', label: 'PERSONAL', color: 'gray', databaseId: 'db-personal',
  props: { title: '할 일', done: '완료', due: '진행일시', note: '텍스트', doneAt: '완료일시' },
  enabled: true,
};
const PROJECT = {
  id: 'project', label: 'SJS PROJECT', color: 'blue', databaseId: 'db-project',
  props: { title: '이름', done: '체크박스', due: '날짜', note: '', doneAt: '' },
  enabled: true,
};

function tmpEngine(client, sources = [PERSONAL, PROJECT]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
  const settings = new JsonFile(path.join(dir, 'config.json'), DEFAULT_SETTINGS);
  const cache = new JsonFile(path.join(dir, 'cache.json'), DEFAULT_CACHE);
  settings.set('sources', JSON.parse(JSON.stringify(sources)));
  settings.set('defaultSourceId', sources[0] ? sources[0].id : null);
  return new SyncEngine({ cache, settings, client, onChange: () => {} });
}

/** 노션 대신 쓰는 가짜 서버. DB 별로 페이지를 따로 들고 있다. */
function fakeClient() {
  let seq = 0;
  const pages = new Map();          // pageId -> task
  const c = {
    configured: true,
    calls: [],
    failNext: null,
    failSources: new Set(),         // 이 DB 는 조회가 실패한다

    hasSchema: () => true,
    async loadSchema() { return { title: 'fake', properties: [], missing: [] }; },

    _maybeFail() {
      if (c.failNext) { const e = c.failNext; c.failNext = null; throw e; }
    },
    async createTask(source, payload) {
      c._maybeFail();
      const id = `notion-${++seq}`;
      const task = {
        id, sourceId: source.id, category: source.label, url: `https://notion.so/${id}`,
        done: false, note: '', doneAt: null, due: null, ...payload, pending: false,
      };
      pages.set(id, task);
      c.calls.push(['create', source.id, id]);
      return { ...task };
    },
    async updateTask(source, id, patch) {
      c._maybeFail();
      if (!pages.has(id)) throw new NotionError('없는 페이지', 404);
      Object.assign(pages.get(id), patch);
      c.calls.push(['update', source.id, id]);
      return { ...pages.get(id), pending: false };
    },
    async archiveTask(id) { c._maybeFail(); pages.delete(id); c.calls.push(['archive', null, id]); },

    async queryOpenTasks(source) {
      if (c.failSources.has(source.id)) throw new NotionError('연결 안 됨', 404);
      return [...pages.values()].filter((t) => t.sourceId === source.id && !t.done).map((t) => ({ ...t }));
    },
    async queryCompletedOn(source) {
      if (c.failSources.has(source.id)) throw new NotionError('연결 안 됨', 404);
      return [...pages.values()].filter((t) => t.sourceId === source.id && t.done).map((t) => ({ ...t }));
    },
  };
  return c;
}

// ── 기본 동작 ────────────────────────────────────────────────

test('추가한 할 일은 즉시 화면에 뜨고 outbox 에 쌓인다', () => {
  const engine = tmpEngine(fakeClient());
  const task = engine.addTask({ title: '논문 읽기' });

  assert.ok(isLocalId(task.id), '노션 반영 전에는 로컬 ID');
  assert.equal(task.pending, true);
  assert.equal(task.sourceId, 'personal', '기본 카테고리로 들어간다');
  assert.equal(engine.outbox.length, 1);
});

test('고른 카테고리의 DB 로 만들어진다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  engine.addTask({ title: 'PLICA 논문 초고', sourceId: 'project' });
  await engine.push();

  assert.deepEqual(client.calls[0].slice(0, 2), ['create', 'project']);
  assert.equal(engine.tasks[0].category, 'SJS PROJECT');
});

test('체크는 그 항목이 속한 DB 로 되돌아간다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  const task = engine.addTask({ title: '스터디 자료', sourceId: 'project' });
  await engine.push();

  engine.patchTask(engine.tasks[0].id, { done: true });
  await engine.push();

  const update = client.calls.find((call) => call[0] === 'update');
  assert.equal(update[1], 'project', 'PERSONAL 로 잘못 보내면 안 된다');
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
  assert.deepEqual(client.calls.map((call) => call[0]), ['create']);
});

test('완료 체크는 완료일시를 함께 남긴다', () => {
  const engine = tmpEngine(fakeClient());
  const task = engine.addTask({ title: 'PLICA 논문' });
  engine.patchTask(task.id, { done: true });

  assert.equal(D.toDateKey(engine.tasks[0].doneAt), D.dateKey());

  engine.patchTask(task.id, { done: false });
  assert.equal(engine.tasks[0].doneAt, null, '완료 취소하면 지워져야 한다');
});

// ── 실패 처리 ────────────────────────────────────────────────

test('인터넷이 끊기면 변경을 잃지 않고 다음에 이어서 보낸다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '오프라인 항목' });

  client.failNext = new NotionError('네트워크 오류', 0);   // fatal 아님
  await assert.rejects(() => engine.push());

  assert.equal(engine.outbox.length, 1);
  assert.equal(engine.tasks[0].pending, true);

  await engine.push();
  assert.equal(engine.outbox.length, 0);
  assert.equal(engine.tasks[0].id, 'notion-1');
});

test('토큰/권한 오류처럼 고쳐질 수 없는 실패는 큐를 막지 않는다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '실패할 항목' });
  engine.addTask({ title: '성공할 항목' });

  client.failNext = new NotionError('권한 없음', 403);
  const failures = await engine.push();

  assert.equal(failures.length, 1);
  assert.equal(engine.outbox.length, 0, '뒤의 작업까지 막히면 안 된다');
  assert.ok(engine.tasks.every((t) => t.pending === false));
});

test('한 카테고리가 실패해도 나머지 카테고리는 그대로 불러온다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  engine.addTask({ title: '개인 항목', sourceId: 'personal' });
  engine.addTask({ title: '프로젝트 항목', sourceId: 'project' });
  await engine.push();

  // SJS PROJECT DB 에 통합을 연결하지 않은 상황
  client.failSources.add('project');
  const { failures } = await engine.pull();

  assert.equal(failures.length, 1);
  assert.match(failures[0], /SJS PROJECT/);

  const titles = engine.tasks.map((t) => t.title).sort();
  assert.deepEqual(titles, ['개인 항목', '프로젝트 항목'],
    '못 불러온 DB 의 항목을 지워버리면 목록이 통째로 사라진다');
});

test('꺼둔 카테고리의 항목은 목록에서 빠진다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  engine.addTask({ title: '개인 항목', sourceId: 'personal' });
  engine.addTask({ title: '프로젝트 항목', sourceId: 'project' });
  await engine.push();
  await engine.pull();
  assert.equal(engine.tasks.length, 2);

  const sources = engine.settings.get('sources');
  sources.find((s) => s.id === 'project').enabled = false;
  engine.settings.save();

  await engine.pull();
  assert.deepEqual(engine.tasks.map((t) => t.title), ['개인 항목']);
});

test('pull 은 아직 못 올린 로컬 변경을 덮어쓰지 않는다', async () => {
  const engine = tmpEngine(fakeClient());

  engine.addTask({ title: '이미 올라간 항목' });
  await engine.push();
  engine.addTask({ title: '아직 못 올린 항목' });

  await engine.pull();

  assert.deepEqual(engine.tasks.map((t) => t.title).sort(),
    ['아직 못 올린 항목', '이미 올라간 항목']);
  assert.equal(engine.outbox.length, 1);
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
  assert.ok(client.calls.some((call) => call[0] === 'archive' && call[2] === id));
});

test('아직 안 올린 항목을 지우면 노션 호출 없이 사라진다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  const task = engine.addTask({ title: '바로 지울 항목' });

  engine.deleteTask(task.id);

  assert.equal(engine.tasks.length, 0);
  assert.equal(engine.outbox.length, 0);
  await engine.push();
  assert.equal(client.calls.length, 0);
});

// ── 동기화 루프 ──────────────────────────────────────────────

test('동기화가 도는 중에 체크한 항목도 같은 번에 함께 올라간다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);

  let release;
  const gate = new Promise((r) => { release = r; });
  const original = client.createTask;
  let held = false;
  client.createTask = async (source, payload) => {
    if (!held) { held = true; await gate; }
    return original(source, payload);
  };

  engine.addTask({ title: '첫 번째' });
  const running = engine.sync();

  await new Promise((r) => setImmediate(r));
  engine.addTask({ title: '두 번째' });
  engine.sync();            // 이미 도는 중이라 "끝나고 한 번 더" 표시만 남는다
  release();

  await running;
  assert.equal(engine.outbox.length, 0, '두 번째 항목이 다음 주기까지 밀리면 안 된다');
});

test('동기화가 실패하면 무한히 재시도하지 않는다', async () => {
  const client = fakeClient();
  const engine = tmpEngine(client);
  engine.addTask({ title: '안 올라갈 항목' });

  let attempts = 0;
  client.createTask = async () => { attempts += 1; throw new NotionError('네트워크 오류', 0); };

  const status = await engine.sync();

  assert.ok(status.error);
  assert.ok(attempts <= 5, `재시도 ${attempts}회 — 상한이 걸려 있어야 한다`);
  assert.equal(engine.outbox.length, 1);
});

test('카테고리가 하나도 없으면 무엇을 해야 하는지 알려준다', async () => {
  const engine = tmpEngine(fakeClient(), []);
  const status = await engine.sync();
  assert.match(status.error, /카테고리가 없습니다/);
});

test('완료 항목은 최근에 끝낸 순으로 정렬된다', () => {
  const list = [
    { done: true,  title: '아침',   due: null, doneAt: '2026-09-10T08:30:00+09:00' },
    { done: false, title: '남은 일', due: '2026-09-10T18:00:00+09:00', doneAt: null },
    { done: true,  title: '점심',   due: null, doneAt: '2026-09-10T13:10:00+09:00' },
  ].sort(sortTasks);

  assert.deepEqual(list.map((t) => t.title), ['남은 일', '점심', '아침']);
});
