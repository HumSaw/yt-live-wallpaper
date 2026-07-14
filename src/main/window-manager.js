// Управление окнами: панель управления и окна-обои (по одному на дисплей).
// Также владеет снапшотом состояния для renderer и его рассылкой.

const { BrowserWindow, screen } = require('electron')
const path = require('path')
const store = require('./store')
const downloader = require('./downloader')
const wallpaper = require('./wallpaper')
const wallpaperMac = require('./wallpaper-mac')
const playlist = require('./playlist')
const runtime = require('./runtime-state')

const IS_WINDOWS = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'
const PLATFORM_SUPPORTED = IS_WINDOWS || IS_MAC || IS_LINUX

let controlWindow = null
/** Окна-обои по id дисплея: Map<displayId, BrowserWindow> */
const wallpaperWindows = new Map()

function wallpaperActive() {
  return wallpaperWindows.size > 0
}

function eachWallpaperWindow(fn) {
  for (const win of wallpaperWindows.values()) {
    if (!win.isDestroyed()) fn(win)
  }
}

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
    if (!runtime.isQuitting()) {
      e.preventDefault()
      controlWindow.hide()
    }
  })
}

function targetDisplays() {
  const setting = store.get().settings.targetDisplay
  const all = screen.getAllDisplays()
  if (setting === 'all') return all
  if (setting === 'primary') return [screen.getPrimaryDisplay()]
  const found = all.find((d) => String(d.id) === String(setting))
  return [found || screen.getPrimaryDisplay()]
}

function displaysForRenderer() {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `Монитор ${i + 1} (${d.size.width}×${d.size.height})${d.id === primaryId ? ' — основной' : ''}`,
    primary: d.id === primaryId,
  }))
}

function createWallpaperWindowForDisplay(display) {
  const existing = wallpaperWindows.get(display.id)
  if (existing && !existing.isDestroyed()) return existing

  const win = new BrowserWindow({
    width: display.bounds.width,
    height: display.bounds.height,
    x: display.bounds.x,
    y: display.bounds.y,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    backgroundColor: '#000000',
    // Linux (X11): окно типа desktop живёт на уровне фона рабочего стола
    ...(IS_LINUX ? { type: 'desktop' } : {}),
    // macOS: не показываем окно-обои в Dock и не даём его развернуть
    ...(IS_MAC ? { hiddenInMissionControl: true, hasShadow: false } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-wallpaper.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // видео не должно замирать в фоне
    },
  })

  win.loadFile(path.join(__dirname, '..', 'wallpaper-window', 'wallpaper.html'))

  win.once('ready-to-show', () => {
    win.show()
    if (IS_WINDOWS) {
      // Физические (пиксельные) границы дисплея для позиционирования внутри WorkerW
      const physical = screen.dipToScreenRect(null, display.bounds)
      const ok = wallpaper.attachToDesktop(win, physical)
      if (!ok) console.error('[wallpaper] Не удалось прикрепить окно к рабочему столу')
    } else if (IS_MAC) {
      // Опускаем NSWindow на уровень фона рабочего стола (ниже иконок)
      const ok = wallpaperMac.attachToDesktop(win)
      if (!ok) console.error('[wallpaper] Не удалось опустить окно на уровень рабочего стола')
    } else if (IS_LINUX) {
      // Тип desktop уже задан при создании; дополнительно уходим в самый низ
      win.blur()
    }
  })

  win.on('closed', () => {
    wallpaperWindows.delete(display.id)
  })

  wallpaperWindows.set(display.id, win)
  return win
}

function ensureWallpaperWindows() {
  const displays = targetDisplays()
  const wantedIds = new Set(displays.map((d) => d.id))
  // Убираем окна с дисплеев, которые больше не выбраны
  for (const [id, win] of wallpaperWindows) {
    if (!wantedIds.has(id)) {
      win.destroy()
      wallpaperWindows.delete(id)
    }
  }
  return displays.map((d) => createWallpaperWindowForDisplay(d))
}

function destroyWallpaperWindows() {
  playlist.stopTimer()
  eachWallpaperWindow((win) => win.destroy())
  wallpaperWindows.clear()
  runtime.setPausedByMonitor(false)
  if (IS_WINDOWS) wallpaper.refreshDesktop()
}

function sendPlayToWallpapers(clip, loop) {
  const wins = ensureWallpaperWindows()
  const settings = store.get().settings
  for (const win of wins) {
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
  }
  broadcastState()
}

function getStateForRenderer() {
  const s = store.get()
  return {
    clips: s.clips,
    settings: s.settings,
    wallpaperActive: wallpaperActive(),
    pausedByFullscreen: runtime.isPausedByMonitor(),
    pausedByBattery: runtime.isPausedByBattery(),
    displays: displaysForRenderer(),
    platformSupported: PLATFORM_SUPPORTED,
    setup: runtime.getSetupState(), // null = компоненты готовы
    diskUsage: downloader.getDiskUsage(),
  }
}

function broadcastState() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('state:update', getStateForRenderer())
  }
}

// Прогресс загрузки прилетает от yt-dlp десятки раз в секунду.
// Полный broadcast с пересборкой DOM — раз в 250 мс, не чаще.
let progressBroadcastTimer = null
function broadcastStateThrottled() {
  if (progressBroadcastTimer) return
  progressBroadcastTimer = setTimeout(() => {
    progressBroadcastTimer = null
    broadcastState()
  }, 250)
}

module.exports = {
  createControlWindow,
  wallpaperActive,
  eachWallpaperWindow,
  ensureWallpaperWindows,
  destroyWallpaperWindows,
  sendPlayToWallpapers,
  getStateForRenderer,
  broadcastState,
  broadcastStateThrottled,
}
