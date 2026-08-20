#!/usr/bin/env node
// EVERY tracked file, EVERY never-public category, one pass.
//
// Why this exists, plainly: four consecutive audits of the published release
// tarball each found content that should never have shipped, and each time the
// repo's own guards had passed. They passed because they are SCOPED —
// check-pricing-leaks reads packages/*/src, changelogs, changesets and
// migrations; check-private-leaks reads a symbol deny-list. Nothing read
// backend/src or frontend/src for policy prose, which is exactly where most of
// the findings lived. Fixing the findings one report at a time could never
// converge: each new review angle produced a new category.
//
// So this check is deliberately the opposite shape:
//   - scope is EVERY tracked text file (minus a small, explicit skip list),
//   - categories are data, so adding one is one line,
//   - each file is scanned per-line AND de-wrapped, because comment blocks wrap
//     and a line-at-a-time regex cannot see a phrase split across two lines,
//   - exceptions are explicit, path-anchored, and carry a reason.
//
// It is not a replacement for the other guards: check-pricing-leaks encodes
// the packages-only npm-irrevocability rule, check-private-leaks holds a secret
// symbol list, check-billing-dumps reads JSON shape. This one is the broad net
// underneath all three.
//
// Run locally: node tools/check-public-surface.mjs

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const SKIP_DIRS = ["node_modules/", "dist/", "build/", ".git/"]
// Binary and lockfile-ish things a prose check has nothing to say about.
const SKIP_EXT = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".mp4", ".mov", ".wav",
  ".mp3", ".pdf", ".zip", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".lock",
]

// tools/ is skipped for the same reason the other guards skip it: a pattern
// necessarily resembles what it matches, so a guard scanning guards self-trips.
// The rule that keeps that honest is enforced by review, not regex — every
// pattern here is written so it does NOT contain the literal it matches.
const SKIP_PATHS = ["tools/", "package-lock.json"]

/**
 * @typedef {{id: string, why: string, pattern: RegExp, allow?: RegExp[]}} Rule
 */

/** @type {Rule[]} */
const RULES = [
  {
    id: "margin-structure",
    why: "reveals how our prices sit against provider cost",
    // "at-cost", "0%-base", "N% markup baked", "safety factor", "below cost"
    pattern: /\bat[\s-]cost\b|\b0%[\s-]base\b|\bsafety factor\b|\bbelow[\s-]cost\b|\bzero platform margin\b/i,
    allow: [
      // The sanctioned runtime markup mechanism (admin-configurable, default 0)
      // and the creator-monetization markup are both public by design.
      /cost_markup_percent|p_markup_amount|calculateMonetizationMarkup/,
    ],
  },
  {
    id: "measurement-methodology",
    why: "how we derive rates/quality is never public, even without the number",
    // All-caps MEASURED is ordinary emphasis ("the LAST MEASURED height"), so it
    // only counts next to a cost/rate/price word — the methodology it marks.
    pattern: /\b(staging|production)\s+measurement\b|\b\d+-run\s+measurement\b|\bmeasured\s+at\s+\d+\s+\w*\s*jobs\b|\bMEASURED\b(?=[^\n]{0,80}(cost|rate|price|billing|spend|token))|(cost|rate|price|billing|spend)[^\n]{0,80}\bMEASURED\b|\blive\s+\S*\s*billing\b|\bprobe matrix\b|\bprobe evidence\b/,
  },
  {
    id: "provider-rate",
    why: "provider $ rates belong in the sanctioned pricing homes only",
    pattern: /\$\d+(\.\d+)?\s*\/\s*(s|sec|second|min|minute|M|MP|token|image|video|clip|block|frame|attempt|call|output)\b/i,
    allow: [/CREDIT_BASE_USD/],
    // Rate cards live in these paths ON PURPOSE (the 2026-07 IP audit moved
    // them out of the published packages and into exactly here). A figure
    // anywhere ELSE is the finding.
    allowPaths: [
      /^backend\/src\/lib\/pricing\//,
      /^backend\/src\/ee\/billing\//,
      /^backend\/src\/providers\/[a-z]+\/(pricing|client|models)\.ts$/,
      /^backend\/src\/providers\/[a-z]+\/__tests__\//,
      /^backend\/scripts\//,
    ],
  },
  {
    id: "personal-identity",
    why: "real people's addresses/accounts and named decision attributions",
    pattern: /[a-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|walla|proton|icloud)\.[a-z]{2,}|\bapproved by (Tal|Asaf)\b|\b(Tal|Asaf) approved\b|\((Tal|Asaf)[,:]|\b(Tal|Asaf):\s*"/i,
  },
  {
    id: "competitor-citation",
    why: "sourcing our craft from a named competitor",
    pattern: /\bhiggsfield\b|\bapiyi\b|\bkrea\.ai\b|\bfreepik\b/i,
  },
  {
    id: "internal-planning-ref",
    why: "names the private planning repo, its layout, or its documents",
    pattern: /plan\.nodaro\.ai|\bplan repo\b|\bspecs\/[a-z0-9-]|\bnorth-star\b|docs\/superpowers/i,
    allow: [
      // The CI guard that BLOCKS internal specs has to name the paths it blocks.
      /git ls-files 'specs\/'|Internal planning docs|no specs\/ or docs\/superpowers/,
    ],
  },
  {
    id: "private-repo-internals",
    why: "maps the private package's files, commits, branches, or PR numbers",
    pattern: /src\/plugins\/[a-z-]|nodaro-cloud-plugins[#/]|plugins\/[a-z-]+\/(engine|pipeline|__tests__)\//i,
  },
  {
    id: "production-identifier",
    why: "a real production row cited in prose, or a live infra endpoint",
    // Two different things: a bucket id is ALWAYS a finding; a bare UUID only
    // matters when a COMMENT points at it as a real row ("job <uuid> did X").
    // UUIDs in data files, fixtures, and asset URLs are how the product works.
    pattern: /pub-[0-9a-f]{32}\.r2\.dev|(?:^|\s)(?:\/\/|--|\*|#)[^\n]{0,120}\b(job|run|execution|workflow|user|profile|task)\s+[`"']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    allow: [
      // Fixture UUIDs: repeated-digit / sequential shapes, and the all-zero id.
      /\b(0{8}|1{8}|2{8}|3{8}|4{8}|5{8}|6{8}|7{8}|8{8}|9{8}|a{8}|b{8}|c{8}|d{8}|e{8}|f{8}|deadbeef|12345678|11111111)-/i,
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b.*(example|fixture|placeholder|test|mock|stub|fake)/i,
      /(example|fixture|placeholder|test|mock|stub|fake|uuid|id).{0,40}\b[0-9a-f]{8}-[0-9a-f]{4}-/i,
    ],
  },
  {
    id: "private-algorithm-method",
    why: "describes how an extracted engine works, not what its seam accepts",
    pattern: /\breplay[\s-]diagonal\b|\bgray-band\b|\bdiagonal run of matching pairs\b|\bReinhard\b|\bargmax\b.{0,40}\bpair\b/i,
  },
]

/** Explicit, path-anchored exceptions. Each needs a reason; keep this short. */
const EXCEPTIONS = [
  {
    path: "docs/deployment.md",
    ruleId: "production-identifier",
    why: "documents the placeholder shape of an R2 public URL",
  },
  {
    path: ".github/mirror-author-allowlist.txt",
    ruleId: "personal-identity",
    why: "GitHub noreply identities — public by design, and the gate needs them literal",
  },
]

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 })
  return out.split("\0").filter(Boolean).filter((f) => {
    if (SKIP_DIRS.some((d) => f.includes(d))) return false
    if (SKIP_PATHS.some((p) => f.startsWith(p) || f === p)) return false
    if (SKIP_EXT.some((e) => f.toLowerCase().endsWith(e))) return false
    return true
  })
}

/** Comment markers + newlines collapsed, so a wrapped phrase reads as one line. */
function dewrap(content) {
  return content
    .split("\n")
    .map((line) => line.replace(/^\s*(\/\/+|--|\*|#)\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
}

function excepted(file, ruleId) {
  return EXCEPTIONS.some((e) => e.path === file && e.ruleId === ruleId)
}

const offenders = []
for (const file of trackedFiles()) {
  let content
  try {
    content = readFileSync(file, "utf8")
  } catch {
    continue // binary or unreadable — nothing to say
  }
  if (content.includes("\0")) continue // binary that slipped the extension list
  const lines = content.split("\n")
  const joined = dewrap(content)

  for (const rule of RULES) {
    if (excepted(file, rule.id)) continue
    if (rule.allowPaths?.some((p) => p.test(file))) continue
    let hit = null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!rule.pattern.test(line)) continue
      if (rule.allow?.some((a) => a.test(line))) continue
      hit = { line: i + 1, text: line.trim().slice(0, 160) }
      break
    }
    if (!hit) {
      // Nothing per-line: try the de-wrapped view for a phrase split across lines.
      const m = joined.match(rule.pattern)
      if (m && !rule.allow?.some((a) => a.test(joined))) {
        hit = { line: 0, text: `…${m[0]}… (wrapped across lines)` }
      }
    }
    if (hit) offenders.push({ file, line: hit.line, rule, text: hit.text })
  }
}

if (offenders.length > 0) {
  console.error(`Public-surface check FAILED — ${offenders.length} finding(s) in tracked files:\n`)
  const byRule = new Map()
  for (const o of offenders) {
    if (!byRule.has(o.rule.id)) byRule.set(o.rule.id, [])
    byRule.get(o.rule.id).push(o)
  }
  for (const [id, list] of byRule) {
    console.error(`  [${id}] ${list[0].rule.why}`)
    for (const o of list) console.error(`    ${o.file}:${o.line}\n      ${o.text}`)
    console.error("")
  }
  console.error("Every tracked file ships inside the public release tarball. Reword the")
  console.error("finding, or — if it is genuinely sanctioned — add a path-anchored entry to")
  console.error("EXCEPTIONS in tools/check-public-surface.mjs with a reason.")
  process.exit(1)
} else {
  console.log(`Public-surface check passed — ${RULES.length} categories over every tracked file.`)
}
