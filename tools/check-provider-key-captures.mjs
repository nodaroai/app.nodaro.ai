#!/usr/bin/env node
/**
 * Provider keys are LIVE (backend/src/lib/config.ts: `config.<PROVIDER>_KEY`
 * resolves env first, then the operator-supplied key stored via /setup).
 * That only holds if every consumer reads the key WHEN IT USES IT. Two
 * shapes silently freeze a key at the moment the process started, and would
 * make "paste a key on /setup" work for every provider except one:
 *
 *   1. an SDK constructed with the key at import/first-use:
 *        new Replicate({ auth: config.REPLICATE_API_TOKEN })
 *      -> go through liveProviderClient() (providers/provider-keys.ts) or
 *         memoise per key (lib/gemini/client.ts).
 *   2. a module-level constant capturing the key:
 *        const KEY = config.KIE_API_KEY
 *      -> read config.<KEY> inside the function that uses it.
 *
 * Both were checked by hand on 2026-08-16 (exactly two SDK captures existed —
 * Replicate and Gemini — and were converted). This lint keeps it that way.
 *
 * Usage: node tools/check-provider-key-captures.mjs   (from the repo root)
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, extname, relative } from "node:path"

const ROOT = "backend/src"
const EXTS = new Set([".ts"])
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "__characterization__"])

const KEYS = [
  "NODARO_API_KEY",
  "KIE_API_KEY",
  "REPLICATE_API_TOKEN",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "ELEVENLABS_API_KEY",
  "FAL_KEY",
]
const KEY_ALT = KEYS.join("|")

// `new Something({ ...config.X_KEY... })` on one line — an SDK taking the key
// at construction. liveProviderClient's factory receives the key as an
// argument, so a compliant site never mentions `config.` inside `new`.
const SDK_CAPTURE = new RegExp(`\\bnew\\s+[A-Za-z_$][\\w$.]*\\s*\\([^)]*config\\.(${KEY_ALT})`)
// Module-level `const|let X = config.X_KEY` (no indentation = top level).
const MODULE_CAPTURE = new RegExp(`^(?:export\\s+)?(?:const|let|var)\\s+\\w+\\s*=\\s*config\\.(${KEY_ALT})\\b`)

/** Files that memoise per key on purpose (reviewed). */
const ALLOWLIST = new Set([
  "backend/src/lib/gemini/client.ts", // memoised per key; rebuilt when it changes
])

function listFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (EXTS.has(extname(entry.name)) && !entry.name.endsWith(".test.ts")) out.push(full)
  }
  return out
}

const violations = []
let scanned = 0
for (const file of listFiles(ROOT)) {
  const rel = relative(process.cwd(), file).replace(/\\/g, "/")
  if (ALLOWLIST.has(rel)) continue
  scanned++
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  lines.forEach((line, i) => {
    if (SDK_CAPTURE.test(line)) {
      violations.push(`${rel}:${i + 1}: SDK constructed with a provider key — use liveProviderClient() or read the key per call\n    ${line.trim()}`)
    } else if (MODULE_CAPTURE.test(line)) {
      violations.push(`${rel}:${i + 1}: module-level capture of a provider key — read config.<KEY> inside the function\n    ${line.trim()}`)
    }
  })
}

if (violations.length > 0) {
  console.error(`FAIL: ${violations.length} provider-key capture(s) that would freeze a live key:\n`)
  for (const v of violations) console.error(`  ${v}\n`)
  console.error("Provider keys resolve at read time (env, then /setup). A frozen capture keeps a stale key after the operator changes it.")
  process.exit(1)
}
console.log(`OK: no frozen provider-key captures across ${scanned} files (excluding ${ALLOWLIST.size} reviewed).`)
