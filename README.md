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

It installs for your user, with Start menu and desktop shortcuts. To pin it, right-click Waypoint on the taskbar while it runs and choose Pin to taskbar.

**Debian, Ubuntu, Raspberry Pi OS** (x86-64 and ARM64). This installs the app with everything it needs and adds it to the applications menu:

```sh
curl -L -o /tmp/waypoint.deb "https://github.com/PyMite6941/waypoint/releases/latest/download/Waypoint-$(dpkg --print-architecture).deb" && sudo apt install -y /tmp/waypoint.deb
```

Then run `waypoint` or pick Waypoint from the menu. Remove it with `sudo apt remove waypoint`.

**Other Linux** (portable AppImage, nothing installed system-wide):

```sh
curl -L -o Waypoint.AppImage "https://github.com/PyMite6941/waypoint/releases/latest/download/Waypoint-$(uname -m | sed s/aarch64/arm64/).AppImage"
chmod +x Waypoint.AppImage
./Waypoint.AppImage --appimage-extract-and-run
```

`--appimage-extract-and-run` makes it work on systems without FUSE 2 (most current distributions); with `libfuse2` installed you can leave it off and it starts faster.

**macOS:** download `Waypoint-arm64.dmg` (Apple silicon) or `Waypoint-x64.dmg` (Intel) from [Releases](https://github.com/PyMite6941/waypoint/releases/latest), open it and drag the app to Applications. To keep it in the Dock, right-click its Dock icon while it runs and choose Options, Keep in Dock.

The installers are not code-signed yet. If Windows shows a SmartScreen prompt, choose More info, then Run anyway; on macOS, right-click the app and choose Open the first time.

### Uninstall

In the app: **File, Uninstall Waypoint…**. It quits and removes itself, and can also delete your data (API keys, saved deck, templates, animations, settings). Without that box ticked your data stays, so reinstalling picks up where you left off. Or by hand:

| System | Remove the app | Its data (optional) |
| --- | --- | --- |
| Windows | Settings, Apps, Installed apps, Waypoint, Uninstall | `%APPDATA%\Waypoint`, `%LOCALAPPDATA%\waypoint-updater` |
| macOS | Drag Waypoint from Applications to the Trash | `~/Library/Application Support/Waypoint`, `~/Library/Caches/waypoint-updater` |
| Debian, Ubuntu | `sudo apt remove waypoint` | `~/.config/Waypoint`, `~/.cache/waypoint-updater` |
| AppImage | Delete the `.AppImage` file | `~/.config/Waypoint` |
| Browser | Installed app: its ⋮ menu, Uninstall. Data: **File, Remove from this browser…** | Only Waypoint's own storage is cleared |

## What it does

- Free-form slides: text, boxes, circles and images you drag and resize, with alignment guides and four themes
- Present in order with arrows, Space, Page Up/Down or a clicker. The toolbar's Clicker menu lists paired Bluetooth devices (from the OS in the desktop app, WebHID in Chrome and Edge), says when there are none, and shows whether the chosen one is connected, with a warning in the presenter view. File, Clicker setup shows what each clicker button does and can teach new ones; in the desktop app the clicker keeps working while another app is in front
- Jump anywhere: type a slide number, open the grid with G, or click a linked item on the slide
- Backspace returns to the slide you were on before the jump
- Per-slide "next choices" for talks that branch
- Edit mode and present mode, switched with the pencil at the top right (Ctrl+E). Present mode lays every slide out on a Keynote-style light table, 3 or 4 per row, with the chosen slide ringed in orange
- **Present** works like Google Slides with a second monitor: the slides go full screen on the other display and your screen becomes a Keynote-style controller. With one monitor the slides open in a window of their own
- The controller shows the current and next slide, notes, a timer, and every slide on a light table: click any slide to send the room there
- A Java desktop presenter (`java/`) with the same controller and display behaviour, for machines without a browser or Node
- **Generate slides with AI** (edit mode, Ctrl+G) using your own provider: an Anthropic, OpenAI, Gemini, OpenRouter, Groq, Mistral, DeepSeek or xAI key, any OpenAI-compatible address, a local model (Ollama, LM Studio), a ChatGPT plan or Google account through the Codex CLI or Gemini CLI (desktop app), or copy and paste with any chat app, which opens ChatGPT, Claude, Gemini or Copilot with the prompt copied (the only way to use Claude Pro or Max, since Anthropic does not let other apps use that login). Keys are kept in a `.env` file; a provider can have several, and Waypoint counts each key's monthly tokens and switches automatically when one is rate limited, out of credit or over a limit you set. Set it up in File, AI settings. You review the slides before they go in, and one Undo takes them out
- Slide layouts on **+ Slide** (title, bullets, section, two columns, quote, blank) and a shortcuts sheet on **?**
- Slide transitions (fade, push, cover, wipe, zoom, flip, cube, morph) and click-by-click build animations, the same on web, desktop and Java
- Custom animations: a keyframe editor (move, scale, turn, fade, blur, with easing) for entrance and emphasis effects; they are saved in the deck, and in My animations for reuse in other decks, with export and import
- Templates: File, New from template opens a gallery read from the website (with an offline copy), your own saved templates, any Google Slides or PowerPoint link, and other galleries anyone can publish as a JSON file
- Import PowerPoint (.pptx and 97-2003 .ppt), Keynote, OpenDocument (.odp, LibreOffice), Google Slides (link or .pptx), PDF, Markdown and pictures, or open a presentation from a link (Google Slides, or a file on OneDrive, SharePoint, Google Drive or Dropbox): it is downloaded, its type is read from its bytes, and File, Update from link fetches the latest version later, keeping layout and colours; export to PowerPoint, Google Slides, PDF, PNG or `.waypoint.json`
- Installs as an app with its own taskbar, Dock or Start menu icon, either from the browser (Chrome/Edge install, Safari's Add to Dock) or as the desktop app; File, Install as an app explains pinning for your system. Installed, it opens presentations you double-click or drop on its icon
- Updates itself: the web version offers a reload when a new build is live, the desktop app installs new releases from GitHub
- Undo and redo, autosave

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
| `src/lib/files.js` | Opening and saving files (native dialogs on desktop, upload/download on web) |
| `src/lib/convert/` | Import and export. `links.js` turns share links into downloads (desktop `net:get`, the dev server's `/__waypoint/fetch`, or the browser) and sniffs the file type; `import.js` picks the reader by file type: `pptx-import.js`, `ppt-import.js` (97-2003 binary), `keynote-import.js` (`.key`: Snappy + protobuf), `odp-import.js` with `odf-shapes.js` (OpenDocument custom shapes). Shared helpers in `util.js`; export in `export.js`. **Add new file types here** |
| `src/lib/install.js` | Installing as an app, and presentations opened from the system (the desktop app's `open-files`, the web app's `launchQueue`) |
| `src/lib/transitions.js` | Slide transitions and build effects |
| `src/lib/clickerDevices.js`, `src/components/ClickerMenu.jsx` | The Clicker menu: paired Bluetooth devices (`bluetooth:devices` IPC: PowerShell PnP on Windows, `system_profiler` on macOS, `bluetoothctl` on Linux) or WebHID, the chosen clicker and its connection |
| `src/lib/clicker.js` | What each key does in a show, taught clicker keys, background keys for the desktop app |
| `src/lib/updates.js` | Update checks: `version.json` on the web, electron-updater on desktop |
| `src/lib/store.js` | Autosave (IndexedDB) and the channel between the show and presenter view |
| `src/App.jsx` | The editor: toolbar, slide strip, actions, keyboard shortcuts |
| `src/components/SlideView.jsx` | Draws a slide. Used by the stage, thumbnails, show, presenter view and print |
| `src/components/Stage.jsx` | Selecting, moving and resizing on the slide |
| `src/lib/ai.js` | AI providers, settings, the prompt, and turning replies into slides. **Add providers here** |
| `src/lib/keys.js` | API keys in a `.env` file (desktop IPC, the dev server, a picked file on the web), per-key usage counts |
| `src/lib/envfile.js` | Reading and updating `.env` text without touching other variables |
| `src/components/AiDialogs.jsx` | The AI settings and Generate dialogs |
| `src/components/Inspector.jsx` | The right-hand properties panel |
| `src/components/Show.jsx` | The presentation: navigation, grid, control bar |
| `src/components/Presenter.jsx` | The presenter's controller, shown in the editor window while presenting |
| `src/components/LightTable.jsx` | The slide grid shared by present mode and the controller |
| `src/components/Audience.jsx` | The slides window Present opens (`?audience&at=N`) |
| `src/lib/present.js` | Picks the display for the slides (Window Management API, or Electron's display list) |
| `java/` | Standalone Java (Swing) presenter for `.waypoint.json` decks. See `java/README.md` |
| `src/style.css` | Editor chrome, slide themes, show, presenter view, print |
| `desktop/` | Electron window, `app://` file server, the `window.desktop` file bridge |
| `public/docs/` | User guide, published alongside the app |
| `public/templates/` | The template gallery (`index.json` plus decks), also bundled into the app |
| `src/lib/anims.js`, `src/lib/templates.js` | Custom animations and templates |
| `public/sw.js`, `src/lib/offline.js` | Offline support and install for the web version |
| `public/icon.svg`, `build/icon.png` | App icon (web and installers) |
| `.github/workflows/pages.yml` | Builds and deploys to GitHub Pages on every push to `main` |
| `.github/workflows/release.yml` | Builds desktop installers when a `v*` tag is pushed |

Things worth knowing before changing it:

- Slides are a fixed 1600 x 900 canvas, scaled to fit wherever they are shown.
- Links and next choices store slide ids, not positions, so reordering is safe.
- Images are stored once in `deck.assets` and referenced by id. Undo history leaves assets alone.
- The show (in the audience window) owns the current position. The controller only sends requests (`goto`, `step`, `back`, `end`) and mirrors the reply.
- While the slides window is open, the desktop app registers Page Up/Down and media keys as global shortcuts (`desktop/main.cjs`) and sends them to the slides window; they are released when the show ends.
- The desktop app can only write to paths the user chose in a dialog during that session.
- AI keys live in a `.env` file (copy `.env.example`; git ignores `.env`): in the desktop app's settings folder (`env:read`/`env:write` IPC), in the project folder under `npm run dev` (the `/__waypoint/env` endpoint, localhost and same-origin only), or on the web a file the user picks (File System Access) or opens each session. `envDir: false` keeps Vite from loading `.env` into the bundle. Keys go only to the provider they belong to; per-key token counts and limits stay in localStorage. Keys saved in localStorage by older versions are moved into `.env` on first run.
- Subscriptions: the desktop app can run the user's own signed-in Codex CLI (`codex exec`, read-only sandbox, reply via `-o`) or Gemini CLI (`-p … --output-format json`) through `cli:run`, with fixed arguments, the prompt on stdin, an empty temp folder, a 10-minute timeout and Stop. There is no Claude subscription bridge, because Anthropic's terms do not allow third-party apps to use Pro/Max logins. In the desktop app, AI requests go through the main process (`ai:fetch`, https or localhost only) so provider CORS rules do not apply. The Anthropic SDK is loaded on first use, so it is not in the main bundle.
- Security: the built app (web and desktop) carries a Content Security Policy (`vite.config.js`): scripts only from the app itself, no plugins, no `<base>` changes, pictures only from the app or data/blob URLs, network open to https and localhost for AI providers and presentation links. The dev server skips it because hot reload needs inline scripts. PDFs are parsed with pdf.js eval turned off. In the desktop app every IPC handler checks the request comes from Waypoint's own page, windows cannot navigate away or embed webviews, and only http(s)/mailto links reach the OS.
- Performance: edits copy only what they change (`immer` in `state.js`), so undo history shares unchanged slides, and slide views redraw only when their own slide, the theme, the pictures or the slide list change. Pictures are saved under their own IndexedDB key and rewritten only when they change. The AI dialogs and the link importer load on first use.

## License

MIT. See [LICENSE](LICENSE).
