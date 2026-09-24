/**
 * The read-only template canvas must render EVERY node of the snapshot,
 * sticky notes included. The first version filtered them out ("poster-sized
 * notes would bury the machine") and told the viewer "7 sticky notes hidden"
 * — which, for the tutorial templates, hid the very explanation the template
 * exists to give. Structural guard: the filter was one predicate on
 * `node.type`, and that is where a regression would come back.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("read-only template canvas", () => {
  it("does not filter sticky notes out of the snapshot", () => {
    const source = readFileSync(join(__dirname, "..", "read-only-canvas.tsx"), "utf8")
    expect(source).not.toMatch(/type\s*!==\s*["']sticky-note["']/)
    expect(source).not.toMatch(/hiddenNoteCount/)
  })

  it("no longer announces hidden notes in the canvas preview", () => {
    const source = readFileSync(join(__dirname, "..", "template-canvas-preview.tsx"), "utf8")
    expect(source).not.toMatch(/stickyHidden|hiddenNoteCount/)
  })

  // The editor paints its flow over `.canvas-ambient` (canvas colour + the
  // soft pink/indigo wash). The template canvas showed the same nodes on a
  // flat page colour, and the difference was the first thing Asaf noticed.
  // The wash only shows if the dot layer stays transparent.
  it("paints the editor's ambient wash behind the snapshot", () => {
    const source = readFileSync(join(__dirname, "..", "read-only-canvas.tsx"), "utf8")
    expect(source).toMatch(/className="canvas-ambient"/)
    expect(source).toMatch(/<Background[^>]*className="!bg-transparent"/)
    expect(source).not.toMatch(/background:\s*"transparent"/)
  })

  // A prompt longer than its node was unreadable: the nodes are inert and
  // `pointer-events: none`, so there was no way to see the rest (reported
  // 2026-09-15). A click on the interactive canvas now opens an inspector for
  // the node under the pointer — found by geometry, since the click lands on
  // the pane. The still (non-interactive) canvas stays a still.
  it("opens a node inspector from a pane click on the interactive canvas only", () => {
    const source = readFileSync(join(__dirname, "..", "read-only-canvas.tsx"), "utf8")
    expect(source).toMatch(/onPaneClick=\{interactive \? onPaneClick : undefined\}/)
    expect(source).toMatch(/nodeAtPoint\(nodeRects\(instance\), point\)/)
    expect(source).toMatch(/\{interactive && inspected && \(?\s*<NodeInspector/)
  })

  // Framed edge to edge, a flow's outputs sat under the Clone panel and its
  // lower lanes under the results rail (2026-09-24). The canvas preview hands
  // the canvas its chrome, and the first frame fits into what is left.
  it("frames the canvas preview clear of its floating chrome", () => {
    const source = readFileSync(join(__dirname, "..", "template-canvas-preview.tsx"), "utf8")
    expect(source).toMatch(/fitInsets=\{fitInsets\}/)
    expect(source).toMatch(/chromeInsets\(canvas, \[topBarRef, railRef, panelRef\]/)
    for (const ref of ["topBarRef", "railRef", "panelRef"]) expect(source).toMatch(new RegExp(`ref=\\{${ref}\\}`))
    const canvas = readFileSync(join(__dirname, "..", "read-only-canvas.tsx"), "utf8")
    expect(canvas).toMatch(/fitView\(\{ padding: fitViewPadding\(insets\), minZoom: 0\.02 \}\)/)
  })

  it("keeps the nodes themselves out of hit testing so the pane still pans from anywhere", () => {
    const css = readFileSync(join(__dirname, "..", "..", "..", "globals.css"), "utf8")
    expect(css).toMatch(/\.templates-canvas \.react-flow__node,\s*\n\.templates-canvas \.react-flow__edge \{\s*\n\s*pointer-events: none !important;/)
  })
})
