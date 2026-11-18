// Builds every icon NoteBase needs from the chosen artwork in build/icon-source.webp.
// Run: npm run icons
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

mkdirSync('build', { recursive: true });
mkdirSync('public', { recursive: true });

// 1) remove the white canvas around the rounded square, then cut the corners transparent
const { data: trimmed, info } = await sharp('build/icon-source.webp').flatten({ background: '#ffffff' })
  .trim({ background: '#ffffff', threshold: 28 }).png().toBuffer({ resolveWithObject: true });
const inset = 3; // drops the anti-aliased white fringe
const size = 1024;
const square = await sharp(trimmed)
  .extract({ left: inset, top: inset, width: info.width - inset * 2, height: info.height - inset * 2 })
  .resize(size, size, { fit: 'cover' }).png().toBuffer();
const radius = Math.round(size * 0.255);
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
const master = await sharp(square).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
await sharp(master).toFile('build/icon-master.png');

const out = async (file, px) => sharp(master).resize(px, px, { kernel: 'lanczos3' }).png().toFile(file);

// 2) web / PWA / favicon files
await out('public/icon-512.png', 512);
await out('public/icon-192.png', 192);
await out('public/apple-touch-icon.png', 180);
await out('public/favicon-32.png', 32);
await out('public/favicon-48.png', 48);
await out('public/favicon-256.png', 256);
writeFileSync('public/favicon.ico', await pngToIco(['public/favicon-32.png', 'public/favicon-48.png', 'public/favicon-256.png']));

// 3) Windows app + installer icon (multi-size .ico) and the window icon
await out('build/icon.png', 512);
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const files = [];
for (const s of icoSizes) { const f = `build/ico-${s}.png`; await out(f, s); files.push(f); }
writeFileSync('build/icon.ico', await pngToIco(files));
for (const f of files) rmSync(f);
console.log('icons written from build/icon-source.webp');
