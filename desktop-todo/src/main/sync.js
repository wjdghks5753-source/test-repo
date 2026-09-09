'use strict';

const crypto = require('crypto');
const D = require('./dates');
const { NotionError } = require('./notion');

const isLocalId = (id) => typeof id === 'string' && id.startsWith('local:');

/**
 * 로컬 캐시가 화면의 진실이고, 노션이 저장소의 진실이다.
 *
 * 체크를 누르면 화면은 즉시 바뀌고(낙관적 갱신) 변경은 outbox 에 쌓인다.
 * 인터넷이 끊겨 있어도 앱은 그대로 동작하고, 연결되면 밀린 변경을 순서대로 보낸다.
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

  _commit() {
    this.cache.save();
    this.onChange();
  }

  findTask(id) {
    return this.tasks.find((t) => t.id === id);
  }

  // ── 로컬 변경 ────────────────────────────────────────────────

  addTask({ title, due, note, category, source }) {
    const task = {
      id: `local:${crypto.randomUUID()}`,
      title: title.trim(),
      done: false,
      due: due || null,
      note: note || '',
      doneAt: null,
      category: category || this.settings.get('defaultCategory') || null,
      source: source || '앱',
      url: null,
      lastEdited: new Date().toISOString(),
      pending: true,
    };
    this.tasks.unshift(task);
    this.outbox.push({
      opId: crypto.randomUUID(), type: 'create', taskId: task.id,
      payload: { title: task.title, due: task.due, note: task.note, category: task.category, source: task.source, done: false },
      tries: 0,
    });
    this._commit();
    return task;
  }

  patchTask(id, patch) {
    const task = this.findTask(id);
    if (!task) return null;

    if (patch.done !== undefined) {
      // 완료 시각은 앱이 남긴다. 이게 "언제 끝냈는지"의 기록이 된다.
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
        this.outbox.push({ opId: crypto.randomUUID(), type: 'update', taskId: id, patch: { ...patch }, tries: 0 });
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
        if (op.type === 'create') {
          const created = await this.client.createTask(op.payload);
          const local = this.findTask(op.taskId);
          if (local) Object.assign(local, created, { pending: false });
          // 뒤에 남은 작업들이 임시 ID 를 가리키고 있으면 진짜 ID 로 바꿔준다.
          for (const later of this.outbox) {
            if (later.taskId === op.taskId) later.taskId = created.id;
          }
        } else if (op.type === 'update') {
          if (isLocalId(op.taskId)) throw new NotionError('아직 노션에 생성되지 않은 항목입니다.', 400);
          const updated = await this.client.updateTask(op.taskId, op.patch);
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

  /** 노션에서 오늘 기준 목록을 다시 받아 캐시를 맞춘다. */
  async pull() {
    const today = D.dateKey();
    const [open, completed] = [
      await this.client.queryOpenTasks({
        today,
        carryOverDays: this.settings.get('carryOverDays'),
        includeNoDueDate: this.settings.get('includeNoDueDate'),
      }),
      await this.client.queryCompletedOn(today),
    ];

    const remote = new Map();
    for (const t of [...open, ...completed]) remote.set(t.id, t);

    const pendingIds = new Set(this.outbox.map((op) => op.taskId));
    const next = [];

    // 아직 노션에 못 올린 로컬 항목은 무조건 살린다.
    for (const t of this.tasks) {
      if (isLocalId(t.id) || pendingIds.has(t.id)) {
        next.push(t);
        remote.delete(t.id);
      }
    }
    for (const t of remote.values()) next.push(t);

    next.sort(sortTasks);
    this.cache.data.tasks = next;
    this.cache.data.lastSyncAt = new Date().toISOString();
    this._commit();
    return { open: open.length, completed: completed.length };
  }

  async sync() {
    if (this.status.syncing) return this.status;
    if (!this.client.configured) {
      this.status = { ...this.status, syncing: false, error: '노션 토큰을 먼저 설정해 주세요.' };
      this.onChange();
      return this.status;
    }

    this.status = { ...this.status, syncing: true, error: null };
    this.onChange();

    try {
      if (!this.client.schema) await this.client.loadSchema();
      const failures = await this.push();
      await this.pull();
      this.status = {
        syncing: false,
        lastSyncAt: this.cache.get('lastSyncAt'),
        error: failures.length ? `일부 항목 반영 실패 — ${failures[0]}` : null,
      };
    } catch (err) {
      this.status = { syncing: false, lastSyncAt: this.cache.get('lastSyncAt'), error: err.message };
    }

    this.onChange();
    return this.status;
  }
}

/** 마감 시각 있는 것 먼저, 그다음 마감일 순, 완료된 것은 아래로. */
function sortTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (!a.due && !b.due) return a.title.localeCompare(b.title, 'ko');
  if (!a.due) return 1;
  if (!b.due) return -1;
  return a.due.localeCompare(b.due);
}

module.exports = { SyncEngine, isLocalId, sortTasks };
