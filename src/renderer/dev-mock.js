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
        status: 'ready',
        progress: 100,
      },
      {
        id: '2',
        url: 'https://www.youtube.com/watch?v=bbb',
        title: 'Ghibli Vibes — поезд над морем (lofi loop)',
        start: '1:20',
        end: '2:45',
        status: 'ready',
        progress: 100,
      },
      {
        id: '3',
        url: 'https://www.youtube.com/watch?v=ccc',
        title: 'Attack on Titan Final Season OST',
        start: '',
        end: '',
        status: 'downloading',
        progress: 47,
      },
    ],
    settings: {
      volume: 0.3,
      muted: false,
      playbackMode: 'sequence',
      playlistIntervalSec: 300,
      pauseOnFullscreen: true,
      autostart: false,
      autoResume: true,
      activeClipId: '1',
    },
    wallpaperActive: true,
    pausedByFullscreen: false,
    platformSupported: true,
  }
  window.api = {
    getState: () => Promise.resolve(mockState),
    addClip: () => Promise.resolve({ clip: {} }),
    removeClip: () => Promise.resolve(true),
    playClip: () => Promise.resolve(true),
    startWallpaper: () => Promise.resolve(true),
    stopWallpaper: () => Promise.resolve(true),
    nextClip: () => Promise.resolve(true),
    setSettings: () => Promise.resolve(mockState.settings),
    onStateUpdate: () => () => {},
  }
}
