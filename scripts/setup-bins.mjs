// Скачивает yt-dlp.exe и ffmpeg.exe в папку bin/ (для Windows).
// Запуск: pnpm setup  (или npm run setup)

import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const binDir = path.join(root, 'bin')
fs.mkdirSync(binDir, { recursive: true })

const isWin = process.platform === 'win32'

async function download(url, dest) {
  console.log(`Скачиваю ${url} ...`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`)
  await pipeline(res.body, fs.createWriteStream(dest))
  console.log(`Сохранено: ${dest}`)
}

// --- yt-dlp ---
const ytDlpName = isWin ? 'yt-dlp.exe' : 'yt-dlp'
const ytDlpPath = path.join(binDir, ytDlpName)
if (!fs.existsSync(ytDlpPath)) {
  const url = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  await download(url, ytDlpPath)
  if (!isWin) fs.chmodSync(ytDlpPath, 0o755)
} else {
  console.log('yt-dlp уже установлен, пропускаю.')
}

// --- ffmpeg (только Windows: берём сборку BtbN) ---
if (isWin) {
  const ffmpegPath = path.join(binDir, 'ffmpeg.exe')
  if (!fs.existsSync(ffmpegPath)) {
    const zipUrl =
      'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
    const zipPath = path.join(binDir, 'ffmpeg.zip')
    await download(zipUrl, zipPath)
    console.log('Распаковываю ffmpeg ...')
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}\\ffmpeg-tmp' -Force"`
    )
    // Находим bin внутри распакованного архива и переносим exe
    const tmp = path.join(binDir, 'ffmpeg-tmp')
    const inner = fs.readdirSync(tmp).find((d) => d.startsWith('ffmpeg'))
    for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
      fs.copyFileSync(path.join(tmp, inner, 'bin', exe), path.join(binDir, exe))
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(zipPath, { force: true })
    console.log('ffmpeg установлен.')
  } else {
    console.log('ffmpeg уже установлен, пропускаю.')
  }
} else {
  console.log('Не Windows: установите ffmpeg через пакетный менеджер, если его нет в PATH.')
}

console.log('\nГотово! Запускайте приложение: pnpm start')
