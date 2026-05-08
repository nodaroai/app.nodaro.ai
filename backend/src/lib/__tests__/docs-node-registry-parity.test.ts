/**
 * L1#5 — docs/nodes/ ↔ NODE_REGISTRY parity.
 *
 * Per CLAUDE.md "Public Docs Maintenance Rule": every node added to
 * NODE_REGISTRY must have a doc page at `docs/nodes/<category>/<type>.md`
 * AND a row in `docs/nodes/README.md`. The docs are published as the public
 * GitHub Pages reference; drift means SDK users hit "what does this node do?"
 * 404s.
 *
 * This test enforces a softer parity than CLAUDE.md describes: it walks
 * NODE_REGISTRY and checks for ANY `docs/nodes/(any-subfolder)/(type).md`
 * file (not pinned to a specific category subfolder). Reason: the docs
 * category structure (`processing-video`, `suno-music`, etc.) is more
 * granular than the NODE_REGISTRY `category` enum, so an exact subfolder
 * match would be brittle and fail on legitimate organizational decisions.
 *
 * Bug class: developer adds a new node, lands the code, but forgets the
 * docs/ pair. The test surfaces it at PR time, not when an SDK user files
 * an issue.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const DOCS_NODES_DIR = join(REPO_ROOT, "docs/nodes")
const DOCS_README_PATH = join(DOCS_NODES_DIR, "README.md")

/** Recursively walk a directory and return all `.md` files (excluding README.md). */
function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      out.push(...walkMarkdown(p))
    } else if (s.isFile() && entry.endsWith(".md") && entry !== "README.md") {
      out.push(p)
    }
  }
  return out
}

const DOC_FILE_PATHS = walkMarkdown(DOCS_NODES_DIR)
const DOC_TYPES = new Set(DOC_FILE_PATHS.map((p) => basename(p, ".md")))
const README_CONTENT = readFileSync(DOCS_README_PATH, "utf8")

/**
 * Allowlist of NODE_REGISTRY types that don't yet have public docs. Add
 * entries ONLY with a comment explaining why (e.g., internal-only node).
 * The integrity check below ensures the list can't go stale.
 */
const KNOWN_UNDOCUMENTED: ReadonlySet<string> = new Set<string>([])

// ---------------------------------------------------------------------------
// Sanity check on the docs directory walk.
// ---------------------------------------------------------------------------

describe("docs/nodes/ walk sanity", () => {
  it("found a non-trivial number of doc files (>= 50)", () => {
    expect(DOC_FILE_PATHS.length).toBeGreaterThanOrEqual(50)
  })

  it("README.md exists and is non-trivial", () => {
    expect(README_CONTENT.length).toBeGreaterThan(500)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every NODE_REGISTRY type has a `docs/nodes/**/<type>.md` file.
// ---------------------------------------------------------------------------

describe("NODE_REGISTRY → docs/nodes/ file parity", () => {
  it.each(NODE_REGISTRY.map((n) => [n.type, n.label] as const))(
    'NODE_REGISTRY entry "%s" (%s) has a doc page in docs/nodes/',
    (type) => {
      if (KNOWN_UNDOCUMENTED.has(type)) return // explicit allowlist
      expect(
        DOC_TYPES.has(type),
        `NODE_REGISTRY contains "${type}" but no docs/nodes/<category>/${type}.md exists. Per CLAUDE.md "Public Docs Maintenance Rule", every node MUST have a public doc page. Create the page (mirror an existing one for structure) and add a row in docs/nodes/README.md. If this node is intentionally undocumented (e.g., internal-only), add it to KNOWN_UNDOCUMENTED in this test file with a comment explaining why.`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — every NODE_REGISTRY type is mentioned (linked) in the master
// README so the table-of-contents is complete.
// ---------------------------------------------------------------------------

describe("NODE_REGISTRY → docs/nodes/README.md mention parity", () => {
  it.each(NODE_REGISTRY.map((n) => [n.type, n.label] as const))(
    'docs/nodes/README.md links to "%s" (%s)',
    (type) => {
      if (KNOWN_UNDOCUMENTED.has(type)) return
      // Look for a link of the form `(./<category>/<type>.md)` or
      // `<type>.md` anywhere in the README. The doc file existence is
      // already covered by Test 1 — this test ensures the master index has
      // been updated.
      const linked = README_CONTENT.includes(`/${type}.md`)
      expect(
        linked,
        `docs/nodes/README.md does not link to ${type}.md. Add a row to the appropriate category section pointing to the doc page (CLAUDE.md "Public Docs Maintenance Rule" — Triggers: New node added).`,
      ).toBe(true)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 3 — KNOWN_UNDOCUMENTED integrity — no entry that's actually documented.
// ---------------------------------------------------------------------------

describe("KNOWN_UNDOCUMENTED integrity", () => {
  it("every entry in KNOWN_UNDOCUMENTED is genuinely missing from docs/nodes/", () => {
    const stale = [...KNOWN_UNDOCUMENTED].filter((t) => DOC_TYPES.has(t))
    expect(
      stale,
      `These KNOWN_UNDOCUMENTED entries now have docs/nodes/<...>/${stale[0] ?? "<type>"}.md files — remove them from the allowlist: ${stale.join(", ")}`,
    ).toEqual([])
  })
})
