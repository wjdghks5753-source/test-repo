'use strict';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let notifyTimes = [];
let routines = [];
let pickedDays = new Set([1, 2, 3, 4, 5]);   // 기본값: 평일

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
  return r.time ? `${days} ${r.time}` : days || '요일 없음';
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
    category: $('routineCategory').value || null,
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

// ── 노션 연결 테스트 ─────────────────────────────────────────

$('testBtn').addEventListener('click', async () => {
  const out = $('testResult');
  flash(out, '확인 중…', '');

  const res = await window.todo.testNotion({
    notionToken: $('notionToken').value.trim() || undefined,
    databaseId: $('databaseId').value.trim() || undefined,
  });

  if (!res.ok) {
    flash(out, `실패 — ${res.error}`, 'err');
    return;
  }
  const msg = res.missing.length
    ? `연결됨: "${res.title}" · 없는 속성: ${res.missing.join(', ')} (해당 기능만 생략됩니다)`
    : `연결됨: "${res.title}" · 속성 확인 완료`;
  flash(out, msg, res.missing.length ? '' : 'ok');
});

// ── 저장 ─────────────────────────────────────────────────────

function flash(node, text, cls) {
  node.textContent = text;
  node.className = `result ${cls || ''}`.trim();
}

$('saveBtn').addEventListener('click', async () => {
  const patch = {
    databaseId: $('databaseId').value.trim(),
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
    defaultCategory: $('defaultCategory').value || null,
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
  $('databaseId').value = s.databaseId || '';
  $('notionToken').placeholder = s.hasToken
    ? '저장된 토큰이 있습니다 (바꿀 때만 입력)'
    : 'ntn_… 토큰을 붙여넣으세요';

  notifyTimes = [...(s.notifyTimes || [])];
  $('notifyBeforeMin').value = s.notifyBeforeMin ?? 10;
  $('popupOnNotify').checked = Boolean(s.popupOnNotify);
  $('syncIntervalMin').value = s.syncIntervalMin ?? 5;
  $('carryOverDays').value = s.carryOverDays ?? 7;
  $('includeNoDueDate').checked = Boolean(s.includeNoDueDate);
  $('hideCompleted').checked = s.hideCompleted !== false;
  $('autoLaunch').checked = Boolean(s.autoLaunch);
  $('showOnLaunch').checked = Boolean(s.showOnLaunch);
  $('alwaysOnTop').checked = Boolean(s.alwaysOnTop);
  $('defaultCategory').value = s.defaultCategory || '';

  routines = [...(state.routines || [])];

  renderTimes();
  renderRoutines();
  renderWeekdayPicker();
});
