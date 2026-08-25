// Surface-funnel lint (B1): fails CI when a NEW hardcoded brand product-name
// literal appears in a chrome component instead of reading surfaceBrandName().
// The systematic conversion pass routes chrome brand text through the funnel
// (frontend/src/lib/surface-selectors.ts); this guard keeps the 101st site from
// regressing silently. Substring pre-filter (only files mentioning the literal
// are inspected) + a hard file-count ceiling keep it cheap (Phase-1 finding #5).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const BRAND_LITERAL = /["'`]Nodaro(\.ai)?["'`]/

/**
 * Paths exempt from the brand-literal rule. Two kinds:
 *  - the surface plumbing itself (the default lives here on purpose), and
 *  - non-chrome uses of the literal where the product's real name is correct
 *    regardless of a white-label surface: the free-tier watermark, SEO/marketing
 *    copy, share-card text, email/analytics, and the canonical app registry.
 * Each entry is a substring match against the repo-relative path.
 */
const ALLOW = [
  "src/lib/surface-profile.ts",
  "src/lib/surface-selectors.ts",
  "src/lib/nodaro-apps.ts",
  "__tests__",
  "docs/",
]

export function findSurfaceFunnelViolations(files) {
  const out = []
  for (const f of files) {
    if (ALLOW.some((a) => f.path.includes(a))) continue
    if (!f.text.includes("Nodaro")) continue // substring pre-filter
    if (BRAND_LITERAL.test(f.text) && !f.text.includes("surfaceBrandName")) {
      out.push({ path: f.path, rule: "brand-literal-outside-funnel" })
    }
  }
  return out
}

// --- CLI: walk frontend/src, print violations, exit 1 on any --------------
const MAX_FILES = 5000 // ceiling: refuse to scan an unexpectedly huge tree
const EXTS = new Set([".ts", ".tsx"])

function collect(dir, root, acc) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      collect(full, root, acc)
    } else if (EXTS.has(name.slice(name.lastIndexOf(".")))) {
      acc.push({ path: relative(root, full), text: readFileSync(full, "utf8") })
      if (acc.length > MAX_FILES) throw new Error(`[check-surface-funnel] file ceiling ${MAX_FILES} exceeded`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd()
  const files = []
  collect(join(root, "frontend", "src"), root, files)
  const violations = findSurfaceFunnelViolations(files)
  if (violations.length > 0) {
    console.error(`[check-surface-funnel] ${violations.length} brand literal(s) outside the surface funnel:`)
    for (const v of violations) console.error(`  ${v.path} — ${v.rule} (use surfaceBrandName() or add to ALLOW with a reason)`)
    process.exit(1)
  }
  console.log(`[check-surface-funnel] ok — ${files.length} files scanned, no brand literals outside the funnel`)
}
