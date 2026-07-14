// Прикрепление окна Electron к рабочему столу macOS.
// Принцип: NSWindow.level = kCGDesktopWindowLevel (-2147483623) — это НИЖЕ
// слоя иконок рабочего стола (kCGDesktopIconWindowLevel = -2147483603),
// поэтому видео играет за ярлыками и папками, как обычные обои.
// Используем objc-runtime через koffi — без нативных модулей.

let fns = null

function loadObjc() {
  if (fns) return fns
  const koffi = require('koffi')
  const objc = koffi.load('libobjc.A.dylib')

  // Селекторы и objc_msgSend с конкретными сигнатурами.
  // Работаем через intptr — как и в windows-версии с user32.
  const sel_registerName = objc.func('sel_registerName', 'intptr', ['str'])
  const msgSendPtr = objc.func('objc_msgSend', 'intptr', ['intptr', 'intptr'])
  const msgSendVoidLong = objc.func('objc_msgSend', 'void', ['intptr', 'intptr', 'long'])
  const msgSendVoidULong = objc.func('objc_msgSend', 'void', ['intptr', 'intptr', 'ulong'])

  fns = {
    selWindow: sel_registerName('window'),
    selSetLevel: sel_registerName('setLevel:'),
    selSetCollectionBehavior: sel_registerName('setCollectionBehavior:'),
    msgSendPtr,
    msgSendVoidLong,
    msgSendVoidULong,
  }
  return fns
}

// kCGDesktopWindowLevel: уровень фона рабочего стола (ниже иконок)
const DESKTOP_WINDOW_LEVEL = -2147483623
// canJoinAllSpaces (1<<0) | stationary (1<<4) | ignoresCycle (1<<6):
// обои видны на всех рабочих столах Spaces, не двигаются Mission Control
// и не участвуют в Cmd+Tab
const COLLECTION_BEHAVIOR = (1 << 0) | (1 << 4) | (1 << 6)

/**
 * Опускает окно BrowserWindow на уровень рабочего стола macOS.
 * getNativeWindowHandle() на macOS возвращает NSView* — берём его NSWindow
 * и выставляем уровень + поведение в Spaces.
 */
function attachToDesktop(browserWindow) {
  if (process.platform !== 'darwin') return false
  try {
    const f = loadObjc()
    const handle = browserWindow.getNativeWindowHandle()
    const nsView =
      handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0)
    if (!nsView) return false

    const nsWindow = f.msgSendPtr(nsView, f.selWindow)
    if (!nsWindow) return false

    f.msgSendVoidLong(nsWindow, f.selSetLevel, DESKTOP_WINDOW_LEVEL)
    f.msgSendVoidULong(nsWindow, f.selSetCollectionBehavior, COLLECTION_BEHAVIOR)
    return true
  } catch (err) {
    console.error('[wallpaper-mac] attachToDesktop error:', err)
    return false
  }
}

module.exports = { attachToDesktop }
