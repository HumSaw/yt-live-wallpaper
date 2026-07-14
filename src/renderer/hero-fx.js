// Анимация «аниме-боя» в шапке: скоростные линии, дуги ударов клинков,
// искры и вспышки столкновений. Рисуется на canvas поверх арта.
// Палитры разные для ночной и дневной темы. Уважает prefers-reduced-motion.

;(() => {
  const canvas = document.getElementById('hero-fx')
  if (!canvas) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) return

  const ctx = canvas.getContext('2d')
  let w = 0
  let h = 0
  let dpr = 1
  let raf = null
  let running = false

  const PALETTES = {
    night: {
      speedLines: 'rgba(85, 230, 255, 0.55)',
      speedLines2: 'rgba(255, 77, 141, 0.5)',
      slash: '#ff4d8d',
      slashCore: '#ffe3ee',
      slash2: '#55e6ff',
      slash2Core: '#e8fbff',
      spark: ['#ff4d8d', '#55e6ff', '#ffffff'],
      flash: 'rgba(255, 255, 255, 0.85)',
    },
    day: {
      speedLines: 'rgba(255, 255, 255, 0.75)',
      speedLines2: 'rgba(255, 176, 59, 0.65)',
      slash: '#f4762c',
      slashCore: '#fff3e0',
      slash2: '#4aa3ff',
      slash2Core: '#eaf5ff',
      spark: ['#f4762c', '#ffd166', '#ffffff'],
      flash: 'rgba(255, 250, 235, 0.9)',
    },
  }

  let palette = PALETTES.night

  function setTheme(theme) {
    palette = PALETTES[theme] || PALETTES.night
  }

  // следим за data-theme на <html>
  new MutationObserver(() => {
    setTheme(document.documentElement.dataset.theme || 'night')
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  setTheme(document.documentElement.dataset.theme || 'night')

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = rect.width
    h = rect.height
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const rand = (a, b) => a + Math.random() * (b - a)

  // скоростные линии, летящие по горизонтали
  const lines = []
  function spawnLine() {
    const fromLeft = Math.random() < 0.5
    lines.push({
      x: fromLeft ? -60 : w + 60,
      y: rand(0, h),
      len: rand(40, 160),
      speed: rand(14, 30) * (fromLeft ? 1 : -1),
      width: rand(0.5, 1.8),
      alt: Math.random() < 0.35,
      life: 1,
    })
  }

  // дуга удара клинком
  const slashes = []
  function spawnSlash() {
    const cx = rand(w * 0.2, w * 0.8)
    const cy = rand(h * 0.15, h * 0.7)
    slashes.push({
      cx,
      cy,
      r: rand(30, 90),
      a0: rand(0, Math.PI * 2),
      sweep: rand(1.6, 2.6) * (Math.random() < 0.5 ? 1 : -1),
      t: 0,
      dur: rand(14, 20),
      alt: Math.random() < 0.5,
    })
    // искры из точки удара
    const sparkCount = 6 + Math.floor(Math.random() * 8)
    for (let i = 0; i < sparkCount; i++) {
      const ang = rand(0, Math.PI * 2)
      const v = rand(2, 7)
      sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * v,
        vy: Math.sin(ang) * v - 1.5,
        life: 1,
        decay: rand(0.02, 0.05),
        size: rand(1, 2.5),
        color: palette.spark[Math.floor(Math.random() * palette.spark.length)],
      })
    }
    // редкая вспышка столкновения
    if (Math.random() < 0.3) {
      flashes.push({ x: cx, y: cy, r: rand(20, 46), life: 1 })
    }
  }

  const sparks = []
  const flashes = []

  let frame = 0
  function tick() {
    if (!running) return
    frame++
    ctx.clearRect(0, 0, w, h)

    if (frame % 3 === 0 && lines.length < 26) spawnLine()
    if (frame % 50 === 0 || (Math.random() < 0.012 && slashes.length < 3)) spawnSlash()

    // скоростные линии
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      l.x += l.speed
      if (l.x < -220 || l.x > w + 220) {
        lines.splice(i, 1)
        continue
      }
      ctx.strokeStyle = l.alt ? palette.speedLines2 : palette.speedLines
      ctx.globalAlpha = 0.7
      ctx.lineWidth = l.width
      ctx.beginPath()
      ctx.moveTo(l.x, l.y)
      ctx.lineTo(l.x - l.len * Math.sign(l.speed), l.y)
      ctx.stroke()
    }

    // дуги ударов: рисуются быстро, гаснут медленно
    for (let i = slashes.length - 1; i >= 0; i--) {
      const s = slashes[i]
      s.t++
      const progress = Math.min(1, s.t / s.dur)
      const fade = s.t > s.dur ? 1 - (s.t - s.dur) / 12 : 1
      if (fade <= 0) {
        slashes.splice(i, 1)
        continue
      }
      const a1 = s.a0 + s.sweep * progress
      ctx.globalAlpha = fade * 0.9
      // внешняя цветная дуга
      ctx.strokeStyle = s.alt ? palette.slash2 : palette.slash
      ctx.lineWidth = 5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.r, s.a0, a1, s.sweep < 0)
      ctx.stroke()
      // яркое ядро
      ctx.strokeStyle = s.alt ? palette.slash2Core : palette.slashCore
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(s.cx, s.cy, s.r, s.a0, a1, s.sweep < 0)
      ctx.stroke()
    }

    // искры
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i]
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.15
      p.life -= p.decay
      if (p.life <= 0) {
        sparks.splice(i, 1)
        continue
      }
      ctx.globalAlpha = p.life
      ctx.fillStyle = p.color
      ctx.fillRect(p.x, p.y, p.size, p.size)
    }

    // вспышки столкновений
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]
      f.life -= 0.08
      if (f.life <= 0) {
        flashes.splice(i, 1)
        continue
      }
      const r = f.r * (1.4 - f.life * 0.4)
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
      grad.addColorStop(0, palette.flash)
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.globalAlpha = f.life * 0.8
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    raf = requestAnimationFrame(tick)
  }

  function start() {
    if (running) return
    running = true
    resize()
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
  }

  // не жжём CPU, когда окно скрыто
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else start()
  })
  window.addEventListener('resize', resize)

  start()
})()
