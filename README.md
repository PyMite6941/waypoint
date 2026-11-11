# Waypoint

Slides you can present in order, or steer. Arrow keys and clickers work as they do everywhere else; you can also jump to any slide mid-talk and step back to where you were.

- **Use it in a browser:** https://pymite6941.github.io/waypoint/
- **Guide:** https://pymite6941.github.io/waypoint/docs/

## Run it

| How | What to do |
| --- | --- |
| In a browser, any device | Open https://pymite6941.github.io/waypoint/. Nothing to install. It keeps working offline after the first visit, and Chrome, Edge and phones offer "Install" to add it as an app |
| Desktop app | Run the install command for your system below, or download from [Releases](https://github.com/PyMite6941/waypoint/releases/latest) |
| From source | `git clone https://github.com/PyMite6941/waypoint && cd waypoint && npm install && npm run desktop` (needs Node.js 20 or newer) |

### Install the desktop app

**Windows** (PowerShell):

```powershell
curl.exe -L -o "$env:TEMP\Waypoint-Setup.exe" https://github.com/PyMite6941/waypoint/releases/latest/download/Waypoint-Setup.exe; & "$env:TEMP\Waypoint-Setup.exe"
```

**Linux** (x86-64 and ARM64, including Raspberry Pi):

```sh
curl -L -o Waypoint.AppImage "https://github.com/PyMite6941/waypoint/releases/latest/download/Waypoint-$(uname -m | sed s/aarch64/arm64/).AppImage"
chmod +x Waypoint.AppImage
./Waypoint.AppImage
```

If the AppImage complains about FUSE, either install it (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04 and newer) or run `./Waypoint.AppImage --appimage-extract-and-run`.

**macOS:** download `Waypoint-arm64.dmg` from [Releases](https://github.com/PyMite6941/waypoint/releases/latest), open it and drag the app to Applications.

The installers are not code-signed yet. If Windows shows a SmartScreen prompt, choose More info, then Run anyway; on macOS, right-click the app and choose Open the first time.

## What it does

- Free-form slides: text, boxes, circles and images you drag and resize, with alignment guides and four themes
- Present in order with arrows, Space, Page Up/Down or a clicker
- Jump anywhere: type a slide number, open the grid with G, or click a linked item on the slide
- Backspace returns to the slide you were on before the jump
- Per-slide "next choices" for talks that branch
- Presenter view in a second window: current and next slide, notes, timer, and a clickable picker that drives the audience screen
- Undo and redo, autosave, `.waypoint.json` files, PDF export

## Develop

Needs Node.js 20 or newer.

```sh
npm install
npm run dev          # web app with live reload, http://localhost:5173
npm run build        # static site in dist/
npm run desktop      # build, then open the desktop app
npm run desktop:dev  # desktop app pointed at the dev server (run `npm run dev` first)
npm run package      # build an installer into release/ (downloads electron-builder on first use)
```

To publish installers for every system, push a version tag (bump `version` in `package.json`, then `git tag v0.2.0 && git push --tags`). `.github/workflows/release.yml` builds them and attaches them to a GitHub release. Code signing is not set up yet; it goes in the `build` section of `package.json`.

## How it is put together

One React app, two shells. The web build is what GitHub Pages serves. The desktop app is Electron loading that same build and adding native file dialogs.

| Path | Purpose |
| --- | --- |
| `src/lib/deck.js` | The deck model: slides, elements, themes. Start here |
| `src/lib/state.js` | Editor state and undo history (a reducer) |
| `src/lib/files.js` | Opening and saving decks, reading images. **Add new file types here** |
| `src/lib/store.js` | Autosave (IndexedDB) and the channel between the show and presenter view |
| `src/App.jsx` | The editor: toolbar, slide strip, actions, keyboard shortcuts |
| `src/components/SlideView.jsx` | Draws a slide. Used by the stage, thumbnails, show, presenter view and print |
| `src/components/Stage.jsx` | Selecting, moving and resizing on the slide |
| `src/components/Inspector.jsx` | The right-hand properties panel |
| `src/components/Show.jsx` | The presentation: navigation, grid, control bar |
| `src/components/Presenter.jsx` | The presenter's window (`?presenter`) |
| `src/style.css` | Editor chrome, slide themes, show, presenter view, print |
| `desktop/` | Electron window, `app://` file server, the `window.desktop` file bridge |
| `public/docs/` | User guide, published alongside the app |
| `public/sw.js`, `src/lib/offline.js` | Offline support and install for the web version |
| `public/icon.svg`, `build/icon.png` | App icon (web and installers) |
| `.github/workflows/pages.yml` | Builds and deploys to GitHub Pages on every push to `main` |
| `.github/workflows/release.yml` | Builds desktop installers when a `v*` tag is pushed |

Things worth knowing before changing it:

- Slides are a fixed 1600 x 900 canvas, scaled to fit wherever they are shown.
- Links and next choices store slide ids, not positions, so reordering is safe.
- Images are stored once in `deck.assets` and referenced by id. Undo history leaves assets alone.
- The show owns the current position. Presenter view only sends requests (`goto`, `step`, `back`) and mirrors the reply.
- The desktop app can only write to paths the user chose in a dialog during that session.

## License

MIT. See [LICENSE](LICENSE).
