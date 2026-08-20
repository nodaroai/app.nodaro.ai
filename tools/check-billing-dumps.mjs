#!/usr/bin/env node
// Forbids committed PROVIDER-BILLING EXTRACTS — the raw output of the audit
// scripts in backend/scripts/ (per-task provider charges, per-model observed
// rates, replay sheets).
//
// Why this exists: a 0.7 MB extract sat tracked at backend/kie-per-task.json
// from 2026-07-30 and shipped inside EVERY public release tarball. It carried
// 3,508 real provider task ids, 30 days of per-model call volume, our
// provider unit rate, and the total spend those rows sum to — i.e. our
// operating scale and per-model economics, readable by anyone who downloads a
// release. Found in the v1.29.6 artifact audit.
//
// Detection is by SHAPE, not filename: a rename, a new script, or a different
// lookback window all still trip it, and a filename allowlist would have to be
// updated by the same person who forgot to gitignore the file.
//
// Run locally: node tools/check-billing-dumps.mjs

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

// Fields that only ever appear together in a provider-billing extract.
// Deliberately NOT single generic words ("usd", "cost") — those appear in
// legitimate fixtures and would make this guard noise.
const SHAPES = [
  { name: "per-task provider billing extract", keys: ["taskId", "usd"], anyOf: ["kieCredits", "kieModel", "kieUsdPerCredit"] },
  { name: "observed per-model provider rates", keys: ["usdPerSecond"], anyOf: ["observed", "samples", "taskCount"] },
  { name: "credit-replay sheet", keys: ["oldCr", "newCr"], anyOf: ["oldUsd", "newUsd", "ratio"] },
]

// Scanning EVERY tracked json would be slow and noisy; billing extracts are
// large by nature (thousands of rows), so a size floor keeps this to the files
// that could actually carry a meaningful extract.
const MIN_BYTES = 20_000

function trackedJson() {
  const out = execFileSync("git", ["ls-files", "-z", "*.json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  return out.split("\0").filter(Boolean)
}

function sampleKeys(value, depth = 0) {
  // Collect keys from the first object found at or under `value`, following
  // arrays and single-key wrappers ({ tasks: [...] } is the observed shape).
  if (depth > 3 || value === null || typeof value !== "object") return []
  if (Array.isArray(value)) return value.length ? sampleKeys(value[0], depth + 1) : []
  const keys = Object.keys(value)
  const nested = keys.flatMap((k) => sampleKeys(value[k], depth + 1))
  return [...keys, ...nested]
}

const offenders = []
for (const file of trackedJson()) {
  let raw
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    continue // deleted in the working tree
  }
  if (raw.length < MIN_BYTES) continue
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    continue // not JSON we can judge
  }
  const keys = new Set(sampleKeys(parsed))
  for (const shape of SHAPES) {
    const hasAll = shape.keys.every((k) => keys.has(k))
    const hasAny = shape.anyOf.some((k) => keys.has(k))
    if (hasAll && hasAny) offenders.push(`${file}: ${shape.name}`)
  }
}

if (offenders.length > 0) {
  console.error("Billing-dump lint FAILED — a provider-billing extract is tracked in this repo:\n")
  for (const o of offenders) console.error(`  ${o}`)
  console.error("\nThese extracts carry real provider task ids, per-model call volume, and our")
  console.error("provider unit rate — they ship inside every public release tarball.")
  console.error("Generate them locally when auditing (backend/scripts/*.mts), keep them out of git:")
  console.error("  git rm --cached <file>   # then confirm .gitignore covers it")
  process.exit(1)
} else {
  console.log("Billing-dump lint passed — no provider-billing extracts tracked.")
}
