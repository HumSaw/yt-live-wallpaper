// Панель управления. Всё общение с main-процессом идёт через window.api (см. preload.js).

let state = null

const $ = (id) => document.getElementById(id)

function applyTheme() {
  const theme = state?.settings?.theme || 'night'
  document.documentElement.dataset.theme = theme
  $('theme-toggle-label').textContent = theme === 'day' ? 'Ночь' : 'День'
}

function render() {
  if (!state) return

  applyTheme()

  const badge = $('status-badge')
  const statusText = $('status-text')
  const toggleBtn = $('btn-toggle-wallpaper')

  if (state.wallpaperActive && state.pausedByBattery) {
    statusText.textContent = 'Пауза (батарея)'
    badge.className = 'badge badge-paused'
  } else if (state.wallpaperActive && state.pausedByFullscreen) {
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

  $('platform-warning').classList.toggle('hidden', state.platformSupported)

  renderClips()
  renderDisplays()

  const s = state.settings
  for (const radio of document.querySelectorAll('input[name="playback-mode"]')) {
    radio.checked = radio.value === s.playbackMode
  }
  $('interval-row').classList.toggle('hidden', s.playbackMode !== 'timer')
  $('interval').value = s.playlistIntervalSec

  $('volume').value = Math.round(s.volume * 100)
  $('volume-label').textContent = s.muted ? 'выкл' : `${Math.round(s.volume * 100)}%`
  $('btn-mute').textContent = s.muted ? 'Вкл. звук' : 'Выкл. звук'
  $('pause-fullscreen').checked = s.pauseOnFullscreen
  $('pause-covered').checked = !!s.pauseWhenCovered
  $('pause-battery').checked = !!s.pauseOnBattery
  $('autostart').checked = s.autostart
  $('auto-resume').checked = s.autoResume
}

function renderDisplays() {
  const select = $('display-select')
  const displays = state.displays || []
  const s = state.settings
  select.innerHTML = ''

  const optPrimary = document.createElement('option')
  optPrimary.value = 'primary'
  optPrimary.textContent = 'Основной монитор'
  select.appendChild(optPrimary)

  if (displays.length > 1) {
    const optAll = document.createElement('option')
    optAll.value = 'all'
    optAll.textContent = 'Все мониторы'
    select.appendChild(optAll)

    for (const d of displays) {
      const opt = document.createElement('option')
      opt.value = d.id
      opt.textContent = d.label
      select.appendChild(opt)
    }
  }

  select.value = ['primary', 'all'].includes(s.targetDisplay)
    ? s.targetDisplay
    : displays.some((d) => d.id === String(s.targetDisplay))
      ? String(s.targetDisplay)
      : 'primary'
  select.disabled = displays.length <= 1
}

function fileUrl(p) {
  return 'file:///' + String(p).replace(/\\/g, '/')
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
    order.textContent = String(i + 1).padStart(2, '0')
    li.appendChild(order)

    const thumbWrap = document.createElement('div')
    thumbWrap.className = 'clip-thumb'
    if (clip.thumbPath) {
      const img = document.createElement('img')
      img.src = fileUrl(clip.thumbPath)
      img.alt = ''
      thumbWrap.appendChild(img)
    } else {
      thumbWrap.classList.add('clip-thumb-empty')
      thumbWrap.textContent = clip.status === 'downloading' ? '…' : '▶'
    }
    li.appendChild(thumbWrap)

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
    const sourceLabel = clip.source === 'local' ? 'локальный файл' : null
    const range =
      clip.start || clip.end
        ? `отрезок ${clip.start || '0:00'} – ${clip.end || 'конец'}`
        : 'всё видео'
    const metaParts = [sourceLabel, range].filter(Boolean).join(' · ')

    if (clip.status === 'downloading') {
      meta.textContent = `Загрузка ${Math.round(clip.progress || 0)}% · ${metaParts}`
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
      meta.textContent = `Готов · ${metaParts}`
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

function showFormError(msg) {
  const el = $('form-error')
  el.textContent = msg || ''
  el.classList.toggle('hidden', !msg)
}

// переключатель «всё видео / отрезок»
for (const radio of document.querySelectorAll('input[name="range-mode"]')) {
  radio.addEventListener('change', () => {
    const isClip = document.querySelector('input[name="range-mode"]:checked').value === 'clip'
    $('timecodes').classList.toggle('hidden', !isClip)
    $('timecode-hint').classList.toggle('hidden', !isClip)
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

// drag&drop своих видеофайлов
const dropZone = $('drop-zone')

for (const evt of ['dragenter', 'dragover']) {
  document.addEventListener(evt, (e) => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })
}
for (const evt of ['dragleave', 'drop']) {
  document.addEventListener(evt, (e) => {
    e.preventDefault()
    if (evt === 'dragleave' && e.relatedTarget) return
    dropZone.classList.remove('drag-over')
  })
}
document.addEventListener('drop', async (e) => {
  e.preventDefault()
  showFormError(null)
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length === 0) return
  for (const file of files) {
    const result = await window.api.addLocalFile(file)
    if (result && result.error) showFormError(result.error)
  }
})

$('btn-toggle-wallpaper').addEventListener('click', async () => {
  if (state.wallpaperActive) await window.api.stopWallpaper()
  else await window.api.startWallpaper()
})

$('btn-theme').addEventListener('click', () => {
  const next = (state?.settings?.theme || 'night') === 'night' ? 'day' : 'night'
  // мгновенный отклик, не дожидаясь ответа main-процесса
  if (state) state.settings.theme = next
  applyTheme()
  window.api.setSettings({ theme: next })
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

$('display-select').addEventListener('change', (e) => {
  window.api.setSettings({ targetDisplay: e.target.value })
})

$('pause-fullscreen').addEventListener('change', (e) => {
  window.api.setSettings({ pauseOnFullscreen: e.target.checked })
})

$('pause-covered').addEventListener('change', (e) => {
  window.api.setSettings({ pauseWhenCovered: e.target.checked })
})

$('pause-battery').addEventListener('change', (e) => {
  window.api.setSettings({ pauseOnBattery: e.target.checked })
})

$('autostart').addEventListener('change', (e) => {
  window.api.setSettings({ autostart: e.target.checked })
})

$('auto-resume').addEventListener('change', (e) => {
  window.api.setSettings({ autoResume: e.target.checked })
})

$('btn-update-ytdlp').addEventListener('click', async () => {
  const btn = $('btn-update-ytdlp')
  const status = $('ytdlp-status')
  btn.disabled = true
  status.textContent = 'Обновляю...'
  status.className = 'ytdlp-status'
  const result = await window.api.updateYtDlp()
  status.textContent = result.message
  status.className = 'ytdlp-status ' + (result.ok ? 'ok' : 'error')
  btn.disabled = false
})

window.api.onStateUpdate((s) => {
  state = s
  render()
})

window.api.getState().then((s) => {
  state = s
  render()
})
