// Логика панели управления. Общается с главным процессом через window.api.

let state = null

const $ = (id) => document.getElementById(id)

// ---------- Рендер ----------
function render() {
  if (!state) return

  // Бейдж статуса и главная кнопка
  const badge = $('status-badge')
  const statusText = $('status-text')
  const toggleBtn = $('btn-toggle-wallpaper')
  if (state.wallpaperActive && state.pausedByFullscreen) {
    statusText.textContent = 'Пауза (полный экран)'
    badge.className = 'badge badge-paused'
  } else if (state.wallpaperActive) {
    statusText.textContent = 'Обои включены'
    badge.className = 'badge badge-on'
  } else {
    statusText.textContent = 'Обои выключены'
    badge.className = 'badge badge-off'
  }
  toggleBtn.textContent = state.wallpaperActive ? 'Остановить обои' : 'Запустить обои'

  // Предупреждение о платформе
  $('platform-warning').classList.toggle('hidden', state.platformSupported)

  // Список клипов
  renderClips()

  // Режим воспроизведения
  const s = state.settings
  for (const radio of document.querySelectorAll('input[name="playback-mode"]')) {
    radio.checked = radio.value === s.playbackMode
  }
  $('interval-row').classList.toggle('hidden', s.playbackMode !== 'timer')
  $('interval').value = s.playlistIntervalSec

  // Настройки
  $('volume').value = Math.round(s.volume * 100)
  $('volume-label').textContent = s.muted ? 'выкл' : `${Math.round(s.volume * 100)}%`
  $('btn-mute').textContent = s.muted ? 'Вкл. звук' : 'Выкл. звук'
  $('pause-fullscreen').checked = s.pauseOnFullscreen
  $('autostart').checked = s.autostart
  $('auto-resume').checked = s.autoResume
}

function renderClips() {
  const list = $('clip-list')
  list.innerHTML = ''
  $('empty-hint').classList.toggle('hidden', state.clips.length > 0)

  state.clips.forEach((clip, i) => {
    const isActive = clip.id === state.settings.activeClipId && state.wallpaperActive
    const li = document.createElement('li')
    li.className = 'clip' + (isActive ? ' active' : '')

    const order = document.createElement('span')
    order.className = 'clip-order'
    order.textContent = String(i + 1)
    li.appendChild(order)

    const info = document.createElement('div')
    info.className = 'clip-info'

    if (isActive) {
      const now = document.createElement('div')
      now.className = 'clip-now'
      now.textContent = 'Сейчас на рабочем столе'
      info.appendChild(now)
    }

    const title = document.createElement('div')
    title.className = 'clip-title'
    title.textContent = clip.title || clip.url
    info.appendChild(title)

    const meta = document.createElement('div')
    meta.className = 'clip-meta'
    const range =
      clip.start || clip.end
        ? `отрезок ${clip.start || '0:00'} – ${clip.end || 'конец'}`
        : 'всё видео'
    if (clip.status === 'downloading') {
      meta.textContent = `Загрузка ${Math.round(clip.progress || 0)}% · ${range}`
      const bar = document.createElement('div')
      bar.className = 'progress'
      const fill = document.createElement('div')
      fill.className = 'progress-fill'
      fill.style.width = `${clip.progress || 0}%`
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

    if (clip.status === 'ready' && !isActive) {
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
  })
}

// ---------- Форма добавления ----------
function showFormError(msg) {
  const el = $('form-error')
  el.textContent = msg || ''
  el.classList.toggle('hidden', !msg)
}

for (const radio of document.querySelectorAll('input[name="range-mode"]')) {
  radio.addEventListener('change', () => {
    const isClip = document.querySelector('input[name="range-mode"]:checked').value === 'clip'
    $('timecodes').classList.toggle('hidden', !isClip)
    if (!isClip) {
      $('start').value = ''
      $('end').value = ''
    }
  })
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  showFormError(null)
  const url = $('url').value.trim()
  if (!url) return

  const isClip = document.querySelector('input[name="range-mode"]:checked').value === 'clip'
  const result = await window.api.addClip({
    url,
    start: isClip ? $('start').value.trim() : '',
    end: isClip ? $('end').value.trim() : '',
  })

  if (result && result.error) {
    showFormError(result.error)
    return
  }
  $('url').value = ''
  $('start').value = ''
  $('end').value = ''
})

// ---------- Управление ----------
$('btn-toggle-wallpaper').addEventListener('click', async () => {
  if (state.wallpaperActive) await window.api.stopWallpaper()
  else await window.api.startWallpaper()
})

for (const radio of document.querySelectorAll('input[name="playback-mode"]')) {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) window.api.setSettings({ playbackMode: e.target.value })
  })
}

$('volume').addEventListener('input', (e) => {
  window.api.setSettings({ volume: Number(e.target.value) / 100, muted: false })
})

$('btn-mute').addEventListener('click', () => {
  window.api.setSettings({ muted: !state.settings.muted })
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
