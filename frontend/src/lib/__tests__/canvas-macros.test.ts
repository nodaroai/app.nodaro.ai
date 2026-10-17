// @test-always scans the frontend sources for macro creation sites, and checks every node unit's too
/**
 * The add-node macros (Reframe, decided 2026-10-11): a menu entry that inserts
 * real nodes. Invariants that keep it from drifting into a ghost node type:
 * it is in the catalogue and a family but nowhere an engine or a client could
 * read it as a node, every place that creates a node from a picked entry routes
 * it, and it is offered only where all its nodes are.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const gates = vi.hoisted(() => ({ hidden: new Set<string>(), credits: true, viewPriced: true, framesPriced: true }))
// The price flags are constants in the real module: the test sets the pair the
// video-mode gate (R15) reads, through the shared helper.
const flag = vi.hoisted(() => ({
  get priced() { return gates.viewPriced },
  set priced(v: boolean) { gates.viewPriced = v },
  get frames() { return gates.framesPriced },
  set frames(v: boolean) { gates.framesPriced = v },
}))
vi.mock("@nodaro/render-rules", async (orig) =>
  (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await orig<typeof import("@nodaro/render-rules")>(), flag),
)
vi.mock("@/lib/surface-availability", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-availability")>()),
  isNodeUnavailable: (t: string) => gates.hidden.has(t),
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasCredits: () => gates.credits,
}))

import { NODE_OPTIONS, getNodeOptions } from "@/lib/node-options"
import { CANVAS_MACROS, REFRAME_ENTRY_TYPE, canvasMacroOf, isCanvasMacroType, isMacroGroup, macrosForConnection, withoutMacros } from "@/lib/canvas-macros"
import { OWNER_FAMILY_BY_TYPE, familyById } from "@/lib/node-families"
import { tabSections, sidebarSections } from "@/lib/node-picker-sections"
import { REFRAME_CHILD_TYPES } from "@/lib/reframe-macro"
import { LABEL_TABLES } from "@/lib/i18n/labels"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"

afterEach(() => {
  gates.hidden = new Set()
  gates.credits = true
  gates.viewPriced = true
  gates.framesPriced = true
})

const SRC = join(__dirname, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

describe("the Reframe catalogue entry", () => {
  const entry = () => NODE_OPTIONS.find((o) => o.type === REFRAME_ENTRY_TYPE)!

  it("is named Reframe with the subtitle 'Follow the speaker' (D4)", () => {
    expect(entry()).toMatchObject({ label: "Reframe", subtitle: "Follow the speaker" })
  })

  it("has its OWN family and header (decided 2026-10-12), and its group agrees with the registry", () => {
    expect(OWNER_FAMILY_BY_TYPE.get(REFRAME_ENTRY_TYPE)).toBe("video-reframe")
    expect(entry().group).toBe("video-reframe")
    expect(familyById("video-reframe")).toMatchObject({ label: "Reframe", tab: "video", types: [REFRAME_ENTRY_TYPE] })
    // Speaker View itself stays where it was.
    expect(OWNER_FAMILY_BY_TYPE.get("speaker-view")).toBe("video-cut-assemble")
  })

  it("has the family header translated in every language", () => {
    for (const [locale, tables] of Object.entries(LABEL_TABLES)) {
      expect(tables?.nodeGroup?.["Reframe"], `${locale}: Reframe (family)`).toBeTruthy()
    }
  })

  it("is listed once, and is the only macro", () => {
    expect(NODE_OPTIONS.filter((o) => isCanvasMacroType(o.type)).map((o) => o.type)).toEqual(["reframe"])
    expect(CANVAS_MACROS.map((m) => m.type)).toEqual(["reframe"])
  })

  it("has a label and a subtitle in every language, so the menu never mixes tongues", () => {
    for (const [locale, tables] of Object.entries(LABEL_TABLES)) {
      expect(tables?.node?.["Reframe"], `${locale}: Reframe`).toBeTruthy()
      expect(tables?.node?.["Follow the speaker"], `${locale}: Follow the speaker`).toBeTruthy()
    }
  })
})

describe("a macro is not a node type", () => {
  it("has no node definition, so the store cannot create it and the engines cannot run it", () => {
    expect(NODE_DEFINITIONS.some((d) => (d.type as string) === "reframe")).toBe(false)
    expect(isExecutableNode({ type: "reframe", data: {} } as never)).toBe(false)
  })

  it("is not registered on the backend: no non-test backend source or skills doc names it as a type", () => {
    // A scan of everything the server ships, not three hand-picked files: a stray
    // registration in a route, the MCP tools or a generated skills doc fails here.
    // Tests are exempt: they name the `macro: "reframe"` marker on a group's data.
    const backend = join(SRC, "..", "..", "backend")
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "dist") continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (/["'`]reframe["'`]/.test(readFileSync(path, "utf8"))) hits.push(path)
        }
      }
    }
    for (const dir of ["src", "skills"]) walk(join(backend, dir))
    expect(hits).toEqual([])
  })

  it("inserts only real, registered node types", () => {
    const real = new Set(NODE_DEFINITIONS.map((d) => d.type as string))
    for (const macro of CANVAS_MACROS) for (const t of macro.childTypes) expect(real.has(t), `${macro.type} → ${t}`).toBe(true)
    expect(canvasMacroOf("reframe")!.childTypes).toEqual(REFRAME_CHILD_TYPES)
  })
})

describe("availability follows the nodes it inserts", () => {
  it("is offered when all three are", () => {
    expect(getNodeOptions().some((o) => o.type === REFRAME_ENTRY_TYPE)).toBe(true)
  })

  it.each(REFRAME_CHILD_TYPES)("is hidden when %s is hidden on this deployment", (type) => {
    gates.hidden = new Set([type])
    expect(getNodeOptions().some((o) => o.type === REFRAME_ENTRY_TYPE)).toBe(false)
    // ...and only the macro goes: the others stay.
    expect(getNodeOptions().some((o) => o.type === "text-prompt")).toBe(true)
  })
})

describe("hidden until video mode is open: Speaker View AND Speaker Frames priced (R7, R15, decided 2026-10-12)", () => {
  const OFF_PAIRS = [
    { view: false, frames: true },
    { view: true, frames: false },
    { view: false, frames: false },
  ] as const
  const set = (p: { view: boolean; frames: boolean }) => {
    gates.viewPriced = p.view
    gates.framesPriced = p.frames
  }

  it.each(OFF_PAIRS)("is not offered anywhere (view $view, frames $frames): menu, sidebar, edge-drop and quick-add all read getNodeOptions", (p) => {
    set(p)
    const pool = getNodeOptions()
    expect(pool.some((o) => o.type === REFRAME_ENTRY_TYPE)).toBe(false)
    expect(macrosForConnection(pool, { handleId: "video", direction: "source", nodeType: "upload-video" })).toEqual([])
    // Nothing else goes with it.
    expect(pool.some((o) => o.type === "speaker-view")).toBe(true)
  })

  it("is offered once both are priced", () => {
    set({ view: true, frames: true })
    expect(getNodeOptions().some((o) => o.type === REFRAME_ENTRY_TYPE)).toBe(true)
  })

  it("leaves no empty Reframe header behind", () => {
    set({ view: true, frames: false })
    const sections = tabSections(getNodeOptions(), "video")
    expect(sections.some((sec) => sec.id === "video-reframe")).toBe(false)
    const sidebarFamilies = sidebarSections(getNodeOptions()).flatMap((sec) => sec.families.map((f) => f.id))
    expect(sidebarFamilies).not.toContain("video-reframe")
    set({ view: true, frames: true })
    expect(tabSections(getNodeOptions(), "video").find((sec) => sec.id === "video-reframe")?.options.map((o) => o.type)).toEqual([REFRAME_ENTRY_TYPE])
  })

  it("the store-side insert refuses too, so no stale menu can add it", async () => {
    const { isCanvasMacroOffered } = await import("@/lib/canvas-macros")
    for (const p of OFF_PAIRS) {
      set(p)
      expect(isCanvasMacroOffered("reframe")).toBe(false)
    }
    set({ view: true, frames: true })
    expect(isCanvasMacroOffered("reframe")).toBe(true)
  })
})

describe("the edge-drop menu", () => {
  const pool = getNodeOptions()
  const ids = (list: readonly { type: string }[]) => list.map((o) => o.type)

  it("offers the macro from a video output, and nothing else from anywhere else", () => {
    expect(ids(macrosForConnection(pool, { handleId: "video", direction: "source", nodeType: "upload-video" }))).toEqual(["reframe"])
    expect(macrosForConnection(pool, { handleId: "image", direction: "source", nodeType: "upload-image" })).toEqual([])
    expect(macrosForConnection(pool, { handleId: "text", direction: "source", nodeType: "text-prompt" })).toEqual([])
    // Dragging from an INPUT asks for a producer: a macro is not one.
    expect(macrosForConnection(pool, { handleId: "video", direction: "target", nodeType: "speaker-view" })).toEqual([])
  })

  it("keeps the macro out of the compatibility rules, which have no handles to read", () => {
    expect(ids(withoutMacros(pool))).not.toContain("reframe")
    expect(withoutMacros(pool)).toHaveLength(pool.length - 1)
  })
})

describe("every creation site routes a picked entry through the macro dispatch", () => {
  // A site that handles "component" specially is a site that creates a node
  // from a picked entry; each of them must also route macros, or the pick is a
  // silent no-op (the store refuses a type with no definition).
  const SITES = [
    "components/editor/add-node-popup.tsx",
    "components/editor/node-toolbar.tsx",
    "components/editor/workflow-canvas.tsx",
  ]
  it.each(SITES)("%s", (file) => {
    const src = read(file)
    expect(src).toMatch(/isCanvasMacroType/)
    expect(src).toMatch(/addNodeOrMacro/)
  })

  it("finds no other component that dispatches on 'component' without it", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    const hits = execSync(`grep -rlE 'type === "component"' ${join(SRC, "components")} --include=*.tsx || true`, { encoding: "utf8" })
      .split("\n").filter(Boolean).map((f) => f.slice(SRC.length + 1))
      .filter((f) => !f.includes("__tests__"))
    for (const f of hits) {
      if (SITES.includes(f)) continue
      // Not a creation site (renders / reads an existing component node).
      expect(read(f), f).not.toMatch(/addNode(AndOpenPicker)?\(/)
    }
  })
})

describe("isMacroGroup", () => {
  it("recognises a group a macro made, and no other node", () => {
    expect(isMacroGroup({ type: "group", data: { label: "Reframe", macro: "reframe" } })).toBe(true)
    expect(isMacroGroup({ type: "group", data: { label: "Mine" } })).toBe(false)
    expect(isMacroGroup({ type: "text-prompt", data: { macro: "reframe" } })).toBe(false)
    expect(isMacroGroup(undefined)).toBe(false)
  })
})
