# To do

## Move the web version to Vercel

Today the web version is a static build published to GitHub Pages by `.github/workflows/pages.yml`
(https://pymite6941.github.io/waypoint/). It is not on Vercel yet.

- [ ] Create a Vercel project from `PyMite6941/waypoint` (framework: Vite, build `npm run build`, output `dist`).
- [ ] Point `homepage` in `package.json`, the README and the guide at the new address.
- [ ] Decide whether GitHub Pages stays as a mirror or `pages.yml` is removed.
- [ ] Check the service worker (`public/sw.js`) and `version.json` update check work from the new origin.
- [ ] Keep the relative `base: './'` in `vite.config.js`: the desktop app loads the same build.

## Server-side hosting

Things the browser cannot do on its own, which a small server (Vercel Functions) would make possible.
Everything here must stay optional: the desktop app and a plain static copy of the site keep working without it.

- [ ] **Presentation links on the web.** `src/lib/convert/links.js` downloads Google Slides, OneDrive, SharePoint, Google Drive
      and Dropbox links. The desktop app and `npm run dev` download them server-side; a plain browser tries directly (Google's
      export and GitHub worked in testing) and otherwise opens the download for the person to drop in.
      Old note: the desktop app downloads `docs.google.com/.../export/pptx` itself;
      browsers block that cross-site download, so the web version asks you to download the file and drop it in.
      A proxy function (https only, Google Docs hosts only, size limit) would make the link work on the web too.
- [ ] **AI requests without CORS trouble.** Some providers refuse calls from web pages. A pass-through
      function would fix that, but it must never store or log keys.
- [ ] **Sharing decks by link.** Upload a deck (and its pictures) to storage such as Vercel Blob and get a
      view-only link; optionally a presenter link that steers everyone watching.
- [ ] **Sync between devices.** Keep the same deck on the web and the desktop app (needs sign-in).
- [ ] **Remote control.** Advance slides from a phone: today the controller only talks to windows on the same computer.
- [ ] **Release info.** Serve the latest version number from one place for the web, the desktop app and the Java presenter.
