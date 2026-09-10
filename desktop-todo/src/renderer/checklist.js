'use strict';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const U = () => window.TodoUtil;

const el = {
  date: $('dateLabel'), list: $('list'), tabs: $('tabs'),
  fill: $('progressFill'), pct: $('progressPct'), progress: $('progressText'),
  next: $('nextUp'), nextWhen: $('nextUpWhen'), nextTime: $('nextUpTime'), nextTitle: $('nextUpTitle'),
  title: $('newTitle'), time: $('newTime'), source: $('newSource'),
  sync: $('syncBtn'), settings: $('settingsBtn'), hide: $('hideBtn'),
  status: $('statusText'), pending: $('pendingText'),
};

let state = null;
let completedOpen = false;   // 완료 섹션 펼침 여부. 창을 새로 열면 다시 접힌다.
let editingId = null;        // 지금 수정 중인 항목. 편집 중에는 다시 그리지 않는다.
let activeSource = 'all';    // 지금 보고 있는 카테고리 ('all' 이면 전부)

// ── 날짜 헬퍼 ────────────────────────────────────────────────

const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hasTime = (v) => typeof v === 'string' && v.includes('T');
const dueKey = (v) => (v ? (hasTime(v) ? dateKey(new Date(v)) : v.slice(0, 10)) : null);
const timeLabel = (v) => {
  if (!hasTime(v)) return null;
  const d = new Date(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const WEEK_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const WEEK_SHORT = ['일', '월', '화', '수', '목', '금', '토'];

function humanDate(key, long = false) {
  const d = new Date(`${key}T00:00:00`);
  const w = (long ? WEEK_LONG : WEEK_SHORT)[d.getDay()];
  return long
    ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${w}`
    : `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
}

function relativeTime(iso) {
  if (!iso) return '아직 동기화 안 됨';
  const secs = Math.round((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return '방금 동기화';
  if (secs < 3600) return `${Math.floor(secs / 60)}분 전 동기화`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}시간 전 동기화`;
  return `${Math.floor(secs / 86400)}일 전 동기화`;
}

// ── 카테고리 ─────────────────────────────────────────────────

const hideCompleted = () => Boolean(state && state.settings.hideCompleted);
const sources = () => (state && state.sources ? state.sources.filter((s) => s.enabled !== false) : []);
const sourceOf = (id) => sources().find((s) => s.id === id) || null;
const colorOf = (source) => `cat-${(source && source.color) || 'gray'}`;

function categoryDot(source) {
  const dot = document.createElement('span');
  dot.className = `dot ${colorOf(source)}`;
  return dot;
}

/** 카테고리 탭. 숫자는 그 카테고리에 남은(미완료) 개수다. */
function renderTabs() {
  el.tabs.replaceChildren();
  const list = sources();
  if (list.length < 2) return;          // 카테고리가 하나뿐이면 탭이 의미 없다

  const make = (id, label, count, source) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = id === activeSource ? 'tab active' : 'tab';
    if (source) tab.appendChild(categoryDot(source));
    tab.append(document.createTextNode(label));

    const badge = document.createElement('span');
    badge.className = 'count';
    badge.textContent = String(count);
    tab.appendChild(badge);

    tab.addEventListener('click', () => { activeSource = id; render({ force: true }); });
    return tab;
  };

  const open = state.tasks.filter((t) => !t.done);
  el.tabs.appendChild(make('all', '전체', open.length, null));
  for (const source of list) {
    el.tabs.appendChild(
      make(source.id, source.label, open.filter((t) => t.sourceId === source.id).length, source));
  }
}

/** '추가' 가 어느 카테고리로 갈지 고르는 드롭다운을 채운다. */
function fillSourceSelect() {
  const list = sources();
  const current = el.source.value;
  el.source.replaceChildren();

  for (const source of list) {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.label;
    el.source.appendChild(option);
  }

  // 탭에서 카테고리를 고르면 추가도 그쪽으로 맞춰준다.
  const preferred = (activeSource !== 'all' && list.some((s) => s.id === activeSource))
    ? activeSource
    : (current || state.settings.defaultSourceId || (list[0] && list[0].id));
  if (preferred) el.source.value = preferred;
}

// ── 수정 ─────────────────────────────────────────────────────

function startEdit(id) { editingId = id; render({ force: true }); }
function stopEdit() { editingId = null; render({ force: true }); }

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
 * 화면에 보이는 값(제목·마감·메모)은 전부 여기서 바꿀 수 있다.
 */
function renderEditor(task) {
  const form = document.createElement('form');
  form.className = 'task-editor';

  const title = field('text', task.title, '할 일');
  const date = field('date', task.due ? dueKey(task.due) : '');
  const time = field('time', timeLabel(task.due) || '');
  const note = field('text', task.note, '메모 (선택)');

  // 카테고리는 노션 DB 자체라 앱에서 옮길 수 없다. 어디 소속인지만 보여준다.
  const source = sourceOf(task.sourceId);
  const cat = document.createElement('div');
  cat.className = `editor-cat ${colorOf(source)}`;
  cat.title = '카테고리는 노션 데이터베이스라 앱에서 옮길 수 없습니다';
  cat.textContent = source ? source.label : '카테고리 없음';

  const when = document.createElement('div');
  when.className = 'editor-row';
  when.append(date, time, cat);

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
  later.title = '날짜를 하루 미룹니다 (저장을 눌러야 반영됩니다)';
  later.addEventListener('click', () => {
    date.value = U().shiftDate(date.value || state.today, 1);
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
      due: U().buildDue(date.value, time.value),
      note: note.value.trim(),
    });
    render({ force: true });
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); stopEdit(); }
  });

  return form;
}

// ── 목록 ─────────────────────────────────────────────────────

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

function renderTask(task, today) {
  const source = sourceOf(task.sourceId);
  const row = document.createElement('div');

  const key = dueKey(task.due);
  const label = timeLabel(task.due);
  const classes = ['task', colorOf(source)];

  if (task.done) {
    classes.push('done');
  } else if (key && key < today) {
    classes.push('late');
  } else if (label) {
    const at = new Date(task.due);
    const mins = (at - Date.now()) / 60000;
    if (mins < 0) classes.push('past');
    else if (mins <= 60) classes.push('soon');
  }
  row.className = classes.join(' ');

  // 시각을 맨 앞 열에 세워 하루가 시간순으로 읽히게 한다.
  const when = document.createElement('span');
  when.className = 'when';
  if (key && key < today) {
    // 지연은 날짜를 보여준다. 폭이 좁으므로 '9/7' 처럼 짧게 쓴다.
    const d = new Date(`${key}T00:00:00`);
    when.textContent = `${d.getMonth() + 1}/${d.getDate()}`;
    when.title = `${humanDate(key)} 기한 · 지연`;
  } else {
    when.textContent = label || '';
  }

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = '✓';
  check.title = task.done ? '완료 취소' : '완료 처리';
  check.setAttribute('aria-pressed', String(task.done));
  check.addEventListener('click', () => {
    if (row.classList.contains('leaving')) return;   // 연타 방지

    const next = !task.done;
    if (next && hideCompleted() && !completedOpen) {
      // 목록에서 빠지는 게 보이도록 애니메이션을 먼저 보여주고 상태를 바꾼다.
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

  // 카테고리 이름은 '전체' 탭에서만. 한 카테고리만 보고 있으면 군더더기다.
  if (source && activeSource === 'all') {
    const name = document.createElement('span');
    name.className = 'catname';
    name.textContent = source.label;
    meta.appendChild(name);
  }
  if (task.done && task.doneAt) {
    meta.appendChild(makeTag(`${timeLabel(task.doneAt) || ''} 완료`.trim()));
  }
  if (task.pending) meta.appendChild(makeTag('동기화 대기', 'pending'));
  if (task.note) {
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = task.note.replace(/\s+/g, ' ').slice(0, 54);
    meta.appendChild(note);
  }
  if (meta.childElementCount) body.appendChild(meta);

  const btns = document.createElement('div');
  btns.className = 'rowbtns';

  const edit = document.createElement('button');
  edit.className = 'rowbtn';
  edit.textContent = '✎';
  edit.title = '수정';
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

  row.append(when, check, body, btns);
  return row;
}

function makeTag(text, cls) {
  const span = document.createElement('span');
  span.className = cls ? `tag ${cls}` : 'tag';
  span.textContent = text;
  return span;
}

const renderRow = (task, today) =>
  (task.id === editingId ? renderEditor(task) : renderTask(task, today));

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

/** 완료한 항목은 기본으로 접어둔다. 남은 할 일이 그 아래로 파묻히지 않도록. */
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

/** 지금 기준 다음 한 건. 이 창만 보고 하루를 산다면 이게 제일 중요한 줄이다. */
function renderNextUp(tasks) {
  const next = U().nextUp(tasks);
  if (!next) { el.next.hidden = true; return; }

  const late = next.when < Date.now();
  el.next.hidden = false;
  el.next.className = late ? 'nextup late' : 'nextup';
  el.nextWhen.textContent = U().untilLabel(next.when);
  el.nextTime.textContent = timeLabel(next.task.due) || '';
  el.nextTitle.textContent = next.task.title;
}

// ── 그리기 ───────────────────────────────────────────────────

function render({ force = false } = {}) {
  if (!state) return;

  // 수정하던 항목이 목록에서 사라졌다면 편집 상태를 푼다.
  // 이걸 안 하면 아래 가드에 걸려 화면이 영영 갱신되지 않는다.
  if (editingId && !state.tasks.some((t) => t.id === editingId)) editingId = null;

  // 수정 중에 다시 그리면 입력하던 내용이 날아간다.
  if (editingId && !force) return;

  const { today, status } = state;

  el.date.textContent = humanDate(today, true);
  renderTabs();
  fillSourceSelect();

  // 고른 카테고리만 본다. 퍼센트도 지금 보고 있는 것 기준으로 센다.
  const tasks = activeSource === 'all'
    ? state.tasks
    : state.tasks.filter((t) => t.sourceId === activeSource);

  const g = groupTasks(tasks, today);
  const open = tasks.filter((t) => !t.done);
  const total = tasks.length;

  renderNextUp(tasks);

  // 완료율의 분모는 "날짜가 오늘인 항목"뿐이다.
  // 몇 달 밀린 걸 오늘 정리했다고 오늘 몫을 다 한 것은 아니다.
  const stats = U().todayStats(tasks, today);

  el.pct.textContent = stats.dueToday ? `${stats.percent}%` : '—';
  el.pct.title = '날짜가 오늘인 항목 기준';
  el.fill.style.width = `${stats.percent}%`;

  if (!total) {
    el.progress.textContent = '오늘 등록된 할 일이 없습니다';
  } else if (!stats.dueToday) {
    const parts = ['오늘 날짜인 항목 없음'];
    if (stats.open) parts.push(`남은 ${stats.open}건`);
    if (stats.otherDone) parts.push(`오늘 처리 ${stats.otherDone}건`);
    el.progress.textContent = parts.join(' · ');
  } else {
    const parts = [`오늘 ${stats.doneToday} / ${stats.dueToday} 완료`];
    if (stats.overdue) parts.push(`지연 ${stats.overdue}건`);
    if (stats.otherDone) parts.push(`그 외 오늘 처리 ${stats.otherDone}건`);
    el.progress.textContent = parts.join(' · ');
  }

  el.list.replaceChildren();

  if (!total) {
    const here = activeSource === 'all' ? null : sourceOf(activeSource);
    const empty = document.createElement('div');
    empty.className = 'empty';
    const big = document.createElement('span');
    big.className = 'big';
    big.textContent = '🗒️';
    empty.appendChild(big);
    empty.append(document.createTextNode(
      here ? `${here.label} 에는 오늘 할 일이 없습니다.` : '오늘 할 일이 비어 있습니다.'));
    empty.appendChild(document.createElement('br'));
    empty.append(document.createTextNode('위에 적으면 노션에도 함께 기록됩니다.'));
    el.list.appendChild(empty);
  } else {
    for (const [label, list, cls] of [
      ['지연', g.overdue, 'overdue'],
      ['오늘', g.today, null],
      ['날짜 없음', g.undated, null],
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

// ── 입력 ─────────────────────────────────────────────────────

function submit() {
  const title = el.title.value.trim();
  if (!title) return;

  const today = state ? state.today : dateKey();
  window.todo.addTask({
    title,
    due: U().buildDue(today, el.time.value),
    sourceId: el.source.value || null,
  });

  el.title.value = '';
  el.time.value = '';
  el.title.focus();
}

el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
el.time.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
el.sync.addEventListener('click', () => window.todo.syncNow());
el.settings.addEventListener('click', () => window.todo.openSettings());
el.hide.addEventListener('click', () => window.todo.hideWindow());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.todo.hideWindow(); });

window.todo.onState((data) => { state = data; render(); });
window.todo.getState().then((data) => { state = data; render(); });

// "n분 뒤", "n분 전 동기화" 표시를 살아있게 유지한다.
setInterval(() => render(), 30000);
