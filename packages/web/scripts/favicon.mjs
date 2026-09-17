/**
 * Generates the app icons from the *real* tile geometry.
 *
 * The mark is one **vertex** and the three **arrows** bordering it — a pinwheel,
 * which is the smallest thing that shows both the tiling and the 3-in/3-out
 * junction the whole game turns on. The polygons are not hand-drawn: they are
 * `makeLayout(MEASURED_SILHOUETTE).polygon()` for the three borders of the up
 * triangle at cell (0,0), so a retune of the silhouette retunes the icon.
 *
 *   pnpm icons
 *
 * Loaded through Vite so the package's own extensionless imports resolve. Needs
 * `rsvg-convert` (brew install librsvg) for the PNG fallbacks. Output is
 * committed; this only runs when the artwork changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(REPO, 'packages/web/public');

const vite = await createServer({ root: REPO, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const { makeLayout } = await vite.ssrLoadModule('/packages/geometry-tiling/src/layout.ts');
const { cellArrow, cellVertex, vertexBorders, vertexCell } = await vite.ssrLoadModule(
  '/packages/geometry-tiling/src/cells.ts',
);


// Player A gold, player B blue, player C orange — packages/web/src/colors.ts.
const TILE_COLOURS = ['#e0b050', '#50a0e0', '#e8734a'];
const BOARD_BG = '#0e141b';

const SIZE = 64;
const PAD = 4;
const SEAM = 2.4;

const layout = makeLayout();
const centre = vertexCell(cellVertex(0, 0, 'up'));
const polygons = vertexBorders(centre).map((cell) =>
  layout.polygon(cellArrow(cell.i, cell.j, cell.d)),
);

const xs = polygons.flat().map((p) => p.x);
const ys = polygons.flat().map((p) => p.y);
const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
const scale = Math.min((SIZE - 2 * PAD) / (maxX - minX), (SIZE - 2 * PAD) / (maxY - minY));
const offX = (SIZE - (maxX - minX) * scale) / 2 - minX * scale;
const offY = (SIZE - (maxY - minY) * scale) / 2 - minY * scale;

const points = (poly) =>
  poly.map((p) => `${(p.x * scale + offX).toFixed(2)},${(p.y * scale + offY).toFixed(2)}`).join(' ');

const tiles = polygons
  .map(
    (poly, i) =>
      `<polygon points="${points(poly)}" fill="${TILE_COLOURS[i]}" stroke="${BOARD_BG}" stroke-width="${String(SEAM)}" stroke-linejoin="round"/>`,
  )
  .join('');

const svg = (ground) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(SIZE)} ${String(SIZE)}" width="${String(SIZE)}" height="${String(SIZE)}">` +
  `${ground}${tiles}</svg>\n`;

mkdirSync(OUT, { recursive: true });

// Browser tab: transparent, so it sits on the tab strip's own colour.
writeFileSync(resolve(OUT, 'favicon.svg'), svg(''));

// The raster fallbacks get the board ground under them: a transparent PNG is
// composited onto whatever the platform feels like, and iOS picks black.
const opaque = resolve(tmpdir(), 'conquarrow-icon.svg');
writeFileSync(opaque, svg(`<rect width="${String(SIZE)}" height="${String(SIZE)}" fill="${BOARD_BG}"/>`));

try {
  for (const [name, px] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ]) {
    execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', resolve(OUT, name), opaque]);
  }
} catch (err) {
  const missing = err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT';
  throw new Error(missing ? 'rsvg-convert not found (brew install librsvg)' : String(err), { cause: err });
} finally {
  await vite.close();
}

console.log(`wrote icons to ${OUT}`);
