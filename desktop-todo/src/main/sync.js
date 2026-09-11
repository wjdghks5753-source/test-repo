'use strict';

const crypto = require('crypto');
const D = require('./dates');
const { NotionError } = require('./notion');

const isLocalId = (id) => typeof id === 'string' && id.startsWith('local:');

// 동기화 도중 들어온 변경까지 이어서 보내되, 무한히 돌지는 않게 한다.
const MAX_SYNC_ROUNDS = 5;

/**
 * 로컬 캐시가 화면의 진실이고, 노션이 저장소의 진실이다.
 *
 * 체크를 누르면 화면은 즉시 바뀌고(낙관적 갱신) 변경은 outbox 에 쌓인다.
 * 인터넷이 끊겨 있어도 앱은 그대로 동작하고, 연결되면 밀린 변경을 순서대로 보낸다.
 *
 * 카테고리(PERSONAL / SJS PROJECT / SJS STUDY)는 각각 별도의 노션 DB 이고,
 * 항목은 자기가 어느 DB 에서 왔는지 sourceId 로 기억한다.
 */
class SyncEngine {
  constructor({ cache, settings, client, onChange }) {
    this.cache = cache;
    this.settings = settings;
    this.client = client;
    this.onChange = onChange || (() => {});
    this.status = { syncing: false, lastSyncAt: cache.get('lastSyncAt'), error: null };
  }

  get tasks() { return this.cache.get('tasks'); }
  get outbox() { return this.cache.get('outbox'); }

  get sources() { return this.settings.get('sources') || []; }
  get enabledSources() { return this.sources.filter((s) => s.enabled !== false && s.databaseId); }

  sourceOf(id) {
    return this.sources.find((s) => s.id === id) || this.enabledSources[0] || null;
  }

  _commit() {
    this.cache.save();
    this.onChange();
  }

  findTask(id) {
    return this.tasks.find((t) => t.id === id);
  }

  // ── 로컬 변경 ────────────────────────────────────────────────

  addTask({ title, due, dueEnd, note, sourceId }) {
    const source = this.sourceOf(sourceId || this.settings.get('defaultSourceId'));
    if (!source) return null;

    const task = {
      id: `local:${crypto.randomUUID()}`,
      sourceId: source.id,
      category: source.label,
      title: title.trim(),
      done: false,
      due: due || null,
      dueEnd: dueEnd || null,
      note: note || '',
      doneAt: null,
      url: null,
      lastEdited: new Date().toISOString(),
      pending: true,
    };
    this.tasks.unshift(task);
    this.outbox.push({
      opId: crypto.randomUUID(),
      type: 'create',
      taskId: task.id,
      sourceId: source.id,
      payload: { title: task.title, due: task.due, dueEnd: task.dueEnd, note: task.note, done: false },
      tries: 0,
    });
    this._commit();
    return task;
  }

  patchTask(id, patch) {
    const task = this.findTask(id);
    if (!task) return null;

    if (patch.done !== undefined) {
      // 완료 시각은 앱이 남긴다. DB 에 완료일시 속성이 없으면 노션 쪽은 그냥 생략된다.
      patch.doneAt = patch.done ? D.toNotionDateTime(new Date()) : null;
    }

    Object.assign(task, patch, { pending: true, lastEdited: new Date().toISOString() });

    // 같은 항목에 대해 아직 안 보낸 변경이 있으면 하나로 합친다.
    const existing = this.outbox.find((op) => op.taskId === id && op.type === 'update');
    if (existing) {
      Object.assign(existing.patch, patch);
      existing.tries = 0;
      existing.lastError = null;
    } else {
      const create = this.outbox.find((op) => op.taskId === id && op.type === 'create');
      if (create) {
        // 아직 노션에 만들어지지도 않았다면 생성 내용 자체를 고친다.
        Object.assign(create.payload, patch);
      } else {
        this.outbox.push({
          opId: crypto.randomUUID(),
          type: 'update',
          taskId: id,
          sourceId: task.sourceId,
          patch: { ...patch },
          tries: 0,
        });
      }
    }
    this._commit();
    return task;
  }

  deleteTask(id) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    this.tasks.splice(idx, 1);

    // 아직 안 보낸 변경은 같이 버린다.
    this.cache.data.outbox = this.outbox.filter((op) => op.taskId !== id);
    if (!isLocalId(id)) {
      this.outbox.push({ opId: crypto.randomUUID(), type: 'delete', taskId: id, tries: 0 });
    }
    this._commit();
  }

  // ── 노션 반영 ────────────────────────────────────────────────

  /** outbox 를 앞에서부터 비운다. 일시적 오류가 나면 순서를 지키기 위해 거기서 멈춘다. */
  async push() {
    const failures = [];

    while (this.outbox.length) {
      const op = this.outbox[0];
      try {
        const source = op.sourceId ? this.sourceOf(op.sourceId) : null;
        if (op.type !== 'delete' && !source) {
          throw new NotionError('이 항목이 속한 카테고리를 찾을 수 없습니다.', 400);
        }
        if (source && !this.client.hasSchema(source)) await this.client.loadSchema(source);

        if (op.type === 'create') {
          const created = await this.client.createTask(source, op.payload);
          const local = this.findTask(op.taskId);
          if (local) Object.assign(local, created, { pending: false });
          // 뒤에 남은 작업들이 임시 ID 를 가리키고 있으면 진짜 ID 로 바꿔준다.
          for (const later of this.outbox) {
            if (later.taskId === op.taskId) later.taskId = created.id;
          }
        } else if (op.type === 'update') {
          if (isLocalId(op.taskId)) throw new NotionError('아직 노션에 생성되지 않은 항목입니다.', 400);
          const updated = await this.client.updateTask(source, op.taskId, op.patch);
          const local = this.findTask(op.taskId);
          if (local) Object.assign(local, updated, { pending: false });
        } else if (op.type === 'delete') {
          await this.client.archiveTask(op.taskId);
        }
        this.outbox.shift();
      } catch (err) {
        op.tries = (op.tries || 0) + 1;
        op.lastError = err.message;

        if (err.fatal || op.tries >= 5) {
          // 고쳐질 리 없는 오류. 계속 붙잡고 있으면 뒤의 변경까지 전부 막힌다.
          this.outbox.shift();
          const local = this.findTask(op.taskId);
          if (local) local.pending = false;
          failures.push(`${op.type}: ${err.message}`);
          continue;
        }
        this._commit();
        throw err; // 일시적 오류 — 다음 동기화 때 이어서 시도한다.
      }
    }

    this._commit();
    return failures;
  }

  /**
   * 모든 카테고리에서 오늘 기준 목록을 받아 캐시를 맞춘다.
   * 한 DB 가 실패해도 (통합 연결을 안 했다든지) 나머지는 그대로 불러온다.
   */
  async pull() {
    const today = D.dateKey();
    const options = {
      today,
      carryOverDays: this.settings.get('carryOverDays'),
      includeNoDueDate: this.settings.get('includeNoDueDate'),
    };

    const remote = new Map();
    const failures = [];
    const failedSources = new Set();
    const liveSources = new Set(this.enabledSources.map((s) => s.id));

    for (const source of this.enabledSources) {
      try {
        if (!this.client.hasSchema(source)) await this.client.loadSchema(source);
        const open = await this.client.queryOpenTasks(source, options);
        const completed = await this.client.queryCompletedOn(source, today);
        for (const task of [...open, ...completed]) remote.set(task.id, task);
      } catch (err) {
        failures.push(`${source.label} — ${err.message}`);
        failedSources.add(source.id);
      }
    }

    const pendingIds = new Set(this.outbox.map((op) => op.taskId));
    const next = [];

    for (const task of this.tasks) {
      const keepLocal = isLocalId(task.id) || pendingIds.has(task.id);
      // 못 불러온 DB 의 항목은 지우지 않는다. 잠깐의 오류로 목록이 비면 곤란하다.
      const sourceFailed = failedSources.has(task.sourceId);
      // 꺼버린 카테고리의 항목은 화면에서 뺀다.
      const stillEnabled = liveSources.has(task.sourceId);

      if ((keepLocal || sourceFailed) && stillEnabled) {
        next.push(task);
        remote.delete(task.id);
      }
    }
    for (const task of remote.values()) next.push(task);

    next.sort(sortTasks);
    this.cache.data.tasks = next;
    this.cache.data.lastSyncAt = new Date().toISOString();
    this._commit();

    return { count: next.length, failures };
  }

  async sync() {
    // 이미 돌고 있으면 겹쳐 돌리지 않는다. 대신 "끝나고 한 번 더" 표시만 남긴다.
    if (this.status.syncing) {
      this.again = true;
      return this.status;
    }

    if (!this.client.configured) {
      this.status = { ...this.status, syncing: false, error: '노션 토큰을 먼저 설정해 주세요.' };
      this.onChange();
      return this.status;
    }
    if (!this.enabledSources.length) {
      this.status = { ...this.status, syncing: false, error: '연결된 카테고리가 없습니다. 설정에서 추가해 주세요.' };
      this.onChange();
      return this.status;
    }

    this.status = { ...this.status, syncing: true, error: null };
    this.onChange();

    let error = null;
    let rounds = 0;

    do {
      this.again = false;
      rounds += 1;
      try {
        const pushFailures = await this.push();
        const { failures } = await this.pull();
        const all = [...pushFailures, ...failures];
        error = all.length ? all[0] : null;
      } catch (err) {
        error = err.message;
        break;
      }
    } while ((this.again || this.outbox.length) && rounds < MAX_SYNC_ROUNDS);

    this.status = { syncing: false, lastSyncAt: this.cache.get('lastSyncAt'), error };
    this.onChange();
    return this.status;
  }
}

/** 미완료가 위, 그 안에서는 마감일 순. 완료된 것은 최근에 끝낸 순으로 아래에. */
function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;

  if (a.done) {
    if (a.doneAt && b.doneAt) return new Date(b.doneAt) - new Date(a.doneAt);
    if (a.doneAt) return -1;
    if (b.doneAt) return 1;
  }

  if (!a.due && !b.due) return a.title.localeCompare(b.title, 'ko');
  if (!a.due) return 1;
  if (!b.due) return -1;
  return a.due.localeCompare(b.due);
}

module.exports = { SyncEngine, isLocalId, sortTasks };
