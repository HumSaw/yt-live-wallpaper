// Точка входа main-процесса: собирает модули вместе и вешает события app.
// Вся логика живёт в модулях:
//   window-manager — окна (панель + обои), состояние для renderer
//   ipc            — обработчики запросов от renderer
//   app-lifecycle  — старт/стоп обоев, паузы, первичная установка
//   playlist       — какой клип играет и когда сменяется
//   runtime-state  — общие рантайм-флаги

const { app, screen, powerMonitor } = require('electron')
const store = require('./store')
const downloader = require('./downloader')
const binManager = require('./bin-manager')
const fullscreenMonitor = require('./fullscreen-monitor')
const playlist = require('./playlist')
const tray = require('./tray')
const windows = require('./window-manager')
const ipc = require('./ipc')
const lifecycle = require('./app-lifecycle')
const runtime = require('./runtime-state')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => windows.createControlWindow())

  app.whenReady().then(() => {
    store.init(app.getPath('userData'))
    downloader.init(app.getPath('userData'))
    binManager.init(app.getPath('userData'))

    playlist.init({
      sendPlay: windows.sendPlayToWallpapers,
      wallpaperActive: windows.wallpaperActive,
      onStopped: () => lifecycle.stopWallpaper(),
    })
    tray.init({
      wallpaperActive: windows.wallpaperActive,
      startWallpaper: lifecycle.startWallpaper,
      stopWallpaper: lifecycle.stopWallpaper,
      toggleMute: lifecycle.toggleMute,
      openPanel: windows.createControlWindow,
      quit: lifecycle.quit,
    })

    ipc.register()
    lifecycle.setupPowerMonitor()

    // Не блокируем запуск: окно откроется сразу, прогресс уйдёт в UI
    lifecycle.runFirstTimeSetup().catch((err) => {
      runtime.setSetupState({ label: '', percent: 0, error: String(err.message || err) })
      windows.broadcastState()
    })

    const startHidden = process.argv.includes('--hidden')
    if (!startHidden) windows.createControlWindow()

    const settings = store.get().settings
    lifecycle.syncMonitorState()
    if (settings.pauseOnBattery && powerMonitor.isOnBatteryPower()) {
      runtime.setPausedByBattery(true)
    }

    // Автовозобновление обоев при старте
    if (settings.autoResume && playlist.readyClips().length > 0) {
      playlist.setCurrent(settings.activeClipId)
      lifecycle.startWallpaper()
      if (runtime.isPausedByBattery()) lifecycle.applyPauseState()
    }

    const rebuildWindows = () => {
      if (windows.wallpaperActive() && playlist.current()) {
        playlist.playClipById(playlist.current())
      }
      windows.broadcastState()
    }
    // Подключили/отключили монитор или сменили DPI/разрешение — пересобираем окна
    screen.on('display-added', rebuildWindows)
    screen.on('display-removed', rebuildWindows)
    screen.on('display-metrics-changed', rebuildWindows)
  })

  app.on('window-all-closed', () => {
    // Не выходим — приложение живёт в трее
  })

  app.on('before-quit', () => {
    runtime.setQuitting(true)
    // Отложенные удаления выполняем немедленно, иначе файлы останутся навсегда
    ipc.finalizeAllPendingRemovals()
    fullscreenMonitor.stop()
    playlist.stopTimer()
    store.saveNow() // сбрасываем дебаунс-очередь на диск
  })
}
