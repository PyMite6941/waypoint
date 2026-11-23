// Helpers shared by the importers.
import { uid } from '../deck.js';

export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' };

/** True when a CSS colour is dark enough that a dark theme suits it. */
export function dark(css) {
  const m = /#([0-9a-f]{6})/i.exec(css);
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

// Drop empty optional fields so saved decks stay small.
export function clean(el) {
  for (const key of Object.keys(el)) if (el[key] === undefined || el[key] === null || (key === 'rot' && !el[key])) delete el[key];
  return el;
}

// Big pictures are scaled down to 2400 px; PNGs stay PNG (transparency), the rest become JPEG.
export function shrink(src, type) {
  if (!/png|jpeg|bmp|webp/.test(type) || src.length < 1.2e6) return Promise.resolve(src);
  return new Promise(ok => {
    const img = new Image();
    img.onerror = () => ok(src);
    img.onload = () => {
      const k = Math.min(1, 2400 / Math.max(img.width, img.height));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
      ok(out.length < src.length ? out : src);
    };
    img.src = src;
  });
}

/** Bytes to a data: URL. */
export function dataUrl(bytes, type) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

/** Picture bytes to an asset in `assets`, shrunk when huge. Null for formats browsers cannot show. */
export async function addPicture(assets, bytes, ext) {
  const type = IMAGE_TYPES[String(ext).toLowerCase()];
  if (!type || !bytes?.length) return null;
  const id = uid();
  assets[id] = await shrink(dataUrl(bytes, type), type);
  return id;
}

/** The format of picture bytes, from their first bytes. */
export function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'webp';
  if (b[0] === 0x3c) return 'svg';
  return null;
}
