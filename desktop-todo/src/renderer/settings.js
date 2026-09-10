'use strict';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'red'];

// 논리 이름 -> 화면에 보여줄 이름. 값이 비면 그 기능만 생략된다.
const PROP_LABELS = {
  title: '제목',
  done: '완료 체크',
  due: '날짜',
  note: '메모',
  doneAt: '완료일시',
};

let notifyTimes = [];
let routines = [];
let sources = [];
let pickedDays = new Set([1, 2, 3, 4, 5]);   // 기본값: 평일

const newId = () => `src-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function flash(node, text, cls) {
  node.textContent = text;
  node.className = `result ${cls || ''}`.trim();
}

// ── 카테고리 ─────────────────────────────────────────────────

function renderSources() {
  const box = $('sourceList');
  box.replaceChildren();

  if (!sources.length) {
    const none = document.createElement('div');
    none.className = 'result';
    none.textContent = '카테고리가 없습니다. 아래 "카테고리 추가"를 눌러 주세요.';
    box.appendChild(none);
  }

  sources.forEach((source, index) => {
    const card = document.createElement('div');
    card.className = 'source';

    // 머리줄: 사용 여부 / 이름 / 색 / 삭제
    const head = document.createElement('div');
    head.className = 'source-head';

    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = source.enabled !== false;
    on.title = '이 카테고리를 사용';
    on.addEventListener('change', () => { source.enabled = on.checked; });

    const swatch = document.createElement('span');
    swatch.className = `swatch sw-${source.color || 'gray'}`;

    const label = document.createElement('input');
    label.className = 'field label';
    label.value = source.label || '';
    label.placeholder = '카테고리 이름 (예: SJS STUDY)';
    label.addEventListener('input', () => { source.label = label.value; });

    const color = document.createElement('select');
    color.className = 'field';
    color.style.flex = 'none';
    color.style.width = '96px';
    for (const c of COLORS) {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c;
      color.appendChild(option);
    }
    color.value = source.color || 'gray';
    color.addEventListener('change', () => {
      source.color = color.value;
      swatch.className = `swatch sw-${source.color}`;
    });

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '🗑';
    del.title = '카테고리 삭제 (노션 데이터는 그대로입니다)';
    del.addEventListener('click', () => {
      if (!confirm(`"${source.label}" 카테고리를 목록에서 뺄까요?\n노션 데이터베이스는 그대로 남습니다.`)) return;
      sources.splice(index, 1);
      renderSources();
      fillSourceSelects();
    });

    head.append(on, swatch, label, color, del);

    // 데이터베이스 ID
    const db = document.createElement('input');
    db.className = 'field db';
    db.value = source.databaseId || '';
    db.placeholder = '데이터베이스 ID (노션 URL 의 32자리)';
    db.addEventListener('input', () => { source.databaseId = db.value.trim(); });

    // 속성 이름 짝맞추기
    const props = document.createElement('div');
    props.className = 'props';
    source.props = source.props || {};

    for (const [key, text] of Object.entries(PROP_LABELS)) {
      const wrap = document.createElement('label');
      wrap.className = 'prop';

      const caption = document.createElement('span');
      caption.textContent = text;

      const input = document.createElement('input');
      input.className = 'field';
      input.value = source.props[key] || '';
      input.placeholder = key === 'title' ? '할 일' : '';
      input.addEventListener('input', () => { source.props[key] = input.value.trim(); });

      wrap.append(caption, input);
      props.appendChild(wrap);
    }

    card.append(head, db, props);
    box.appendChild(card);
  });
}

$('addSourceBtn').addEventListener('click', () => {
  sources.push({
    id: newId(),
    label: '새 카테고리',
    color: COLORS[sources.length % COLORS.length],
    databaseId: '',
    props: { title: '할 일', done: '완료', due: '날짜', note: '', doneAt: '' },
    enabled: true,
  });
  renderSources();
  fillSourceSelects();
});

/** 기본 카테고리 / 반복 할 일 드롭다운을 카테고리 목록으로 채운다. */
function fillSourceSelects() {
  for (const [id, keep] of [['defaultSourceId', true], ['routineSource', false]]) {
    const select = $(id);
    const current = select.value;
    select.replaceChildren();

    if (!keep) {
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '기본 카테고리';
      select.appendChild(none);
    }
    for (const source of sources) {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = source.label;
      select.appendChild(option);
    }
    if (current) select.value = current;
  }
}

// ── 알림 시각 칩 ─────────────────────────────────────────────

function renderTimes() {
  const box = $('timeChips');
  box.replaceChildren();

  if (!notifyTimes.length) {
    const none = document.createElement('span');
    none.className = 'result';
    none.textContent = '설정된 알림 시각이 없습니다';
    box.appendChild(none);
    return;
  }

  for (const t of notifyTimes) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(t));

    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = '삭제';
    x.addEventListener('click', () => {
      notifyTimes = notifyTimes.filter((v) => v !== t);
      renderTimes();
    });

    chip.appendChild(x);
    box.appendChild(chip);
  }
}

$('addTimeBtn').addEventListener('click', () => {
  const v = $('newNotifyTime').value;
  if (!v || notifyTimes.includes(v)) return;
  notifyTimes = [...notifyTimes, v].sort();
  $('newNotifyTime').value = '';
  renderTimes();
});

// ── 반복 할 일 ───────────────────────────────────────────────

function describe(r) {
  const days = r.days.length === 7
    ? '매일'
    : r.days.slice().sort().map((d) => WEEKDAYS[d]).join('·');
  const where = sources.find((s) => s.id === r.sourceId);
  const when = r.time ? `${days} ${r.time}` : days || '요일 없음';
  return where ? `${when} · ${where.label}` : when;
}

function renderRoutines() {
  const box = $('routineList');
  box.replaceChildren();

  if (!routines.length) {
    const none = document.createElement('div');
    none.className = 'result';
    none.textContent = '등록된 반복 할 일이 없습니다.';
    box.appendChild(none);
    return;
  }

  for (const r of routines) {
    const row = document.createElement('div');
    row.className = 'routine';

    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = r.enabled !== false;
    on.title = '사용/중지';
    on.addEventListener('change', async () => {
      await window.todo.updateRoutine(r.id, { enabled: on.checked });
      r.enabled = on.checked;
    });

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = r.title;

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = describe(r);

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.title = '삭제';
    del.addEventListener('click', async () => {
      if (!confirm(`반복 할 일 "${r.title}" 을(를) 삭제할까요?\n이미 만들어진 오늘 항목은 남습니다.`)) return;
      await window.todo.deleteRoutine(r.id);
      routines = routines.filter((x) => x.id !== r.id);
      renderRoutines();
    });

    row.append(on, name, when, del);
    box.appendChild(row);
  }
}

function renderWeekdayPicker() {
  const box = $('weekdays');
  box.replaceChildren();
  WEEKDAYS.forEach((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = pickedDays.has(i) ? 'on' : '';
    b.addEventListener('click', () => {
      if (pickedDays.has(i)) pickedDays.delete(i); else pickedDays.add(i);
      b.className = pickedDays.has(i) ? 'on' : '';
    });
    box.appendChild(b);
  });
}

$('addRoutineBtn').addEventListener('click', async () => {
  const title = $('routineTitle').value.trim();
  if (!title) return;
  if (!pickedDays.size) { flash($('routineResult'), '요일을 하나 이상 선택하세요.', 'err'); return; }

  const created = await window.todo.addRoutine({
    title,
    days: [...pickedDays],
    time: $('routineTime').value || null,
    sourceId: $('routineSource').value || null,
  });

  routines.push(created);
  renderRoutines();
  $('routineTitle').value = '';
  $('routineTime').value = '';
});

$('runRoutinesBtn').addEventListener('click', async () => {
  const created = await window.todo.runRoutinesNow();
  flash($('routineResult'),
    created.length ? `${created.length}건 추가: ${created.join(', ')}` : '오늘 추가할 반복 할 일이 없습니다.',
    'ok');
});

// ── 연결 테스트 ──────────────────────────────────────────────

$('testBtn').addEventListener('click', async () => {
  const out = $('testResult');
  flash(out, '확인 중…', '');

  const { results } = await window.todo.testNotion({
    notionToken: $('notionToken').value.trim() || undefined,
    sources,
  });

  if (!results.length) {
    flash(out, '사용 중인 카테고리가 없습니다.', 'err');
    return;
  }

  const lines = results.map((r) => {
    if (!r.ok) return `✕ ${r.label} — ${r.error}`;
    if (r.missing && r.missing.length) return `△ ${r.label} — 없는 속성: ${r.missing.join(', ')}`;
    return `✓ ${r.label} — "${r.title}" 확인 완료`;
  });

  const bad = results.some((r) => !r.ok);
  const warn = results.some((r) => r.ok && r.missing && r.missing.length);
  flash(out, lines.join('\n'), bad ? 'err' : (warn ? '' : 'ok'));
});

// ── 저장 ─────────────────────────────────────────────────────

$('saveBtn').addEventListener('click', async () => {
  const patch = {
    sources,
    defaultSourceId: $('defaultSourceId').value || null,
    notifyTimes,
    notifyBeforeMin: Number($('notifyBeforeMin').value) || 0,
    popupOnNotify: $('popupOnNotify').checked,
    syncIntervalMin: Math.max(1, Number($('syncIntervalMin').value) || 5),
    carryOverDays: Math.max(0, Number($('carryOverDays').value) || 0),
    includeNoDueDate: $('includeNoDueDate').checked,
    hideCompleted: $('hideCompleted').checked,
    autoLaunch: $('autoLaunch').checked,
    showOnLaunch: $('showOnLaunch').checked,
    alwaysOnTop: $('alwaysOnTop').checked,
  };

  // 빈칸이면 기존 토큰을 그대로 둔다. 실수로 지워지는 걸 막기 위해서다.
  const token = $('notionToken').value.trim();
  if (token) patch.notionToken = token;

  flash($('saveResult'), '저장 중…', '');
  await window.todo.saveSettings(patch);
  $('notionToken').value = '';
  flash($('saveResult'), '저장했습니다. 동기화를 다시 실행했습니다.', 'ok');
  setTimeout(() => flash($('saveResult'), '', ''), 4000);
});

$('closeBtn').addEventListener('click', () => window.todo.closeWindow());

// ── 초기화 ───────────────────────────────────────────────────

window.todo.getState().then((state) => {
  const s = state.settings;
  $('notionToken').placeholder = s.hasToken
    ? '저장된 토큰이 있습니다 (바꿀 때만 입력)'
    : 'ntn_… 토큰을 붙여넣으세요';

  sources = JSON.parse(JSON.stringify(state.sources || []));
  notifyTimes = [...(s.notifyTimes || [])];
  routines = [...(state.routines || [])];

  $('notifyBeforeMin').value = s.notifyBeforeMin ?? 10;
  $('popupOnNotify').checked = Boolean(s.popupOnNotify);
  $('syncIntervalMin').value = s.syncIntervalMin ?? 5;
  $('carryOverDays').value = s.carryOverDays ?? 7;
  $('includeNoDueDate').checked = Boolean(s.includeNoDueDate);
  $('hideCompleted').checked = s.hideCompleted !== false;
  $('autoLaunch').checked = Boolean(s.autoLaunch);
  $('showOnLaunch').checked = Boolean(s.showOnLaunch);
  $('alwaysOnTop').checked = Boolean(s.alwaysOnTop);

  renderSources();
  fillSourceSelects();
  if (s.defaultSourceId) $('defaultSourceId').value = s.defaultSourceId;

  renderTimes();
  renderRoutines();
  renderWeekdayPicker();
});
