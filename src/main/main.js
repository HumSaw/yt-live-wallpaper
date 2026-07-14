const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron')
const path = require('path')
const store = require('./store')
const downloader = require('./downloader')
const wallpaper = require('./wallpaper')
const fullscreenMonitor = require('./fullscreen-monitor')

const IS_WINDOWS = process.platform === 'win32'

let controlWindow = null
let wallpaperWindow = null
let tray = null
let playlistTimer = null
let currentClipIndex = 0
let pausedByFullscreen = false

// ---------- Окно управления ----------
function createControlWindow() {
  if (controlWindow) {
    controlWindow.show()
    controlWindow.focus()
    return
  }
  controlWindow = new BrowserWindow({
    width: 980,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    title: 'YT Live Wallpaper',
    backgroundColor: '#0d0f12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  controlWindow.on('closed', () => {
    controlWindow = null
  })
  // Закрытие окна не завершает приложение — оно живёт в трее
  controlWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      controlWindow.hide()
    }
  })
}

// ---------- Окно-обои ----------
function createWallpaperWindow() {
  if (wallpaperWindow) return wallpaperWindow

  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size

  wallpaperWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // видео не должно замирать в фоне
    },
  })

  wallpaperWindow.loadFile(path.join(__dirname, '..', 'wallpaper-window', 'wallpaper.html'))

  wallpaperWindow.once('ready-to-show', () => {
    wallpaperWindow.show()
    if (IS_WINDOWS) {
      // Встраиваем окно ЗА иконки рабочего стола (трюк с WorkerW)
      const ok = wallpaper.attachToDesktop(wallpaperWindow)
      if (!ok) console.error('[wallpaper] Не удалось прикрепить окно к рабочему столу')
    }
  })

  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null
  })

  return wallpaperWindow
}

function destroyWallpaperWindow() {
  stopPlaylistTimer()
  if (wallpaperWindow) {
    wallpaperWindow.destroy()
    wallpaperWindow = null
  }
  if (IS_WINDOWS) wallpaper.refreshDesktop()
}

// ---------- Плейлист ----------
function playClipAtIndex(index) {
  const clips = store.get().clips.filter((c) => c.status === 'ready')
  if (clips.length === 0) return
  currentClipIndex = ((index % clips.length) + clips.length) % clips.length
  const clip = clips[currentClipIndex]
  const win = createWallpaperWindow()
  const settings = store.get().settings
  const send = () =>
    win.webContents.send('wallpaper:play', {
      filePath: clip.filePath,
      volume: settings.muted ? 0 : settings.volume,
    })
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  store.update((s) => {
    s.settings.activeClipId = clip.id
  })
  broadcastState()
  schedulePlaylistTimer()
}

function playNextClip() {
  playClipAtIndex(currentClipIndex + 1)
}

function schedulePlaylistTimer() {
  stopPlaylistTimer()
  const s = store.get().settings
  const readyCount = store.get().clips.filter((c) => c.status === 'ready').length
  if (s.playlistMode && readyCount > 1) {
    playlistTimer = setTimeout(() => playNextClip(), Math.max(10, s.playlistIntervalSec) * 1000)
  }
}

function stopPlaylistTimer() {
  if (playlistTimer) {
    clearTimeout(playlistTimer)
    playlistTimer = null
  }
}

// ---------- Состояние для UI ----------
function getStateForRenderer() {
  const s = store.get()
  return {
    clips: s.clips,
    settings: s.settings,
    wallpaperActive: !!wallpaperWindow,
    pausedByFullscreen,
    platformSupported: IS_WINDOWS,
  }
}

function broadcastState() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('state:update', getStateForRenderer())
  }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => getStateForRenderer())

  ipcMain.handle('clip:add', async (_e, { url, start, end }) => {
    const clip = store.addClip({ url, start, end })
    broadcastState()
    downloader
      .downloadClip(clip, (progress) => {
        store.updateClip(clip.id, { progress })
        broadcastState()
      })
      .then((filePath) => {
        store.updateClip(clip.id, { status: 'ready', filePath, progress: 100 })
        broadcastState()
        // Если обои ещё не запущены — запускаем сразу с первым готовым клипом
        if (!wallpaperWindow) playClipAtIndex(0)
      })
      .catch((err) => {
        store.updateClip(clip.id, { status: 'error', error: String(err.message || err) })
        broadcastState()
      })
    return clip
  })

  ipcMain.handle('clip:remove', (_e, id) => {
    downloader.removeClipFile(store.get().clips.find((c) => c.id === id))
    store.removeClip(id)
    broadcastState()
    return true
  })

  ipcMain.handle('clip:play', (_e, id) => {
    const clips = store.get().clips.filter((c) => c.status === 'ready')
    const idx = clips.findIndex((c) => c.id === id)
    if (idx >= 0) playClipAtIndex(idx)
    return true
  })

  ipcMain.handle('wallpaper:start', () => {
    playClipAtIndex(currentClipIndex)
    return true
  })

  ipcMain.handle('wallpaper:stop', () => {
    destroyWallpaperWindow()
    broadcastState()
    return true
  })

  ipcMain.handle('settings:set', (_e, patch) => {
    store.update((s) => Object.assign(s.settings, patch))
    const s = store.get().settings

    if ('volume' in patch || 'muted' in patch) {
      if (wallpaperWindow) {
        wallpaperWindow.webContents.send('wallpaper:volume', s.muted ? 0 : s.volume)
      }
    }
    if ('autostart' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.autostart, args: ['--hidden'] })
    }
    if ('playlistMode' in patch || 'playlistIntervalSec' in patch) {
      schedulePlaylistTimer()
    }
    if ('pauseOnFullscreen' in patch) {
      if (patch.pauseOnFullscreen) startFullscreenMonitor()
      else fullscreenMonitor.stop()
    }
    broadcastState()
    return s
  })
}

// ---------- Пауза при полноэкранных приложениях ----------
function startFullscreenMonitor() {
  if (!IS_WINDOWS) return
  fullscreenMonitor.start((isFullscreen) => {
    if (!wallpaperWindow) return
    if (isFullscreen && !pausedByFullscreen) {
      pausedByFullscreen = true
      wallpaperWindow.webContents.send('wallpaper:pause')
      broadcastState()
    } else if (!isFullscreen && pausedByFullscreen) {
      pausedByFullscreen = false
      wallpaperWindow.webContents.send('wallpaper:resume')
      broadcastState()
    }
  })
}

// ---------- Трей ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('YT Live Wallpaper')
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть панель', click: () => createControlWindow() },
    { label: 'Следующий клип', click: () => playNextClip() },
    { type: 'separator' },
    { label: 'Остановить обои', click: () => { destroyWallpaperWindow(); broadcastState() } },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.isQuiting = true
        destroyWallpaperWindow()
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => createControlWindow())
}

// ---------- Запуск ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createControlWindow())

  app.whenReady().then(() => {
    store.init(app.getPath('userData'))
    downloader.init(app.getPath('userData'))
    registerIpc()
    createTray()

    const startHidden = process.argv.includes('--hidden')
    if (!startHidden) createControlWindow()

    const settings = store.get().settings
    if (settings.pauseOnFullscreen) startFullscreenMonitor()

    // Автовозобновление обоев при старте, если есть готовые клипы
    const hasReady = store.get().clips.some((c) => c.status === 'ready')
    if (hasReady && settings.autoResume) playClipAtIndex(0)
  })

  app.on('window-all-closed', () => {
    // Не выходим — приложение живёт в трее
  })

  app.on('before-quit', () => {
    app.isQuiting = true
    fullscreenMonitor.stop()
    stopPlaylistTimer()
  })
}
