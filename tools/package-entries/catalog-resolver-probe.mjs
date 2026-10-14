#!/usr/bin/env node
// In a FRESH process, load ONLY `@nodaro/prompts/catalog-packs` (the pack
// registry — it does not install the composed-catalog resolver) and ONE other
// subpath, register a pack that ADDS an option to a catalog, and resolve that
// option through a function the subpath exports. The answer must be the pack's
// text: the stock catalog has no such id, and without the resolver the lookup
// throws (catalog-overlay.ts fails closed). Prints JSON on stdout.
//
//   node tools/package-entries/catalog-resolver-probe.mjs <subpath>
import { createRequire } from 'node:module'

const PKG = '@nodaro/prompts'
const SETTING_HINT = 'PROBE-CURATED-SETTING'
const GENRE_HINT = 'PROBE-CURATED-GENRE'

const PACKS = [
  {
    id: 'probe-setting',
    catalogId: 'setting',
    mode: 'extend',
    options: [{ id: 'probe-setting-id', label: 'Probe setting', promptHint: SETTING_HINT }],
  },
  {
    id: 'probe-genre',
    catalogId: 'music-genre',
    mode: 'extend',
    dimensions: [{ field: 'genre', label: 'Genre', options: [{ id: 'probe-genre-id', label: 'Probe genre', promptHint: GENRE_HINT }] }],
  },
]

/** How each catalog-reaching entry resolves a curated id, using only its own exports. */
const RESOLVE = {
  'picker-catalogs': (ns) => ns.composedOption('setting', 'probe-setting-id')?.promptHint ?? '',
  pickers: (ns) => ns.getSetting('probe-setting-id')?.promptHint ?? '',
  'prompt-builder': (ns) => ns.renderDirectionHints({ setting: 'probe-setting-id' }, { surface: 'image' }).join(' | '),
  assembly: (ns) =>
    ns.composeSoundHintFromConnections({ id: 'c', type: 'suno-generate', data: {} }, 'suno-generate', {
      nodes: [{ id: 'c', type: 'suno-generate', data: {} }, { id: 's', type: 'music-genre', data: { genre: 'probe-genre-id' } }],
      edges: [{ id: 'e', source: 's', target: 'c', targetHandle: 'audio-style' }],
    }).text,
}
const EXPECT = { 'picker-catalogs': SETTING_HINT, pickers: SETTING_HINT, 'prompt-builder': SETTING_HINT, assembly: GENRE_HINT }

async function probe(load, subpath) {
  try {
    const packs = await load(`${PKG}/catalog-packs`)
    const ns = await load(`${PKG}/${subpath}`)
    for (const p of PACKS) packs.registerCatalogPack(p)
    return { text: RESOLVE[subpath](ns) }
  } catch (err) {
    return { error: String(err?.message ?? err) }
  }
}

const subpath = process.argv[2]
if (!RESOLVE[subpath]) {
  process.stdout.write(JSON.stringify({ error: `no resolver probe for "${subpath}" — add one to RESOLVE in tools/package-entries/catalog-resolver-probe.mjs` }))
} else {
  const require = createRequire(import.meta.url)
  const esm = await probe((s) => import(s), subpath)
  const cjs = await probe(async (s) => require(s), subpath)
  process.stdout.write(JSON.stringify({ esm, cjs, expect: EXPECT[subpath] }))
}
