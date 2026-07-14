// Встраивание окна Electron ЗА иконки рабочего стола Windows (трюк с WorkerW).
// Работает только на Windows. Использует koffi (FFI) для вызова user32.dll.

let user32 = null
let fns = null

function loadUser32() {
  if (fns) return fns
  const koffi = require('koffi')
  user32 = koffi.load('user32.dll')

  const FindWindowW = user32.func('__stdcall', 'FindWindowW', 'intptr', ['str16', 'str16'])
  const FindWindowExW = user32.func('__stdcall', 'FindWindowExW', 'intptr', [
    'intptr',
    'intptr',
    'str16',
    'str16',
  ])
  const SendMessageTimeoutW = user32.func('__stdcall', 'SendMessageTimeoutW', 'intptr', [
    'intptr',
    'uint',
    'uintptr',
    'intptr',
    'uint',
    'uint',
    koffi.out(koffi.pointer('uintptr')),
  ])
  const SetParent = user32.func('__stdcall', 'SetParent', 'intptr', ['intptr', 'intptr'])
  const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'bool', [
    koffi.pointer(koffi.proto('__stdcall', 'EnumWindowsProc', 'bool', ['intptr', 'intptr'])),
    'intptr',
  ])
  const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'intptr', [])
  const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'bool', [
    'intptr',
    koffi.out(koffi.pointer('int32', 4)),
  ])
  const GetShellWindow = user32.func('__stdcall', 'GetShellWindow', 'intptr', [])
  const SystemParametersInfoW = user32.func('__stdcall', 'SystemParametersInfoW', 'bool', [
    'uint',
    'uint',
    'intptr',
    'uint',
  ])
  const GetSystemMetrics = user32.func('__stdcall', 'GetSystemMetrics', 'int', ['int'])
  const MoveWindow = user32.func('__stdcall', 'MoveWindow', 'bool', [
    'intptr',
    'int',
    'int',
    'int',
    'int',
    'bool',
  ])
  const IsZoomed = user32.func('__stdcall', 'IsZoomed', 'bool', ['intptr'])

  fns = {
    koffi,
    FindWindowW,
    FindWindowExW,
    SendMessageTimeoutW,
    SetParent,
    EnumWindows,
    GetForegroundWindow,
    GetWindowRect,
    GetShellWindow,
    SystemParametersInfoW,
    GetSystemMetrics,
    MoveWindow,
    IsZoomed,
  }
  return fns
}

/**
 * Прикрепляет окно BrowserWindow за иконки рабочего стола.
 * 1. Находим Progman
 * 2. Шлём ему 0x052C — Windows создаёт окно WorkerW позади иконок
 * 3. Находим этот WorkerW и делаем его родителем нашего окна
 *
 * @param {BrowserWindow} browserWindow
 * @param {{x:number,y:number,width:number,height:number}|null} physicalBounds
 *   Физические (в пикселях) границы дисплея, на который встают обои.
 *   После SetParent координаты окна становятся относительными к WorkerW,
 *   который охватывает ВЕСЬ виртуальный экран — поэтому пересчитываем
 *   позицию относительно начала виртуального экрана.
 */
function attachToDesktop(browserWindow, physicalBounds) {
  if (process.platform !== 'win32') return false
  try {
    const f = loadUser32()
    const hwndBuf = browserWindow.getNativeWindowHandle()
    // HWND из буфера (little-endian, 64-бит)
    const hwnd =
      hwndBuf.length >= 8 ? Number(hwndBuf.readBigUInt64LE(0)) : hwndBuf.readUInt32LE(0)

    const progman = f.FindWindowW('Progman', null)
    if (!progman) return false

    // Просим Windows создать WorkerW
    const result = [0]
    f.SendMessageTimeoutW(progman, 0x052c, 0, 0, 0x0000, 1000, result)

    // Ищем WorkerW, который является соседом окна с SHELLDLL_DefView
    let workerw = 0
    const cb = f.koffi.register((topHwnd) => {
      const shellView = f.FindWindowExW(topHwnd, 0, 'SHELLDLL_DefView', null)
      if (shellView) {
        // Нужный WorkerW — следующий за этим окном верхнего уровня
        workerw = f.FindWindowExW(0, topHwnd, 'WorkerW', null)
      }
      return true
    }, f.koffi.pointer(f.koffi.proto('__stdcall', 'EnumWindowsProc2', 'bool', ['intptr', 'intptr'])))

    f.EnumWindows(cb, 0)
    f.koffi.unregister(cb)

    // На Windows 11 24H2 иногда SHELLDLL_DefView находится прямо в Progman,
    // тогда родителем можно сделать сам Progman
    const target = workerw || progman
    f.SetParent(hwnd, target)

    if (physicalBounds) {
      // SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77 — начало виртуального экрана
      const vx = f.GetSystemMetrics(76)
      const vy = f.GetSystemMetrics(77)
      f.MoveWindow(
        hwnd,
        physicalBounds.x - vx,
        physicalBounds.y - vy,
        physicalBounds.width,
        physicalBounds.height,
        true
      )
    }
    return true
  } catch (err) {
    console.error('[wallpaper] attachToDesktop error:', err)
    return false
  }
}

/** true, если окно переднего плана развёрнуто на весь экран (maximized). */
function isForegroundMaximized() {
  if (process.platform !== 'win32') return false
  try {
    const f = loadUser32()
    const fg = f.GetForegroundWindow()
    if (!fg || fg === f.GetShellWindow()) return false
    return !!f.IsZoomed(fg)
  } catch (_) {
    return false
  }
}

/** Обновляет рабочий стол после отсоединения обоев (перерисовывает фон). */
function refreshDesktop() {
  if (process.platform !== 'win32') return
  try {
    const f = loadUser32()
    // SPI_SETDESKWALLPAPER с текущими обоями = перерисовка
    f.SystemParametersInfoW(0x0014, 0, 0, 0x01 | 0x02)
  } catch (_) {
    /* не критично */
  }
}

module.exports = { attachToDesktop, refreshDesktop, loadUser32, isForegroundMaximized }
