'use strict';

/**
 * 날짜 유틸. 모든 "오늘"은 UTC 가 아니라 이 PC 의 로컬 시간대(한국이면 KST) 기준이다.
 * 이걸 UTC 로 계산하면 밤 9시 이후 항목이 내일로 밀려버린다.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (로컬 시간대) */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> 그날 00:00 의 로컬 Date */
function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 'YYYY-MM-DD' 에서 n일 이동한 키 */
function addDays(key, n) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

/** 0=일 ... 6=토 */
function weekday(key) {
  return fromDateKey(key).getDay();
}

/** 'HH:MM' -> 그날의 로컬 Date */
function atTime(key, hhmm) {
  const d = fromDateKey(key);
  if (hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/** Date -> 노션 date 속성에 넣을 오프셋 포함 ISO 문자열 (예: 2026-09-09T09:00:00+09:00) */
function toNotionDateTime(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** 노션 date 문자열에 시간이 들어있는지 ('2026-09-09' 는 false) */
function hasTime(value) {
  return typeof value === 'string' && value.includes('T');
}

/** 노션 date 문자열 -> 로컬 'YYYY-MM-DD' */
function toDateKey(value) {
  if (!value) return null;
  if (!hasTime(value)) return value.slice(0, 10);
  return dateKey(new Date(value));
}

/** 'HH:MM' 표기, 시간이 없는 날짜면 null */
function timeLabel(value) {
  if (!hasTime(value)) return null;
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 현재 시각의 'HH:MM' */
function nowHHMM(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = {
  dateKey, fromDateKey, addDays, weekday, atTime,
  toNotionDateTime, hasTime, toDateKey, timeLabel, nowHHMM,
};
