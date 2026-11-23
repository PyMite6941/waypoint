// Opening a presentation from a link: Google Slides, a PowerPoint (or Keynote, OpenDocument,
// PDF) file shared from OneDrive, SharePoint, Google Drive or Dropbox, or a direct download link.
// The link is turned into the file's download address, the file is downloaded, its type is
// read from the bytes (not the name), and it goes through the normal importers.
//
// Where it downloads from:
//   desktop app   the main process, so other sites' browser rules (CORS) do not apply
//   npm run dev   the dev server (localhost only), for the same reason
//   web           the browser directly; most sharing sites refuse that, so the download is
//                 opened in a new tab and the person drops the file in
import { importFiles } from './import.js';

const b64url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * What a link points at: { service, urls: [download addresses to try, best first], help }.
 * Throws with an explanation for links that cannot be downloaded.
 */
export function resolveLink(link) {
  let u;
  try { u = new URL(link.trim()); } catch { throw new Error('That is not a web address. Paste the whole link, starting with https://'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links (https://…) can be opened.');
  const host = u.hostname.toLowerCase();
  const id = (re, s = u.pathname) => re.exec(s)?.[1];

  if (host === 'docs.google.com') {
    if (/\/presentation\/d\/e\//.test(u.pathname)) throw new Error('That is a "Publish to the web" link, which Google does not let anyone download. Use the deck\'s Share link instead (Share, General access, "Anyone with the link").');
    const slides = id(/\/presentation\/d\/([\w-]{20,})/);
    if (slides) return { service: 'Google Slides', urls: [`https://docs.google.com/presentation/d/${slides}/export/pptx`], help: 'In Google Slides choose Share, General access, "Anyone with the link". Or use File, Download, Microsoft PowerPoint and open that file here.' };
    throw new Error('That Google link is not a Google Slides deck.');
  }
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
    const file = id(/\/file\/d\/([\w-]{20,})/) || u.searchParams.get('id');
    if (!file) throw new Error('That Google Drive link is a folder or page, not a file. Open the presentation and copy its link.');
    return { service: 'Google Drive', urls: [`https://drive.usercontent.google.com/download?id=${file}&export=download&confirm=t`, `https://drive.google.com/uc?export=download&id=${file}`], help: 'In Google Drive choose Share, General access, "Anyone with the link".' };
  }
  if (host === 'www.dropbox.com' || host === 'dropbox.com' || host === 'dl.dropboxusercontent.com') {
    const dl = new URL(u); dl.searchParams.delete('dl'); dl.searchParams.delete('raw'); dl.searchParams.set('dl', '1');
    const direct = new URL(dl); direct.hostname = 'dl.dropboxusercontent.com'; direct.searchParams.delete('dl');
    return { service: 'Dropbox', urls: [dl.href, direct.href], help: 'In Dropbox, use Share, Copy link (anyone with the link can view).' };
  }
  if (host === '1drv.ms' || host.endsWith('onedrive.live.com') || host.endsWith('.sharepoint.com') || host === 'onedrive.com') {
    const dl = new URL(u); dl.searchParams.set('download', '1');
    const api = `https://api.onedrive.com/v1.0/shares/u!${b64url(u.href)}/root/content`;
    const sharepoint = host.endsWith('.sharepoint.com');
    return {
      service: sharepoint ? 'SharePoint' : 'OneDrive',
      urls: sharepoint ? [dl.href, api] : [api, dl.href],
      help: sharepoint
        ? 'In PowerPoint or SharePoint choose Share, and set the link to "Anyone". Links limited to people in your organisation need you to download the file yourself (File, Download a copy) and open it here.'
        : 'In OneDrive choose Share, Copy link, with "Anyone with the link can view".',
    };
  }
  if (host.endsWith('icloud.com')) throw new Error('iCloud links cannot be downloaded by other apps. In Keynote or on icloud.com, download the presentation (.key or .pptx) and open the file here.');
  return { service: '', urls: [u.href], help: 'Check the link opens the file itself for anyone, without signing in.' };
}

/** A file's type from its first bytes (and, for zip files, what is inside): an extension, 'html' or null. */
export function sniff(bytes) {
  const b = bytes.subarray(0, 8), text = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ppt';
  if (b[0] === 0x50 && b[1] === 0x4b) {
    // Zip: look at the names of the files inside (they are stored as plain text).
    let part = bytes;
    if (bytes.length > 4e6) { part = new Uint8Array(4e6); part.set(bytes.subarray(0, 2e6)); part.set(bytes.subarray(-2e6), 2e6); }
    const names = new TextDecoder('latin1').decode(part);
    if (/application\/vnd\.oasis\.opendocument\.presentation/.test(names)) return 'odp';
    if (/ppt\/presentation\.xml/.test(names)) return 'pptx';
    if (/Index\/Document\.iwa|Index\.zip|index\.apxl/.test(names)) return 'key';
    return 'zip';
  }
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('<head')) return 'html';
  if (text.startsWith('{') && new TextDecoder().decode(bytes.subarray(0, 4e6)).includes('"slides"')) return 'json';   // a Waypoint deck
  return null;
}

const nameFrom = (disposition, url) => {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition || '')?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition || '')?.[1];
  if (plain) return plain;
  const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  return /\.\w{2,5}$/.test(last) ? last : '';
};

const DEV_FETCH = '/__waypoint/fetch';
// One download: { bytes, type, name } or throws ({ blocked: true } when the browser refused it).
export async function download(url, signal) {
  if (window.desktop?.get) {
    const r = await window.desktop.get(url);
    if (r.error) throw new Error(r.error);
    return { status: r.status, bytes: r.data, name: nameFrom(r.disposition, r.url || url) };
  }
  if (import.meta.env.DEV) {
    const r = await fetch(`${DEV_FETCH}?url=${encodeURIComponent(url)}`, { headers: { 'X-Waypoint': '1' }, signal });
    if (r.status === 502) throw new Error(await r.text());
    return { status: +r.headers.get('X-Status') || r.status, bytes: new Uint8Array(await r.arrayBuffer()), name: nameFrom(r.headers.get('X-Disposition'), r.headers.get('X-Url') || url) };
  }
  let r;
  try { r = await fetch(url, { signal, credentials: 'omit', redirect: 'follow' }); }
  catch (err) { if (err.name === 'AbortError') throw err; throw Object.assign(new Error('blocked'), { blocked: true }); }
  return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()), name: nameFrom(r.headers.get('content-disposition'), r.url || url) };
}

/**
 * Downloads and imports the presentation a link points at.
 * Resolves to { deck, warnings, name, source } or, on the web when the site refuses the
 * browser, to { manual: url, help } (the download is opened in a new tab for the person).
 * onStatus(text) reports progress.
 */
export async function importLink(link, { signal, onStatus } = {}) {
  const { service, urls, help } = resolveLink(link);
  let problem = '';
  for (const url of urls) {
    onStatus?.(`Downloading${service ? ` from ${service}` : ''}…`);
    let got;
    try { got = await download(url, signal); }
    catch (err) {
      if (err.blocked) continue;
      if (err.name === 'AbortError') throw err;
      problem = err.message; continue;
    }
    if (got.status === 401 || got.status === 403) { problem = 'private'; continue; }
    if (got.status === 404) { problem = 'missing'; continue; }
    if (got.status >= 400) { problem = `${got.status}`; continue; }
    const kind = sniff(got.bytes);
    if (kind === 'html') { problem = 'private'; continue; }
    if (!kind || kind === 'zip') throw new Error('That link downloads a file Waypoint cannot read. It opens PowerPoint, Keynote, OpenDocument and PDF presentations.');
    const base = (got.name || service || 'Linked deck').replace(/\.\w{2,5}$/, '');
    onStatus?.(`Reading ${base}…`);
    const result = await importFiles([{ name: `${base}.${kind}`, bytes: got.bytes }]);
    return { ...result, name: base, source: { url: link.trim(), service, at: Date.now() } };
  }
  if (!problem && !window.desktop) {
    window.open(urls[0], '_blank', 'noopener');
    return { manual: urls[0], help };
  }
  if (problem === 'private') throw new Error(`${service || 'The site'} wanted a sign-in, so the deck is not shared publicly. ${help}`);
  if (problem === 'missing') throw new Error(`${service || 'The site'} says there is no file at that link. Check it is the whole link. ${help}`);
  throw new Error(`Could not download it${problem ? ` (${problem})` : ''}. ${help}`);
}
