/**
 * Downloads building icons from dsp-wiki.com and writes an icon manifest keyed by
 * the dataset's building keys.
 *
 *   node tools/fetch-icons.mjs [--force] [--limit N]
 *
 * The icons live on the wiki's own `Buildings` page, so the file list comes from
 * that page rather than being guessed. For each icon we also measure:
 *   - `bbox`: the tight bounding box of the non-transparent pixels, so the view can
 *     scale the *visible building* to its footprint instead of scaling the padded
 *     80x80 canvas (the padding is what made the drawing look undersized);
 *   - `palette`: accent/mean/dark colours sampled from the art, so a schematic
 *     block still matches the building.
 *
 * Files land in `public/icons/`; the manifest goes to
 * `src/engine/data/building-icons.json`.
 *
 * Licensing: the images are from dsp-wiki.com and belong to Youthcat Studio /
 * the wiki's contributors. This is a fan tool.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const API = 'https://dsp-wiki.com/api.php';
const ROOT = resolve(import.meta.dirname, '..');
const ICON_DIR = resolve(ROOT, 'public/icons');
const MANIFEST = resolve(ROOT, 'src/engine/data/building-icons.json');
const force = process.argv.includes('--force');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

mkdirSync(ICON_DIR, { recursive: true });

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: { 'user-agent': 'dsp-factory-sim/0.1 (fan simulator; icon fetch)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** `Icon_Assembling_Machine_Mk.I.png` -> `AssemblingMachineMk1`. */
function iconFileToKey(file) {
  let name = file.replace(/^Icon_/, '').replace(/\.png$/i, '');
  name = name.replace(/Mk\.?\s*III$/i, 'Mk3').replace(/Mk\.?\s*II$/i, 'Mk2').replace(/Mk\.?\s*I$/i, 'Mk1');
  return name
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .replace(/[^A-Za-z0-9]/g, '');
}

/** Alternate spellings that appear on the wiki but not in the dataset. */
const KEY_ALIASES = {
  // The dataset uses the current in-game names (Depot Mk.I/II); the wiki still
  // ships these icons under the older "Storage" wording.
  StorageMk1: 'DepotMk1',
  StorageMk2: 'DepotMk2',
  StorageMK1: 'DepotMk1',
  StorageMK2: 'DepotMk2',
  FullAccumulator: 'AccumulatorFull',
  Accumulatorfull: 'AccumulatorFull',
  SortersMk1: 'SorterMk1',
  SortersMk2: 'SorterMk2',
  SortersMk3: 'SorterMk3',
  WirelessPowerTower: 'TeslaTower',
  ReComposingAssembler: 'RecomposingAssembler',
  SelfEvolutionLab: 'SelfEvolutionLab',
  // The wiki calls it a "station"; the game's prototype is a "plant".
  MiniFusionPowerStation: 'MiniFusionPowerPlant',
  MiniFusionPowerplant: 'MiniFusionPowerPlant',
  ThermalPowerStation: 'ThermalPowerPlant',
};

// ---------------------------------------------------------------------------
// PNG decoding
// ---------------------------------------------------------------------------

/** Minimal PNG -> RGBA decoder (8-bit RGB/RGBA/grey, non-interlaced). */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 6;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colourType = data[9];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 0 ? 1 : 0;
  if (channels === 0) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++];
    const row = raw.subarray(read, read + stride);
    read += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/**
 * Measure one icon: its opaque bounding box plus a small palette.
 *
 * The bounding box matters because the wiki sprites are 80x80 with a lot of empty
 * margin; scaling the whole padded square to a footprint makes the building look
 * too small and leaves gaps against its neighbours.
 */
function analyseIcon(filePath) {
  const { width, height, channels, pixels } = decodePng(readFileSync(filePath));
  const alphaAt = (x, y) => {
    const p = (y * width + x) * channels;
    return channels === 4 ? pixels[p + 3] : 255;
  };
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  // Ignore faint anti-aliased fringes when bounding the art.
  const ALPHA_MIN = 24;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) < ALPHA_MIN) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const bbox = maxX < 0 ? { x: 0, y: 0, w: width, h: height } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let an = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const p = (y * width + x) * channels;
      if (channels === 4 && pixels[p + 3] < 128) continue;
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      sr += r;
      sg += g;
      sb += b;
      n++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (sat > 0.22 && lum > 0.2 && lum < 0.88) {
        ar += r;
        ag += g;
        ab += b;
        an++;
      }
    }
  }
  const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const mean = n > 0 ? [sr / n, sg / n, sb / n] : [128, 128, 128];
  const accent = an > 0 ? [ar / an, ag / an, ab / an] : mean;
  const lift = (c, k) => c.map((v) => v * k + 16);
  return {
    bbox,
    palette: { accent: hex(lift(accent, 1.05)), mean: hex(mean), dark: hex(lift(accent, 0.4)) },
  };
}

// ---------------------------------------------------------------------------

const dataset = JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8'));
const buildingKeys = new Set(dataset.buildings.map((b) => b.key));

console.log('fetching the image list of the Buildings page …');
const page = await api({ action: 'parse', page: 'Buildings', prop: 'images' });
const iconFiles = (page.parse?.images ?? []).filter((f) => /^Icon_.*\.png$/i.test(f));
console.log(`  ${iconFiles.length} Icon_*.png files on the page`);

async function resolveUrls(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const titles = batch.map((f) => `File:${f}`).join('|');
    const json = await api({ action: 'query', titles, prop: 'imageinfo', iiprop: 'url|size', formatversion: '2' });
    for (const pg of json.query?.pages ?? []) {
      const info = pg.imageinfo?.[0];
      if (!info?.url) continue;
      // The API normalises titles to spaces; key by the underscore form so lookups
      // match regardless of which spelling came back.
      out.set(pg.title.replace(/^File:/, '').replace(/ /g, '_'), { url: info.url, width: info.width, height: info.height });
    }
  }
  return out;
}

const urls = await resolveUrls(iconFiles);
console.log(`  resolved ${urls.size} icon URLs`);

const entries = {};
const skipped = [];
let downloaded = 0;

for (const file of iconFiles) {
  if (downloaded >= limit) break;
  const info = urls.get(file);
  if (!info) {
    skipped.push(`${file} (no URL)`);
    continue;
  }
  let key = iconFileToKey(file);
  key = KEY_ALIASES[key] ?? key;
  if (!buildingKeys.has(key)) {
    const loose = [...buildingKeys].find((k) => k.toLowerCase() === key.toLowerCase());
    if (loose) key = loose;
    else {
      skipped.push(`${file} -> ${key} (no dataset building)`);
      continue;
    }
  }

  const dest = resolve(ICON_DIR, file);
  if (force || !existsSync(dest)) {
    const res = await fetch(info.url, { headers: { 'user-agent': 'dsp-factory-sim/0.1' } });
    if (!res.ok) {
      skipped.push(`${file} (download HTTP ${res.status})`);
      continue;
    }
    writeFileSync(dest, new Uint8Array(await res.arrayBuffer()));
    downloaded++;
  }

  let analysis = null;
  try {
    analysis = analyseIcon(dest);
  } catch (err) {
    skipped.push(`${file} (analysis: ${err.message})`);
  }

  entries[key] = {
    file: `/icons/${file}`,
    width: info.width ?? null,
    height: info.height ?? null,
    // Tight box around the visible art; the view scales this to the footprint.
    bbox: analysis?.bbox ?? null,
    palette: analysis?.palette ?? null,
    source: info.url,
    wikiPage: 'https://dsp-wiki.com/Buildings',
  };
}

const withoutIcon = [...buildingKeys].filter((k) => !entries[k]).sort();

// Buildings with no icon still need a colour so they are never invisible.
const CATEGORY_FALLBACK = {
  production: '#7e9bb5',
  logistics: '#6f8fd0',
  power: '#c9a227',
  storage: '#8a97a3',
  research: '#a06fd0',
  gathering: '#4fa08a',
  defence: '#b06a5a',
  other: '#7a8896',
};
for (const building of dataset.buildings) {
  const entry = entries[building.key];
  if (entry?.palette) continue;
  const base = CATEGORY_FALLBACK[building.category] ?? CATEGORY_FALLBACK.other;
  if (entry) entry.palette = { accent: base, mean: base, dark: base, fromCategory: true };
}

writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'https://dsp-wiki.com/Buildings',
      license: 'Icons belong to Youthcat Studio / dsp-wiki.com contributors; this is a fan tool.',
      note: 'bbox is the tight opaque box in the source image; palette is sampled from the art.',
      icons: entries,
    },
    null,
    1,
  ),
);

console.log(`\ndownloaded      : ${downloaded}`);
console.log(`icons in effect : ${Object.keys(entries).length}`);
console.log(`manifest        : ${MANIFEST}`);
console.log(`\nbounding boxes (source image -> visible art):`);
for (const key of ['ConveyorBeltMk1', 'SorterMk1', 'ArcSmelter', 'AssemblingMachineMk1', 'MatrixLab', 'TeslaTower']) {
  const e = entries[key];
  if (!e?.bbox) continue;
  const fill = ((e.bbox.w * e.bbox.h) / ((e.width ?? 1) * (e.height ?? 1))) * 100;
  console.log(
    `  ${key.padEnd(24)} ${String(e.width).padStart(3)}x${String(e.height).padEnd(3)} -> art ${String(e.bbox.w).padStart(3)}x${String(e.bbox.h).padEnd(3)} at (${e.bbox.x},${e.bbox.y})  fills ${fill.toFixed(0)}%  accent ${e.palette?.accent}`,
  );
}
if (skipped.length > 0) {
  console.log(`\nskipped ${skipped.length}:`);
  for (const s of skipped.slice(0, 20)) console.log(`  ${s}`);
}
console.log(`\ndataset buildings without an icon (${withoutIcon.length}): coloured by category`);
for (const k of withoutIcon.slice(0, 40)) console.log(`  ${k}`);
