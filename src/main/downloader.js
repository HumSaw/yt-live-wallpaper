// Скачивание отрезков YouTube-видео через yt-dlp (+ ffmpeg для вырезки).
// Бинарники ожидаются в папке bin/ проекта (кладутся скриптом `pnpm setup`)
// либо доступны в PATH.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

let videosDir = null

function init(userDataDir) {
  videosDir = path.join(userDataDir, 'videos')
  fs.mkdirSync(videosDir, { recursive: true })
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
  if (parts.some(isNaN)) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/**
 * Скачивает отрезок видео в максимальном качестве до 4K.
 * @returns {Promise<string>} путь к готовому mp4
 */
function downloadClip(clip, onProgress) {
  return new Promise((resolve, reject) => {
    const startSec = parseTime(clip.start)
    const endSec = parseTime(clip.end)

    const outFile = path.join(videosDir, `${clip.id}.mp4`)

    const args = [
      clip.url,
      // до 4K, лучшее видео + аудио, приоритет mp4/h264 для плавного аппаратного декодирования
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

    // Вырезка отрезка средствами yt-dlp (использует ffmpeg)
    if (startSec != null || endSec != null) {
      const s = startSec != null ? startSec : 0
      const e = endSec != null ? endSec : 'inf'
      args.push('--download-sections', `*${s}-${e}`)
      // точная вырезка по ключевым кадрам
      args.push('--force-keyframes-at-cuts')
    }

    const ffDir = ffmpegDir()
    if (ffDir) args.push('--ffmpeg-location', ffDir)

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
            'yt-dlp не найден. Запустите `pnpm setup` (или `npm run setup`), чтобы скачать yt-dlp и ffmpeg в папку bin/.'
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
  if (clip && clip.filePath) {
    try {
      fs.unlinkSync(clip.filePath)
    } catch (_) {
      /* уже удалён */
    }
  }
}

module.exports = { init, downloadClip, removeClipFile, parseTime }
