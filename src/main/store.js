// JSON-хранилище настроек и плейлиста в userData.
// Запись на диск дебаунсится, прогресс загрузки на диск не пишется.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let filePath = null
let state = null
let saveTimer = null

const DEFAULT_STATE = {
  clips: [],
  settings: {
    volume: 0.3,
    muted: false,
    // Режимы: 'single' — один клип по кругу,
    // 'sequence' — клипы друг за другом (закончился — следующий), по кругу,
    // 'timer' — смена клипа каждые N секунд
    playbackMode: 'sequence',
    playlistIntervalSec: 300,
    pauseOnFullscreen: true,
    autostart: false,
    autoResume: true,
    activeClipId: null,
  },
}

function init(userDataDir) {
  filePath = path.join(userDataDir, 'store.json')
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const loaded = JSON.parse(raw)
    state = {
      clips: Array.isArray(loaded.clips) ? loaded.clips : [],
      settings: { ...DEFAULT_STATE.settings, ...(loaded.settings || {}) },
    }
    // Миграция со старого поля playlistMode -> playbackMode
    if (typeof state.settings.playlistMode === 'boolean') {
      state.settings.playbackMode = state.settings.playlistMode ? 'timer' : 'single'
      delete state.settings.playlistMode
    }
    if (!['single', 'sequence', 'timer'].includes(state.settings.playbackMode)) {
      state.settings.playbackMode = 'sequence'
    }
    // Клипы, застрявшие в статусе "загрузка" при прошлом запуске — помечаем ошибкой
    for (const c of state.clips) {
      if (c.status === 'downloading') {
        c.status = 'error'
        c.error = 'Загрузка прервана (приложение было закрыто)'
      }
      if (c.status === 'ready' && c.filePath && !fs.existsSync(c.filePath)) {
        c.status = 'error'
        c.error = 'Файл не найден на диске'
      }
    }
  } catch (_) {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE))
  }
  saveNow()
}

function saveNow() {
  if (!filePath || !state) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    // Прогресс — эфемерное поле, на диск не пишем
    const persisted = {
      clips: state.clips.map(({ progress, ...rest }) => rest),
      settings: state.settings,
    }
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), 'utf8')
    fs.renameSync(tmp, filePath) // атомарная запись — файл не побьётся при сбое
  } catch (err) {
    console.error('[store] save error:', err)
  }
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 400)
}

function get() {
  return state
}

function update(mutator) {
  mutator(state)
  save()
  return state
}

function addClip({ url, start, end }) {
  const clip = {
    id: crypto.randomUUID(),
    url,
    start,
    end,
    title: null, // подтянется асинхронно через yt-dlp
    status: 'downloading',
    progress: 0,
    filePath: null,
    error: null,
    createdAt: Date.now(),
  }
  state.clips.push(clip)
  save()
  return clip
}

function updateClip(id, patch, { persist = true } = {}) {
  const clip = state.clips.find((c) => c.id === id)
  if (clip) {
    Object.assign(clip, patch)
    if (persist) save()
  }
  return clip
}

function removeClip(id) {
  state.clips = state.clips.filter((c) => c.id !== id)
  if (state.settings.activeClipId === id) state.settings.activeClipId = null
  save()
}

module.exports = { init, get, update, addClip, updateClip, removeClip, save, saveNow }
