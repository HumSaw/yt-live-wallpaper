// Иконка в системном трее и её контекстное меню.

const { Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const store = require('./store')
const playlist = require('./playlist')

let tray = null
let deps = null // { wallpaperActive, startWallpaper, stopWallpaper, toggleMute, openPanel, quit }

function init(d) {
  deps = d
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('YT Live Wallpaper')
  tray.on('double-click', () => deps.openPanel())
  update()
}

function update() {
  if (!tray) return
  const active = deps.wallpaperActive()
  const s = store.get().settings
  const hasClips = playlist.readyClips().length > 0

  const menu = Menu.buildFromTemplate([
    { label: 'Открыть панель', click: () => deps.openPanel() },
    { type: 'separator' },
    active
      ? { label: 'Остановить обои', click: () => deps.stopWallpaper() }
      : { label: 'Запустить обои', enabled: hasClips, click: () => deps.startWallpaper() },
    {
      label: 'Следующий клип',
      enabled: active && playlist.readyClips().length > 1,
      click: () => playlist.playNext(),
    },
    {
      label: s.muted ? 'Включить звук' : 'Выключить звук',
      enabled: active,
      click: () => deps.toggleMute(),
    },
    { type: 'separator' },
    { label: 'Выход', click: () => deps.quit() },
  ])
  tray.setContextMenu(menu)
}

module.exports = { init, update }
