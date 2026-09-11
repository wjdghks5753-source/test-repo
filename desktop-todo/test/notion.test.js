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

  // 앞뒤로 하루씩 넉넉히 받아온다. 노션에 날짜만 주고 거르면 시간대 해석이
  // 엇갈려 저녁 항목이 통째로 빠질 수 있어서다. 정확한 판정은 앱이 한다.
  assert.deepEqual(and[1], { property: '날짜', date: { on_or_before: '2026-09-11' } });
  assert.deepEqual(and[2], { property: '날짜', date: { on_or_after: '2026-09-02' } });
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
  assert.deepEqual(and[1], { property: '날짜', date: { on_or_after: '2026-09-09' } });
  assert.deepEqual(and[2], { property: '날짜', date: { on_or_before: '2026-09-11' } });
});

test('완료일시가 있으면 완료일시로 찾는다', async () => {
  const c = stubbed(PERSONAL);
  await c.queryCompletedOn(PERSONAL, '2026-09-10');

  const { and } = c.sent[0].body.filter;
  assert.equal(and[1].property, '완료일시');
  assert.equal(and[2].property, '완료일시');
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

// ── 시간대 ────────────────────────────────────────────
// 저녁 7시 30분 항목은 한국 날짜와 UTC 날짜가 갈린다.
// 노션에 날짜만 넘겨 거르면 이런 항목이 조용히 사라진다.

/** 주어진 페이지들을 돌려주는 클라이언트 */
function serving(source, pages) {
  const c = stubbed(source);
  c.request = async (method, path, body) => {
    c.sent.push({ method, path, body });
    return { results: pages, has_more: false };
  };
  return c;
}

const page = (id, name, dueStart, dueEnd, done) => ({
  id,
  url: `https://notion.so/${id}`,
  properties: {
    '이름': { title: [{ plain_text: name }] },
    '체크박스': { checkbox: Boolean(done) },
    '날짜': { date: { start: dueStart, end: dueEnd || null } },
  },
});

test('저녁 늦은 항목도 오늘 목록에 남는다', async () => {
  // 한유정 KINVENT 처럼 19:30 에 잡힌 일정
  const evening = D.toNotionDateTime(D.atTime('2026-09-10', '19:30'));
  const c = serving(PROJECT, [page('p1', '한유정 KINVENT', evening)]);

  const tasks = await c.queryOpenTasks(PROJECT,
    { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: false });

  assert.deepEqual(tasks.map((t) => t.title), ['한유정 KINVENT']);
});

test('내일 것은 넓게 받아왔어도 오늘 목록에서 뺀다', async () => {
  const tomorrow = D.toNotionDateTime(D.atTime('2026-09-11', '09:00'));
  const today = D.toNotionDateTime(D.atTime('2026-09-10', '09:00'));
  const c = serving(PROJECT, [page('p1', '내일 것', tomorrow), page('p2', '오늘 것', today)]);

  const tasks = await c.queryOpenTasks(PROJECT,
    { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: false });

  assert.deepEqual(tasks.map((t) => t.title), ['오늘 것']);
});

test('끌어오기 기간보다 오래된 것도 뺀다', async () => {
  const old = D.toNotionDateTime(D.atTime('2026-09-01', '09:00'));
  const recent = D.toNotionDateTime(D.atTime('2026-09-08', '09:00'));
  const c = serving(PROJECT, [page('p1', '너무 오래됨', old), page('p2', '최근 지연', recent)]);

  const tasks = await c.queryOpenTasks(PROJECT,
    { today: '2026-09-10', carryOverDays: 7, includeNoDueDate: false });

  assert.deepEqual(tasks.map((t) => t.title), ['최근 지연']);
});

test('완료 목록도 로컬 날짜로 오늘만 남긴다', async () => {
  const todayEve = D.toNotionDateTime(D.atTime('2026-09-10', '21:00'));
  const yesterday = D.toNotionDateTime(D.atTime('2026-09-09', '21:00'));
  const c = serving(PROJECT, [
    page('p1', '오늘 끝냄', todayEve, null, true),
    page('p2', '어제 끝냄', yesterday, null, true),
  ]);

  const tasks = await c.queryCompletedOn(PROJECT, '2026-09-10');
  assert.deepEqual(tasks.map((t) => t.title), ['오늘 끝냄']);
});

// ── 날짜 범위 ──────────────────────────────────────────

test('시작과 끝이 있는 일정은 끝 시각도 읽는다', () => {
  const c = stubbed(PROJECT);
  const task = c.toTask(PROJECT,
    page('p1', '한유정 KINVENT', '2026-09-11T19:30:00+09:00', '2026-09-11T20:00:00+09:00'));

  assert.equal(task.due, '2026-09-11T19:30:00+09:00');
  assert.equal(task.dueEnd, '2026-09-11T20:00:00+09:00');
});

test('고쳐 보낼 때 끝 시각을 잃지 않는다', () => {
  const c = stubbed(PROJECT);
  const props = c.buildProperties(PROJECT, {
    due: '2026-09-12T19:30:00+09:00',
    dueEnd: '2026-09-12T20:00:00+09:00',
  });

  assert.deepEqual(props['날짜'].date, {
    start: '2026-09-12T19:30:00+09:00',
    end: '2026-09-12T20:00:00+09:00',
  });
});

test('끝 시각이 없으면 시작만 보낸다', () => {
  const props = stubbed(PROJECT).buildProperties(PROJECT, { due: '2026-09-12', dueEnd: null });
  assert.deepEqual(props['날짜'].date, { start: '2026-09-12' });
});

// ── 데이터 소스가 여럿인 DB ────────────────────────────
// 노션에서 DB 안에 데이터 소스를 하나 더 만들면 기존 API 가 조회를 거부한다.
// PERSONAL 이 통째로 안 뜨던 원인이 이것이었다.

const { NotionError } = require('../src/main/notion');

/** 경로와 버전에 따라 다르게 답하는 가짜 노션 */
function multiSourceServer(source, dataSources) {
  const client = new NotionClient({ token: 'ntn_test' });
  client.sent = [];
  client.request = async (method, path, body, opts = {}) => {
    const version = opts.version || '2022-06-28';
    client.sent.push({ method, path, version, body });

    if (path === `/databases/${source.databaseId}` && version === '2022-06-28') {
      throw new NotionError('Databases with multiple data sources are not supported in this API version.', 400);
    }
    if (path === `/databases/${source.databaseId}`) {
      return { title: [{ plain_text: 'SJS' }], data_sources: dataSources };
    }
    if (path.startsWith('/data_sources/') && method === 'GET') {
      return { title: [{ plain_text: 'SJS' }], properties: { '이름': { type: 'title' }, '체크박스': { type: 'checkbox' }, '날짜': { type: 'date' } } };
    }
    return { results: [], has_more: false };
  };
  return client;
}

test('데이터 소스가 여럿이면 새 API 로 갈아타 하나를 고른다', async () => {
  const c = multiSourceServer(PROJECT, [
    { id: 'ds-main', name: 'SJS PROJECT' },
    { id: 'ds-stray', name: '새 데이터 소스' },
  ]);

  const info = await c.loadSchema(PROJECT);

  assert.match(info.note, /데이터 소스가 2개/, '어느 것을 골랐는지 알려줘야 한다');
  assert.equal(c.modes.get('project').kind, 'dataSource');
  assert.equal(c.modes.get('project').dataSourceId, 'ds-main', '이름이 맞는 쪽을 고른다');
});

test('갈아탄 뒤에는 조회도 data_sources 로 나간다', async () => {
  const c = multiSourceServer(PROJECT, [
    { id: 'ds-main', name: 'PROJECT' },
    { id: 'ds-stray', name: '새 데이터 소스' },
  ]);
  await c.loadSchema(PROJECT);
  c.sent.length = 0;

  await c.queryOpenTasks(PROJECT, { today: '2026-09-11', carryOverDays: 7, includeNoDueDate: false });

  assert.equal(c.sent[0].path, '/data_sources/ds-main/query');
  assert.equal(c.sent[0].version, '2025-09-03');
});

test('갈아탄 뒤 새 항목도 그 데이터 소스에 만들어진다', async () => {
  const c = multiSourceServer(PROJECT, [{ id: 'ds-only', name: 'PROJECT' }]);
  await c.loadSchema(PROJECT);
  c.sent.length = 0;

  await c.createTask(PROJECT, { title: '한유정 KINVENT' });

  const call = c.sent.find((x) => x.path === '/pages');
  assert.deepEqual(call.body.parent, { type: 'data_source_id', data_source_id: 'ds-only' });
  assert.equal(call.version, '2025-09-03');
});

test('설정에 데이터 소스를 지정했으면 그것을 쓴다', async () => {
  const pinned = { ...PROJECT, dataSourceId: 'ds-stray' };
  const c = multiSourceServer(pinned, [
    { id: 'ds-main', name: 'PROJECT' },
    { id: 'ds-stray', name: '새 데이터 소스' },
  ]);

  await c.loadSchema(pinned);
  assert.equal(c.modes.get('project').dataSourceId, 'ds-stray');
});

test('데이터 소스가 하나뿐인 보통 DB 는 예전 경로를 그대로 쓴다', async () => {
  const c = stubbed(PROJECT);
  await c.queryOpenTasks(PROJECT, { today: '2026-09-11', carryOverDays: 7, includeNoDueDate: false });

  assert.equal(c.sent[0].path, '/databases/db-project/query');
  assert.ok(!c.modes.get('project') || c.modes.get('project').kind !== 'dataSource');
});

test('다중 데이터 소스와 무관한 오류는 그대로 올려보낸다', async () => {
  const c = new NotionClient({ token: 'ntn_test' });
  c.request = async () => { throw new NotionError('Could not find database with ID', 404); };

  await assert.rejects(() => c.loadSchema(PROJECT), /Could not find database/);
});
