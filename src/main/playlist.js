// Логика плейлиста: какой клип играет, таймер смены, следующий клип.
// Ничего не знает про окна и IPC — main.js передаёт колбэки при инициализации.

const store = require('./store')

let deps = null // { sendPlay(clip, loop), wallpaperActive(), onStopped() }
let currentClipId = null
let timer = null

function init(d) {
  deps = d
}

function readyClips() {
  return store.get().clips.filter((c) => c.status === 'ready' && !c.pendingRemoval)
}

function current() {
  return currentClipId
}

function setCurrent(id) {
  currentClipId = id
}

function currentIndex(clips) {
  const idx = clips.findIndex((c) => c.id === currentClipId)
  return idx >= 0 ? idx : 0
}

function playClipById(id) {
  const clips = readyClips()
  if (clips.length === 0) return false
  const clip = clips.find((c) => c.id === id) || clips[0]
  currentClipId = clip.id

  const settings = store.get().settings
  // В режиме «последовательность» клип не зацикливается сам — по окончании
  // окно-обои шлёт wallpaper:ended и включается следующий.
  const loop = settings.playbackMode !== 'sequence' || clips.length <= 1
  deps.sendPlay(clip, loop)

  store.update((s) => {
    s.settings.activeClipId = clip.id
  })
  scheduleTimer()
  return true
}

function playNext() {
  const clips = readyClips()
  if (clips.length === 0) return
  const next = clips[(currentIndex(clips) + 1) % clips.length]
  playClipById(next.id)
}

function start() {
  const clips = readyClips()
  if (clips.length === 0) return false
  return playClipById(currentClipId || clips[0].id)
}

function scheduleTimer() {
  stopTimer()
  const s = store.get().settings
  if (s.playbackMode === 'timer' && readyClips().length > 1) {
    timer = setTimeout(() => playNext(), Math.max(10, s.playlistIntervalSec) * 1000)
  }
}

function stopTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** Клип пропал (удалён) — переключаемся или сообщаем, что играть нечего. */
function handleClipGone(id) {
  if (currentClipId !== id) return
  currentClipId = null
  if (!deps.wallpaperActive()) return
  if (readyClips().length > 0) start()
  else deps.onStopped()
}

module.exports = {
  init,
  readyClips,
  current,
  setCurrent,
  playClipById,
  playNext,
  start,
  scheduleTimer,
  stopTimer,
  handleClipGone,
}
