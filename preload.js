// preload.js - 安全暴露主进程能力给渲染层
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('musicAPI', {
  // 数据
  list: () => ipcRenderer.invoke('music:list'),
  getDir: () => ipcRenderer.invoke('music:getDir'),
  // 操作
  pickDir: () => ipcRenderer.invoke('music:pickDir'),
  setDir: (dir) => ipcRenderer.invoke('music:setDir', dir),
  rescan: () => ipcRenderer.invoke('music:rescan'),
  openDir: () => ipcRenderer.invoke('music:openDir'),
  unlock: () => ipcRenderer.invoke('music:unlock'),
  addDroppedPath: (p) => ipcRenderer.invoke('music:addDroppedPath', p),
  // Electron 32: file.path 没了，用 webUtils 拿
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return null; }
  },
  // 事件
  onReset: (cb) => ipcRenderer.on('music:reset', (_e, tracks) => cb(tracks)),
  onAdded: (cb) => ipcRenderer.on('music:added', (_e, track) => cb(track)),
  onRemoved: (cb) => ipcRenderer.on('music:removed', (_e, id) => cb(id)),
  onCleared: (cb) => ipcRenderer.on('music:cleared', () => cb()),
  onDir: (cb) => ipcRenderer.on('music:dir', (_e, dir) => cb(dir)),
  onRequestSetDir: (cb) => ipcRenderer.on('music:requestSetDir', (_e, dir) => cb(dir)),
  onEmpty: (cb) => ipcRenderer.on('music:empty', () => cb()),
  onAutoplay: (cb) => ipcRenderer.on('dev:autoplay', () => cb()),
});
