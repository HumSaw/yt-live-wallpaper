// Логика панели управления. Общается с главным процессом через window.api.

let state = null

const $ = (id) => document.getElementById(id)

// ---------- Рендер ----------
function render() {
  if (!state) return

  // Бейдж статуса и кнопка
  const badge = $('status-badge')
  const toggleBtn = $('btn-toggle-wallpaper')
  if (state.wallpaperActive && state.pausedByFullscreen) {
    badge.textContent = 'Пауза (полный экран)'
    badge.className = 'badge badge-paused'
  } else if (state.wallpaperActive) {
    badge.textContent = 'Обои включены'
    badge.className = 'badge badge-on'
  } else {
    badge.textContent = 'Обои выключены'
    badge.className = 'badge badge-off'
  }
  toggleBtn.textContent = state.wallpaperActive ? 'Остановить обои' : 'Запустить обои'

  // Предупреждение о платформе
  $('platform-warning').classList.toggle('hidden', state.platformSupported)

  // Список клипов
  const list = $('clip-list')
  list.innerHTML = ''
  $('empty-hint').classList.toggle('hidden', state.clips.length > 0)

  for (const clip of state.clips) {
    const li = document.createElement('li')
    li.className = 'clip' + (clip.id === state.settings.activeClipId && state.wallpaperActive ? ' active' : '')

    const info = document.createElement('div')
    info.className = 'clip-info'

    const title = document.createElement('div')
    title.className = 'clip-title'
    title.textContent = clip.url
    info.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'clip-meta'
    const range =
      clip.start || clip.end
        ? `${clip.start || '0:00'} – ${clip.end || 'конец'}`
        : 'всё видео'
    if (clip.status === 'downloading') {
      meta.textContent = `Загрузка ${Math.round(clip.progress)}% · ${range}`
      const bar = document.createElement('div')
      bar.className = 'progress'
      const fill = document.createElement('div')
      fill.className = 'progress-fill'
      fill.style.width = `${clip.progress}%`
      bar.appendChild(fill)
      info.appendChild(meta)
      info.appendChild(bar)
    } else if (clip.status === 'error') {
      meta.textContent = `Ошибка: ${clip.error}`
      meta.className = 'clip-meta error'
      info.appendChild(meta)
    } else {
      meta.textContent = `Готов · ${range}`
      info.appendChild(meta)
    }

    const actions = document.createElement('div')
    actions.className = 'clip-actions'

    if (clip.status === 'ready') {
      const playBtn = document.createElement('button')
      playBtn.className = 'btn btn-small'
      playBtn.textContent = 'Поставить'
      playBtn.addEventListener('click', () => window.api.playClip(clip.id))
      actions.appendChild(playBtn)
    }

    const removeBtn = document.createElement('button')
    removeBtn.className = 'btn btn-small btn-ghost btn-danger'
    removeBtn.textContent = 'Удалить'
    removeBtn.addEventListener('click', () => window.api.removeClip(clip.id))
    actions.appendChild(removeBtn)

    li.appendChild(info)
    li.appendChild(actions)
    list.appendChild(li)
  }

  // Настройки
  const s = state.settings
  $('volume').value = Math.round(s.volume * 100)
  $('volume-label').textContent = s.muted ? 'выкл' : `${Math.round(s.volume * 100)}%`
  $('btn-mute').textContent = s.muted ? 'Вкл. звук' : 'Выкл. звук'
  $('playlist-mode').checked = s.playlistMode
  $('interval').value = s.playlistIntervalSec
  $('pause-fullscreen').checked = s.pauseOnFullscreen
  $('autostart').checked = s.autostart
  $('auto-resume').checked = s.autoResume
}

// ---------- События ----------
$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const url = $('url').value.trim()
  if (!url) return
  await window.api.addClip({
    url,
    start: $('start').value.trim(),
    end: $('end').value.trim(),
  })
  $('url').value = ''
  $('start').value = ''
  $('end').value = ''
})

$('btn-toggle-wallpaper').addEventListener('click', async () => {
  if (state.wallpaperActive) await window.api.stopWallpaper()
  else await window.api.startWallpaper()
})

$('volume').addEventListener('input', (e) => {
  window.api.setSettings({ volume: Number(e.target.value) / 100, muted: false })
})

$('btn-mute').addEventListener('click', () => {
  window.api.setSettings({ muted: !state.settings.muted })
})

$('playlist-mode').addEventListener('change', (e) => {
  window.api.setSettings({ playlistMode: e.target.checked })
})

$('interval').addEventListener('change', (e) => {
  const v = Math.max(10, Number(e.target.value) || 300)
  window.api.setSettings({ playlistIntervalSec: v })
})

$('pause-fullscreen').addEventListener('change', (e) => {
  window.api.setSettings({ pauseOnFullscreen: e.target.checked })
})

$('autostart').addEventListener('change', (e) => {
  window.api.setSettings({ autostart: e.target.checked })
})

$('auto-resume').addEventListener('change', (e) => {
  window.api.setSettings({ autoResume: e.target.checked })
})

// ---------- Инициализация ----------
window.api.onStateUpdate((s) => {
  state = s
  render()
})

window.api.getState().then((s) => {
  state = s
  render()
})
