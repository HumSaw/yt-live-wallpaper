// Все IPC-обработчики панели управления и окон-обоев.
// Также владеет загрузкой клипов и отложенным удалением (undo).

const { app, ipcMain, powerMonitor } = require('electron')
const path = require('path')
const store = require('./store')
const downloader = require('./downloader')
const binManager = require('./bin-manager')
const playlist = require('./playlist')
const tray = require('./tray')
const windows = require('./window-manager')
const lifecycle = require('./app-lifecycle')
const runtime = require('./runtime-state')

const IS_LINUX = process.platform === 'linux'
const UNDO_WINDOW_MS = 6000

// Отложенные удаления клипов (undo): Map<clipId, Timeout>
const pendingRemovals = new Map()

// Renderer не должен уметь записать в настройки произвольные ключи/значения
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
  language: (v) =>
    ['ru', 'en', 'es', 'pt', 'de', 'fr', 'ja', 'zh', 'ko', 'pl'].includes(v) ? v : undefined,
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

function startClipDownload(clip) {
  // Название видео подтягиваем параллельно с загрузкой
  downloader.fetchTitle(clip.url).then((title) => {
    if (title) {
      store.updateClip(clip.id, { title })
      windows.broadcastState()
    }
  })

  downloader
    .queueDownload(clip, (progress) => {
      // Прогресс — только в память и в UI, без записи на диск
      store.updateClip(clip.id, { progress }, { persist: false })
      windows.broadcastStateThrottled()
    })
    .then(async (filePath) => {
      const thumbPath = await downloader.makeThumbnail(filePath, clip.id)
      store.updateClip(clip.id, { status: 'ready', filePath, thumbPath, progress: 100 })
      windows.broadcastState()
      // Если обои ещё не запущены — включаем сразу
      if (!windows.wallpaperActive()) lifecycle.startWallpaper()
      else playlist.scheduleTimer()
    })
    .catch((err) => {
      store.updateClip(clip.id, { status: 'error', error: String(err.message || err) })
      windows.broadcastState()
    })
}

function finalizeClipRemoval(id) {
  pendingRemovals.delete(id)
  downloader.removeClipFile(store.get().clips.find((c) => c.id === id))
  store.removeClip(id)
  playlist.handleClipGone(id)
  windows.broadcastState()
  tray.update()
}

/** Выполняет все отложенные удаления немедленно (вызывается перед выходом). */
function finalizeAllPendingRemovals() {
  for (const id of [...pendingRemovals.keys()]) {
    clearTimeout(pendingRemovals.get(id))
    finalizeClipRemoval(id)
  }
}

function register() {
  ipcMain.handle('state:get', () => windows.getStateForRenderer())

  ipcMain.handle('setup:retry', async () => {
    await lifecycle.runFirstTimeSetup()
    return windows.getStateForRenderer()
  })

  ipcMain.handle('clip:add', async (_e, { url, start, end }) => {
    if (runtime.getSetupState()) return { error: 'Дождитесь установки компонентов' }
    const urlError = downloader.validateUrl(url)
    if (urlError) return { error: urlError }

    const clip = store.addClip({ url, start, end })
    windows.broadcastState()
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
    windows.broadcastState()

    downloader.makeThumbnail(filePath, clip.id).then((thumbPath) => {
      if (thumbPath) {
        store.updateClip(clip.id, { thumbPath })
        windows.broadcastState()
      }
    })

    if (!windows.wallpaperActive()) lifecycle.startWallpaper()
    else playlist.scheduleTimer()
    return { clip }
  })

  // Мягкое удаление: клип помечается и исчезает из ротации, файл удаляется
  // через UNDO_WINDOW_MS — за это время пользователь может передумать.
  ipcMain.handle('clip:remove', (_e, id) => {
    const clip = store.get().clips.find((c) => c.id === id)
    if (!clip || pendingRemovals.has(id)) return false

    store.updateClip(id, { pendingRemoval: true }, { persist: false })
    if (playlist.current() === id) playlist.handleClipGone(id)
    pendingRemovals.set(id, setTimeout(() => finalizeClipRemoval(id), UNDO_WINDOW_MS))
    windows.broadcastState()
    tray.update()
    return true
  })

  ipcMain.handle('clip:removeUndo', (_e, id) => {
    const timer = pendingRemovals.get(id)
    if (!timer) return false
    clearTimeout(timer)
    pendingRemovals.delete(id)
    store.updateClip(id, { pendingRemoval: false }, { persist: false })
    windows.broadcastState()
    tray.update()
    return true
  })

  // Повторная загрузка клипа после ошибки
  ipcMain.handle('clip:retry', (_e, id) => {
    if (runtime.getSetupState()) return { error: 'Дождитесь установки компонентов' }
    const clip = store.get().clips.find((c) => c.id === id)
    if (!clip || clip.status !== 'error' || clip.source === 'local') {
      return { error: 'Клип нельзя перезапустить' }
    }

    store.updateClip(id, { status: 'downloading', progress: 0, error: null })
    windows.broadcastState()
    startClipDownload(store.get().clips.find((c) => c.id === id))
    return { ok: true }
  })

  ipcMain.handle('clip:play', (_e, id) => {
    playlist.playClipById(id)
    windows.broadcastState()
    tray.update()
    return true
  })

  ipcMain.handle('wallpaper:start', () => lifecycle.startWallpaper())

  ipcMain.handle('wallpaper:stop', () => {
    lifecycle.stopWallpaper()
    return true
  })

  ipcMain.handle('wallpaper:next', () => {
    playlist.playNext()
    windows.broadcastState()
    return true
  })

  ipcMain.handle('ytdlp:update', () => binManager.updateYtDlp())

  // Видео закончилось (режим «последовательность») — включаем следующее
  ipcMain.on('wallpaper:ended', () => {
    if (store.get().settings.playbackMode === 'sequence') {
      playlist.playNext()
      windows.broadcastState()
    }
  })

  ipcMain.handle('settings:set', (_e, rawPatch) => {
    const patch = sanitizeSettingsPatch(rawPatch)
    store.update((s) => Object.assign(s.settings, patch))
    const s = store.get().settings

    if ('volume' in patch || 'muted' in patch) {
      windows.eachWallpaperWindow((win) =>
        win.webContents.send('wallpaper:volume', s.muted ? 0 : s.volume)
      )
    }
    if ('autostart' in patch && !IS_LINUX) {
      // setLoginItemSettings работает на Windows и macOS; на Linux — нет
      app.setLoginItemSettings({ openAtLogin: !!patch.autostart, args: ['--hidden'] })
    }
    if ('playbackMode' in patch) {
      // Перезапускаем текущий клип, чтобы применить loop-режим
      if (windows.wallpaperActive() && playlist.current()) {
        playlist.playClipById(playlist.current())
      } else {
        playlist.scheduleTimer()
      }
    } else if ('playlistIntervalSec' in patch) {
      // Смена интервала не требует перезапуска видео
      playlist.scheduleTimer()
    }
    if ('targetDisplay' in patch) {
      // Пересоздаём окна под новый набор мониторов
      if (windows.wallpaperActive() && playlist.current()) {
        playlist.playClipById(playlist.current())
      }
    }
    if ('pauseOnFullscreen' in patch || 'pauseWhenCovered' in patch) {
      lifecycle.syncMonitorState()
    }
    if ('pauseOnBattery' in patch) {
      runtime.setPausedByBattery(!!patch.pauseOnBattery && powerMonitor.isOnBatteryPower())
      lifecycle.applyPauseState()
    }
    windows.broadcastState()
    tray.update()
    return s
  })
}

module.exports = { register, finalizeAllPendingRemovals, sanitizeSettingsPatch }
