// Простое JSON-хранилище настроек и плейлиста в userData.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let filePath = null
let state = null

const DEFAULT_STATE = {
  clips: [],
  settings: {
    volume: 0.3,
    muted: false,
    playlistMode: true,
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
    // Клипы, застрявшие в статусе "загрузка" при прошлом запуске — помечаем ошибкой
    for (const c of state.clips) {
      if (c.status === 'downloading') {
        c.status = 'error'
        c.error = 'Загрузка прервана (приложение было закрыто)'
      }
      // Проверяем, что файл ещё существует
      if (c.status === 'ready' && c.filePath && !fs.existsSync(c.filePath)) {
        c.status = 'error'
        c.error = 'Файл не найден на диске'
      }
    }
  } catch (_) {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE))
  }
  save()
}

function save() {
  if (!filePath || !state) return
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.error('[store] save error:', err)
  }
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
    title: url,
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

function updateClip(id, patch) {
  const clip = state.clips.find((c) => c.id === id)
  if (clip) {
    Object.assign(clip, patch)
    save()
  }
  return clip
}

function removeClip(id) {
  state.clips = state.clips.filter((c) => c.id !== id)
  if (state.settings.activeClipId === id) state.settings.activeClipId = null
  save()
}

module.exports = { init, get, update, addClip, updateClip, removeClip, save }
