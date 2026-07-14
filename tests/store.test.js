// Тесты JSON-хранилища: дефолты, персистентность, миграции, восстановление.
// store.js не зависит от Electron — тестируется на чистом Node.

const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

let tmpDir
let store

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytlw-store-'))
  // Сбрасываем модуль между тестами — у него модульное состояние
  delete require.cache[require.resolve('../src/main/store')]
  store = require('../src/main/store')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('init создаёт состояние с дефолтными настройками', () => {
  store.init(tmpDir)
  const s = store.get()
  assert.equal(s.clips.length, 0)
  assert.equal(s.settings.playbackMode, 'sequence')
  assert.equal(s.settings.theme, 'night')
  assert.equal(typeof s.settings.volume, 'number')
})

test('addClip добавляет клип с id и статусом downloading', () => {
  store.init(tmpDir)
  const clip = store.addClip({ url: 'https://youtube.com/watch?v=x', start: '', end: '' })
  assert.ok(clip.id.length > 0)
  assert.equal(clip.status, 'downloading')
  assert.equal(store.get().clips.length, 1)
})

test('updateClip меняет поля, removeClip удаляет и чистит activeClipId', () => {
  store.init(tmpDir)
  const clip = store.addClip({ url: 'u', start: '', end: '' })
  store.updateClip(clip.id, { status: 'ready' })
  assert.equal(store.get().clips[0].status, 'ready')

  store.update((s) => {
    s.settings.activeClipId = clip.id
  })
  store.removeClip(clip.id)
  assert.equal(store.get().clips.length, 0)
  assert.equal(store.get().settings.activeClipId, null)
})

test('saveNow пишет на диск атомарно и не сохраняет progress', () => {
  store.init(tmpDir)
  const clip = store.addClip({ url: 'u', start: '', end: '' })
  store.updateClip(clip.id, { progress: 42 }, { persist: false })
  store.saveNow()

  const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 'store.json'), 'utf8'))
  assert.equal(raw.clips.length, 1)
  assert.equal('progress' in raw.clips[0], false)
  assert.equal(fs.existsSync(path.join(tmpDir, 'store.json.tmp')), false)
})

test('повторный init восстанавливает состояние и чинит зависшие клипы', () => {
  store.init(tmpDir)
  const a = store.addClip({ url: 'a', start: '', end: '' }) // останется downloading
  const b = store.addClip({ url: 'b', start: '', end: '' })
  store.updateClip(b.id, { status: 'ready', filePath: path.join(tmpDir, 'nope.mp4') })
  store.saveNow()

  delete require.cache[require.resolve('../src/main/store')]
  const store2 = require('../src/main/store')
  store2.init(tmpDir)

  const clips = store2.get().clips
  // «Зависшая» загрузка помечена ошибкой
  assert.equal(clips.find((c) => c.id === a.id).status, 'error')
  // ready-клип с пропавшим файлом тоже помечен ошибкой
  assert.equal(clips.find((c) => c.id === b.id).status, 'error')
})

test('битый store.json не роняет приложение — стартуем с дефолтов', () => {
  fs.writeFileSync(path.join(tmpDir, 'store.json'), '{оборванный json', 'utf8')
  store.init(tmpDir)
  assert.equal(store.get().clips.length, 0)
  assert.equal(store.get().settings.playbackMode, 'sequence')
})

test('миграция playlistMode -> playbackMode', () => {
  fs.writeFileSync(
    path.join(tmpDir, 'store.json'),
    JSON.stringify({ clips: [], settings: { playlistMode: true } }),
    'utf8'
  )
  store.init(tmpDir)
  assert.equal(store.get().settings.playbackMode, 'timer')
  assert.equal('playlistMode' in store.get().settings, false)
})
