# Contributing

Thanks for your interest in the project! / Спасибо за интерес к проекту!

## Dev setup

Requirements: [Node.js](https://nodejs.org) 20+ and pnpm (`corepack enable` or `npm i -g pnpm`).

```bash
git clone https://github.com/HumSaw/yt-live-wallpaper.git
cd yt-live-wallpaper
pnpm install
pnpm setup     # optional: pre-download yt-dlp + ffmpeg into bin/
pnpm start     # launch the app (binaries auto-fetch on first start if you skipped setup)
```

On Windows you can skip the terminal entirely: double-click `run-dev.bat`.

### Working on the panel UI without Electron

Open `src/renderer/index.html` in a regular browser — `dev-mock.js` injects
test data (clips, settings, download progress). In Electron the mock is
inactive and it is excluded from builds. This is the fastest loop for
styling and layout work.

### Testing wallpaper embedding

The desktop embedding (`wallpaper.js` / `wallpaper-mac.js`) can only be tested
on a real OS — there is no emulation. If you change it, state in the PR which
OS and version you verified on (for Windows include the build, e.g. 24H2 —
the desktop layout differs between builds and it matters).

## Checks before a PR

```bash
pnpm lint      # ESLint — must pass with no errors
pnpm test      # unit tests (node --test) — all green
pnpm format    # Prettier — auto-format
```

CI runs lint + tests on every push; a red build won't be merged.

## PR guidelines

- One PR — one logical change
- Describe what changed and why; attach a screenshot for UI changes
- New logic in `store`, `playlist`, `downloader` should come with tests —
  these modules are dependency-injected and test without Electron
- UI strings go through i18n (`src/renderer/i18n.js`) — add a key to all
  10 locales (English fallback is fine for languages you don't speak)

## Bug reports

Please include in the issue:

- OS and version (for Windows — the build, e.g. 23H2/24H2; find it via `winver`)
- App version (Settings → bottom of the panel)
- Steps to reproduce
- Error text from the panel, if any

## Ideas waiting for a hand

See the [Roadmap](README.md#roadmap) — or propose your own in
[Discussions](https://github.com/HumSaw/yt-live-wallpaper/discussions).
