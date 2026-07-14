// Тесты логики плейлиста: выбор клипа, следующий по кругу, реакция на
// удаление. Зависимости (окна) подменяются колбэками — так задумано в API.

const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

let tmpDir
let store
let playlist
let sent // список вызовов sendPlay
let stopped

function freshModules() {
  delete require.cache[require.resolve('../src/main/store')]
  delete require.cache[require.resolve('../src/main/playlist')]
  store = require('../src/main/store')
  playlist = require('../src/main/playlist')
}

function addReadyClip(title) {
  const clip = store.addClip({ url: title, start: '', end: '' })
  store.updateClip(clip.id, { status: 'ready', filePath: __filename })
  return clip
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytlw-pl-'))
  freshModules()
  store.init(tmpDir)
  sent = []
  stopped = false
  playlist.init({
    sendPlay: (clip, loop) => sent.push({ id: clip.id, loop }),
    wallpaperActive: () => sent.length > 0,
    onStopped: () => {
      stopped = true
    },
  })
})

afterEach(() => {
  playlist.stopTimer()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('readyClips отдаёт только готовые и не помеченные на удаление', () => {
  const a = addReadyClip('a')
  store.addClip({ url: 'downloading', start: '', end: '' })
  const c = addReadyClip('c')
  store.updateClip(c.id, { pendingRemoval: true }, { persist: false })

  const ready = playlist.readyClips()
  assert.equal(ready.length, 1)
  assert.equal(ready[0].id, a.id)
})

test('start без клипов возвращает false и ничего не играет', () => {
  assert.equal(playlist.start(), false)
  assert.equal(sent.length, 0)
})

test('playClipById играет клип и запоминает его в настройках', () => {
  const a = addReadyClip('a')
  assert.equal(playlist.playClipById(a.id), true)
  assert.equal(sent[0].id, a.id)
  assert.equal(playlist.current(), a.id)
  assert.equal(store.get().settings.activeClipId, a.id)
})

test('в режиме sequence с 2+ клипами loop выключен', () => {
  const a = addReadyClip('a')
  addReadyClip('b')
  store.update((s) => {
    s.settings.playbackMode = 'sequence'
  })
  playlist.playClipById(a.id)
  assert.equal(sent[0].loop, false)
})

test('с одним клипом loop всегда включён, даже в sequence', () => {
  const a = addReadyClip('a')
  playlist.playClipById(a.id)
  assert.equal(sent[0].loop, true)
})

test('playNext идёт по кругу', () => {
  const a = addReadyClip('a')
  const b = addReadyClip('b')
  playlist.playClipById(a.id)
  playlist.playNext()
  assert.equal(sent[1].id, b.id)
  playlist.playNext() // с конца — обратно к началу
  assert.equal(sent[2].id, a.id)
})

test('handleClipGone переключает на следующий клип', () => {
  const a = addReadyClip('a')
  const b = addReadyClip('b')
  playlist.playClipById(a.id)
  store.removeClip(a.id)
  playlist.handleClipGone(a.id)
  assert.equal(sent[sent.length - 1].id, b.id)
})

test('handleClipGone останавливает обои, если клипов не осталось', () => {
  const a = addReadyClip('a')
  playlist.playClipById(a.id)
  store.removeClip(a.id)
  playlist.handleClipGone(a.id)
  assert.equal(stopped, true)
})
