'use strict';

const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, Notification,
  shell, screen, safeStorage, powerMonitor, nativeImage,
} = require('electron');

const D = require('./dates');
const { JsonFile, DEFAULT_SETTINGS, DEFAULT_CACHE, DEFAULT_ROUTINES } = require('./store');
const { NotionClient } = require('./notion');
const { SyncEngine } = require('./sync');
const { Scheduler } = require('./scheduler');
const routines = require('./routines');

// Windows 토스트 알림은 AppUserModelID 가 있어야 앱 이름으로 뜬다.
const APP_ID = 'kr.sejongsports.dailytodo';
app.setAppUserModelId(APP_ID);

// 두 번 실행되면 창만 다시 띄우고 두 번째 프로세스는 종료한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const ASSETS = path.join(__dirname, '..', 'assets');

let settings, cache, routinesFile, client, engine, scheduler;
let checklistWindow = null;
let settingsWindow = null;
let tray = null;
let quitting = false;

// ── 토큰 보관 ──────────────────────────────────────────────────
// 노션 토큰은 평문으로 두지 않는다. Windows 는 safeStorage 가 DPAPI 를 쓰므로
// 파일을 그대로 복사해가도 다른 계정에서는 풀리지 않는다.

function readToken() {
  const enc = settings.get('notionTokenEnc');
  if (enc) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      }
    } catch (_) { /* 복호화 실패 시 아래 폴백 */ }
  }
  return settings.get('notionTokenPlain') || null;
}

function writeToken(token) {
  if (!token) {
    settings.update({ notionTokenEnc: null, notionTokenPlain: null });
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    settings.update({
      notionTokenEnc: safeStorage.encryptString(token).toString('base64'),
      notionTokenPlain: null,
    });
  } else {
    settings.update({ notionTokenEnc: null, notionTokenPlain: token });
  }
}

// ── 창 ────────────────────────────────────────────────────────

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 400;
  const height = Math.min(660, workArea.height - 60);
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + workArea.height - height - 24,
  };
}

function createChecklistWindow() {
  const saved = settings.get('windowBounds');
  const bounds = saved && isOnScreen(saved) ? saved : defaultBounds();

  checklistWindow = new BrowserWindow({
    ...bounds,
    minWidth: 340,
    minHeight: 380,
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: Boolean(settings.get('alwaysOnTop')),
    backgroundColor: '#f6f7f9',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  checklistWindow.loadFile(path.join(__dirname, '..', 'renderer', 'checklist.html'));

  const persist = () => {
    if (checklistWindow && !checklistWindow.isDestroyed() && !checklistWindow.isMinimized()) {
      settings.set('windowBounds', checklistWindow.getBounds());
    }
  };
  checklistWindow.on('moved', persist);
  checklistWindow.on('resized', persist);

  // X 를 눌러도 종료가 아니라 트레이로 숨는다. 알림이 계속 와야 하기 때문.
  checklistWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      persist();
      checklistWindow.hide();
    }
  });

  return checklistWindow;
}

/** 저장된 창 위치가 지금 연결된 모니터 안에 있는지 (모니터를 뺐을 때 창이 사라지는 걸 방지) */
function isOnScreen(bounds) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x
        && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y;
  });
}

function showChecklist() {
  if (!checklistWindow || checklistWindow.isDestroyed()) createChecklistWindow();
  if (checklistWindow.isMinimized()) checklistWindow.restore();
  checklistWindow.show();
  checklistWindow.focus();
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    show: false,
    frame: false,
    resizable: true,
    minWidth: 460,
    minHeight: 520,
    backgroundColor: '#f6f7f9',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── 트레이 ────────────────────────────────────────────────────

function buildTray() {
  const image = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(image);
  tray.setToolTip('오늘 할 일');
  tray.on('click', showChecklist);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const open = engine ? engine.tasks.filter((t) => !t.done).length : 0;
  tray.setToolTip(open ? `오늘 할 일 — 남은 ${open}건` : '오늘 할 일 — 모두 완료');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `남은 할 일 ${open}건`, enabled: false },
    { type: 'separator' },
    { label: '오늘 할 일 열기', click: showChecklist },
    { label: '지금 동기화', click: () => engine.sync() },
    { type: 'separator' },
    {
      label: '컴퓨터 켤 때 자동 실행',
      type: 'checkbox',
      checked: Boolean(settings.get('autoLaunch')),
      click: (item) => {
        settings.set('autoLaunch', item.checked);
        applyAutoLaunch();
      },
    },
    { label: '설정…', click: createSettingsWindow },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyAutoLaunch() {
  app.setLoginItemSettings({
    openAtLogin: Boolean(settings.get('autoLaunch')),
    openAsHidden: false,
    path: process.execPath,
  });
}

// ── 알림 ──────────────────────────────────────────────────────

function notify({ title, body }) {
  if (Notification.isSupported()) {
    const n = new Notification({
      title,
      body,
      icon: path.join(ASSETS, 'icon.png'),
      silent: false,
    });
    n.on('click', showChecklist);
    n.show();
  }
  if (settings.get('popupOnNotify')) showChecklist();
}

// ── 상태 브로드캐스트 ─────────────────────────────────────────

function publicSettings() {
  const s = { ...settings.data };
  delete s.notionTokenEnc;
  delete s.notionTokenPlain;
  s.hasToken = Boolean(readToken());
  return s;
}

function snapshot() {
  return {
    today: D.dateKey(),
    tasks: engine ? engine.tasks : [],
    status: engine ? engine.status : { syncing: false, error: null, lastSyncAt: null },
    settings: publicSettings(),
    sources: settings.get('sources') || [],
    routines: routinesFile.get('routines'),
    outboxCount: engine ? engine.outbox.length : 0,
  };
}

function broadcast() {
  const data = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('state:changed', data);
  }
  refreshTrayMenu();
}

// ── 하루 시작 ─────────────────────────────────────────────────

async function onDayRollover() {
  routines.materializeToday(engine, routinesFile, cache);
  await engine.sync();

  const open = engine.tasks.filter((t) => !t.done);
  notify({
    title: `${D.dateKey()} · 오늘 할 일 ${open.length}건`,
    body: open.length
      ? open.slice(0, 3).map((t) => `· ${t.title}`).join('\n')
      : '등록된 할 일이 없습니다. 창에서 바로 추가할 수 있습니다.',
  });
}

// ── IPC ───────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());

  ipcMain.handle('task:add', (_e, payload) => {
    if (!payload || !String(payload.title || '').trim()) return null;
    const task = engine.addTask(payload);
    engine.sync();
    return task;
  });

  ipcMain.handle('task:patch', (_e, id, patch) => {
    const task = engine.patchTask(id, patch);
    engine.sync();
    return task;
  });

  ipcMain.handle('task:delete', (_e, id) => {
    engine.deleteTask(id);
    engine.sync();
  });

  ipcMain.handle('sync:now', () => engine.sync());

  ipcMain.handle('settings:get', () => publicSettings());

  ipcMain.handle('settings:save', async (_e, patch) => {
    const { notionToken, ...rest } = patch || {};
    if (notionToken !== undefined) writeToken(notionToken);
    settings.update(rest);

    client.token = readToken();
    client.schemas.clear(); // DB 나 속성 이름이 바뀌었을 수 있으니 다시 읽게 한다

    applyAutoLaunch();
    if (checklistWindow && !checklistWindow.isDestroyed()) {
      checklistWindow.setAlwaysOnTop(Boolean(settings.get('alwaysOnTop')));
    }
    await engine.sync();
    return publicSettings();
  });

  ipcMain.handle('notion:test', async (_e, patch) => {
    const probe = new NotionClient({ token: patch?.notionToken || readToken() });
    const sources = (patch && patch.sources) || settings.get('sources') || [];
    const results = [];

    for (const source of sources) {
      if (source.enabled === false) continue;
      if (!source.databaseId) {
        results.push({ label: source.label, ok: false, error: '데이터베이스 ID 가 비어 있습니다.' });
        continue;
      }
      try {
        const info = await probe.loadSchema(source);
        results.push({ label: source.label, ok: true, title: info.title, missing: info.missing });
      } catch (err) {
        results.push({ label: source.label, ok: false, error: err.message });
      }
    }
    return { results };
  });

  ipcMain.handle('routine:add', (_e, payload) => routines.addRoutine(routinesFile, payload));
  ipcMain.handle('routine:update', (_e, id, patch) => routines.updateRoutine(routinesFile, id, patch));
  ipcMain.handle('routine:delete', (_e, id) => routines.deleteRoutine(routinesFile, id));
  ipcMain.handle('routine:runNow', () => {
    const created = routines.materializeToday(engine, routinesFile, cache);
    engine.sync();
    return created;
  });

  ipcMain.handle('settings:open', () => createSettingsWindow());
  ipcMain.handle('window:hide', (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('shell:open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
}

/**
 * 예전 설정은 DB 를 하나만 들고 있었다 (settings.databaseId).
 * 그 값을 PERSONAL 카테고리로 옮겨, 사용자가 바꿔둔 DB 를 잃지 않게 한다.
 */
function migrateSources() {
  const legacy = settings.data.databaseId;
  if (!legacy) return;

  const sources = settings.get('sources') || [];
  const personal = sources.find((s) => s.id === 'personal');
  if (personal && personal.databaseId !== legacy) {
    personal.databaseId = legacy;
  }
  delete settings.data.databaseId;
  settings.save();
}

// ── 부팅 ──────────────────────────────────────────────────────

app.on('second-instance', showChecklist);

app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  settings = new JsonFile(path.join(dir, 'config.json'), DEFAULT_SETTINGS);
  cache = new JsonFile(path.join(dir, 'cache.json'), DEFAULT_CACHE);
  routinesFile = new JsonFile(path.join(dir, 'routines.json'), DEFAULT_ROUTINES);

  migrateSources();
  client = new NotionClient({ token: readToken() });
  engine = new SyncEngine({ cache, settings, client, onChange: broadcast });
  scheduler = new Scheduler({ cache, settings, engine, notify, onDayRollover });

  registerIpc();
  createChecklistWindow();
  buildTray();
  applyAutoLaunch();

  if (settings.get('showOnLaunch')) {
    checklistWindow.once('ready-to-show', showChecklist);
  }

  // 오늘 몫의 루틴을 만들고 첫 동기화를 돌린다.
  routines.materializeToday(engine, routinesFile, cache);
  await engine.sync();

  scheduler.start();

  // 노트북을 열었을 때 바로 따라잡게 한다.
  powerMonitor.on('resume', () => scheduler.tick().catch(() => {}));

  if (!readToken()) createSettingsWindow();
});

app.on('before-quit', () => { quitting = true; scheduler?.stop(); });

// 트레이 상주 앱이다. 이 리스너를 등록해 두면 창이 모두 닫혀도 Electron 이
// 앱을 자동 종료하지 않는다. 종료는 트레이 메뉴의 '종료'로만 한다.
app.on('window-all-closed', () => { if (quitting) app.quit(); });
