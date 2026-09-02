import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * The picker renders inside <html dir="rtl"> for Hebrew. A physical
 * horizontal class (text-left, ml-auto, pl-4, left-3 …) pins one side
 * regardless of direction, so Hebrew rows came out left-aligned under
 * right-aligned headers. Logical utilities (text-start, ms-auto, ps-4,
 * start-3) follow the document direction; this scan keeps the picker on them.
 *
 * Read as source text — same style as node-labels-coverage.test.ts.
 */
const SRC = path.resolve(__dirname, "../../..")

const PICKER_FILES = [
  "components/editor/add-node-popup.tsx",
  "components/editor/add-node-popup/picker-tab-bar.tsx",
  "components/editor/add-node-popup/picker-section-list.tsx",
  "components/editor/add-node-popup/picker-search-results.tsx",
  "components/editor/models-tab.tsx",
  "components/editor/node-toolbar/sidebar-section.tsx",
]

// A class token is preceded by a quote, backtick or whitespace. Horizontal
// gradients are checked separately: they must be chosen by the live
// direction (useAppDir), never a `rtl:` variant — Tailwind compiles that to a
// `[dir="rtl"] *` descendant selector that pierces the canvas's LTR pin
// (rtl-direction-guards.test.ts forbids it repo-wide).
const PHYSICAL = /(?<=["'`\s])(?:text-left|text-right|(?:ml|mr|pl|pr)-(?:auto|\[[^\]]+\]|[\d.]+)|(?:left|right)-(?:\[[^\]]+\]|[\d.]+)|rounded-[lr]-|border-[lr](?=[\s"'`]))/g

describe("picker components use logical (direction-aware) classes", () => {
  for (const rel of PICKER_FILES) {
    it(`${rel} has no physical left/right classes`, () => {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8")
      const hits = src
        .split("\n")
        .flatMap((line, i) => [...line.matchAll(PHYSICAL)].map((m) => `${i + 1}: ${m[0]}`))
      expect(hits, `physical-direction classes in ${rel}:\n${hits.join("\n")}`).toEqual([])
    })

    it(`${rel} picks every horizontal gradient by the live direction`, () => {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8")
      const unconditional = src
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /bg-gradient-to-[lr]\b/.test(line) && !/isRtl/.test(line))
        .map(({ n, line }) => `${n}: ${line.trim()}`)
      expect(unconditional, `direction-blind gradient in ${rel}:\n${unconditional.join("\n")}`).toEqual([])
    })
  }
})
