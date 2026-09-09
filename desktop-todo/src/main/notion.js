'use strict';

const D = require('./dates');

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/** 노션 DB 의 속성 이름. DB 에서 이름을 바꿨다면 여기만 고치면 된다. */
const P = {
  TITLE: '할 일',
  DONE: '완료',
  DUE: '마감일',
  NOTE: '텍스트',
  DONE_AT: '완료일시',
  CATEGORY: '분류',
  SOURCE: '출처',
};

class NotionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    // 토큰/권한/DB ID 문제는 재시도해도 소용없다.
    this.fatal = status === 400 || status === 401 || status === 403 || status === 404;
  }
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((r) => r.plain_text).join('') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotionClient {
  constructor({ token, databaseId }) {
    this.token = token;
    this.databaseId = databaseId;
    this.schema = null;       // 실제 DB 에 존재하는 속성 이름 Set
    this._chain = Promise.resolve();
    this._lastCall = 0;
  }

  get configured() {
    return Boolean(this.token && this.databaseId);
  }

  /** 노션은 초당 약 3회 제한이 있어 호출을 한 줄로 세우고 최소 간격을 준다. */
  _queue(fn) {
    const run = this._chain.then(async () => {
      const gap = Date.now() - this._lastCall;
      if (gap < 350) await sleep(350 - gap);
      try {
        return await fn();
      } finally {
        this._lastCall = Date.now();
      }
    });
    this._chain = run.catch(() => {});
    return run;
  }

  async request(method, path, body, attempt = 0) {
    if (!this.token) throw new NotionError('노션 토큰이 설정되지 않았습니다.', 401);

    return this._queue(async () => {
      let res;
      try {
        res = await fetch(`${API}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        // 네트워크가 끊긴 경우. 재시도 대상.
        throw new NotionError(`네트워크 오류: ${err.message}`, 0);
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt < 3) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await sleep(retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt);
          return this.request(method, path, body, attempt + 1);
        }
      }

      const text = await res.text();

      // 사내 프록시나 방화벽이 중간에서 HTML 오류 페이지를 돌려주는 경우가 있다.
      // 그대로 JSON.parse 하면 엉뚱한 SyntaxError 가 나서 원인을 알 수 없게 된다.
      let json = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch (_) {
          throw new NotionError(
            `노션이 아닌 곳에서 응답이 왔습니다 (HTTP ${res.status}). ` +
            '회사망 프록시나 방화벽이 api.notion.com 을 막고 있는지 확인해 주세요.',
            res.status || 502,
          );
        }
      }

      if (!res.ok) {
        throw new NotionError(json.message || `노션 오류 (HTTP ${res.status})`, res.status, json.code);
      }
      return json;
    });
  }

  /** DB 스키마를 읽어 어떤 속성이 실제로 있는지 기억해 둔다. */
  async loadSchema() {
    const db = await this.request('GET', `/databases/${this.databaseId}`);
    this.schema = new Set(Object.keys(db.properties || {}));
    return {
      title: plain(db.title),
      properties: [...this.schema],
      missing: Object.values(P).filter((name) => !this.schema.has(name)),
    };
  }

  has(prop) {
    // 스키마를 아직 못 읽었으면 일단 있다고 보고 시도한다.
    return !this.schema || this.schema.has(prop);
  }

  async _queryAll(filter, sorts) {
    const results = [];
    let cursor;
    do {
      const page = await this.request('POST', `/databases/${this.databaseId}/query`, {
        filter,
        sorts,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return results.map((p) => this.toTask(p));
  }

  /**
   * 오늘 처리해야 할 미완료 항목:
   *  - 마감일이 오늘이거나 지난 것 (carryOverDays 만큼만 거슬러 올라간다)
   *  - 마감일이 비어 있고 최근에 만들어진 것 (선택)
   */
  async queryOpenTasks({ today, carryOverDays, includeNoDueDate }) {
    const dueBranch = { and: [{ property: P.DUE, date: { on_or_before: today } }] };
    if (carryOverDays > 0) {
      dueBranch.and.push({
        property: P.DUE,
        date: { on_or_after: D.addDays(today, -carryOverDays) },
      });
    }

    const branches = [dueBranch];
    if (includeNoDueDate) {
      const since = D.toNotionDateTime(D.atTime(D.addDays(today, -(carryOverDays || 30)), '00:00'));
      branches.push({
        and: [
          { property: P.DUE, date: { is_empty: true } },
          { timestamp: 'created_time', created_time: { on_or_after: since } },
        ],
      });
    }

    return this._queryAll(
      { and: [{ property: P.DONE, checkbox: { equals: false } }, { or: branches }] },
      [{ property: P.DUE, direction: 'ascending' }],
    );
  }

  /** 해당 날짜에 완료 처리한 항목. 완료일시가 없는 DB 면 마감일로 대신 찾는다. */
  async queryCompletedOn(today) {
    const doneFilter = { property: P.DONE, checkbox: { equals: true } };

    if (this.has(P.DONE_AT)) {
      const from = D.toNotionDateTime(D.atTime(today, '00:00'));
      const to = D.toNotionDateTime(D.atTime(D.addDays(today, 1), '00:00'));
      return this._queryAll({
        and: [doneFilter, { property: P.DONE_AT, date: { on_or_after: from } }, { property: P.DONE_AT, date: { before: to } }],
      });
    }

    return this._queryAll({
      and: [doneFilter, { property: P.DUE, date: { equals: today } }],
    });
  }

  /** 노션 page -> 앱에서 쓰는 할 일 객체 */
  toTask(page) {
    const props = page.properties || {};
    return {
      id: page.id,
      title: plain(props[P.TITLE]?.title) || '(제목 없음)',
      done: props[P.DONE]?.checkbox === true,
      due: props[P.DUE]?.date?.start ?? null,
      note: plain(props[P.NOTE]?.rich_text),
      doneAt: props[P.DONE_AT]?.date?.start ?? null,
      category: props[P.CATEGORY]?.select?.name ?? null,
      source: props[P.SOURCE]?.select?.name ?? null,
      url: page.url,
      lastEdited: page.last_edited_time,
      pending: false,
    };
  }

  /** 앱 필드 -> 노션 properties. DB 에 없는 속성은 조용히 건너뛴다. */
  buildProperties(patch) {
    const out = {};
    const put = (name, value) => { if (this.has(name)) out[name] = value; };

    if (patch.title !== undefined) put(P.TITLE, { title: [{ text: { content: patch.title.slice(0, 2000) } }] });
    if (patch.done !== undefined) put(P.DONE, { checkbox: Boolean(patch.done) });
    if (patch.note !== undefined) put(P.NOTE, { rich_text: patch.note ? [{ text: { content: patch.note.slice(0, 2000) } }] : [] });
    if (patch.due !== undefined) put(P.DUE, { date: patch.due ? { start: patch.due } : null });
    if (patch.doneAt !== undefined) put(P.DONE_AT, { date: patch.doneAt ? { start: patch.doneAt } : null });
    if (patch.category !== undefined) put(P.CATEGORY, { select: patch.category ? { name: patch.category } : null });
    if (patch.source !== undefined) put(P.SOURCE, { select: patch.source ? { name: patch.source } : null });

    return out;
  }

  async createTask(payload) {
    const page = await this.request('POST', '/pages', {
      parent: { database_id: this.databaseId },
      properties: this.buildProperties(payload),
    });
    return this.toTask(page);
  }

  async updateTask(pageId, patch) {
    const page = await this.request('PATCH', `/pages/${pageId}`, {
      properties: this.buildProperties(patch),
    });
    return this.toTask(page);
  }

  async archiveTask(pageId) {
    await this.request('PATCH', `/pages/${pageId}`, { archived: true });
  }
}

module.exports = { NotionClient, NotionError, P };
