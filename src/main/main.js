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
let currentClipId = null
let pausedByFullscreen = false

// ---------- Хелперы плейлиста ----------
function readyClips() {
  return store.get().clips.filter((c) => c.status === 'ready')
}

function currentIndex(clips) {
  const idx = clips.findIndex((c) => c.id === currentClipId)
  return idx >= 0 ? idx : 0
}

// ---------- Окно управления ----------
function createControlWindow() {
  if (controlWindow) {
    controlWindow.show()
    controlWindow.focus()
    return
  }
  controlWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    title: 'YT Live Wallpaper',
    backgroundColor: '#0b0b12',
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
  pausedByFullscreen = false
  if (IS_WINDOWS) wallpaper.refreshDesktop()
}

// ---------- Воспроизведение ----------
function playClipById(id) {
  const clips = readyClips()
  if (clips.length === 0) return
  const clip = clips.find((c) => c.id === id) || clips[0]
  currentClipId = clip.id

  const win = createWallpaperWindow()
  const settings = store.get().settings
  // В режиме «последовательность» клип не зацикливается сам — по окончании
  // окно-обои шлёт wallpaper:ended и мы включаем следующий.
  const loop = settings.playbackMode !== 'sequence' || clips.length <= 1

  const send = () =>
    win.webContents.send('wallpaper:play', {
      filePath: clip.filePath,
      volume: settings.muted ? 0 : settings.volume,
      loop,
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
  const clips = readyClips()
  if (clips.length === 0) return
  const next = clips[(currentIndex(clips) + 1) % clips.length]
  playClipById(next.id)
}

function startWallpaper() {
  const clips = readyClips()
  if (clips.length === 0) return false
  playClipById(currentClipId || clips[0].id)
  return true
}

function schedulePlaylistTimer() {
  stopPlaylistTimer()
  const s = store.get().settings
  if (s.playbackMode === 'timer' && readyClips().length > 1) {
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
    const urlError = downloader.validateUrl(url)
    if (urlError) return { error: urlError }

    const clip = store.addClip({ url, start, end })
    broadcastState()

    // Название видео подтягиваем параллельно с загрузкой
    downloader.fetchTitle(url).then((title) => {
      if (title) {
        store.updateClip(clip.id, { title })
        broadcastState()
      }
    })

    downloader
      .downloadClip(clip, (progress) => {
        // Прогресс — только в память и в UI, без записи на диск
        store.updateClip(clip.id, { progress }, { persist: false })
        broadcastState()
      })
      .then((filePath) => {
        store.updateClip(clip.id, { status: 'ready', filePath, progress: 100 })
        broadcastState()
        // Если обои ещё не запущены — включаем сразу
        if (!wallpaperWindow) startWallpaper()
        else schedulePlaylistTimer()
      })
      .catch((err) => {
        store.updateClip(clip.id, { status: 'error', error: String(err.message || err) })
        broadcastState()
      })
    return { clip }
  })

  ipcMain.handle('clip:remove', (_e, id) => {
    downloader.removeClipFile(store.get().clips.find((c) => c.id === id))
    store.removeClip(id)
    if (currentClipId === id) {
      currentClipId = null
      if (wallpaperWindow) {
        // Активный клип удалили — переключаемся на следующий или гасим обои
        if (readyClips().length > 0) startWallpaper()
        else destroyWallpaperWindow()
      }
    }
    broadcastState()
    return true
  })

  ipcMain.handle('clip:play', (_e, id) => {
    playClipById(id)
    return true
  })

  ipcMain.handle('wallpaper:start', () => {
    const ok = startWallpaper()
    broadcastState()
    return ok
  })

  ipcMain.handle('wallpaper:stop', () => {
    destroyWallpaperWindow()
    broadcastState()
    return true
  })

  ipcMain.handle('wallpaper:next', () => {
    playNextClip()
    return true
  })

  // Видео закончилось (режим «последовательность») — включаем следующее
  ipcMain.on('wallpaper:ended', () => {
    if (store.get().settings.playbackMode === 'sequence') playNextClip()
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
    if ('playbackMode' in patch || 'playlistIntervalSec' in patch) {
      // Перезапускаем текущий клип, чтобы применить loop-режим
      if (wallpaperWindow && currentClipId) playClipById(currentClipId)
      else schedulePlaylistTimer()
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

    // Автовозобновление обоев при старте
    if (settings.autoResume && readyClips().length > 0) {
      currentClipId = settings.activeClipId
      startWallpaper()
    }
  })

  app.on('window-all-closed', () => {
    // Не выходим — приложение живёт в трее
  })

  app.on('before-quit', () => {
    app.isQuiting = true
    fullscreenMonitor.stop()
    stopPlaylistTimer()
    store.saveNow() // сбрасываем дебаунс-очередь на диск
  })
}
