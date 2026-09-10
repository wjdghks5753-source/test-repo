'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { NotionClient, P } = require('../src/main/notion');
const D = require('../src/main/dates');

/** 네트워크 없이 요청 본문만 들여다보기 위한 클라이언트 */
function stubbed(schemaNames) {
  const client = new NotionClient({ token: 'ntn_test', databaseId: 'db-1' });
  if (schemaNames) client.schema = new Set(schemaNames);
  client.sent = [];
  client.request = async (method, path, body) => {
    client.sent.push({ method, path, body });
    return { results: [], has_more: false };
  };
  return client;
}

const ALL = ['할 일', '완료', '마감일', '텍스트', '완료일시', '분류', '출처'];

test('buildProperties 는 노션이 받는 모양으로 만든다', () => {
  const c = stubbed(ALL);
  const props = c.buildProperties({
    title: '테이핑 스터디',
    done: true,
    due: '2026-09-09T18:30:00+09:00',
    note: '자료 정리까지',
    doneAt: '2026-09-09T19:02:00+09:00',
    category: '스터디',
    source: '앱',
  });

  assert.equal(props[P.TITLE].title[0].text.content, '테이핑 스터디');
  assert.equal(props[P.DONE].checkbox, true);
  assert.equal(props[P.DUE].date.start, '2026-09-09T18:30:00+09:00');
  assert.equal(props[P.NOTE].rich_text[0].text.content, '자료 정리까지');
  assert.equal(props[P.DONE_AT].date.start, '2026-09-09T19:02:00+09:00');
  assert.equal(props[P.CATEGORY].select.name, '스터디');
  assert.equal(props[P.SOURCE].select.name, '앱');
});

test('DB 에 없는 속성은 조용히 건너뛴다', () => {
  // 속성을 추가하지 않은 원래 스키마 상태를 가정
  const c = stubbed(['할 일', '완료', '마감일', '텍스트']);
  const props = c.buildProperties({ title: '할 일', done: true, doneAt: '2026-09-09T19:02:00+09:00', category: '스터디' });

  assert.ok(P.TITLE in props);
  assert.ok(P.DONE in props);
  assert.ok(!(P.DONE_AT in props), '없는 속성을 보내면 노션이 400 을 낸다');
  assert.ok(!(P.CATEGORY in props));
});

test('빈 값은 null 로 보내 노션 쪽 값을 지운다', () => {
  const c = stubbed(ALL);
  const props = c.buildProperties({ due: null, doneAt: null, category: null, note: '' });

  assert.equal(props[P.DUE].date, null);
  assert.equal(props[P.DONE_AT].date, null);
  assert.equal(props[P.CATEGORY].select, null);
  assert.deepEqual(props[P.NOTE].rich_text, []);
});

test('오늘 목록 조회는 미완료 + 오늘 이전 마감으로 좁힌다', async () => {
  const c = stubbed(ALL);
  await c.queryOpenTasks({ today: '2026-09-09', carryOverDays: 7, includeNoDueDate: false });

  assert.equal(c.sent.length, 1);
  const { and } = c.sent[0].body.filter;
  assert.deepEqual(and[0], { property: P.DONE, checkbox: { equals: false } });
  assert.deepEqual(and[1], { property: P.DUE, date: { on_or_before: '2026-09-09' } });
  assert.deepEqual(and[2], { property: P.DUE, date: { on_or_after: '2026-09-02' } });
});

test('carryOverDays 가 0 이면 기간 하한을 걸지 않는다', async () => {
  const c = stubbed(ALL);
  await c.queryOpenTasks({ today: '2026-09-09', carryOverDays: 0, includeNoDueDate: false });

  assert.equal(c.sent[0].body.filter.and.length, 2, '하한 없이 전체 미완료를 끌어온다');
});

test('마감일 없는 항목은 별도 질의로 가져오고 최근 생성분만 본다', async () => {
  const c = stubbed(ALL);
  await c.queryOpenTasks({ today: '2026-09-09', carryOverDays: 7, includeNoDueDate: true });

  assert.equal(c.sent.length, 2, '한 필터에 or 로 욱여넣지 않고 두 번 나눠 묻는다');
  const { and } = c.sent[1].body.filter;
  assert.deepEqual(and[1], { property: P.DUE, date: { is_empty: true } });
  assert.equal(and[2].timestamp, 'created_time',
    '제한이 없으면 몇 달치 미완료가 통째로 딸려온다');
});

test('마감일 없는 항목이 앞선 결과와 겹치면 한 번만 담는다', async () => {
  const c = stubbed(ALL);
  const page = (id) => ({ id, url: `u/${id}`, properties: { '할 일': { title: [{ plain_text: id }] } } });
  let call = 0;
  c.request = async () => {
    call += 1;
    return { results: call === 1 ? [page('a'), page('b')] : [page('b'), page('c')], has_more: false };
  };

  const tasks = await c.queryOpenTasks({ today: '2026-09-09', carryOverDays: 7, includeNoDueDate: true });
  assert.deepEqual(tasks.map((t) => t.id), ['a', 'b', 'c']);
});

test('완료 목록은 완료일시의 하루 구간으로 조회한다', async () => {
  const c = stubbed(ALL);
  await c.queryCompletedOn('2026-09-09');

  const and = c.sent[0].body.filter.and;
  assert.deepEqual(and[0], { property: P.DONE, checkbox: { equals: true } });
  assert.ok(and[1][P.DONE_AT] === undefined && and[1].property === P.DONE_AT);
  assert.ok(and[1].date.on_or_after.startsWith('2026-09-09T00:00:00'));
  assert.ok(and[2].date.before.startsWith('2026-09-10T00:00:00'));
});

test('완료일시 속성이 없는 DB 면 마감일 기준으로 대체한다', async () => {
  const c = stubbed(['할 일', '완료', '마감일', '텍스트']);
  await c.queryCompletedOn('2026-09-09');

  const and = c.sent[0].body.filter.and;
  assert.deepEqual(and[1], { property: P.DUE, date: { equals: '2026-09-09' } });
});

test('노션 page 를 앱 객체로 옮긴다', () => {
  const c = stubbed(ALL);
  const task = c.toTask({
    id: 'page-1',
    url: 'https://notion.so/page-1',
    last_edited_time: '2026-09-09T10:00:00.000Z',
    properties: {
      '할 일': { title: [{ plain_text: '베트남 선수 ' }, { plain_text: '영상 확인' }] },
      '완료': { checkbox: true },
      '마감일': { date: { start: '2026-09-09T18:00:00+09:00' } },
      '텍스트': { rich_text: [{ plain_text: '메모' }] },
      '완료일시': { date: { start: '2026-09-09T19:00:00+09:00' } },
      '분류': { select: { name: '업무' } },
      '출처': { select: { name: '앱' } },
    },
  });

  assert.equal(task.title, '베트남 선수 영상 확인', '나뉜 rich text 를 이어붙인다');
  assert.equal(task.done, true);
  assert.equal(task.category, '업무');
  assert.equal(D.toDateKey(task.doneAt), '2026-09-09');
});

test('제목이 비어 있어도 화면이 깨지지 않는다', () => {
  const c = stubbed(ALL);
  const task = c.toTask({ id: 'x', url: 'u', properties: { '할 일': { title: [] } } });
  assert.equal(task.title, '(제목 없음)');
  assert.equal(task.done, false);
});

test('프록시가 HTML 을 돌려줘도 원인을 알 수 있는 오류가 난다', async () => {
  const c = new NotionClient({ token: 'ntn_test', databaseId: 'db-1' });
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    headers: { get: () => null },
    text: async () => 'Host not in allowlist',
  });

  await assert.rejects(
    () => c.request('GET', '/databases/db-1'),
    (err) => {
      assert.equal(err.name, 'NotionError', 'SyntaxError 가 그대로 새어나오면 안 된다');
      assert.match(err.message, /프록시나 방화벽/);
      assert.equal(err.fatal, true, '계속 재시도해도 소용없는 상황');
      return true;
    },
  );
});

test('토큰이 없으면 네트워크를 타지 않는다', async () => {
  const c = new NotionClient({ token: null, databaseId: 'db-1' });
  await assert.rejects(() => c.request('GET', '/x'), /토큰이 설정되지 않았습니다/);
});

// ── 노션 필터 구조 검증 ────────────────────────────────
// 노션 복합 필터는 두 단계까지만 중첩할 수 있다. 세 단계를 보내면 400 이 오는데,
// 단위 테스트가 요청 내용만 확인하면 이 규칙 위반을 놓친다. 실제로 놓쳤다.

/** and/or 가 몇 겹으로 쌓였는지 (잎이면 0) */
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

test('만들어 보내는 모든 필터가 노션 중첩 규칙을 지킨다', async () => {
  const combos = [
    { carryOverDays: 7, includeNoDueDate: true },
    { carryOverDays: 7, includeNoDueDate: false },
    { carryOverDays: 0, includeNoDueDate: true },
    { carryOverDays: 0, includeNoDueDate: false },
  ];

  for (const options of combos) {
    for (const schema of [ALL, ['할 일', '완료', '마감일', '텍스트']]) {
      const c = stubbed(schema);
      await c.queryOpenTasks({ today: '2026-09-09', ...options });
      await c.queryCompletedOn('2026-09-09');

      assert.ok(c.sent.length > 0);
      c.sent.forEach((req, i) => assertValidFilter(req.body.filter, `${JSON.stringify(options)} #${i}`));
    }
  }
});

test('중첩이 세 단계인 필터는 검증에서 걸러진다', () => {
  const tooDeep = {
    and: [
      { property: '완료', checkbox: { equals: false } },
      { or: [{ and: [{ property: '마감일', date: { is_empty: true } }] }] },
    ],
  };
  assert.equal(compoundDepth(tooDeep), 3);
  assert.throws(() => assertValidFilter(tooDeep, '3단계'), /2단계까지만/);
});
