// Поиск и автозагрузка yt-dlp/ffmpeg.
// Порядок поиска: bin/ проекта (dev) -> resources/bin (собранное приложение)
// -> userData/bin (скачано при первом запуске) -> PATH.
// Если бинарников нет — качаем их в userData/bin с прогрессом для UI.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const IS_WIN = process.platform === 'win32'

const YTDLP_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
const FFMPEG_ZIP_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'

let userBinDir = null

function init(userDataDir) {
  userBinDir = path.join(userDataDir, 'bin')
}

function exeName(name) {
  return IS_WIN ? `${name}.exe` : name
}

function searchDirs() {
  const dirs = [path.join(__dirname, '..', '..', 'bin')]
  if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'bin'))
  if (userBinDir) dirs.push(userBinDir)
  return dirs
}

function findBin(name) {
  const exe = exeName(name)
  for (const dir of searchDirs()) {
    const p = path.join(dir, exe)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Путь к бинарнику или голое имя (расчёт на PATH). */
function binPath(name) {
  return findBin(name) || name
}

/** Папка с ffmpeg.exe (нужна yt-dlp для --ffmpeg-location) или null. */
function ffmpegDir() {
  const p = findBin('ffmpeg')
  return p ? path.dirname(p) : null
}

function checkInPath(name) {
  return new Promise((resolve) => {
    const proc = spawn(exeName(name), ['-version'], { windowsHide: true })
    proc.on('error', () => resolve(false))
    proc.on('close', (code) => resolve(code === 0))
  })
}

/** Что отсутствует: массив из 'yt-dlp' и/или 'ffmpeg' (пустой = всё на месте). */
async function missingBinaries() {
  const missing = []
  if (!findBin('yt-dlp') && !(await checkInPath('yt-dlp'))) missing.push('yt-dlp')
  if (!findBin('ffmpeg') && !(await checkInPath('ffmpeg'))) missing.push('ffmpeg')
  return missing
}

async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} при скачивании ${url}`)

  const total = Number(res.headers.get('content-length')) || 0
  const tmp = dest + '.part'
  const out = fs.createWriteStream(tmp)
  let received = 0

  for await (const chunk of res.body) {
    received += chunk.length
    out.write(chunk)
    if (total && onProgress) onProgress(Math.round((received / total) * 100))
  }
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()))
  })
  fs.renameSync(tmp, dest)
}

function extractFfmpegZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(destDir, 'ffmpeg-tmp')
    const proc = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force`,
      ],
      { windowsHide: true }
    )
    proc.on('error', reject)
    proc.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(`Expand-Archive завершился с кодом ${code}`)
        const inner = fs.readdirSync(tmpDir).find((d) => d.startsWith('ffmpeg'))
        if (!inner) throw new Error('В архиве ffmpeg не найдена ожидаемая папка')
        for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
          fs.copyFileSync(path.join(tmpDir, inner, 'bin', exe), path.join(destDir, exe))
        }
        resolve()
      } catch (err) {
        reject(err)
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
        fs.rmSync(zipPath, { force: true })
      }
    })
  })
}

/**
 * Скачивает недостающие бинарники в userData/bin.
 * onProgress({ step, label, percent }) — для экрана первого запуска.
 */
async function ensureBinaries(onProgress) {
  const missing = await missingBinaries()
  if (missing.length === 0) return { ok: true }

  if (!userBinDir) throw new Error('bin-manager не инициализирован')
  fs.mkdirSync(userBinDir, { recursive: true })

  try {
    if (missing.includes('yt-dlp')) {
      const dest = path.join(userBinDir, exeName('yt-dlp'))
      onProgress?.({ step: 'yt-dlp', label: 'Загрузчик видео (yt-dlp)', percent: 0 })
      await downloadFile(YTDLP_URL, dest, (p) =>
        onProgress?.({ step: 'yt-dlp', label: 'Загрузчик видео (yt-dlp)', percent: p })
      )
      if (!IS_WIN) fs.chmodSync(dest, 0o755)
      onProgress?.({ step: 'yt-dlp', label: 'Загрузчик видео (yt-dlp)', percent: 100 })
    }

    if (missing.includes('ffmpeg')) {
      if (!IS_WIN) {
        // На Linux/macOS ffmpeg ставится пакетным менеджером; авто-установка только на Windows
        return { ok: false, error: 'Установите ffmpeg через пакетный менеджер вашей системы' }
      }
      const zipPath = path.join(userBinDir, 'ffmpeg.zip')
      onProgress?.({ step: 'ffmpeg', label: 'Видеоконвертер (ffmpeg)', percent: 0 })
      await downloadFile(FFMPEG_ZIP_URL, zipPath, (p) =>
        // распаковка займёт ещё немного, держим полосу до 95%
        onProgress?.({ step: 'ffmpeg', label: 'Видеоконвертер (ffmpeg)', percent: Math.min(95, p) })
      )
      onProgress?.({ step: 'ffmpeg', label: 'Распаковка ffmpeg…', percent: 97 })
      await extractFfmpegZip(zipPath, userBinDir)
      onProgress?.({ step: 'ffmpeg', label: 'Видеоконвертер (ffmpeg)', percent: 100 })
    }

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error:
        'Не удалось скачать компоненты: ' +
        (err.message || err) +
        '. Проверьте интернет и перезапустите приложение.',
    }
  }
}

module.exports = { init, binPath, ffmpegDir, missingBinaries, ensureBinaries }
