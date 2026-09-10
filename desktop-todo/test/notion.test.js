'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { NotionClient } = require('../src/main/notion');
const D = require('../src/main/dates');

// 실제 세 DB 의 속성 이름이 서로 다르다는 점이 이 앱의 핵심 제약이다.
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

const namesOf = (source) => Object.values(source.props).filter(Boolean);

/** 네트워크 없이 요청 본문만 들여다보기 위한 클라이언트 */
function stubbed(source, names) {
  const client = new NotionClient({ token: 'ntn_test' });
  client.schemas.set(source.id, new Set(names || namesOf(source)));
  client.sent = [];
  client.request = async (method, path, body) => {
    client.sent.push({ method, path, body });
    return { results: [], has_more: false };
  };
  return client;
}

test('DB 마다 자기 속성 이름으로 나간다', () => {
  const personal = stubbed(PERSONAL).buildProperties(PERSONAL, { title: '커피', done: true });
  assert.ok('할 일' in personal);
  assert.ok('완료' in personal);

  const project = stubbed(PROJECT).buildProperties(PROJECT, { title: '논문 초고', done: true });
  assert.ok('이름' in project, 'SJS PROJECT 는 제목이 이름이다');
  assert.ok('체크박스' in project, 'SJS PROJECT 는 완료가 체크박스다');
  assert.ok(!('할 일' in project) && !('완료' in project));
});

test('설정에 비어 있는 속성은 아예 보내지 않는다', () => {
  const c = stubbed(PROJECT);
  const props = c.buildProperties(PROJECT, {
    title: '논문', note: '메모', doneAt: '2026-09-10T19:00:00+09:00',
  });

  assert.ok('이름' in props);
  assert.equal(Object.keys(props).length, 1, '메모/완료일시 속성이 없는 DB 라 제목만 나가야 한다');
});

test('DB 에 실제로 없는 속성도 건너뛴다', () => {
  // 설정에는 완료일시가 적혀 있지만 DB 에서 지워진 상황
  const c = stubbed(PERSONAL, ['할 일', '완료', '진행일시', '텍스트']);
  const props = c.buildProperties(PERSONAL, { title: 'x', doneAt: '2026-09-10T19:00:00+09:00' });

  assert.ok(!('완료일시' in props), '없는 속성을 보내면 노션이 400 을 낸다');
});

test('빈 값은 null 로 보내 노션 쪽 값을 지운다', () => {
  const props = stubbed(PERSONAL).buildProperties(PERSONAL, { due: null, doneAt: null, note: '' });
  assert.equal(props['진행일시'].date, null);
  assert.equal(props['완료일시'].date, null);
  assert.deepEqual(props['텍스트'].rich_text, []);
});

test('오늘 목록 조회는 그 DB 의 완료·날짜 속성을 쓴다', async () => {
  const c = stubbed(PROJECT);
  await c.queryOpenTasks(PROJECT, { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: false });

  assert.equal(c.sent[0].path, '/databases/db-project/query');
  const { and } = c.sent[0].body.filter;
  assert.deepEqual(and[0], { property: '체크박스', checkbox: { equals: false } });
  assert.deepEqual(and[1], { property: '날짜', date: { on_or_before: '2026-09-10' } });
  assert.deepEqual(and[2], { property: '날짜', date: { on_or_after: '2026-09-03' } });
});

test('마감일 없는 항목은 별도 질의로 가져온다', async () => {
  const c = stubbed(PERSONAL);
  await c.queryOpenTasks(PERSONAL, { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: true });

  assert.equal(c.sent.length, 2, '한 필터에 or 로 욱여넣지 않고 두 번 나눠 묻는다');
  const { and } = c.sent[1].body.filter;
  assert.deepEqual(and[1], { property: '진행일시', date: { is_empty: true } });
  assert.equal(and[2].timestamp, 'created_time');
});

test('완료일시가 없는 DB 는 날짜로 대신 찾는다', async () => {
  const c = stubbed(PROJECT);
  await c.queryCompletedOn(PROJECT, '2026-09-10');

  const { and } = c.sent[0].body.filter;
  assert.deepEqual(and[0], { property: '체크박스', checkbox: { equals: true } });
  assert.deepEqual(and[1], { property: '날짜', date: { equals: '2026-09-10' } });
});

test('완료일시가 있으면 그날 구간으로 조회한다', async () => {
  const c = stubbed(PERSONAL);
  await c.queryCompletedOn(PERSONAL, '2026-09-10');

  const { and } = c.sent[0].body.filter;
  assert.equal(and[1].property, '완료일시');
  assert.ok(and[1].date.on_or_after.startsWith('2026-09-10T00:00:00'));
  assert.ok(and[2].date.before.startsWith('2026-09-11T00:00:00'));
});

test('필수 속성이 비어 있으면 무엇을 고쳐야 하는지 알려준다', async () => {
  const broken = { ...PROJECT, props: { ...PROJECT.props, due: '' } };
  const c = stubbed(broken, ['이름', '체크박스']);

  await assert.rejects(
    () => c.queryOpenTasks(broken, { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: false }),
    /SJS PROJECT.*due 속성/s,
  );
});

test('노션 page 를 앱 객체로 옮기면서 카테고리를 붙인다', () => {
  const c = stubbed(PROJECT);
  const task = c.toTask(PROJECT, {
    id: 'page-1',
    url: 'https://notion.so/page-1',
    properties: {
      '이름': { title: [{ plain_text: 'PLICA ' }, { plain_text: '논문' }] },
      '체크박스': { checkbox: true },
      '날짜': { date: { start: '2026-09-10T18:00:00+09:00' } },
    },
  });

  assert.equal(task.title, 'PLICA 논문', '나뉜 rich text 를 이어붙인다');
  assert.equal(task.done, true);
  assert.equal(task.sourceId, 'project');
  assert.equal(task.category, 'SJS PROJECT');
  assert.equal(D.toDateKey(task.due), '2026-09-10');
});

test('제목이 비어 있어도 화면이 깨지지 않는다', () => {
  const c = stubbed(PERSONAL);
  const task = c.toTask(PERSONAL, { id: 'x', url: 'u', properties: { '할 일': { title: [] } } });
  assert.equal(task.title, '(제목 없음)');
  assert.equal(task.done, false);
});

test('프록시가 HTML 을 돌려줘도 원인을 알 수 있는 오류가 난다', async () => {
  const c = new NotionClient({ token: 'ntn_test' });
  globalThis.fetch = async () => ({
    ok: false, status: 403, headers: { get: () => null },
    text: async () => 'Host not in allowlist',
  });

  await assert.rejects(() => c.request('GET', '/databases/x'), (err) => {
    assert.equal(err.name, 'NotionError', 'SyntaxError 가 그대로 새어나오면 안 된다');
    assert.match(err.message, /프록시나 방화벽/);
    assert.equal(err.fatal, true);
    return true;
  });
});

test('긴 노션 오류는 잘라서 넘긴다', async () => {
  const c = new NotionClient({ token: 'ntn_test' });
  const long = 'x'.repeat(600);
  globalThis.fetch = async () => ({
    ok: false, status: 400, headers: { get: () => null },
    text: async () => JSON.stringify({ message: long, code: 'validation_error' }),
  });

  await assert.rejects(() => c.request('GET', '/databases/x'), (err) => {
    assert.ok(err.message.length < 200, '상태줄이 창을 덮지 않도록 잘라야 한다');
    return true;
  });
});

test('토큰이 없으면 네트워크를 타지 않는다', async () => {
  const c = new NotionClient({ token: null });
  await assert.rejects(() => c.request('GET', '/x'), /토큰이 설정되지 않았습니다/);
});

// ── 노션 필터 구조 검증 ────────────────────────────────
// 노션 복합 필터는 두 단계까지만 중첩할 수 있다. 세 단계를 보내면 400 이 온다.

function compoundDepth(node) {
  const children = node.and || node.or;
  if (!Array.isArray(children)) return 0;
  return 1 + Math.max(0, ...children.map(compoundDepth));
}

function assertValidFilter(filter, label) {
  const depth = compoundDepth(filter);
  assert.ok(depth >= 1, `${label}: 필터가 비어 있다`);
  assert.ok(depth <= 2, `${label}: and/or 중첩이 ${depth}단계 — 노션은 2단계까지만 받는다`);

  const walk = (node) => {
    const children = node.and || node.or;
    if (Array.isArray(children)) return children.forEach(walk);
    assert.ok(
      typeof node.property === 'string' || typeof node.timestamp === 'string',
      `${label}: 잎 필터에 property 나 timestamp 가 없다 — ${JSON.stringify(node)}`,
    );
  };
  walk(filter);
}

test('모든 카테고리·설정 조합의 필터가 노션 중첩 규칙을 지킨다', async () => {
  const combos = [
    { carryOverDays: 7, includeNoDueDate: true },
    { carryOverDays: 7, includeNoDueDate: false },
    { carryOverDays: 0, includeNoDueDate: true },
    { carryOverDays: 0, includeNoDueDate: false },
  ];

  for (const source of [PERSONAL, PROJECT]) {
    for (const options of combos) {
      const c = stubbed(source);
      await c.queryOpenTasks(source, { today: '2026-09-10', ...options });
      await c.queryCompletedOn(source, '2026-09-10');

      assert.ok(c.sent.length > 0);
      c.sent.forEach((req, i) =>
        assertValidFilter(req.body.filter, `${source.label} ${JSON.stringify(options)} #${i}`));
    }
  }
});

test('중첩이 세 단계인 필터는 검증에서 걸러진다', () => {
  const tooDeep = {
    and: [
      { property: '완료', checkbox: { equals: false } },
      { or: [{ and: [{ property: '날짜', date: { is_empty: true } }] }] },
    ],
  };
  assert.equal(compoundDepth(tooDeep), 3);
  assert.throws(() => assertValidFilter(tooDeep, '3단계'), /2단계까지만/);
});
