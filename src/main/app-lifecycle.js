// Жизненный цикл: запуск/остановка обоев, паузы (полный экран, батарея,
// экран блокировки), первичная установка бинарников, выход из приложения.

const { app, powerMonitor } = require('electron')
const store = require('./store')
const playlist = require('./playlist')
const tray = require('./tray')
const binManager = require('./bin-manager')
const fullscreenMonitor = require('./fullscreen-monitor')
const windows = require('./window-manager')
const runtime = require('./runtime-state')

function startWallpaper() {
  const ok = playlist.start()
  windows.broadcastState()
  tray.update()
  return ok
}

function stopWallpaper() {
  windows.destroyWallpaperWindows()
  windows.broadcastState()
  tray.update()
}

function applyPauseState() {
  const shouldPause = runtime.isPaused()
  windows.eachWallpaperWindow((win) =>
    win.webContents.send(shouldPause ? 'wallpaper:pause' : 'wallpaper:resume')
  )
  // На паузе клипы не должны сменяться по таймеру
  if (shouldPause) playlist.stopTimer()
  else playlist.scheduleTimer()
  windows.broadcastState()
  tray.update()
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
        if (!windows.wallpaperActive()) return
        if (shouldPause === runtime.isPausedByMonitor()) return
        runtime.setPausedByMonitor(shouldPause)
        applyPauseState()
      }
    )
  } else {
    fullscreenMonitor.stop()
    if (runtime.isPausedByMonitor()) {
      runtime.setPausedByMonitor(false)
      applyPauseState()
    }
  }
}

function setupPowerMonitor() {
  powerMonitor.on('on-battery', () => {
    if (store.get().settings.pauseOnBattery) {
      runtime.setPausedByBattery(true)
      applyPauseState()
    }
  })
  powerMonitor.on('on-ac', () => {
    if (runtime.isPausedByBattery()) {
      runtime.setPausedByBattery(false)
      applyPauseState()
    }
  })
  // Пауза при блокировке экрана — бесплатная экономия
  powerMonitor.on('lock-screen', () => {
    windows.eachWallpaperWindow((win) => win.webContents.send('wallpaper:pause'))
  })
  powerMonitor.on('unlock-screen', () => {
    if (!runtime.isPaused()) {
      windows.eachWallpaperWindow((win) => win.webContents.send('wallpaper:resume'))
    }
  })
}

function toggleMute() {
  store.update((st) => {
    st.settings.muted = !st.settings.muted
  })
  const st = store.get().settings
  windows.eachWallpaperWindow((win) =>
    win.webContents.send('wallpaper:volume', st.muted ? 0 : st.volume)
  )
  windows.broadcastState()
  tray.update()
}

// Первый запуск: докачиваем yt-dlp/ffmpeg, если их нет рядом с приложением
async function runFirstTimeSetup() {
  const missing = await binManager.missingBinaries()
  if (missing.length === 0) {
    runtime.setSetupState(null)
    return
  }

  runtime.setSetupState({ label: 'Подготовка…', percent: 0, error: null })
  windows.broadcastState()

  const result = await binManager.ensureBinaries(({ label, percent }) => {
    runtime.setSetupState({ label, percent, error: null })
    windows.broadcastStateThrottled()
  })

  runtime.setSetupState(result.ok ? null : { label: '', percent: 0, error: result.error })
  windows.broadcastState()
}

function quit() {
  runtime.setQuitting(true)
  windows.destroyWallpaperWindows()
  app.quit()
}

module.exports = {
  startWallpaper,
  stopWallpaper,
  applyPauseState,
  syncMonitorState,
  setupPowerMonitor,
  toggleMute,
  runFirstTimeSetup,
  quit,
}
