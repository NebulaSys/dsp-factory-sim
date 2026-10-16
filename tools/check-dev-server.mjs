/**
 * Smoke-checks the running dev server: the app shell, the transformed entry
 * module and the dataset JSON must all be served.
 *
 *   node tools/check-dev-server.mjs [http://localhost:5199]
 */

const base = (process.argv[2] ?? 'http://localhost:5199').replace(/\/$/, '');

async function get(path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.text() };
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const page = await get('/');
check('GET / returns 200', page.status === 200, `status ${page.status}`);
check('html declares UTF-8', /<meta charset="UTF-8"/i.test(page.body));
check('title renders CJK correctly', page.body.includes('戴森球计划 · 生产线模拟器'));
// Vite appends a cache-busting query (?t=...) to the entry module in dev, so match
// the path without anchoring the end.
check('entry module referenced', /src="\/src\/ui\/main\.ts(\?[^"]*)?"/.test(page.body));
for (const panel of ['blueprint', 'planner', 'tech', 'mining', 'about']) {
  check(`panel #${panel} exists`, page.body.includes(`id="panel-${panel}"`));
}
const tabs = page.body.match(/class="tab(?:\s|")/g) ?? [];
check('five tab buttons exist', tabs.length === 5, `found ${tabs.length}`);
check('canvas element exists', page.body.includes('id="bp-canvas"'));
for (const id of ['bp-zoom', 'bp-labels', 'bp-links']) {
  check(`canvas control #${id} exists`, page.body.includes(`id="${id}"`));
}
check('about panel has an icon section', page.body.includes('id="about-icons"'));

const main = await get('/src/ui/main.ts');
check('entry module transforms', main.status === 200 && main.body.includes('import'), `${main.body.length} B`);

const codec = await get('/src/engine/bp/codec.ts');
check('blueprint codec serves', codec.status === 200 && codec.body.length > 1000, `${codec.body.length} B`);

const iconModule = await get('/src/ui/icons.ts');
check('icon module serves', iconModule.status === 200 && iconModule.body.includes('building-icons'), `${iconModule.body.length} B`);

const iconManifest = await get('/src/engine/data/building-icons.json');
check('icon manifest serves', iconManifest.status === 200 && iconManifest.body.length > 500, `${iconManifest.body.length} B`);

// A real sprite must be served, otherwise the canvas silently falls back to blocks.
const sprite = await get('/icons/Icon_Arc_Smelter.png');
check(
  'building icon image serves',
  sprite.status === 200 && sprite.body.length > 1000,
  `${sprite.body.length} B (as text; PNG bytes are mis-decoded here but the size proves it exists)`,
);

const dataset = await get('/src/engine/data/dsp-vanilla.json');
check('dataset serves', dataset.status === 200 && dataset.body.length > 100_000, `${Math.round(dataset.body.length / 1024)} KB`);

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
if (failures > 0) process.exitCode = 1;
