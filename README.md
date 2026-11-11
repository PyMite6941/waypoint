# Waypoint

Slides you can present in order, or steer. Arrow keys and clickers work as they do everywhere else; you can also jump to any slide mid-talk and step back to where you were.

- **Use it in a browser:** https://pymite6941.github.io/waypoint/
- **Guide:** https://pymite6941.github.io/waypoint/docs/

## Run it

| How | What to do |
| --- | --- |
| In a browser, any device | Open https://pymite6941.github.io/waypoint/. Nothing to install |
| Desktop app | Download the installer for your system from [Releases](https://github.com/PyMite6941/waypoint/releases/latest): `.exe` for Windows, `.dmg` for macOS, `.AppImage` for Linux |
| From source | `npm install`, then `npm run desktop` |

The installers are not code-signed yet. Windows shows a SmartScreen prompt (More info, Run anyway); on macOS, right-click the app and choose Open the first time. On Linux, make the AppImage executable (`chmod +x Waypoint-*.AppImage`) and run it.

## What it does

- Free-form slides: text, boxes, circles and images you drag and resize, with four themes
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

To publish installers for every system, push a version tag (`git tag v0.2.0 && git push --tags`). `.github/workflows/release.yml` builds them and attaches them to a GitHub release. Icons and code signing are not set up yet; both go in the `build` section of `package.json`.

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
