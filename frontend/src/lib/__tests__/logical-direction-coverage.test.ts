import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Hebrew renders under <html dir="rtl">. A physical horizontal class
 * (ml-2, text-left, pl-4, left-3, border-r, rounded-l-md) pins one side
 * regardless of direction, so the page half-flips: the sidebar moves right
 * while a row's icon margin, a label's alignment or a drawer's border stays
 * where the LTR author put it. Logical utilities (ms-2, text-start, ps-4,
 * start-3, border-e, rounded-s-md) follow the document direction.
 *
 * picker-logical-direction.test.ts pins a curated list of editor chrome;
 * this scan covers everything a signed-in user sees, so a NEW component is
 * covered the day it is added. Out of scope, deliberately:
 *   - components/nodes/ and the canvas edge renderers — the canvas is pinned
 *     LTR (globals.css `.react-flow { direction: ltr }`, rtl-direction-guards)
 *     and node internals keep their authored physical classes;
 *   - the operator-only admin pages (English-only surface).
 * Icon flips are not classes: read useAppDir() at the render site.
 */
const SRC = path.resolve(__dirname, "../..")
const TIMEOUT = 60_000

const EXCLUDE_PREFIXES = ["components/nodes/", "ee/app/(admin)/", "ee/components/admin/"]
const EXCLUDE_FILES = new Set([
  "components/editor/animated-flow-edge.tsx",
  "components/editor/deletable-edge.tsx",
  "ee/layouts/admin-layout.tsx",
])

/**
 * Files whose left/right OFFSETS are geometry of the media they sit on (a
 * crop grid, a timeline, a before/after divider, a graph) and are positioned
 * together with inline physical styles — converting only the class would
 * stretch the element under RTL. Only left-* / right-* offsets are exempt
 * here; their margins, paddings, borders and text alignment must be logical.
 */
const PHYSICAL_OFFSETS_OK = new Set<string>([
  "components/editor/media-editor/crop-panel.tsx", // rule-of-thirds grid + crop handles over the image
  "components/editor/media-editor/trim-panel.tsx", // trim handles on a time axis
  "components/editor/scene-graph-preview.tsx", // graph edges drawn with inline coordinates
  "components/pipeline/reel-pipeline.tsx", // reel timeline markers at inline percentages
  "components/presentation/views/compare-view.tsx", // before / after panes of the same media
  "components/editor/focus-mode-nav.tsx", // arrows to the canvas neighbour physically left / right (the canvas stays LTR)
])

// Same token pattern as picker-logical-direction.test.ts (keep them in step):
// variant chains and negatives included, `left-1/2` / `right-1/2` centering
// exempt, `border-l` only when not followed by a letter (border-lg passes).
const PHYSICAL = /(?<=["'`\s])(?:[^\s"'`]*:)?-?(?:text-left|text-right|(?:ml|mr|pl|pr)-(?:auto|\[[^\]]+\]|[\d.]+)|(?:left|right)-(?!1\/2(?![\w/]))(?:\[[^\]]+\]|[\d.]+(?:\/\d+)?)(?![\w/])|rounded-[lr]-|border-[lr](?![a-z]))/g
const OFFSET = /(?:^|:)-?(?:left|right)-/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|stories)\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function inScope(rel: string): boolean {
  return !EXCLUDE_FILES.has(rel) && !EXCLUDE_PREFIXES.some((p) => rel.startsWith(p))
}

describe("logical direction classes outside the canvas", () => {
  it(
    "no physical left/right class in any user-facing component",
    () => {
      const hits: string[] = []
      for (const file of walk(SRC)) {
        const rel = path.relative(SRC, file)
        if (!inScope(rel)) continue
        const src = fs.readFileSync(file, "utf8")
        if (!/(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)|rounded-[lr]-|border-[lr]/.test(src)) continue
        src.split("\n").forEach((line, i) => {
          for (const m of line.matchAll(PHYSICAL)) {
            if (PHYSICAL_OFFSETS_OK.has(rel) && OFFSET.test(m[0])) continue
            hits.push(`${rel}:${i + 1}  ${m[0]}`)
          }
        })
      }
      expect(hits, `physical-direction classes (use ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s-/rounded-e-):\n${hits.join("\n")}`).toEqual([])
    },
    TIMEOUT,
  )

  it("the offset exemption list names real, in-scope files", () => {
    for (const rel of PHYSICAL_OFFSETS_OK) {
      expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true)
      expect(inScope(rel), rel).toBe(true)
    }
  })
})
