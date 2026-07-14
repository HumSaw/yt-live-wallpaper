const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, powerMonitor } = require('electron')
const path = require('path')
const store = require('./store')
const downloader = require('./downloader')
const wallpaper = require('./wallpaper')
const fullscreenMonitor = require('./fullscreen-monitor')
const binManager = require('./bin-manager')

const IS_WINDOWS = process.platform === 'win32'

let controlWindow = null
/** Окна-обои по id дисплея: Map<displayId, BrowserWindow> */
const wallpaperWindows = new Map()
let tray = null
let playlistTimer = null
let currentClipId = null
let pausedByMonitor = false // пауза из-за полного экрана / перекрытого стола
let pausedByBattery = false
// Первичная установка yt-dlp/ffmpeg: null = всё готово
let setupState = null

function readyClips() {
  return store.get().clips.filter((c) => c.status === 'ready')
}

function currentIndex(clips) {
  const idx = clips.findIndex((c) => c.id === currentClipId)
  return idx >= 0 ? idx : 0
}

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
    if (!app.isQuiting) {
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
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
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
  stopPlaylistTimer()
  eachWallpaperWindow((win) => win.destroy())
  wallpaperWindows.clear()
  pausedByMonitor = false
  if (IS_WINDOWS) wallpaper.refreshDesktop()
}

function playClipById(id) {
  const clips = readyClips()
  if (clips.length === 0) return
  const clip = clips.find((c) => c.id === id) || clips[0]
  currentClipId = clip.id

  const wins = ensureWallpaperWindows()
  const settings = store.get().settings
  // В режиме «последовательность» клип не зацикливается сам — по окончании
  // окно-обои шлёт wallpaper:ended и мы включаем следующий.
  const loop = settings.playbackMode !== 'sequence' || clips.length <= 1

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

function applyPauseState() {
  const shouldPause = pausedByMonitor || pausedByBattery
  eachWallpaperWindow((win) =>
    win.webContents.send(shouldPause ? 'wallpaper:pause' : 'wallpaper:resume')
  )
  // На паузе клипы не должны сменяться по таймеру
  if (shouldPause) stopPlaylistTimer()
  else schedulePlaylistTimer()
  broadcastState()
  updateTrayMenu()
}

function getStateForRenderer() {
  const s = store.get()
  return {
    clips: s.clips,
    settings: s.settings,
    wallpaperActive: wallpaperActive(),
    pausedByFullscreen: pausedByMonitor,
    pausedByBattery,
    displays: displaysForRenderer(),
    platformSupported: IS_WINDOWS,
    setup: setupState, // null = компоненты готовы, иначе { label, percent, error }
  }
}

function broadcastState() {
  if (controlWindow && !controlWindow.isDestroyed()) {
    controlWindow.webContents.send('state:update', getStateForRenderer())
  }
}

function startClipDownload(clip) {
  // Название видео подтягиваем параллельно с загрузкой
  downloader.fetchTitle(clip.url).then((title) => {
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
    .then(async (filePath) => {
      const thumbPath = await downloader.makeThumbnail(filePath, clip.id)
      store.updateClip(clip.id, { status: 'ready', filePath, thumbPath, progress: 100 })
      broadcastState()
      // Если обои е��ё не запущены — включаем сразу
      if (!wallpaperActive()) startWallpaper()
      else schedulePlaylistTimer()
    })
    .catch((err) => {
      store.updateClip(clip.id, { status: 'error', error: String(err.message || err) })
      broadcastState()
    })
}

// Первый запуск: докачиваем yt-dlp/ffmpeg, если их нет рядом с приложением
async function runFirstTimeSetup() {
  const missing = await binManager.missingBinaries()
  if (missing.length === 0) {
    setupState = null
    return
  }

  setupState = { label: 'Подготовка…', percent: 0, error: null }
  broadcastState()

  const result = await binManager.ensureBinaries(({ label, percent }) => {
    setupState = { label, percent, error: null }
    broadcastState()
  })

  setupState = result.ok ? null : { label: '', percent: 0, error: result.error }
  broadcastState()
}

function registerIpc() {
  ipcMain.handle('state:get', () => getStateForRenderer())

  ipcMain.handle('setup:retry', async () => {
    await runFirstTimeSetup()
    return getStateForRenderer()
  })

  ipcMain.handle('clip:add', async (_e, { url, start, end }) => {
    if (setupState) return { error: 'Дождитесь установки компонентов' }
    const urlError = downloader.validateUrl(url)
    if (urlError) return { error: urlError }

    const clip = store.addClip({ url, start, end })
    broadcastState()
    startClipDownload(clip)
    return { clip }
  })

  // Локальный файл (drag&drop): не копируем, ссылаемся на оригинал
  ipcMain.handle('clip:addLocal', async (_e, filePath) => {
    const err = downloader.validateLocalFile(filePath)
    if (err) return { error: err }

    const clip = store.addClip({
      url: filePath,
      start: '',
      end: '',
      source: 'local',
      title: path.basename(filePath),
      filePath,
      status: 'ready',
    })
    broadcastState()

    downloader.makeThumbnail(filePath, clip.id).then((thumbPath) => {
      if (thumbPath) {
        store.updateClip(clip.id, { thumbPath })
        broadcastState()
      }
    })

    if (!wallpaperActive()) startWallpaper()
    else schedulePlaylistTimer()
    return { clip }
  })

  ipcMain.handle('clip:remove', (_e, id) => {
    downloader.removeClipFile(store.get().clips.find((c) => c.id === id))
    store.removeClip(id)
    if (currentClipId === id) {
      currentClipId = null
      if (wallpaperActive()) {
        // Активный клип удалили — переключаемся на следующий или гасим обои
        if (readyClips().length > 0) startWallpaper()
        else destroyWallpaperWindows()
      }
    }
    broadcastState()
    updateTrayMenu()
    return true
  })

  ipcMain.handle('clip:play', (_e, id) => {
    playClipById(id)
    updateTrayMenu()
    return true
  })

  ipcMain.handle('wallpaper:start', () => {
    const ok = startWallpaper()
    broadcastState()
    updateTrayMenu()
    return ok
  })

  ipcMain.handle('wallpaper:stop', () => {
    destroyWallpaperWindows()
    broadcastState()
    updateTrayMenu()
    return true
  })

  ipcMain.handle('wallpaper:next', () => {
    playNextClip()
    return true
  })

  ipcMain.handle('ytdlp:update', async () => {
    const result = await downloader.updateYtDlp()
    return result
  })

  // Видео закончилось (режим «последовательность») — включаем следующее
  ipcMain.on('wallpaper:ended', () => {
    if (store.get().settings.playbackMode === 'sequence') playNextClip()
  })

  // Renderer не должен уметь записать в настройки произв��льные ключи/значения
  const SETTING_VALIDATORS = {
    volume: (v) => (typeof v === 'number' ? Math.min(1, Math.max(0, v)) : undefined),
    muted: (v) => !!v,
    playbackMode: (v) => (['single', 'sequence', 'timer'].includes(v) ? v : undefined),
    playlistIntervalSec: (v) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(86400, Math.max(10, Math.round(n))) : undefined
    },
    pauseOnFullscreen: (v) => !!v,
    pauseWhenCovered: (v) => !!v,
    pauseOnBattery: (v) => !!v,
    targetDisplay: (v) => (typeof v === 'string' && v.length < 40 ? v : undefined),
    autostart: (v) => !!v,
    autoResume: (v) => !!v,
    theme: (v) => (['night', 'day'].includes(v) ? v : undefined),
  }

  function sanitizeSettingsPatch(raw) {
    const clean = {}
    for (const [key, value] of Object.entries(raw || {})) {
      const validate = SETTING_VALIDATORS[key]
      if (!validate) continue
      const v = validate(value)
      if (v !== undefined) clean[key] = v
    }
    return clean
  }

  ipcMain.handle('settings:set', (_e, rawPatch) => {
    const patch = sanitizeSettingsPatch(rawPatch)
    store.update((s) => Object.assign(s.settings, patch))
    const s = store.get().settings

    if ('volume' in patch || 'muted' in patch) {
      eachWallpaperWindow((win) =>
        win.webContents.send('wallpaper:volume', s.muted ? 0 : s.volume)
      )
    }
    if ('autostart' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.autostart, args: ['--hidden'] })
    }
    if ('playbackMode' in patch) {
      // Перезапускаем текущий клип, чтобы применить loop-режим
      if (wallpaperActive() && currentClipId) playClipById(currentClipId)
      else schedulePlaylistTimer()
    } else if ('playlistIntervalSec' in patch) {
      // Смена интервала не требует перезапуска видео
      schedulePlaylistTimer()
    }
    if ('targetDisplay' in patch) {
      // Пересоздаём окна под новый набор мониторов
      if (wallpaperActive() && currentClipId) playClipById(currentClipId)
    }
    if ('pauseOnFullscreen' in patch || 'pauseWhenCovered' in patch) {
      syncMonitorState()
    }
    if ('pauseOnBattery' in patch) {
      pausedByBattery = !!patch.pauseOnBattery && powerMonitor.isOnBatteryPower()
      applyPauseState()
    }
    broadcastState()
    updateTrayMenu()
    return s
  })
}

function syncMonitorState() {
  const s = store.get().settings
  if (s.pauseOnFullscreen || s.pauseWhenCovered) {
    fullscreenMonitor.start(
      () => ({
        fullscreen: store.get().settings.pauseOnFullscreen,
        covered: store.get().settings.pauseWhenCovered,
      }),
      (shouldPause) => {
        if (!wallpaperActive()) return
        if (shouldPause === pausedByMonitor) return
        pausedByMonitor = shouldPause
        applyPauseState()
      }
    )
  } else {
    fullscreenMonitor.stop()
    if (pausedByMonitor) {
      pausedByMonitor = false
      applyPauseState()
    }
  }
}

function setupPowerMonitor() {
  powerMonitor.on('on-battery', () => {
    if (store.get().settings.pauseOnBattery) {
      pausedByBattery = true
      applyPauseState()
    }
  })
  powerMonitor.on('on-ac', () => {
    if (pausedByBattery) {
      pausedByBattery = false
      applyPauseState()
    }
  })
  // Пауза при блокировке экрана — бесплатная экономия
  powerMonitor.on('lock-screen', () => {
    eachWallpaperWindow((win) => win.webContents.send('wallpaper:pause'))
  })
  powerMonitor.on('unlock-screen', () => {
    if (!pausedByMonitor && !pausedByBattery) {
      eachWallpaperWindow((win) => win.webContents.send('wallpaper:resume'))
    }
  })
}

function updateTrayMenu() {
  if (!tray) return
  const active = wallpaperActive()
  const s = store.get().settings
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть панель', click: () => createControlWindow() },
    { type: 'separator' },
    active
      ? { label: 'Остановить обои', click: () => { destroyWallpaperWindows(); broadcastState(); updateTrayMenu() } }
      : {
          label: 'Запустить обои',
          enabled: readyClips().length > 0,
          click: () => { startWallpaper(); broadcastState(); updateTrayMenu() },
        },
    { label: 'Следующий клип', enabled: active && readyClips().length > 1, click: () => playNextClip() },
    {
      label: s.muted ? 'Включить звук' : 'Выключить звук',
      enabled: active,
      click: () => {
        store.update((st) => { st.settings.muted = !st.settings.muted })
        const st = store.get().settings
        eachWallpaperWindow((win) =>
          win.webContents.send('wallpaper:volume', st.muted ? 0 : st.volume)
        )
        broadcastState()
        updateTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        app.isQuiting = true
        destroyWallpaperWindows()
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('YT Live Wallpaper')
  updateTrayMenu()
  tray.on('double-click', () => createControlWindow())
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => createControlWindow())

  app.whenReady().then(() => {
    store.init(app.getPath('userData'))
    downloader.init(app.getPath('userData'))
    binManager.init(app.getPath('userData'))
    registerIpc()
    createTray()
    setupPowerMonitor()

    // Не блокируем запуск: окно откроется сразу, прогресс уйдёт в UI
    runFirstTimeSetup().catch((err) => {
      setupState = { label: '', percent: 0, error: String(err.message || err) }
      broadcastState()
    })

    const startHidden = process.argv.includes('--hidden')
    if (!startHidden) createControlWindow()

    const settings = store.get().settings
    syncMonitorState()
    if (settings.pauseOnBattery && powerMonitor.isOnBatteryPower()) {
      pausedByBattery = true
    }

    // Автовозобновление обоев при старте
    if (settings.autoResume && readyClips().length > 0) {
      currentClipId = settings.activeClipId
      startWallpaper()
      if (pausedByBattery) applyPauseState()
    }

    // Подключили/отключили монитор — пересобираем окна
    screen.on('display-added', () => {
      if (wallpaperActive() && currentClipId) playClipById(currentClipId)
      broadcastState()
    })
    screen.on('display-removed', () => {
      if (wallpaperActive() && currentClipId) playClipById(currentClipId)
      broadcastState()
    })
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
