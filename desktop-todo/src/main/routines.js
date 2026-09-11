'use strict';

const crypto = require('crypto');
const D = require('./dates');

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 반복 할 일(루틴). "매주 월/수/금 논문 30분" 같은 것.
 * 하루에 한 번, 해당 요일이면 오늘 목록에 자동으로 만들어 넣는다.
 * routineLog 로 같은 날 두 번 만들어지는 걸 막는다.
 */
function materializeToday(engine, routinesFile, cache) {
  const today = D.dateKey();
  const wd = D.weekday(today);
  const log = cache.get('routineLog');
  const already = new Set(log[today] || []);
  const created = [];

  for (const r of routinesFile.get('routines')) {
    if (r.enabled === false) continue;
    if (!Array.isArray(r.days) || !r.days.includes(wd)) continue;
    if (already.has(r.id)) continue;

    engine.addTask({
      title: r.title,
      due: r.time ? D.toNotionDateTime(D.atTime(today, r.time)) : today,
      note: r.note || '',
      sourceId: r.sourceId || null,
    });
    already.add(r.id);
    created.push(r.title);
  }

  log[today] = [...already];
  pruneLog(log);
  cache.save();
  return created;
}

/** 로그가 무한정 커지지 않게 60일치만 남긴다. */
function pruneLog(log) {
  const cutoff = D.addDays(D.dateKey(), -60);
  for (const key of Object.keys(log)) {
    if (key < cutoff) delete log[key];
  }
}

function addRoutine(routinesFile, { title, days, time, sourceId, note }) {
  const routine = {
    id: crypto.randomUUID(),
    title: String(title || '').trim(),
    days: Array.isArray(days) ? days.map(Number).filter((d) => d >= 0 && d <= 6) : [],
    time: time || null,
    sourceId: sourceId || null,   // 어느 카테고리(노션 DB)에 만들지
    note: note || '',
    enabled: true,
  };
  routinesFile.get('routines').push(routine);
  routinesFile.save();
  return routine;
}

function updateRoutine(routinesFile, id, patch) {
  const r = routinesFile.get('routines').find((x) => x.id === id);
  if (!r) return null;
  Object.assign(r, patch);
  routinesFile.save();
  return r;
}

function deleteRoutine(routinesFile, id) {
  const list = routinesFile.get('routines');
  const idx = list.findIndex((x) => x.id === id);
  if (idx !== -1) list.splice(idx, 1);
  routinesFile.save();
}

function describe(routine) {
  const days = routine.days.length === 7
    ? '매일'
    : routine.days.slice().sort().map((d) => WEEKDAY_LABELS[d]).join('·');
  return routine.time ? `${days} ${routine.time}` : days;
}

module.exports = { materializeToday, addRoutine, updateRoutine, deleteRoutine, describe, WEEKDAY_LABELS };
