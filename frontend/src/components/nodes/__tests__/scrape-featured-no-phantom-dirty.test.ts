// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The scrape nodes (instagram-scrape / meta-ads-scrape) must NEVER auto-persist
 * the DISPLAY featured index.
 *
 * `featuredIndex` is not a `TRANSIENT_RUNTIME_KEY` (it selects which post/ad
 * feeds the output handles), so `updateNodeData({ featuredIndex })` marks the
 * workflow dirty. A render EFFECT that wrote the coerced display value back —
 * to keep the card's shown post in sync with a view-format filter — therefore
 * dirtied the workflow with NO user edit, on mount and on every filter click.
 * On a workflow whose only node is a scrape with a large result that is exactly
 * the phantom-dirty → spurious-save → false "updated on another device" →
 * paused-autosave loop (`node-runtime-keys.test.ts` documents the class).
 *
 * The display coercion (`featured`) stays local; only an explicit user click
 * (`setFeatured`) persists a selection. The output handles read the STORED
 * `featuredIndex` clamped to the full list, so filtering the view is
 * wire-neutral. This guard fails if the auto-write effect is ever re-added.
 */
const NODES_DIR = join(__dirname, "..")
const FILES = ["instagram-scrape-node.tsx", "meta-ads-scrape-node.tsx"] as const

describe("scrape nodes never auto-persist the display featuredIndex", () => {
  it.each(FILES)("%s: no effect writes the coerced featuredIndex", (file) => {
    const src = readFileSync(join(NODES_DIR, file), "utf8")

    // The exact coercion write that caused the loop — writing the derived
    // DISPLAY value (`featured`), not a user-chosen index.
    expect(src).not.toMatch(/updateNodeData\(\s*id\s*,\s*\{\s*featuredIndex:\s*featured\s*\}/)

    // Defense in depth: no `useEffect` block may reference `featuredIndex` at
    // all — a coercion write under any spelling is still a phantom-dirty source.
    const effects = src.match(/useEffect\([\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/g) ?? []
    for (const eff of effects) {
      expect(
        eff.includes("featuredIndex"),
        `a useEffect in ${file} references featuredIndex — a mount/filter write dirties the workflow (false "updated on another device")`,
      ).toBe(false)
    }

    // The explicit-click writer must remain — selecting a post IS persisted.
    expect(src, `${file} lost setFeatured — users can no longer pick the featured post`).toContain("setFeatured")
  })
})
