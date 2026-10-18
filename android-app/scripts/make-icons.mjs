// The Android app's icons, from the website's own mark: the yellow play triangle (icons/icon-512.png).
//
//   npm run icons        (from android-app/)
//
// Writes, overwriting, into android/app/src/main/res:
//  - the launcher icon (ic_launcher / ic_launcher_round): the triangle alone on a transparent background.
//    There is deliberately no adaptive icon (mipmap-anydpi-v26): the user's launcher icon packs draw their
//    own tile behind a plain icon they don't know, and don't behind an adaptive one;
//  - ic_launcher_foreground (108dp canvas), only the Android 12+ launch-screen icon;
//  - the launch screens for Android 11 and older (the triangle on the site's #111820).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, '..', 'android', 'app', 'src', 'main', 'res');
const YELLOW = '#FBBF24';
const DARK = '#111820';

// The triangle as on icons/icon-512.png, framed by BOX (its own bounds).
const BOX = { x: 85, y: 64, w: 362, h: 383 };
const glyph = `<polygon points="85,64 447,256 85,447" fill="${YELLOW}"/>`;

/** width x height, the triangle centred at `size` x the shorter side tall; background: none or 'full'. */
function svg({ width, height = width, size, background = null }) {
  const side = Math.min(width, height);
  const h = side * size;
  const w = (h * BOX.w) / BOX.h;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${background ? `<rect width="${width}" height="${height}" fill="${DARK}"/>` : ''}
  <svg x="${(width - w) / 2}" y="${(height - h) / 2}" width="${w}" height="${h}" viewBox="${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}">${glyph}</svg>
</svg>`;
}

async function png(file, options) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await sharp(Buffer.from(svg(options))).png().toBuffer());
}

if (!existsSync(RES)) throw new Error(`${RES} is missing - run npx cap add android first.`);
rmSync(join(RES, 'mipmap-anydpi-v26'), { recursive: true, force: true });
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  await png(join(RES, `mipmap-${density}`, 'ic_launcher_foreground.png'), { width: 108 * scale, size: 0.5 });
  await png(join(RES, `mipmap-${density}`, 'ic_launcher.png'), { width: 48 * scale, size: 0.64 });
  await png(join(RES, `mipmap-${density}`, 'ic_launcher_round.png'), { width: 48 * scale, size: 0.64 });
}
const splashes = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [width, height]] of Object.entries(splashes)) {
  await png(join(RES, dir, 'splash.png'), { width, height, size: 0.24, background: 'full' });
}
writeFileSync(
  join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#00000000</color>
</resources>
`,
);
console.log('icons written');
