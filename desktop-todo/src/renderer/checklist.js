'use strict';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const el = {
  date: $('dateLabel'), list: $('list'),
  fill: $('progressFill'), progress: $('progressText'),
  title: $('newTitle'), time: $('newTime'), category: $('newCategory'), add: $('addBtn'),
  sync: $('syncBtn'), settings: $('settingsBtn'), hide: $('hideBtn'),
  status: $('statusText'), pending: $('pendingText'),
};

let state = null;

// ── 날짜 헬퍼 (main 쪽 dates.js 의 화면용 최소 버전) ──────────

const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hasTime = (v) => typeof v === 'string' && v.includes('T');
const dueKey = (v) => (v ? (hasTime(v) ? dateKey(new Date(v)) : v.slice(0, 10)) : null);
const timeLabel = (v) => {
  if (!hasTime(v)) return null;
  const d = new Date(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function humanDate(key) {
  const d = new Date(`${key}T00:00:00`);
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
}

function relativeTime(iso) {
  if (!iso) return '아직 동기화 안 됨';
  const secs = Math.round((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return '방금 동기화';
  if (secs < 3600) return `${Math.floor(secs / 60)}분 전 동기화`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}시간 전 동기화`;
  return `${Math.floor(secs / 86400)}일 전 동기화`;
}

// ── 렌더 ──────────────────────────────────────────────────────

function groupTasks(tasks, today) {
  const groups = { overdue: [], today: [], undated: [], done: [] };
  for (const t of tasks) {
    if (t.done) { groups.done.push(t); continue; }
    const k = dueKey(t.due);
    if (!k) groups.undated.push(t);
    else if (k < today) groups.overdue.push(t);
    else groups.today.push(t);
  }
  return groups;
}

function makeTag(text, cls) {
  const span = document.createElement('span');
  span.className = cls ? `tag ${cls}` : 'tag';
  span.textContent = text;
  return span;
}

function renderTask(task, today) {
  const row = document.createElement('div');
  row.className = task.done ? 'task done' : 'task';

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.title = task.done ? '완료 취소' : '완료 처리';
  check.setAttribute('aria-pressed', String(task.done));
  check.addEventListener('click', () => {
    row.classList.toggle('done');           // 응답을 기다리지 않고 바로 반응
    window.todo.patchTask(task.id, { done: !task.done });
  });

  const body = document.createElement('div');
  body.className = 'body';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = task.title;           // textContent — 노션 내용이 HTML 로 해석되지 않게
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const k = dueKey(task.due);
  const t = timeLabel(task.due);
  if (k && k < today) {
    meta.appendChild(makeTag(`${humanDate(k)} 지연`, 'late'));
  } else if (t) {
    const due = new Date(task.due);
    const soon = !task.done && due - Date.now() < 60 * 60 * 1000 && due > Date.now();
    meta.appendChild(makeTag(t, soon ? 'soon' : ''));
  }
  if (task.category) meta.appendChild(makeTag(task.category));
  if (task.source === '루틴') meta.appendChild(makeTag('루틴', 'routine'));
  if (task.done && task.doneAt) meta.appendChild(makeTag(`${timeLabel(task.doneAt) || ''} 완료`.trim()));
  if (task.pending) meta.appendChild(makeTag('동기화 대기', 'pending'));
  if (task.note) {
    const note = document.createElement('span');
    note.textContent = task.note.replace(/\s+/g, ' ').slice(0, 60);
    meta.appendChild(note);
  }
  if (meta.childElementCount) body.appendChild(meta);

  const btns = document.createElement('div');
  btns.className = 'rowbtns';

  if (task.url) {
    const open = document.createElement('button');
    open.className = 'rowbtn';
    open.textContent = '↗';
    open.title = '노션에서 열기';
    open.addEventListener('click', () => window.todo.openExternal(task.url));
    btns.appendChild(open);
  }

  const del = document.createElement('button');
  del.className = 'rowbtn del';
  del.textContent = '🗑';
  del.title = '삭제 (노션에서 보관 처리)';
  del.addEventListener('click', () => {
    if (confirm(`"${task.title}" 을(를) 삭제할까요?\n노션에서는 휴지통으로 이동합니다.`)) {
      window.todo.deleteTask(task.id);
    }
  });
  btns.appendChild(del);

  row.append(check, body, btns);
  return row;
}

function renderGroup(label, tasks, today, cls) {
  if (!tasks.length) return null;
  const frag = document.createDocumentFragment();
  const head = document.createElement('div');
  head.className = cls ? `group-title ${cls}` : 'group-title';
  head.textContent = `${label} ${tasks.length}`;
  frag.appendChild(head);
  for (const t of tasks) frag.appendChild(renderTask(t, today));
  return frag;
}

function render() {
  if (!state) return;
  const { tasks, today, status } = state;

  el.date.textContent = humanDate(today);

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const total = tasks.length;
  el.fill.style.width = total ? `${Math.round((done.length / total) * 100)}%` : '0%';
  el.progress.textContent = total
    ? `${done.length} / ${total} 완료 · 남은 ${open.length}건`
    : '오늘 등록된 할 일이 없습니다';

  const g = groupTasks(tasks, today);
  el.list.replaceChildren();

  if (!total) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<span class="big">🗒️</span>';
    empty.append(document.createTextNode('오늘 할 일이 비어 있습니다.'));
    empty.appendChild(document.createElement('br'));
    empty.append(document.createTextNode('위에 입력하면 노션에도 함께 기록됩니다.'));
    el.list.appendChild(empty);
  } else {
    for (const [label, list, cls] of [
      ['지연', g.overdue, 'overdue'],
      ['오늘', g.today, null],
      ['마감일 없음', g.undated, null],
      ['완료', g.done, null],
    ]) {
      const frag = renderGroup(label, list, today, cls);
      if (frag) el.list.appendChild(frag);
    }
  }

  el.sync.classList.toggle('spin', Boolean(status.syncing));
  el.status.textContent = status.error || relativeTime(status.lastSyncAt);
  el.status.classList.toggle('err', Boolean(status.error));
  el.pending.textContent = state.outboxCount ? `대기 ${state.outboxCount}건` : '';
}

// ── 입력 ──────────────────────────────────────────────────────

function submit() {
  const title = el.title.value.trim();
  if (!title) return;

  const today = state ? state.today : dateKey();
  let due = today;
  if (el.time.value) {
    const [h, m] = el.time.value.split(':').map(Number);
    const d = new Date(`${today}T00:00:00`);
    d.setHours(h, m, 0, 0);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    due = `${today}T${pad(h)}:${pad(m)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  window.todo.addTask({ title, due, category: el.category.value || null });
  el.title.value = '';
  el.time.value = '';
  el.title.focus();
}

el.add.addEventListener('click', submit);
el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
el.sync.addEventListener('click', () => window.todo.syncNow());
el.settings.addEventListener('click', () => window.todo.openSettings());
el.hide.addEventListener('click', () => window.todo.hideWindow());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.todo.hideWindow(); });

window.todo.onState((data) => { state = data; render(); });
window.todo.getState().then((data) => {
  state = data;
  if (data.settings.defaultCategory) el.category.value = data.settings.defaultCategory;
  render();
});

// "n분 전 동기화" 표시를 살아있게 유지한다.
setInterval(render, 30000);
