// Мок window.api для просмотра панели в обычном браузере (вне Electron).
// В Electron этот файл не подключается — preload.js предоставляет настоящий api.
if (!window.api) {
  const mockState = {
    clips: [
      {
        id: '1',
        url: 'https://www.youtube.com/watch?v=aaa',
        title: 'Cyberpunk: Edgerunners — Ночной город под дождём [4K]',
        start: '',
        end: '',
        source: 'youtube',
        status: 'ready',
        progress: 100,
        thumbPath: null,
      },
      {
        id: '2',
        url: 'https://www.youtube.com/watch?v=bbb',
        title: 'Ghibli Vibes — поезд над морем (lofi loop)',
        start: '1:20',
        end: '2:45',
        source: 'youtube',
        status: 'ready',
        progress: 100,
        thumbPath: null,
      },
      {
        id: '3',
        url: 'C:\\Users\\me\\Videos\\my-anime-loop.mp4',
        title: 'my-anime-loop.mp4',
        start: '',
        end: '',
        source: 'local',
        status: 'ready',
        progress: 100,
        thumbPath: null,
      },
      {
        id: '4',
        url: 'https://www.youtube.com/watch?v=ccc',
        title: 'Attack on Titan Final Season OST',
        start: '',
        end: '',
        source: 'youtube',
        status: 'downloading',
        progress: 47,
        thumbPath: null,
      },
    ],
    settings: {
      volume: 0.3,
      muted: false,
      playbackMode: 'sequence',
      playlistIntervalSec: 300,
      pauseOnFullscreen: true,
      pauseWhenCovered: false,
      pauseOnBattery: false,
      targetDisplay: 'primary',
      autostart: false,
      autoResume: true,
      activeClipId: '1',
      theme: 'night',
    },
    wallpaperActive: true,
    pausedByFullscreen: false,
    pausedByBattery: false,
    displays: [
      { id: '100', label: 'Монитор 1 (3840×2160) — основной', primary: true },
      { id: '101', label: 'Монитор 2 (2560×1440)', primary: false },
    ],
    platformSupported: true,
    setup: null, // поставь { label: 'Загрузчик видео (yt-dlp)', percent: 42, error: null } для проверки оверлея
  }
  window.api = {
    getState: () => Promise.resolve(mockState),
    retrySetup: () => Promise.resolve(mockState),
    addClip: () => Promise.resolve({ clip: {} }),
    addLocalFile: () => Promise.resolve({ clip: {} }),
    removeClip: () => Promise.resolve(true),
    playClip: () => Promise.resolve(true),
    startWallpaper: () => Promise.resolve(true),
    stopWallpaper: () => Promise.resolve(true),
    nextClip: () => Promise.resolve(true),
    updateYtDlp: () => Promise.resolve({ ok: true, message: 'yt-dlp уже последней версии' }),
    setSettings: (patch) => {
      Object.assign(mockState.settings, patch || {})
      return Promise.resolve(mockState.settings)
    },
    onStateUpdate: () => () => {},
  }
}
