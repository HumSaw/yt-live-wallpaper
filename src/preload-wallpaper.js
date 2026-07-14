// Preload окна-обоев: только команды воспроизведения, никакого доступа
// к настройкам, клипам и файловым операциям.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wallpaperApi', {
  onPlay: (cb) => ipcRenderer.on('wallpaper:play', (_e, data) => cb(data)),
  onPause: (cb) => ipcRenderer.on('wallpaper:pause', () => cb()),
  onResume: (cb) => ipcRenderer.on('wallpaper:resume', () => cb()),
  onVolume: (cb) => ipcRenderer.on('wallpaper:volume', (_e, v) => cb(v)),
  notifyEnded: () => ipcRenderer.send('wallpaper:ended'),
})
