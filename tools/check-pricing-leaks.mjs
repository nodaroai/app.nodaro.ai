#!/usr/bin/env node
// Forbids provider-$ rate figures and platform-margin/markup derivation
// content from packages/*/src. Those packages are published npm artifacts
// (Apache-2.0 for @nodaro/shared|client|cli, FSL for @nodaro/prompts) — every
// release is an IRREVOCABLE grant (npm tarballs are immutable/undeleteable).
// Provider rate cards, margin math, and measured-rate methodology belong in
// backend/src/lib/pricing/ (core) or backend/src/ee/billing/ (ee), never here.
//
// See: plan.nodaro.ai specs/superpowers/2026-07-06-public-flip-ip-audit.md
// (section C) + 2026-07-06-vcp-private-extraction-execution-spec.md (S5).
//
// Run locally: node tools/check-pricing-leaks.mjs

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, extname } from "node:path"

const ROOTS = ["packages/shared/src", "packages/prompts/src", "packages/client/src", "packages/cli/src"]
const EXTS = new Set([".ts", ".tsx"])
const SKIP_DIRS = new Set(["node_modules", "dist", "build"])

// Provider-rate shape: a dollar figure immediately followed by a per-unit
// slash — the exact leak shape found (and removed, S5) in
// ai-avatar-pricing.ts ("$0.06/s"), flux2-pricing.ts ("$0.015/MP"),
// switchx-pricing.ts, and the measured-rate comments in llm-models.ts /
// video-analysis-pricing.ts. Deliberately does NOT match a bare "$0.02" —
// CREDIT_BASE_USD (the public credit<->dollar conversion rate) is a
// sanctioned, already-public constant with no unit-rate suffix.
const RATE_PATTERN = /\$\d+(\.\d+)?\s*\/\s*[A-Za-z][A-Za-z-]*/

// Rate TABLE shape: 2+ dollar figures (with a decimal, to dodge regex
// backreferences like "$1"/"$2" in .replace(/(...)/, "$1 $2")) on the same
// line — the leak shape found (and removed, S5) in flux2-pricing.ts's header
// comment ("base $0.015, perOutMP $0.015, perRefMP $0.015"), which uses
// commas, not slashes, between figures. A single, isolated "$0.02" (the
// sanctioned CREDIT_BASE_USD mention, "1 credit = $0.02") never repeats on
// one line, so this is a safe complement to RATE_PATTERN above.
const DOLLAR_FIGURE_PATTERN = /\$\d+\.\d+/g

// Rate RANGE shape: a dollar figure, a dash (hyphen/en/em), then a second
// figure whose own "$" is optional — the leak shape found (and removed, S5
// review round) in pipeline-defaults.ts ("video regen is $0.05-0.20/attempt"),
// which RATE_PATTERN misses (the "/unit" follows the second, $-less figure)
// and DOLLAR_FIGURE_PATTERN misses (only ONE of the two figures carries the
// "$"). At least one side must have a decimal, dodging "$1-$2"
// regex-backreference shapes (e.g. .replace(/(\d{4})(\d{2})/, "$1-$2")).
const DOLLAR_RANGE_PATTERN = /\$\d+\.\d+\s*[-–—]\s*\$?\d+(\.\d+)?|\$\d+(\.\d+)?\s*[-–—]\s*\$?\d+\.\d+/

// Per-unit rate FIELD IDENTIFIERS with no "$" at all — the leak shape of
// llm-models.ts's `inputPricePerM: 0.15` / `outputPricePerM: 0.90` (the
// audit's headline example): the identifier itself declares a provider
// per-unit rate, so it's flagged wherever it appears (interface declaration,
// data literal, or prose). The prefix set (input|output|price|rate|cost) is
// what keeps CREDIT-denominated per-unit fields legal: `creditsPerSecond`
// (film-pricing), `CREDITS_PER_5_SEC` / `FRAMES_PER_CREDIT` (video-utils)
// start with credit/frame terms, and per-unit CREDIT prices are the
// sanctioned-public output — only $-rate-flavored prefixes are the leak.
const RATE_FIELD_PATTERN = /(input|output|price|rate|cost)\w*Per(M|Sec|Second|Token|Image|Video|Clip)\b/i

// Measured-rate METHODOLOGY language — "MEASURED from live KIE billing",
// "MEASURED at Gate 0.5" (the removed llm-models/video-analysis derivation
// comments). All-caps MEASURED is the audit-verified methodology marker;
// lowercase "measured" stays legal (plenty of benign uses: "the measured
// audio duration", "bucket by the measured clip length"). "live ... billing"
// is flagged case-insensitively — no benign use of that phrase exists.
const MEASURED_METHODOLOGY_PATTERN = /\bMEASURED\b/
const LIVE_BILLING_PATTERN = /\blive\s+(\S+\s+)?billing\b/i

// "markup" has zero legitimate non-pricing usage in this codebase (verified
// at S5) — any occurrence is either the sanctioned creator-monetization
// formula (ALLOWLIST below) or a genuine leak of Nodaro's own cost-markup
// mechanics. Unconditional substring match (case-insensitive) — deliberately
// NOT anchored to word boundaries so it also catches identifier-embedded
// cases like `marginMonthly` / `cost_markup_percent`.
const MARKUP_PATTERN = /markup/i

// "margin" alone is a common English/CSS word (layout whitespace — prompt
// copy like "generous margins" and CSS like "margin-right:8px" both use it
// with zero financial meaning) — only flag it when the SAME LINE also
// carries financial context, matching the actual leak shape ("zero platform
// margin — pass-through of Beeble's cost"). Note "%" is deliberately EXCLUDED
// from the context set — prompt/CSS copy uses "%" constantly for opacity,
// scale, and layout, which would otherwise swamp this with false positives.
const MARGIN_PATTERN = /\bmargin\b/i
const FINANCIAL_CONTEXT_PATTERN = /\$\d|\bUSD\b|\bcost\b|\bcredit\b|\bprovider\b|\bplatform\b/i

// Pure barrel re-export lines (`export { X, Y } from "./z.js"`) don't
// introduce new content — the flagged identifier's DEFINITION lives in the
// source file, which is checked independently. Without this, packages/*/src
// index.ts files would need a blanket (and blinding) allowlist entry just to
// re-export the sanctioned creator-monetization markup functions.
const REEXPORT_LINE_PATTERN = /^\s*export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["'][^"']+["']/
const WILDCARD_REEXPORT_LINE_PATTERN = /^\s*export\s*\*\s*from\s*["'][^"']+["']/

// ALLOWLIST — files where "margin"/"markup" is a reviewed, sanctioned,
// non-leaking use: the creator-monetization markup a published-app CREATOR
// sets on their own app (flatFee + percent are BOTH caller-supplied; no
// Nodaro-specific rate or constant is embedded). This is a distinct concept
// from Nodaro's OWN provider-cost markup, which correctly lives in
// backend/src/ee/billing/. Reviewed 2026-07-06 (S5) — do not add new entries
// without the same level of review; prefer rewording the source first.
const ALLOWLIST = new Set([
  "packages/shared/src/monetization.ts",
  "packages/shared/src/__tests__/utilities.test.ts", // calculateMonetizationMarkup/calculateMonetizedCost describe blocks
])

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return [] // package/dir may not exist in every checkout state
  }
  return entries.flatMap((entry) => {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(p)
    return EXTS.has(extname(entry.name)) ? [p] : []
  })
}

function isPricingRelevantLine(line) {
  if (RATE_PATTERN.test(line)) return "provider-rate pattern (a \"$X/unit\" figure)"
  if (DOLLAR_RANGE_PATTERN.test(line)) return "provider-rate range (a \"$X-Y\" figure span)"
  const dollarFigures = line.match(DOLLAR_FIGURE_PATTERN)
  if (dollarFigures && dollarFigures.length >= 2) return "provider-rate table (2+ dollar figures on one line)"
  if (RATE_FIELD_PATTERN.test(line)) return "per-unit rate field identifier (inputPricePerM-class, $-less)"
  if (MEASURED_METHODOLOGY_PATTERN.test(line)) return "measured-rate methodology marker (all-caps MEASURED)"
  if (LIVE_BILLING_PATTERN.test(line)) return "\"live ... billing\" methodology phrase"
  if (MARKUP_PATTERN.test(line)) return "\"markup\" identifier/mention"
  if (MARGIN_PATTERN.test(line) && FINANCIAL_CONTEXT_PATTERN.test(line)) return "\"margin\" mention in financial context"
  return null
}

const offenders = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (ALLOWLIST.has(file)) continue
    const content = readFileSync(file, "utf8")
    const lines = content.split("\n")
    lines.forEach((line, i) => {
      if (REEXPORT_LINE_PATTERN.test(line) || WILDCARD_REEXPORT_LINE_PATTERN.test(line)) return
      const reason = isPricingRelevantLine(line)
      if (reason) offenders.push(`${file}:${i + 1}: ${reason}\n    ${line.trim()}`)
    })
  }
}

if (offenders.length > 0) {
  console.error("Pricing-leak lint FAILED — provider-$ figures or margin/markup content found under packages/*/src")
  console.error("(these packages are published npm artifacts; every release is an irrevocable grant):\n")
  for (const o of offenders) console.error(`  ${o}\n`)
  console.error("Move provider rates / margin math to backend/src/lib/pricing/ (core) or backend/src/ee/billing/ (ee).")
  console.error("If this is a reviewed, sanctioned exception (generic formula, no embedded Nodaro rate), add it to")
  console.error("the ALLOWLIST in tools/check-pricing-leaks.mjs with a comment explaining why.")
  process.exit(1)
} else {
  console.log("Pricing-leak lint passed — no provider-$ or margin/markup content under packages/*/src.")
}
