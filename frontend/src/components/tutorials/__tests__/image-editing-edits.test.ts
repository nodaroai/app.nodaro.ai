import { describe, it, expect } from "vitest"
import { getPickerCatalog } from "@nodaro/prompts"
// The seeded template itself, imported so the path is resolved at build time
// rather than against whatever directory the runner happens to start in.
import seed from "../../../../../backend/src/lib/tutorial-seed/templates/get-started-with-image-editing.json"
import { deriveEditFanOut } from "../bodies/image-editing-edits"
import { EDIT_ORDER, EDIT_PROSE } from "../bodies/image-editing-content"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}, y = 0) =>
  ({ id, type, position: { x: 0, y }, data }) as unknown as WorkflowNode

const edge = (source: string, target: string) =>
  ({ id: `${source}-${target}`, source, target }) as unknown as WorkflowEdge

/** A minimal fan-out: one base image read by two edits. */
function fanOut() {
  return {
    nodes: [
      node("base", "generate-image", { prompt: "a room", resolution: "4K", aspectRatio: "16:9" }),
      node("written", "modify-image", { label: "Jacket", prompt: "make it navy", provider: "gpt-image-2-i2i" }, 10),
      node("picked", "modify-image", { label: "Lit", provider: "gpt-image-2-i2i" }, 20),
      node("lighting", "lighting", { timeOfDay: "golden-hour" }),
    ],
    edges: [edge("base", "written"), edge("base", "picked"), edge("lighting", "picked")],
  }
}

describe("deriveEditFanOut", () => {
  // The hub is what makes this template a fan-out rather than a chain, and it is
  // found structurally — the node the most edges leave — so the lesson survives
  // the original being an upload instead of a generation.
  it("finds the base image as the node everything reads", () => {
    const { base, edits } = deriveEditFanOut(fanOut().nodes, fanOut().edges)
    expect(base?.nodeId).toBe("base")
    expect(base?.chips).toEqual(["4K", "16:9"])
    expect(edits.map((e) => e.nodeId)).toEqual(["written", "picked"])
  })

  it("returns nothing usable when no node fans out", () => {
    const nodes = [node("a", "generate-image"), node("b", "modify-image")]
    const result = deriveEditFanOut(nodes, [edge("a", "b")])
    expect(result.base).toBeNull()
    expect(result.edits).toEqual([])
  })

  // Picker values are resolved through PICKER_CATALOGS, never a local map: a
  // renamed option must not need a second edit here to stay correct.
  it("reads a picker driver's label out of its catalog", () => {
    const { edits } = deriveEditFanOut(fanOut().nodes, fanOut().edges)
    const picked = edits.find((e) => e.nodeId === "picked")!
    expect(picked.driverKind).toBe("LIGHTING")
    expect(picked.driverValue).toBe("Golden Hour")
    expect(picked.drivers).toHaveLength(1)
  })

  it("names a written edit PROMPT and shows the prompt itself", () => {
    const { edits } = deriveEditFanOut(fanOut().nodes, fanOut().edges)
    const written = edits.find((e) => e.nodeId === "written")!
    expect(written.driverKind).toBe("PROMPT")
    expect(written.driverValue).toBe("make it navy")
  })

  // Two Style nodes feeding one edit is the template's least obvious capability,
  // so it has to READ as two rather than being flattened to one name.
  it("says so out loud when two drivers of one kind feed an edit", () => {
    const nodes = [
      node("base", "generate-image"),
      node("edit", "modify-image", { label: "Blended" }),
      node("s1", "style", { style: "anime" }),
      node("s2", "style", { style: "oil-painting" }),
    ]
    const edges = [edge("base", "edit"), edge("base", "other"), edge("s1", "edit"), edge("s2", "edit")]
    const { edits } = deriveEditFanOut(nodes, edges)
    const blended = edits.find((e) => e.nodeId === "edit")!
    expect(blended.driverKind).toBe("STYLE x2")
    expect(blended.driverValue).toContain(" + ")
    expect(blended.drivers).toHaveLength(2)
  })

  it("falls back to the node type when there is neither a driver nor a prompt", () => {
    const nodes = [
      node("base", "generate-image"),
      node("cut", "remove-background", { label: "Remove Background" }),
      node("other", "modify-image", { prompt: "x" }),
    ]
    const { edits } = deriveEditFanOut(nodes, [edge("base", "cut"), edge("base", "other")])
    const cut = edits.find((e) => e.nodeId === "cut")!
    expect(cut.driverKind).toBe("REMOVE BACKGROUND")
    expect(cut.driverValue).toBe("")
  })

  // The critic scores the original rather than producing an edit, so it belongs
  // beside the original — a tenth tile in the results grid would be a lie.
  it("splits the critic out of the results", () => {
    const nodes = [
      node("base", "generate-image"),
      node("critic", "image-critic", { score: 0.88, threshold: 0.7, approved: true, mode: "realism" }),
      node("edit", "modify-image", { prompt: "x" }),
    ]
    const { critic, edits } = deriveEditFanOut(nodes, [edge("base", "critic"), edge("base", "edit")])
    expect(critic).toMatchObject({ score: 0.88, threshold: 0.7, approved: true, mode: "realism" })
    expect(edits.map((e) => e.nodeId)).toEqual(["edit"])
  })

  it("orders by the authored list and appends anything it does not mention", () => {
    const nodes = [
      node("base", "generate-image"),
      node("first", "modify-image", { prompt: "a" }, 300),
      node("second", "modify-image", { prompt: "b" }, 100),
      node("extra", "modify-image", { prompt: "c" }, 200),
    ]
    const edges = [edge("base", "first"), edge("base", "second"), edge("base", "extra")]
    const { edits } = deriveEditFanOut(nodes, edges, ["first", "second"])
    expect(edits.map((e) => e.nodeId)).toEqual(["first", "second", "extra"])
    expect(edits.map((e) => e.index)).toEqual([1, 2, 3])
  })
})

// The prose is keyed by node id, so it silently detaches if the shipped template
// is ever re-exported with different ids. Read the seeded template itself rather
// than trusting that the two files were edited together.
describe("the shipped template", () => {
  const derived = deriveEditFanOut(
    seed.nodes as unknown as WorkflowNode[],
    seed.edges as unknown as WorkflowEdge[],
    EDIT_ORDER,
  )

  it("has a base image, a critic and nine edits", () => {
    expect(derived.base?.imageUrl).toBeTruthy()
    expect(derived.base?.prompt).not.toBe("")
    expect(derived.critic?.score).toBeGreaterThan(0)
    expect(derived.edits).toHaveLength(9)
  })

  it("gives every edit a written explanation and a result to show", () => {
    for (const edit of derived.edits) {
      expect(EDIT_PROSE[edit.nodeId], `no prose for ${edit.nodeId}`).toBeDefined()
      expect(edit.resultUrl, `no result on ${edit.nodeId}`).toBeTruthy()
      expect(edit.driverKind).not.toBe("")
    }
  })

  // Asserting only that SOME driver resolved is what let the multi-dimension
  // Lighting picker read as no driver at all while the suite stayed green. Every
  // picker wired into an edit has to come out the other side.
  it("reads every picker node in the template as a driver", () => {
    const byId = new Map(seed.nodes.map((n) => [n.id, n]))
    const wiredPickers = new Set(
      seed.edges
        .map((e) => byId.get(e.source))
        .filter((n) => n && getPickerCatalog(n.type as string))
        .map((n) => n!.id),
    )
    expect(wiredPickers.size).toBeGreaterThan(0)

    const seen = new Set(derived.edits.flatMap((e) => e.drivers).map((d) => d.nodeId))
    for (const id of wiredPickers) expect(seen.has(id), `${id} was not read as a driver`).toBe(true)
  })

  it("resolves every picker driver to a real catalog label", () => {
    for (const driver of derived.edits.flatMap((e) => e.drivers)) {
      // A raw id leaking through means the catalog lookup missed.
      expect(driver.value, `${driver.nodeId} has no value`).not.toBe("")
      expect(driver.value, `${driver.nodeId} shows a raw id`).not.toMatch(
        /^[a-z0-9]+(-[a-z0-9]+)+$/,
      )
    }
  })

  it("keeps the authored order pointing at edits that still exist", () => {
    const ids = new Set(derived.edits.map((e) => e.nodeId))
    for (const id of EDIT_ORDER) expect(ids.has(id), `${id} is no longer an edit`).toBe(true)
  })
})

// A duplicate edge is not exotic: hand-edited workflow JSON, an import, or a
// re-connect can all leave two edges between the same pair. Counting edges
// rather than sources reported "STYLE x2" for a SINGLE Style node — which would
// make the tutorial lie about the one capability it exists to demonstrate.
describe("duplicate wiring", () => {
  it("counts one picker wired twice as one driver", () => {
    const nodes = [
      node("base", "generate-image"),
      node("edit", "modify-image", { label: "E" }),
      node("s1", "style", { style: "anime" }),
      node("other", "modify-image", { prompt: "x" }),
    ]
    const edges = [
      edge("base", "edit"),
      edge("base", "other"),
      { id: "d1", source: "s1", target: "edit" } as unknown as WorkflowEdge,
      { id: "d2", source: "s1", target: "edit" } as unknown as WorkflowEdge,
    ]
    const traced = deriveEditFanOut(nodes, edges).edits.find((e) => e.nodeId === "edit")!
    expect(traced.drivers).toHaveLength(1)
    expect(traced.driverKind).toBe("STYLE")
    expect(traced.driverValue).toBe("Anime")
  })
})
