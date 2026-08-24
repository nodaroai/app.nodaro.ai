#!/usr/bin/env node
// scripts/check-chrome-i18n-coverage.mjs
//
// Reporting-only, never gating: prints a per-locale coverage table for the
// app-chrome i18n dictionaries in frontend/src/lib/i18n/ (en.ts is the
// canonical key set; every other locale dict is a partial map that falls
// back to English). This is a SIGNAL that upstream string additions to
// en.ts degraded a locale's coverage toward English — closing that gap is
// the dictionary owner's job (a machine-translate PR, or the deployment
// that donated the locale), never the job of whoever added the new string.
// It must never fail CI, so it always exits 0, even on a parse error.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const i18nDir = path.join(repoRoot, "frontend/src/lib/i18n")

// Locale dict files are discovered rather than hardcoded, so a newly added
// locale is picked up automatically. en.ts is canonical (handled
// separately); index.ts, labels.ts, any preset-content.* sidecar (e.g.
// preset-content.he.ts), and __tests__/ are not locale dicts.
const EXCLUDED = new Set(["en.ts", "index.ts", "labels.ts"])
const EXCLUDED_PATTERNS = [/^preset-content\./]

// Static parse: these dict files are machine-shaped ("key": value lines), so a
// regex scan is sufficient and avoids importing TS from a .mjs script. The
// value may be double-, single-, or backtick-quoted (a few values are single-
// quoted because they embed double quotes, e.g. `'Move "{name}" ...'`), and may
// wrap onto the next line — `\s*` spans the newline. Anchoring on the value's
// opening quote regardless of style keeps every canonical key in the denominator
// (a missed key silently reported a locale at a falsely-high %).
const KEY_LINE = /^\s*"([^"]+)":\s*['"`]/gm

function extractKeys(filePath) {
  const src = fs.readFileSync(filePath, "utf8")
  const keys = new Set()
  for (const match of src.matchAll(KEY_LINE)) {
    keys.add(match[1])
  }
  return keys
}

// Canonical LocaleId casing (packages/shared/src/i18n/types.ts), keyed by
// lowercase filename stem — dict filenames are all-lowercase (pt-br.ts,
// zh-cn.ts) but the LocaleId itself uses mixed case (pt-BR, zh-CN).
const CANONICAL_LOCALE_IDS = [
  "en", "es", "fr", "de", "pt-BR", "ru", "hi", "ja", "ko", "zh-CN", "he", "ar",
]
const CANONICAL_BY_LOWERCASE = new Map(
  CANONICAL_LOCALE_IDS.map((id) => [id.toLowerCase(), id]),
)

function localeIdFromFilename(filename) {
  const stem = filename.replace(/\.ts$/, "")
  return CANONICAL_BY_LOWERCASE.get(stem.toLowerCase()) ?? stem
}

function pad(str, len) {
  str = String(str)
  return str.length >= len ? str : str + " ".repeat(len - str.length)
}

function main() {
  const enPath = path.join(i18nDir, "en.ts")
  const canonicalKeys = extractKeys(enPath)
  const totalKeys = canonicalKeys.size

  const localeFiles = fs
    .readdirSync(i18nDir)
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !EXCLUDED.has(f) &&
        !f.startsWith("__tests__") &&
        !EXCLUDED_PATTERNS.some((re) => re.test(f)),
    )
    .sort()

  const rows = []
  for (const file of localeFiles) {
    const locale = localeIdFromFilename(file)
    const localeKeys = extractKeys(path.join(i18nDir, file))
    const translated = [...canonicalKeys].filter((k) => localeKeys.has(k)).length
    const pct = totalKeys === 0 ? 0 : Math.round((translated / totalKeys) * 1000) / 10
    const missing = [...canonicalKeys].filter((k) => !localeKeys.has(k)).slice(0, 20)
    rows.push({ locale, translated, total: totalKeys, pct, missing })
  }

  const lines = []
  lines.push("Chrome i18n coverage report (reporting-only, never gates CI)")
  lines.push("")
  lines.push(`${pad("locale", 8)} ${pad("translated", 10)} ${pad("total", 6)} ${pad("%", 7)} first 20 missing keys`)
  lines.push("-".repeat(80))
  for (const row of rows) {
    const missingStr = row.missing.length > 0 ? row.missing.join(", ") : "(none)"
    lines.push(
      `${pad(row.locale, 8)} ${pad(row.translated, 10)} ${pad(row.total, 6)} ${pad(row.pct + "%", 7)} ${missingStr}`,
    )
  }
  const output = lines.join("\n")

  console.log(output)

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) {
    const mdLines = []
    mdLines.push("## Chrome i18n coverage report")
    mdLines.push("")
    mdLines.push("| locale | translated | total | % | first 20 missing keys |")
    mdLines.push("| --- | --- | --- | --- | --- |")
    for (const row of rows) {
      const missingStr = row.missing.length > 0 ? row.missing.join(", ") : "(none)"
      mdLines.push(`| ${row.locale} | ${row.translated} | ${row.total} | ${row.pct}% | ${missingStr} |`)
    }
    fs.appendFileSync(summaryPath, mdLines.join("\n") + "\n")
  }
}

try {
  main()
} catch (err) {
  console.error("chrome-i18n-coverage: failed to generate report:", err)
} finally {
  // Reporting-only: never fail CI, even on a parse error.
  process.exit(0)
}
