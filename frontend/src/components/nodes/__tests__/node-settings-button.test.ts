// @vitest-environment node
// The settings toggle must reach EVERY node, in ONE position.
//
// It used to float off each node's right edge, rendered by BaseNode, so every
// node got it for free. Moving it into the run strip trades that for a seam
// that can drift: a pill that frames its own toolbar could render a Run button
// without one, and nothing would fail — the control would just be missing from
// that node type, which is exactly how the "cannot connect the outputs" class of
// bug happens in this repo.
//
// The invariant that makes it safe: the settings button is rendered by
// RunNodeButton, and every pill renders RunNodeButton. These tests check both
// halves from source, so a new bespoke toolbar cannot quietly opt out.

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const NODES_DIR = join(process.cwd(), "src/components/nodes")

/** The class string every self-framing run-strip pill uses. */
const PILL_MARKER = "px-1.5 py-1 backdrop-blur-sm rounded-xl"

function nodeSourceFiles(): string[] {
  return readdirSync(NODES_DIR).filter((f) => f.endsWith(".tsx"))
}

function read(file: string): string {
  return readFileSync(join(NODES_DIR, file), "utf8")
}

describe("node settings button placement", () => {
  it("every file that frames a run-strip pill renders RunNodeButton", () => {
    const pills = nodeSourceFiles().filter((f) => read(f).includes(PILL_MARKER))
    // Sanity: if this ever drops to zero the marker changed and the test went
    // vacuous, which would be worse than failing.
    expect(pills.length).toBeGreaterThanOrEqual(5)

    const withoutRun = pills.filter((f) => {
      const src = read(f)
      // The shared shell frames children it does not own, so it is exempt: its
      // children are what carry the Run button.
      if (f === "node-run-strip-shell.tsx") return false
      return !src.includes("RunNodeButton")
    })
    expect(
      withoutRun,
      `These files frame a run-strip pill but never render <RunNodeButton>, so the ` +
        `settings toggle will be missing from those nodes. Render RunNodeButton, or ` +
        `render <NodeSettingsButton nodeId={...} /> explicitly before your run control.`,
    ).toEqual([])
  })

  it("RunNodeButton renders the settings button before its run control", () => {
    const src = read("run-node-button.tsx")
    expect(src).toContain("NodeSettingsButton")

    // Both return paths — idle and running — must carry it, or the control
    // vanishes mid-run exactly when someone wants to change a setting.
    const occurrences = src.split("<NodeSettingsButton").length - 1
    expect(occurrences, "both the idle and the running return path need it").toBe(2)

    // Position, not just presence: the mock puts it immediately LEFT of Run.
    for (const path of src.split("return (").slice(1)) {
      if (!path.includes("<NodeSettingsButton")) continue
      const settingsAt = path.indexOf("<NodeSettingsButton")
      const runAt = path.search(/RUN_BUTTON_CLASS/)
      if (runAt === -1) continue
      expect(settingsAt, "settings must precede the run button in the DOM").toBeLessThan(runAt)
    }
  })

  it("BaseNode no longer floats a settings button off the node's edge", () => {
    // The margins around a node are reserved for ports. A reintroduced floating
    // button would double up with the one in the strip.
    const src = readFileSync(join(NODES_DIR, "base-node.tsx"), "utf8")
    expect(src).not.toMatch(/-right-14/)
  })

  it("BaseNode gives a strip to nodes that pass no toolbar content", () => {
    // ~65 node types (parameter pickers, group frames) pass neither prop. They
    // reached settings through the floating button; without this they would have
    // no way in at all.
    const src = readFileSync(join(NODES_DIR, "base-node.tsx"), "utf8")
    expect(src).toContain("topToolbarContent ?? <NodeSettingsButton")
  })
})
