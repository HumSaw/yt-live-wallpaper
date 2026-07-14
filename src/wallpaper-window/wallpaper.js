// Воспроизведение видео-обоев: два слоя для кроссфейда, команды приходят
// из main-процесса через wallpaperApi (preload-wallpaper.js).

const layers = [document.getElementById('video-a'), document.getElementById('video-b')]
let front = 0 // индекс видимого слоя

function activeVideo() {
  return layers[front]
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

/**
 * Windows-путь -> корректный file:// URL.
 * Простая конкатенация ломается на # и ? в именах папок — это легальные
 * символы в путях Windows. Кодируем каждый сегмент, буква диска остаётся как есть.
 */
function toFileUrl(p) {
  const segments = String(p)
    .replace(/\\/g, '/')
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
  return 'file:///' + segments.join('/')
}

window.wallpaperApi.onPlay(({ filePath, volume, loop }) => {
  const src = toFileUrl(filePath)
  const current = layers[front]

  // Тот же файл — просто обновляем loop/громкость, без перезапуска
  if (current.src && current.src === src) {
    current.loop = !!loop
    current.volume = clamp01(volume)
    current.muted = volume === 0
    if (current.paused) current.play().catch(() => {})
    return
  }

  const back = layers[1 - front]
  back.loop = !!loop
  back.volume = clamp01(volume)
  back.muted = volume === 0
  back.src = src

  const swap = () => {
    back.classList.add('visible')
    current.classList.remove('visible')
    // Стараемся освободить память старого слоя после перехода
    setTimeout(() => {
      current.pause()
      current.removeAttribute('src')
      current.load()
    }, 900)
    front = 1 - front
  }

  back.play().then(swap).catch(() => {
    // canplay как запасной вариант (autoplay мог не стартовать мгновенно)
    back.addEventListener('canplay', () => back.play().then(swap).catch(() => {}), { once: true })
  })
})

// В режиме «последовательность» (loop=false) сообщаем главному процессу,
// что видео доиграло — он включит следующий клип в цикле
layers.forEach((v) =>
  v.addEventListener('ended', () => {
    if (v === activeVideo()) window.wallpaperApi.notifyEnded()
  })
)

window.wallpaperApi.onPause(() => activeVideo().pause())
window.wallpaperApi.onResume(() => activeVideo().play().catch(() => {}))
window.wallpaperApi.onVolume((v) => {
  for (const layer of layers) {
    layer.volume = clamp01(v)
    layer.muted = v === 0
  }
})
