/**
 * The composed-catalog resolver can never be skipped by a subpath entry.
 *
 * Every per-catalog getter (getSetting, getMusicGenre, …) asks
 * catalog-overlay.ts for the composed view whenever a catalog pack targets its
 * catalog, and catalog-overlay FAILS CLOSED when no resolver is installed.
 * picker-catalogs.ts installs it when it loads — it cannot be imported by the
 * catalog modules themselves (module-scope cycle, see catalog-overlay.ts). So
 * every entry whose code reaches catalog-overlay.ts loads picker-catalogs.ts
 * for its side effect. Three layers prove it, for every entry, present or
 * future:
 *   1. source — the entry's static runtime import closure contains
 *      picker-catalogs.ts whenever it contains catalog-overlay.ts;
 *   2. built output — the same holds for the entry's chunk graph in BOTH
 *      formats (a bundler dropping the bare import would break only this);
 *   3. behaviour — in a fresh process, loading only `@nodaro/prompts/catalog-packs`
 *      and the entry, a pack-ADDED option resolves to the pack's text through
 *      the entry's own exports (ESM and CJS).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
// @ts-expect-error — untyped .mjs tooling module
import { entryNames, runtimeClosure } from "../../../../tools/package-entries/entries-lib.mjs"
// @ts-expect-error — untyped .mjs tooling module
import { distRuntimeClosure, runProbe } from "../../../../tools/package-entries/entries-guard.mjs"

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SRC = path.join(PKG_DIR, "src")
const DIST = path.join(PKG_DIR, "dist")
const OVERLAY = path.join(SRC, "catalog-overlay.ts")
const INSTALLER = path.join(SRC, "picker-catalogs.ts")

const entries: string[] = entryNames(PKG_DIR)
const reachesOverlay = entries.filter((e) => runtimeClosure(path.join(SRC, "entries", `${e}.ts`)).has(OVERLAY))

// Built-output markers: the overlay's fail-closed message, and the install call.
const OVERLAY_MARK = "composed-catalog resolver is not installed"
const INSTALL_MARK = /setComposedCatalogResolver\d*\(\s*getPickerCatalog\d*\s*\)/

function chunksWith(ext: string, test: (text: string) => boolean): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name)
      if (f.isDirectory()) walk(p)
      else if (p.endsWith(ext) && test(fs.readFileSync(p, "utf8"))) out.add(p)
    }
  }
  walk(DIST)
  return out
}

describe("composed-catalog resolver vs subpath entries", () => {
  it("the catalog-reaching entries are the ones this suite expects (a new one needs a behaviour probe)", () => {
    // Not a hand list of what is SAFE — layers 1–3 check every entry. This pins
    // the set so a new catalog-reaching entry is noticed: layer 3 needs a
    // resolve function for it in tools/package-entries/catalog-resolver-probe.mjs.
    expect(reachesOverlay).toEqual(["assembly", "picker-catalogs", "pickers", "prompt-builder"])
  })

  it.each(entries)("source: entry %s loads picker-catalogs.ts whenever it reaches catalog-overlay.ts", (e) => {
    const closure = runtimeClosure(path.join(SRC, "entries", `${e}.ts`))
    if (closure.has(OVERLAY)) expect(closure.has(INSTALLER)).toBe(true)
  })

  for (const ext of [".js", ".cjs"]) {
    it(`built ${ext}: every entry whose chunks contain the overlay also loads the resolver install`, () => {
      const overlayChunks = chunksWith(ext, (t) => t.includes(OVERLAY_MARK))
      const installChunks = chunksWith(ext, (t) => INSTALL_MARK.test(t))
      expect(overlayChunks.size, `no built ${ext} file carries the overlay — run npm run build:packages`).toBeGreaterThan(0)
      expect(installChunks.size, `no built ${ext} file installs the resolver`).toBeGreaterThan(0)
      const problems: string[] = []
      for (const e of entries) {
        const closure = distRuntimeClosure(path.join(DIST, "entries", `${e}${ext}`))
        const hasOverlay = [...overlayChunks].some((c) => closure.has(c))
        const hasInstall = [...installChunks].some((c) => closure.has(c))
        if (hasOverlay && !hasInstall) problems.push(e)
        if (reachesOverlay.includes(e) !== hasOverlay) problems.push(`${e}: source and built output disagree on reaching the overlay`)
      }
      expect(problems).toEqual([])
    })
  }

  it.each(reachesOverlay)(
    "behaviour: @nodaro/prompts/%s alone resolves a pack-curated option (fresh process, ESM + CJS)",
    async (e) => {
      const r = await runProbe("catalog-resolver-probe.mjs", [e])
      expect(r.error).toBeUndefined()
      expect(r.esm).toEqual({ text: expect.stringContaining(r.expect) })
      expect(r.cjs).toEqual({ text: expect.stringContaining(r.expect) })
    },
    60_000,
  )
})
