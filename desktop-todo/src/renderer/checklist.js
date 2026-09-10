'use strict';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const el = {
  date: $('dateLabel'), list: $('list'),
  fill: $('progressFill'), progress: $('progressText'), pct: $('progressPct'),
  title: $('newTitle'), time: $('newTime'), category: $('newCategory'), add: $('addBtn'),
  sync: $('syncBtn'), settings: $('settingsBtn'), hide: $('hideBtn'),
  status: $('statusText'), pending: $('pendingText'),
};

let state = null;
let completedOpen = false;   // 완료 섹션 펼침 여부. 창을 새로 열면 다시 접힌다.
let editingId = null;        // 지금 수정 중인 항목. 편집 중에는 다시 그리지 않는다.

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
    if (row.classList.contains('leaving')) return;   // 연타 방지

    const next = !task.done;
    const willVanish = next && hideCompleted() && !completedOpen;

    if (willVanish) {
      // 목록에서 빠지는 게 보이도록 애니메이션을 먼저 보여주고,
      // 그 뒤에 상태를 바꾼다. patchTask 가 곧바로 다시 그리기 때문이다.
      row.classList.add('leaving');
      setTimeout(() => window.todo.patchTask(task.id, { done: true }), 240);
      return;
    }

    row.classList.toggle('done');           // 응답을 기다리지 않고 바로 반응
    window.todo.patchTask(task.id, { done: next });
  });

  const body = document.createElement('div');
  body.className = 'body';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = task.title;           // textContent — 노션 내용이 HTML 로 해석되지 않게
  title.title = '눌러서 수정';
  title.addEventListener('click', () => startEdit(task.id));
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

  const edit = document.createElement('button');
  edit.className = 'rowbtn';
  edit.textContent = '✎';
  edit.title = '수정 (제목·시각·분류·메모)';
  edit.addEventListener('click', () => startEdit(task.id));
  btns.appendChild(edit);

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
  for (const t of tasks) frag.appendChild(renderRow(t, today));
  return frag;
}

const hideCompleted = () => Boolean(state && state.settings.hideCompleted);

const CATEGORIES = ['스터디', '업무', '환자', '연구', '개인'];

function startEdit(id) {
  editingId = id;
  render({ force: true });
}

function stopEdit() {
  editingId = null;
  render({ force: true });
}

function field(type, value, placeholder) {
  const input = document.createElement('input');
  input.className = 'field';
  input.type = type;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  return input;
}

/**
 * 항목을 그 자리에서 고치는 폼. 노션에 다녀오지 않아도 되도록
 * 화면에 보이는 값(제목·마감·분류·메모)은 전부 여기서 바꿀 수 있다.
 */
function renderEditor(task) {
  const form = document.createElement('form');
  form.className = 'task-editor';

  const title = field('text', task.title, '할 일');
  const date = field('date', task.due ? dueKey(task.due) : '');
  const time = field('time', timeLabel(task.due) || '');
  const note = field('text', task.note, '메모 (선택)');

  const category = document.createElement('select');
  category.className = 'field';
  for (const name of ['', ...CATEGORIES]) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name || '분류 없음';
    category.appendChild(option);
  }
  category.value = task.category || '';

  const when = document.createElement('div');
  when.className = 'editor-row';
  when.append(date, time, category);

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn primary';
  save.textContent = '저장';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = '취소';
  cancel.addEventListener('click', stopEdit);

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn';
  later.textContent = '내일로';
  later.title = '마감일을 하루 미룹니다 (저장을 눌러야 반영됩니다)';
  later.addEventListener('click', () => {
    date.value = window.TodoUtil.shiftDate(date.value || state.today, 1);
  });

  const actions = document.createElement('div');
  actions.className = 'editor-row actions';
  const gap = document.createElement('div');
  gap.className = 'spacer';
  actions.append(save, cancel, gap, later);

  form.append(title, when, note, actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = title.value.trim();
    if (!next) { title.focus(); return; }

    editingId = null;
    window.todo.patchTask(task.id, {
      title: next,
      due: window.TodoUtil.buildDue(date.value, time.value),
      category: category.value || null,
      note: note.value.trim(),
    });
    render({ force: true });
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); stopEdit(); }
  });

  return form;
}

const renderRow = (task, today) =>
  (task.id === editingId ? renderEditor(task) : renderTask(task, today));

/**
 * 완료한 항목은 기본으로 접어둔다.
 * 밀린 걸 한꺼번에 정리한 날이면 완료 항목이 수십 개가 되어,
 * 정작 남은 할 일이 그 아래로 파묻힌다.
 */
function renderCompleted(tasks, today) {
  if (!tasks.length) return null;
  if (!hideCompleted()) return renderGroup('완료', tasks, today, null);

  const frag = document.createDocumentFragment();

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'group-title toggle';
  head.title = completedOpen ? '접기' : '펼쳐서 보기';

  // 삼각형은 CSS 로 그린다. 글꼴에 따라 ▸ 가 점으로 깨져 보이는 환경이 있다.
  const caret = document.createElement('span');
  caret.className = completedOpen ? 'caret open' : 'caret';
  head.append(caret, document.createTextNode(`완료 ${tasks.length}`));
  head.addEventListener('click', () => { completedOpen = !completedOpen; render(); });

  frag.appendChild(head);
  if (completedOpen) for (const t of tasks) frag.appendChild(renderRow(t, today));
  return frag;
}

function render({ force = false } = {}) {
  if (!state) return;

  // 수정하던 항목이 목록에서 사라졌다면(다른 기기에서 지웠거나 마감일이 바뀌어
  // 오늘 목록에서 빠진 경우) 편집 상태를 푼다. 이걸 안 하면 아래 가드에 걸려
  // 화면이 영영 갱신되지 않는다.
  if (editingId && !state.tasks.some((t) => t.id === editingId)) editingId = null;

  // 수정 중에 다시 그리면 입력하던 내용이 날아간다.
  // 동기화가 5분마다 도는 앱이라 이 가드가 없으면 실제로 겪게 된다.
  if (editingId && !force) return;

  const { tasks, today, status } = state;

  el.date.textContent = humanDate(today);

  const g = groupTasks(tasks, today);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const total = tasks.length;

  // 완료율은 항목 개수 기준. 99% 이상이면 100%로 올려 보여준다.
  const percent = window.TodoUtil.completionPercent(done.length, total);
  const allDone = total > 0 && !open.length;

  el.pct.textContent = total ? `${percent}%` : '—';
  el.pct.classList.toggle('full', allDone);
  el.fill.style.width = `${percent}%`;
  el.fill.classList.toggle('full', allDone);

  if (!total) {
    el.progress.textContent = '오늘 등록된 할 일이 없습니다';
  } else {
    const parts = [`${done.length} / ${total} 완료`];
    if (open.length) parts.push(`남은 ${open.length}건`);
    if (g.overdue.length) parts.push(`지연 ${g.overdue.length}건`);
    el.progress.textContent = parts.join(' · ');
  }

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
    ]) {
      const frag = renderGroup(label, list, today, cls);
      if (frag) el.list.appendChild(frag);
    }

    if (!open.length) {
      const cleared = document.createElement('div');
      cleared.className = 'empty cleared';
      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = '✓';
      cleared.appendChild(big);
      cleared.append(document.createTextNode('오늘 할 일을 모두 끝냈습니다.'));
      el.list.appendChild(cleared);
    }

    const doneFrag = renderCompleted(g.done, today);
    if (doneFrag) el.list.appendChild(doneFrag);
  }

  if (editingId) {
    const first = el.list.querySelector('.task-editor input');
    if (first) first.focus();
  }

  el.sync.classList.toggle('spin', Boolean(status.syncing));
  el.status.textContent = status.error || relativeTime(status.lastSyncAt);
  el.status.title = status.error || '';   // 잘린 오류 전문은 마우스를 올리면 보인다
  el.status.classList.toggle('err', Boolean(status.error));
  el.pending.textContent = state.outboxCount ? `대기 ${state.outboxCount}건` : '';
}

// ── 입력 ──────────────────────────────────────────────────────

function submit() {
  const title = el.title.value.trim();
  if (!title) return;

  const today = state ? state.today : dateKey();
  const due = window.TodoUtil.buildDue(today, el.time.value);

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
setInterval(() => render(), 30000);
