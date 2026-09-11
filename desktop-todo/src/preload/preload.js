'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 렌더러에는 Node 를 열어주지 않는다(contextIsolation: true).
 * 화면이 쓸 수 있는 것은 아래 목록이 전부다.
 */
contextBridge.exposeInMainWorld('todo', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.off('state:changed', listener);
  },

  addTask: (payload) => ipcRenderer.invoke('task:add', payload),
  patchTask: (id, patch) => ipcRenderer.invoke('task:patch', id, patch),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),
  syncNow: () => ipcRenderer.invoke('sync:now'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testNotion: (patch) => ipcRenderer.invoke('notion:test', patch),
  openSettings: () => ipcRenderer.invoke('settings:open'),

  addRoutine: (payload) => ipcRenderer.invoke('routine:add', payload),
  updateRoutine: (id, patch) => ipcRenderer.invoke('routine:update', id, patch),
  deleteRoutine: (id) => ipcRenderer.invoke('routine:delete', id),
  runRoutinesNow: () => ipcRenderer.invoke('routine:runNow'),

  hideWindow: () => ipcRenderer.invoke('window:hide'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
});
