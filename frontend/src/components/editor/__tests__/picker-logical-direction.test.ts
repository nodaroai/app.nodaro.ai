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
  "components/editor/node-toolbar.tsx",
  "components/editor/canvas-toolbar.tsx",
  "components/editor/connect-node-dialog.tsx",
  "components/editor/unified-asset-library.tsx",
  // Chrome the rail shares an edge with, or opens: the node config panel
  // (pinned to the same inline end as the RTL rail), the Copilot slot (the
  // rail offsets past it) and the component marketplace popup the rail's
  // Add Node button anchors.
  "components/editor/config-panel.tsx",
  "components/editor/workflow-editor/copilot-panel-slot.tsx",
  "components/editor/component-marketplace-modal.tsx",
  // The other occupants of the canvas column's corners: the controls bar
  // (opposite the config drawer), the pipeline drawer (same edge as the
  // config drawer), the open Copilot panel (same seam as its collapsed tab)
  // and the canvas's own overlays.
  "components/editor/canvas-controls.tsx",
  "components/editor/pipeline-panel/pipeline-panel.tsx",
  "ee/components/copilot/copilot-panel.tsx",
  "components/editor/workflow-canvas.tsx",
  "components/editor/marketplace-popup-geometry.ts",
]

// A class token sits after a quote, backtick or whitespace, optionally behind
// a variant chain (`md:`, `dark:hover:`, `data-[state=open]:`) and a leading
// `-` for negatives — `md:-ml-2` pins a side under dir="rtl" exactly as a
// bare `ml-2` does. `left-1/2` / `right-1/2` are exempt: with
// `-translate-x-1/2` they centre, which is symmetric; other fractions are
// real offsets and stay flagged. `border-l` must not be followed by a letter
// so `border-lg` / `border-red-500` pass while `border-l-2` is caught.
// Horizontal gradients are checked separately: they must be chosen by the
// live direction (useAppDir), never a `rtl:` variant — Tailwind compiles that
// to a `[dir="rtl"] *` descendant selector that pierces the canvas's LTR pin
// (rtl-direction-guards.test.ts forbids it repo-wide).
const PHYSICAL = /(?<=["'`\s])(?:[^\s"'`]*:)?-?(?:text-left|text-right|(?:ml|mr|pl|pr)-(?:auto|\[[^\]]+\]|[\d.]+)|(?:left|right)-(?!1\/2(?![\w/]))(?:\[[^\]]+\]|[\d.]+(?:\/\d+)?)(?![\w/])|rounded-[lr]-|border-[lr](?![a-z]))/g

// Physical classes that have no logical form and are therefore chosen by the
// live direction at the render site: the config drawer's off-screen slide and
// the Add Node panel's slide-in origin. A bare one is direction-blind.
const DIRECTION_FLIP = /(?:-?translate-x-full|slide-in-from-(?:left|right))\b/

describe("the physical-class scan", () => {
  const hit = (cls: string) => [...`className="${cls} "`.matchAll(PHYSICAL)].map((m) => m[0])
  it("catches variant-prefixed and negative physical classes", () => {
    for (const cls of ["md:left-4", "dark:text-left", "hover:ml-auto", "-ml-2", "md:-ml-2", "data-[state=open]:left-4", "border-l-2", "left-1/3", "right-2/3", "left-12/2", "left-3/2", "left-[calc(50%-1px)]"]) {
      expect(hit(cls), cls).not.toEqual([])
    }
  })
  it("reports the whole token, not a truncated prefix", () => {
    expect(hit("left-1/3")).toEqual(["left-1/3"])
    expect(hit("left-[calc(50%-1px)]")).toEqual(["left-[calc(50%-1px)]"])
  })
  it("exempts centering fractions and non-direction tokens", () => {
    for (const cls of ["left-1/2", "md:left-1/2", "-translate-x-1/2", "slide-in-from-left-2", "border-lg", "border-red-500", "inset-x-0", "text-start", "ms-auto", "ps-9", "start-3", "end-4"]) {
      expect(hit(cls), cls).toEqual([])
    }
  })
})

describe("picker components use logical (direction-aware) classes", () => {
  for (const rel of PICKER_FILES) {
    it(`${rel} has no physical left/right classes`, () => {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8")
      const hits = src
        .split("\n")
        .flatMap((line, i) => [...line.matchAll(PHYSICAL)].map((m) => `${i + 1}: ${m[0]}`))
      expect(hits, `physical-direction classes in ${rel}:\n${hits.join("\n")}`).toEqual([])
    })

    it(`${rel} chooses every off-screen slide / slide-in origin by the live direction`, () => {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8")
      const blind = src
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => DIRECTION_FLIP.test(line) && !/isRtl/.test(line))
        .map(({ n, line }) => `${n}: ${line.trim()}`)
      expect(blind, `direction-blind slide in ${rel}:\n${blind.join("\n")}`).toEqual([])
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
