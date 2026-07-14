// Скачивание YouTube-видео (целиком или отрезком) через yt-dlp (+ ffmpeg).
// Бинарники ожидаются в папке bin/ (кладутся скриптом `npm run setup`) либо в PATH.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

let videosDir = null

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

function init(userDataDir) {
  videosDir = path.join(userDataDir, 'videos')
  fs.mkdirSync(videosDir, { recursive: true })
}

/**
 * Валидация ссылки: только http(s) и только YouTube-домены.
 * Защита от передачи произвольных аргументов/протоколов в yt-dlp.
 */
function validateUrl(url) {
  let u
  try {
    u = new URL(String(url))
  } catch (_) {
    return 'Некорректная ссылка'
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return 'Поддерживаются только http/https ссылки'
  }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) {
    return 'Поддерживаются только ссылки на YouTube'
  }
  return null
}

function binPath(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const local = path.join(__dirname, '..', '..', 'bin', exe)
  if (fs.existsSync(local)) return local
  return name // надеемся на PATH
}

function ffmpegDir() {
  const dir = path.join(__dirname, '..', '..', 'bin')
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return fs.existsSync(path.join(dir, exe)) ? dir : null
}

/** "1:23" | "01:02:03" | "83" -> секунды */
function parseTime(t) {
  if (t == null || t === '') return null
  const s = String(t).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s)
  const parts = s.split(':').map(Number)
  if (parts.some(isNaN) || parts.length > 3) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/**
 * Асинхронно получает название видео (не блокирует загрузку).
 * @returns {Promise<string|null>}
 */
function fetchTitle(url) {
  return new Promise((resolve) => {
    const proc = spawn(
      binPath('yt-dlp'),
      ['--no-download', '--no-playlist', '--print', 'title', '--', url],
      { windowsHide: true }
    )
    let out = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => {
      const title = out.trim().split('\n')[0]
      resolve(code === 0 && title ? title : null)
    })
  })
}

/**
 * Скачивает видео (целиком или отрезок) в максимальном качестве до 4K.
 * @returns {Promise<string>} путь к готовому mp4
 */
function downloadClip(clip, onProgress) {
  return new Promise((resolve, reject) => {
    const startSec = parseTime(clip.start)
    const endSec = parseTime(clip.end)

    if (startSec != null && endSec != null && endSec <= startSec) {
      reject(new Error('Конец отрезка должен быть позже начала'))
      return
    }

    const outFile = path.join(videosDir, `${clip.id}.mp4`)

    const args = [
      // до 4K, лучшее видео + аудио, приоритет mp4/h264 для аппаратного декодирования
      '-f',
      'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]',
      '--merge-output-format',
      'mp4',
      '-o',
      outFile,
      '--no-playlist',
      '--newline',
      '--no-mtime',
      '--force-overwrites',
    ]

    // Вырезка отрезка средствами yt-dlp (через ffmpeg). Пустые поля = всё видео.
    if (startSec != null || endSec != null) {
      const s = startSec != null ? startSec : 0
      const e = endSec != null ? endSec : 'inf'
      args.push('--download-sections', `*${s}-${e}`)
      args.push('--force-keyframes-at-cuts') // точная вырезка
    }

    const ffDir = ffmpegDir()
    if (ffDir) args.push('--ffmpeg-location', ffDir)

    // `--` гарантирует, что URL не будет разобран как опция
    args.push('--', clip.url)

    const proc = spawn(binPath('yt-dlp'), args, { windowsHide: true })

    let stderr = ''

    proc.stdout.on('data', (data) => {
      const text = data.toString()
      // Строки прогресса вида: [download]  42.3% of ...
      const m = text.match(/\[download\]\s+([\d.]+)%/)
      if (m) onProgress(Math.min(99, parseFloat(m[1])))
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'yt-dlp не найден. Запустите `npm run setup`, чтобы скачать yt-dlp и ffmpeg в папку bin/.'
          )
        )
      } else {
        reject(err)
      }
    })

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outFile)) {
        resolve(outFile)
      } else {
        const lastLines = stderr.trim().split('\n').slice(-3).join(' | ')
        reject(new Error(lastLines || `yt-dlp завершился с кодом ${code}`))
      }
    })
  })
}

function removeClipFile(clip) {
  if (!clip || !clip.filePath) return
  // Удаляем только файлы из нашей папки videos — защита от удаления чужих файлов
  const resolved = path.resolve(clip.filePath)
  if (!videosDir || !resolved.startsWith(path.resolve(videosDir) + path.sep)) return
  try {
    fs.unlinkSync(resolved)
  } catch (_) {
    /* уже удалён */
  }
}

module.exports = { init, downloadClip, removeClipFile, parseTime, validateUrl, fetchTitle }
