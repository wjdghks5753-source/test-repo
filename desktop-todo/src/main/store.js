'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 아주 작은 JSON 파일 저장소.
 * 쓰기는 tmp 파일에 쓴 뒤 rename 하는 방식이라, 저장 도중 앱이 죽어도
 * 기존 파일이 반쯤 덮어써진 상태로 남지 않는다.
 */
class JsonFile {
  constructor(filePath, defaults) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = this._load();
  }

  _load() {
    // 반드시 깊은 복사여야 한다. 얕게 복사하면 여러 저장소가 defaults 안의
    // 같은 배열(tasks, outbox, notifyTimes …)을 공유해 서로의 값을 덮어쓴다.
    const base = structuredClone(this.defaults);
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return Object.assign(base, JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // 파일이 깨졌으면 백업만 남기고 기본값으로 재시작한다.
        try {
          fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch (_) { /* 백업 실패는 치명적이지 않다 */ }
      }
      return base;
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  update(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

const DEFAULT_SETTINGS = {
  // 노션
  notionTokenEnc: null,      // safeStorage 로 암호화된 토큰 (base64)
  notionTokenPlain: null,    // safeStorage 를 못 쓰는 환경의 폴백
  databaseId: '2c48143c-2e66-8067-9c75-cd40794671d7',

  // 동기화
  syncIntervalMin: 5,
  carryOverDays: 7,          // 며칠 지난 미완료까지 오늘 목록에 끌어올릴지 (0 = 무제한)
  includeNoDueDate: true,    // 마감일 없는 항목도 보여줄지

  // 알림
  notifyTimes: ['08:30', '13:00', '18:00'],
  notifyBeforeMin: 10,       // 마감 시각 N분 전 알림 (0 = 끔)
  popupOnNotify: true,       // 알림과 함께 체크리스트 창을 띄울지

  // 창
  autoLaunch: true,
  showOnLaunch: true,
  alwaysOnTop: false,
  windowBounds: null,

  defaultCategory: '업무',
};

const DEFAULT_CACHE = {
  tasks: [],          // 노션에서 내려받은 + 로컬에서 만든 할 일
  outbox: [],         // 아직 노션에 반영하지 못한 변경
  routineLog: {},     // 'YYYY-MM-DD' -> [routineId] 중복 생성 방지용
  lastSyncAt: null,
  lastNotifiedDate: null,
  notifiedDueIds: [], // 마감 임박 알림을 이미 보낸 항목
  firedNotify: [],    // 이미 띄운 정시 알림 ('YYYY-MM-DDTHH:MM')
};

const DEFAULT_ROUTINES = {
  // 요일 반복 할 일. days 는 0=일 ~ 6=토
  routines: [],
};

module.exports = { JsonFile, DEFAULT_SETTINGS, DEFAULT_CACHE, DEFAULT_ROUTINES };
