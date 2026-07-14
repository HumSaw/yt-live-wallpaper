const { contextBridge, ipcRenderer, webUtils } = require('electron')

// API для окна управления
contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  addClip: (data) => ipcRenderer.invoke('clip:add', data),
  // File из drag&drop -> абсолютный путь (безопасно, только через webUtils)
  addLocalFile: (file) => {
    let filePath = null
    try {
      filePath = webUtils.getPathForFile(file)
    } catch (_) {
      /* не файл */
    }
    return ipcRenderer.invoke('clip:addLocal', filePath)
  },
  removeClip: (id) => ipcRenderer.invoke('clip:remove', id),
  playClip: (id) => ipcRenderer.invoke('clip:play', id),
  startWallpaper: () => ipcRenderer.invoke('wallpaper:start'),
  stopWallpaper: () => ipcRenderer.invoke('wallpaper:stop'),
  nextClip: () => ipcRenderer.invoke('wallpaper:next'),
  updateYtDlp: () => ipcRenderer.invoke('ytdlp:update'),
  retrySetup: () => ipcRenderer.invoke('setup:retry'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onStateUpdate: (cb) => {
    const listener = (_e, state) => cb(state)
    ipcRenderer.on('state:update', listener)
    return () => ipcRenderer.removeListener('state:update', listener)
  },
})

// API для окна-обоев
contextBridge.exposeInMainWorld('wallpaperApi', {
  onPlay: (cb) => ipcRenderer.on('wallpaper:play', (_e, data) => cb(data)),
  onPause: (cb) => ipcRenderer.on('wallpaper:pause', () => cb()),
  onResume: (cb) => ipcRenderer.on('wallpaper:resume', () => cb()),
  onVolume: (cb) => ipcRenderer.on('wallpaper:volume', (_e, v) => cb(v)),
  notifyEnded: () => ipcRenderer.send('wallpaper:ended'),
})
