import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const build = new Date().toISOString();

// While developing, the editor keeps API keys in the project's .env file (git ignores it).
// Only the page itself, on this computer, can read or write it: a request needs the
// X-Waypoint header (which other sites cannot send without permission), a localhost Host
// (which stops DNS rebinding) and, where the browser says, to come from the same origin.
// envDir: false below stops Vite reading .env at all, so keys can never end up in the built
// app, and saving a key does not restart the dev server (which would reload the page).
const envFileApi = {
  name: 'waypoint-env-file',
  apply: 'serve',
  configureServer(server) {
    const file = resolve(server.config.root, '.env');
    server.middlewares.use('/__waypoint/env', async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      const site = req.headers['sec-fetch-site'];
      if (req.headers['x-waypoint'] !== '1' || !['localhost', '127.0.0.1', '[::1]'].includes(host) || (site && site !== 'same-origin')) {
        res.statusCode = 403;
        return res.end();
      }
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (req.method === 'GET') {
          const text = await readFile(file, 'utf8').catch(() => '');
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ path: file, text }));
        }
        if (req.method === 'PUT') {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 65536) { res.statusCode = 413; return res.end(); }
          }
          await writeFile(file, body, { mode: 0o600 });
          res.statusCode = 204;
          return res.end();
        }
        res.statusCode = 405;
        res.end();
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err.message));
      }
    });
  },
};

// While developing, links to presentations are downloaded through the dev server, as the
// desktop app does, because sharing sites refuse downloads from other pages. Same checks.
const linkFetch = {
  name: 'waypoint-link-fetch',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__waypoint/fetch', async (req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      const site = req.headers['sec-fetch-site'];
      const url = new URL(req.url, 'http://x').searchParams.get('url') || '';
      if (req.headers['x-waypoint'] !== '1' || !['localhost', '127.0.0.1', '[::1]'].includes(host) || (site && site !== 'same-origin') || !url.startsWith('https://')) {
        res.statusCode = 403;
        return res.end();
      }
      try {
        const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000), headers: { 'User-Agent': `Mozilla/5.0 Waypoint/${version}` } });
        if (+r.headers.get('content-length') > 500e6) { res.statusCode = 502; return res.end('The file is larger than 500 MB.'); }
        res.setHeader('X-Status', String(r.status));
        res.setHeader('X-Url', r.url);
        res.setHeader('X-Disposition', r.headers.get('content-disposition') || '');
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (err) {
        res.statusCode = 502;
        res.end(String(err.cause?.message || err.message));
      }
    });
  },
};

// Relative base so the same build works on GitHub Pages and inside the desktop app.
// Each build writes version.json; open web pages poll it to notice a newer deploy.
export default defineConfig({
  base: './',
  envDir: false,
  plugins: [
    react(),
    envFileApi,
    linkFetch,
    {
      name: 'waypoint-version',
      generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, build }) }); },
    },
  ],
  define: { __VERSION__: JSON.stringify(version), __BUILD__: JSON.stringify(build) },
});
