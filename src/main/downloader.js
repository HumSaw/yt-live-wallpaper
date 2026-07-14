// Скачивание YouTube-видео (целиком или отрезком) через yt-dlp (+ ffmpeg),
// миниатюры клипов, добавление локальных файлов, обновление yt-dlp.
// Бинарники ожидаются в папке bin/ (кладутся скриптом `npm run setup`) либо в PATH.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

let videosDir = null
let thumbsDir = null

const YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

const LOCAL_VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v'])

function init(userDataDir) {
  videosDir = path.join(userDataDir, 'videos')
  thumbsDir = path.join(userDataDir, 'thumbs')
  fs.mkdirSync(videosDir, { recursive: true })
  fs.mkdirSync(thumbsDir, { recursive: true })
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

/** Проверка локального видеофайла (drag&drop). */
function validateLocalFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'Не удалось получить путь к файлу'
  if (!fs.existsSync(filePath)) return 'Файл не найден'
  const ext = path.extname(filePath).toLowerCase()
  if (!LOCAL_VIDEO_EXT.has(ext)) {
    return `Формат ${ext || '(без расширения)'} не поддерживается. Нужен: mp4, webm, mkv, mov`
  }
  return null
}

function binDirCandidates() {
  const dirs = [path.join(__dirname, '..', '..', 'bin')]
  // В собранном приложении (electron-builder) бинарники лежат в resources/bin
  if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'bin'))
  return dirs
}

function binPath(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  for (const dir of binDirCandidates()) {
    const p = path.join(dir, exe)
    if (fs.existsSync(p)) return p
  }
  return name // надеемся на PATH
}

function ffmpegDir() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  for (const dir of binDirCandidates()) {
    if (fs.existsSync(path.join(dir, exe))) return dir
  }
  return null
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

/** Переводит сырой лог yt-dlp в понятное человеку сообщение. */
function humanizeError(stderr, code) {
  const s = (stderr || '').toLowerCase()
  if (s.includes('private video')) return 'Это приватное видео — его нельзя скачать'
  if (s.includes('video unavailable')) return 'Видео недоступно (удалено или скрыто автором)'
  if (s.includes('sign in to confirm your age') || s.includes('age-restricted'))
    return 'У видео возрастное ограничение — YouTube требует вход в аккаунт'
  if (s.includes('not available in your country') || s.includes('geo restricted') || s.includes('blocked in your'))
    return 'Видео заблокировано для вашего региона'
  if (s.includes('is not a valid url') || s.includes('unsupported url'))
    return 'Ссылка не распознана как видео YouTube'
  if (s.includes('live event') || s.includes('premieres in'))
    return 'Это трансляция или премьера — дождитесь публикации записи'
  if (
    s.includes('unable to extract') ||
    s.includes('http error 403') ||
    s.includes('sig extraction failed') ||
    s.includes('nsig')
  )
    return 'YouTube изменил сайт — обновите yt-dlp кнопкой «Обновить yt-dlp» в настройках'
  if (s.includes('getaddrinfo') || s.includes('network') || s.includes('timed out') || s.includes('connection'))
    return 'Проблема с интернет-соединением — проверьте сеть и попробуйте снова'
  if (s.includes('no space left')) return 'На диске закончилось место'
  const lastLines = (stderr || '').trim().split('\n').slice(-2).join(' | ')
  return lastLines || `yt-dlp завершился с кодом ${code}`
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
 * Вытаскивает кадр из видео для миниатюры плейлиста.
 * @returns {Promise<string|null>} путь к jpg или null (не критично)
 */
function makeThumbnail(videoPath, clipId) {
  return new Promise((resolve) => {
    const ffDir = ffmpegDir()
    const ffmpeg = ffDir
      ? path.join(ffDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      : 'ffmpeg'
    const outFile = path.join(thumbsDir, `${clipId}.jpg`)
    const proc = spawn(
      ffmpeg,
      ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', outFile],
      { windowsHide: true }
    )
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => resolve(code === 0 && fs.existsSync(outFile) ? outFile : null))
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
        reject(new Error(humanizeError(stderr, code)))
      }
    })
  })
}

/** Обновляет yt-dlp до последней версии (yt-dlp -U). */
function updateYtDlp() {
  return new Promise((resolve) => {
    const proc = spawn(binPath('yt-dlp'), ['-U'], { windowsHide: true })
    let out = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (out += d.toString()))
    proc.on('error', (err) => {
      resolve({
        ok: false,
        message:
          err.code === 'ENOENT'
            ? 'yt-dlp не найден — запустите `npm run setup`'
            : String(err.message || err),
      })
    })
    proc.on('close', (code) => {
      const text = out.trim()
      if (code === 0) {
        const upToDate = /is up to date/i.test(text)
        resolve({
          ok: true,
          message: upToDate ? 'yt-dlp уже последней версии' : 'yt-dlp обновлён до последней версии',
        })
      } else {
        resolve({ ok: false, message: 'Не удалось обновить: ' + text.split('\n').slice(-1)[0] })
      }
    })
  })
}

function removeClipFile(clip) {
  if (!clip) return
  // Локальные файлы пользователя не трогаем — удаляем только скачанное нами
  if (clip.filePath && clip.source !== 'local') {
    const resolved = path.resolve(clip.filePath)
    if (videosDir && resolved.startsWith(path.resolve(videosDir) + path.sep)) {
      try {
        fs.unlinkSync(resolved)
      } catch (_) {
        /* уже удалён */
      }
    }
  }
  if (clip.thumbPath) {
    const resolvedThumb = path.resolve(clip.thumbPath)
    if (thumbsDir && resolvedThumb.startsWith(path.resolve(thumbsDir) + path.sep)) {
      try {
        fs.unlinkSync(resolvedThumb)
      } catch (_) {
        /* уже удалён */
      }
    }
  }
}

module.exports = {
  init,
  downloadClip,
  removeClipFile,
  parseTime,
  validateUrl,
  validateLocalFile,
  fetchTitle,
  makeThumbnail,
  updateYtDlp,
}
