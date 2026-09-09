'use strict';

const D = require('./dates');

const TICK_MS = 30 * 1000;

/**
 * 시계 담당. 30초마다 깨어나서
 *  - 날짜가 넘어갔으면 오늘의 루틴을 만들고 아침 브리핑을 띄우고
 *  - 설정한 알림 시각이 지났으면 남은 할 일을 알려주고
 *  - 마감 시각이 임박한 항목을 개별로 알려주고
 *  - 주기적으로 노션과 동기화한다.
 *
 * 노트북을 덮어놔서 몇 시간을 건너뛰어도, "마지막 확인 시각 이후에 지나간
 * 알림 시각"을 기준으로 판단하므로 알림이 통째로 증발하지 않는다.
 */
class Scheduler {
  constructor({ cache, settings, engine, notify, onDayRollover }) {
    this.cache = cache;
    this.settings = settings;
    this.engine = engine;
    this.notify = notify;
    this.onDayRollover = onDayRollover;

    this.timer = null;
    this.lastCheck = new Date();
    this.lastSyncAt = 0;
    this.currentDate = D.dateKey();
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const now = new Date();
    const today = D.dateKey(now);

    if (today !== this.currentDate) {
      this.currentDate = today;
      this.lastCheck = D.atTime(today, '00:00');
      await this.onDayRollover();
    }

    this.checkScheduledTimes(now, today);
    this.checkDueSoon(now);

    const intervalMs = Math.max(1, this.settings.get('syncIntervalMin')) * 60 * 1000;
    if (now - this.lastSyncAt >= intervalMs) {
      this.lastSyncAt = now;
      await this.engine.sync();
    }

    this.lastCheck = now;
  }

  /** 설정된 알림 시각을 지났는지 확인. 이미 보낸 것은 다시 보내지 않는다. */
  checkScheduledTimes(now, today) {
    const fired = new Set(this.cache.get('firedNotify') || []);
    let changed = false;

    for (const hhmm of this.settings.get('notifyTimes') || []) {
      const key = `${today}T${hhmm}`;
      if (fired.has(key)) continue;

      const at = D.atTime(today, hhmm);
      if (at > this.lastCheck && at <= now) {
        this.notifyBriefing(hhmm);
        fired.add(key);
        changed = true;
      }
    }

    if (changed) {
      const cutoff = D.addDays(today, -3);
      this.cache.set('firedNotify', [...fired].filter((k) => k.slice(0, 10) >= cutoff));
    }
  }

  /** 마감 시각이 N분 안으로 들어온 항목을 하나씩 알려준다. */
  checkDueSoon(now) {
    const lead = Number(this.settings.get('notifyBeforeMin')) || 0;
    if (lead <= 0) return;

    const notified = new Set(this.cache.get('notifiedDueIds') || []);
    const before = new Date(now.getTime() + lead * 60 * 1000);
    let changed = false;

    for (const task of this.engine.tasks) {
      if (task.done || !task.due || !D.hasTime(task.due)) continue;
      if (notified.has(task.id)) continue;

      const due = new Date(task.due);
      if (due > now && due <= before) {
        this.notify({
          title: `${D.timeLabel(task.due)} 마감`,
          body: task.title,
        });
        notified.add(task.id);
        changed = true;
      }
    }

    if (changed) {
      // 오늘 목록에 없는 ID 는 계속 들고 있을 필요가 없다.
      const alive = new Set(this.engine.tasks.map((t) => t.id));
      this.cache.set('notifiedDueIds', [...notified].filter((id) => alive.has(id)));
    }
  }

  notifyBriefing(hhmm) {
    const tasks = this.engine.tasks.filter((t) => !t.done);
    const today = D.dateKey();
    const overdue = tasks.filter((t) => t.due && D.toDateKey(t.due) < today);

    if (!tasks.length) {
      this.notify({ title: `${hhmm} · 오늘 할 일`, body: '남은 할 일이 없습니다. 수고하셨습니다.' });
      return;
    }

    const head = tasks.slice(0, 3).map((t) => `· ${t.title}`).join('\n');
    const more = tasks.length > 3 ? `\n외 ${tasks.length - 3}건` : '';
    const overdueLine = overdue.length ? ` (지연 ${overdue.length}건)` : '';

    this.notify({
      title: `${hhmm} · 남은 할 일 ${tasks.length}건${overdueLine}`,
      body: `${head}${more}`,
    });
  }
}

module.exports = { Scheduler };
