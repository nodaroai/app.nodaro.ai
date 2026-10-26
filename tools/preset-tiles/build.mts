#!/usr/bin/env -S npx --no tsx
// Writes the Create Image tile presets from the ledger:
//
//   npx --no tsx tools/preset-tiles/build.mts            # regenerate the modules
//   npx --no tsx tools/preset-tiles/build.mts --check    # fail when the committed modules drift
//
// Source: tools/preset-tiles/ledger.json — one row per tile with the prompt that
// rendered its picture and its copy in every interface language. Output: the
// preset modules under packages/prompts/src/factory-presets/tiles/ and the
// app's preset copy per language under frontend/src/lib/i18n/
// (preset-content-tiles.<locale>.generated.ts). Dev-time only; the output is
// committed and packages/prompts/src/__tests__/preset-tiles-generated.test.ts
// holds it to the ledger, so CI never runs this.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { LEDGER_PATHS, mergeLedgers, renderModules, TILES_DIR_PATH, type TileLedger } from "./render.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Every ledger (ledger.json, use-cases.json) as one. */
export function readLedger(): TileLedger {
  return mergeLedgers(LEDGER_PATHS.map((p) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as TileLedger))
}

function main(): void {
  const check = process.argv.includes("--check")
  const modules = renderModules(readLedger())
  const tilesDir = join(ROOT, TILES_DIR_PATH)
  mkdirSync(tilesDir, { recursive: true })
  const stale = readdirSync(tilesDir).filter((f) => f.endsWith(".generated.ts") && !(`${TILES_DIR_PATH}/${f}` in modules))
  const drift: string[] = []
  for (const [name, source] of Object.entries(modules)) {
    const path = join(ROOT, name)
    // A checkout with core.autocrlf holds the modules as CRLF; compare content, not line endings.
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : null
    if (current === source) continue
    drift.push(name)
    if (!check) writeFileSync(path, source)
  }
  for (const name of stale) {
    drift.push(`${name} (stale)`)
    if (!check) unlinkSync(join(tilesDir, name))
  }
  if (check && drift.length > 0) {
    console.error(`preset tiles drift from the ledger: ${drift.join(", ")} — run: npx --no tsx tools/preset-tiles/build.mts`)
    process.exit(1)
  }
  console.log(drift.length === 0 ? "preset tiles: up to date" : `preset tiles: wrote ${drift.join(", ")}`)
}

main()
