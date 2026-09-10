'use strict';

const D = require('./dates');

const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * 여러 노션 DB 를 한 화면에 모은다.
 *
 * DB 마다 속성 이름이 다르다 (할 일/이름, 완료/체크박스, 진행일시/날짜).
 * 그래서 코드는 "논리 이름"만 알고, 실제 속성 이름은 설정의 source.props 에서 찾는다.
 */
const KEYS = ['title', 'done', 'due', 'note', 'doneAt'];

class NotionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    // 토큰/권한/DB ID/속성 이름 문제는 재시도해도 소용없다.
    this.fatal = status === 400 || status === 401 || status === 403 || status === 404;
  }
}

const plain = (rich) => (Array.isArray(rich) ? rich.map((r) => r.plain_text).join('') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotionClient {
  constructor({ token }) {
    this.token = token;
    this.schemas = new Map();   // sourceId -> Set(속성 이름)
    this._chain = Promise.resolve();
    this._lastCall = 0;
  }

  get configured() {
    return Boolean(this.token);
  }

  /** 노션은 초당 약 3회 제한이 있다. DB 가 여러 개여도 큐는 하나로 공유한다. */
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
        // 노션의 검증 오류는 수백 자에 달한다. 화면에 그대로 흘리면 목록을 덮어버린다.
        const detail = json.message || `노션 오류 (HTTP ${res.status})`;
        const short = detail.length > 180 ? `${detail.slice(0, 180)}…` : detail;
        throw new NotionError(short, res.status, json.code);
      }
      return json;
    });
  }

  // ── 스키마 ────────────────────────────────────────────────

  /** DB 를 읽어 어떤 속성이 실제로 있는지 기억해 둔다. */
  async loadSchema(source) {
    const db = await this.request('GET', `/databases/${source.databaseId}`);
    const names = new Set(Object.keys(db.properties || {}));
    this.schemas.set(source.id, names);

    const missing = KEYS
      .filter((key) => source.props[key])
      .filter((key) => !names.has(source.props[key]))
      .map((key) => `${key}=${source.props[key]}`);

    // 제목 속성은 이름이 무엇이든 반드시 하나 있으므로 자동으로 찾아준다.
    const titleName = Object.keys(db.properties || {})
      .find((name) => db.properties[name].type === 'title');

    return {
      title: plain(db.title),
      properties: [...names],
      titleProperty: titleName || null,
      missing,
    };
  }

  hasSchema(source) {
    return this.schemas.has(source.id);
  }

  /** 논리 이름 -> 실제 노션 속성 이름. 설정에 없거나 DB 에 없으면 null. */
  prop(source, key) {
    const name = source.props ? source.props[key] : null;
    if (!name) return null;
    const schema = this.schemas.get(source.id);
    if (schema && !schema.has(name)) return null;
    return name;
  }

  /** 필수 속성이 없으면 조회 자체가 불가능하다. 미리 알려준다. */
  _require(source, key) {
    const name = this.prop(source, key);
    if (!name) {
      throw new NotionError(
        `"${source.label}" 에 ${key} 속성이 설정되어 있지 않습니다. 설정에서 속성 이름을 확인해 주세요.`,
        400,
      );
    }
    return name;
  }

  // ── 조회 ──────────────────────────────────────────────────

  async _queryAll(source, filter, sorts) {
    const results = [];
    let cursor;
    do {
      const page = await this.request('POST', `/databases/${source.databaseId}/query`, {
        filter,
        sorts,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor);
    return results.map((p) => this.toTask(source, p));
  }

  /**
   * 오늘 처리해야 할 미완료 항목.
   *
   * 노션 복합 필터는 두 단계까지만 중첩된다. and 안의 or 안에 다시 and 를 넣으면
   * 400 "body failed validation" 이 돌아온다. 그래서 평평한 질의를 두 번 던지고 합친다.
   */
  async queryOpenTasks(source, { today, carryOverDays, includeNoDueDate }) {
    const doneName = this._require(source, 'done');
    const dueName = this._require(source, 'due');
    const notDone = { property: doneName, checkbox: { equals: false } };

    const dated = [notDone, { property: dueName, date: { on_or_before: today } }];
    if (carryOverDays > 0) {
      dated.push({ property: dueName, date: { on_or_after: D.addDays(today, -carryOverDays) } });
    }

    const tasks = await this._queryAll(
      source,
      { and: dated },
      [{ property: dueName, direction: 'ascending' }],
    );

    if (!includeNoDueDate) return tasks;

    const since = D.toNotionDateTime(D.atTime(D.addDays(today, -(carryOverDays || 30)), '00:00'));
    const undated = await this._queryAll(source, {
      and: [
        notDone,
        { property: dueName, date: { is_empty: true } },
        { timestamp: 'created_time', created_time: { on_or_after: since } },
      ],
    });

    const seen = new Set(tasks.map((t) => t.id));
    for (const task of undated) {
      if (!seen.has(task.id)) tasks.push(task);
    }
    return tasks;
  }

  /** 해당 날짜에 완료한 항목. 완료일시 속성이 없으면 마감일로 대신 찾는다. */
  async queryCompletedOn(source, today) {
    const doneName = this._require(source, 'done');
    const isDone = { property: doneName, checkbox: { equals: true } };
    const doneAtName = this.prop(source, 'doneAt');

    if (doneAtName) {
      const from = D.toNotionDateTime(D.atTime(today, '00:00'));
      const to = D.toNotionDateTime(D.atTime(D.addDays(today, 1), '00:00'));
      return this._queryAll(source, {
        and: [
          isDone,
          { property: doneAtName, date: { on_or_after: from } },
          { property: doneAtName, date: { before: to } },
        ],
      });
    }

    const dueName = this._require(source, 'due');
    return this._queryAll(source, {
      and: [isDone, { property: dueName, date: { equals: today } }],
    });
  }

  // ── 변환 ──────────────────────────────────────────────────

  /** 노션 page -> 앱에서 쓰는 할 일 객체 */
  toTask(source, page) {
    const props = page.properties || {};
    const get = (key) => {
      const name = source.props ? source.props[key] : null;
      return name ? props[name] : undefined;
    };

    return {
      id: page.id,
      sourceId: source.id,
      category: source.label,
      title: plain(get('title')?.title) || '(제목 없음)',
      done: get('done')?.checkbox === true,
      due: get('due')?.date?.start ?? null,
      note: plain(get('note')?.rich_text),
      doneAt: get('doneAt')?.date?.start ?? null,
      url: page.url,
      lastEdited: page.last_edited_time,
      pending: false,
    };
  }

  /** 앱 필드 -> 노션 properties. 설정에 없거나 DB 에 없는 속성은 조용히 건너뛴다. */
  buildProperties(source, patch) {
    const out = {};
    const put = (key, value) => {
      const name = this.prop(source, key);
      if (name) out[name] = value;
    };

    if (patch.title !== undefined) put('title', { title: [{ text: { content: patch.title.slice(0, 2000) } }] });
    if (patch.done !== undefined) put('done', { checkbox: Boolean(patch.done) });
    if (patch.note !== undefined) put('note', { rich_text: patch.note ? [{ text: { content: patch.note.slice(0, 2000) } }] : [] });
    if (patch.due !== undefined) put('due', { date: patch.due ? { start: patch.due } : null });
    if (patch.doneAt !== undefined) put('doneAt', { date: patch.doneAt ? { start: patch.doneAt } : null });

    return out;
  }

  // ── 쓰기 ──────────────────────────────────────────────────

  async createTask(source, payload) {
    const page = await this.request('POST', '/pages', {
      parent: { database_id: source.databaseId },
      properties: this.buildProperties(source, payload),
    });
    return this.toTask(source, page);
  }

  async updateTask(source, pageId, patch) {
    const page = await this.request('PATCH', `/pages/${pageId}`, {
      properties: this.buildProperties(source, patch),
    });
    return this.toTask(source, page);
  }

  async archiveTask(pageId) {
    await this.request('PATCH', `/pages/${pageId}`, { archived: true });
  }
}

module.exports = { NotionClient, NotionError, KEYS };
