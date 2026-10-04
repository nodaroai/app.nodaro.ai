import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// Node results open in ONE modal, `InspectorShell`. They used to open in private
// copies of a hand-rolled `createPortal` modal, one per node file, and every copy
// had to remember the canvas isolation (`.nokey`, `aria-modal`, contained React
// events) on its own — none of them did.

const SRC = join(__dirname, "../../..")
const NODES = join(SRC, "components/nodes")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

/** The hand-rolled modal's backdrop, verbatim. */
const HAND_ROLLED = "fixed inset-0 z-[9999] bg-black/80"

/** Node files (paths relative to components/nodes) still on their own hand-rolled
 *  modal. SHRINK-ONLY: move a node onto `InspectorShell` and delete its line;
 *  never add one. */
const NOT_YET_ON_THE_SHELL = new Set([
  "combine-text-node.tsx",
  "content-ideas-node.tsx",
  "content-recipe-node.tsx",
  "image-critic-node.tsx",
  "image-to-text-node.tsx",
  "transcribe-node.tsx",
  "youtube-video-node.tsx",
])

describe("node result modals", () => {
  it("no private ResultTreeModal is left anywhere in the frontend", () => {
    const offenders = sources(SRC)
      .filter((p) => /\bfunction ResultTreeModal\b|\bconst ResultTreeModal\b/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p))
    expect(offenders).toEqual([])
  })

  // Every node-rendered file, subfolders included (scene views, sub-workflow
  // views, …) — a modal there is just as private.
  const nodeFiles = sources(NODES).filter((p) => p.endsWith(".tsx"))

  it("scans the node folder, subfolders included (never vacuously)", () => {
    expect(nodeFiles.length).toBeGreaterThan(50)
    expect(nodeFiles.some((p) => relative(NODES, p).includes("/"))).toBe(true)
  })

  it("no node file hand-rolls a new result modal", () => {
    const handRolled = nodeFiles
      .filter((p) => readFileSync(p, "utf8").includes(HAND_ROLLED))
      .map((p) => relative(NODES, p))
    expect(handRolled.filter((name) => !NOT_YET_ON_THE_SHELL.has(name))).toEqual([])
  })

  it("the not-yet list has no stale entries (a migrated node leaves it)", () => {
    const stale = [...NOT_YET_ON_THE_SHELL].filter((name) => !readFileSync(join(NODES, name), "utf8").includes(HAND_ROLLED))
    expect(stale).toEqual([])
  })
})
