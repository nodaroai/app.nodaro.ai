#!/usr/bin/env node
// scripts/check-locale-completeness.mjs
//
// CI gate: verify every required locale sidecar exists for catalogs that
// have a strict "all locales or none" requirement. English is intentionally
// excluded — it's defined inline in the catalog source, not as a sidecar.
//
// Currently checks: `location-variants` (11 sidecars).
// To add a new catalog with the same requirement, append an entry to CATALOGS.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const LOCALES = [
  "ar",
  "de",
  "es",
  "fr",
  "he",
  "hi",
  "ja",
  "ko",
  "pt-BR",
  "ru",
  "zh-CN",
]

const CATALOGS = [
  {
    name: "location-variants",
    dir: "packages/shared/src/i18n",
  },
]

let failed = false

for (const { name, dir } of CATALOGS) {
  const absDir = path.join(repoRoot, dir)
  const missing = LOCALES.filter(
    (l) => !fs.existsSync(path.join(absDir, `${name}.${l}.ts`)),
  )
  if (missing.length > 0) {
    console.error(
      `Missing locale files for '${name}': ${missing.join(", ")}`,
    )
    failed = true
  } else {
    console.log(
      `✓ All ${LOCALES.length} ${name} locale files present.`,
    )
  }
}

if (failed) {
  process.exit(1)
}
