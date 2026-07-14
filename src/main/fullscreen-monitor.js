// Определяет, запущено ли полноэкранное приложение (игра, видео и т.п.),
// чтобы ставить видео-обои на паузу и экономить GPU. Только Windows.

const { screen } = require('electron')
const wallpaper = require('./wallpaper')

let timer = null

function isForegroundFullscreen() {
  try {
    const f = wallpaper.loadUser32()
    const fg = f.GetForegroundWindow()
    if (!fg) return false

    // Игнорируем рабочий стол/оболочку
    const shell = f.GetShellWindow()
    if (fg === shell) return false

    const rect = [0, 0, 0, 0]
    if (!f.GetWindowRect(fg, rect)) return false
    const [left, top, right, bottom] = rect

    const display = screen.getDisplayNearestPoint({ x: left, y: top })
    const b = display.bounds
    // Окно считается полноэкранным, если покрывает весь дисплей
    return left <= b.x && top <= b.y && right >= b.x + b.width && bottom >= b.y + b.height
  } catch (_) {
    return false
  }
}

function start(onChange) {
  stop()
  if (process.platform !== 'win32') return
  let last = false
  timer = setInterval(() => {
    const now = isForegroundFullscreen()
    if (now !== last) {
      last = now
      onChange(now)
    }
  }, 2000)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = { start, stop }
