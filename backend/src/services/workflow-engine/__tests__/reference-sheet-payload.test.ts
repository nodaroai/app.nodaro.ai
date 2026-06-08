import { describe, it, expect } from "vitest"
import { buildPayload, resolveSheetEntity } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

/**
 * Reference Sheet is COMPOSE-ONLY: its (entityKind, entityDbId) are NOT a
 * standard graph output — the executor reads them from the upstream entity node
 * by walking the incoming edge. These tests pin the upstream-walk (via the
 * extracted `resolveSheetEntity` helper) AND the full `buildPayload` case so the
 * worker (`workers/handlers/reference-sheet.ts`) receives the exact payload shape
 * it reads: { jobId, type, skin, flavour, entityKind, entityDbId }.
 */

const sheetNode: SimpleNode = {
  id: "n2",
  type: "reference-sheet",
  data: {
    type: "turnaround",
    skin: "studio",
    flavour: { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" },
  },
}

function ctx(nodes: SimpleNode[], edges: SimpleEdge[]) {
  return { nodes, edges }
}

describe("resolveSheetEntity (upstream-walk)", () => {
  it("reads entityKind+entityDbId from a connected character node", () => {
    const char: SimpleNode = { id: "n1", type: "character", data: { characterDbId: "char-123" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(resolveSheetEntity("n2", ctx([char, sheetNode], edges))).toEqual({
      entityKind: "character",
      entityDbId: "char-123",
    })
  })

  it("reads from a connected object node (objectDbId)", () => {
    const obj: SimpleNode = { id: "n1", type: "object", data: { objectDbId: "obj-9" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(resolveSheetEntity("n2", ctx([obj, sheetNode], edges))).toEqual({
      entityKind: "object",
      entityDbId: "obj-9",
    })
  })

  it("reads from a connected location node (locationDbId)", () => {
    const loc: SimpleNode = { id: "n1", type: "location", data: { locationDbId: "loc-7" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(resolveSheetEntity("n2", ctx([loc, sheetNode], edges))).toEqual({
      entityKind: "location",
      entityDbId: "loc-7",
    })
  })

  it("ignores a connected face node (no panel buckets — not a valid entity)", () => {
    const face: SimpleNode = { id: "n1", type: "face", data: { faceDbId: "face-1" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(resolveSheetEntity("n2", ctx([face, sheetNode], edges))).toEqual({})
  })

  it("returns entityKind with undefined id when the entity has no DB id yet", () => {
    const char: SimpleNode = { id: "n1", type: "character", data: { label: "Hero" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(resolveSheetEntity("n2", ctx([char, sheetNode], edges))).toEqual({
      entityKind: "character",
      entityDbId: undefined,
    })
  })

  it("returns {} when nothing is connected", () => {
    expect(resolveSheetEntity("n2", ctx([sheetNode], []))).toEqual({})
  })
})

describe("reference-sheet buildPayload", () => {
  it("emits the worker-shaped payload with entity (kind, id) + sheet config", () => {
    const char: SimpleNode = { id: "n1", type: "character", data: { characterDbId: "char-123" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    const result = buildPayload(sheetNode, "job-1", {}, "usage-1", ctx([char, sheetNode], edges))

    expect(result.jobName).toBe("reference-sheet")
    expect(result.queueName).toBe("video-generation")
    expect(result.modelIdentifier).toBe("reference-sheet:assembly")
    expect(result.payload).toMatchObject({
      jobId: "job-1",
      type: "turnaround",
      skin: "studio",
      entityKind: "character",
      entityDbId: "char-123",
      usageLogId: "usage-1",
    })
    expect(result.payload.flavour).toEqual(sheetNode.data.flavour)
  })

  it("throws entity_not_ready when nothing is connected (fail fast, no blank charged sheet)", () => {
    // Compose-only: a workflow run with no wired entity must fail at BUILD time so
    // node-executor deletes the pending job and reserves nothing — NOT build a
    // payload that the worker turns into a blank, credit-charged sheet (spec §13).
    expect(() => buildPayload(sheetNode, "job-2", {}, undefined, ctx([sheetNode], []))).toThrow(
      "entity_not_ready",
    )
  })

  it("throws entity_not_ready when the connected entity is unsaved (no DB id yet)", () => {
    const char: SimpleNode = { id: "n1", type: "character", data: { label: "Hero" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    expect(() =>
      buildPayload(sheetNode, "job-2b", {}, undefined, ctx([char, sheetNode], edges)),
    ).toThrow("entity_not_ready")
  })

  it("prices a still sheet as reference-sheet:assembly (flavour-aware, 4cr)", () => {
    // sheetNode's flavour.outputFormat is "still" — the orchestrator must reserve
    // the still assembly id, matching the route's `sheetCreditId` discriminator.
    const char: SimpleNode = { id: "n1", type: "character", data: { characterDbId: "char-123" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    const result = buildPayload(sheetNode, "job-3", {}, "usage-3", ctx([char, sheetNode], edges))
    expect(result.modelIdentifier).toBe("reference-sheet:assembly")
  })

  it("prices a motion sheet as reference-sheet:assembly-motion (flavour-aware, 6cr)", () => {
    // Regression: the orchestrator path previously hardcoded the still id, so a
    // motion sheet run INSIDE a workflow under-billed (4cr instead of 6cr). It
    // must mirror routes/reference-sheet.ts::sheetCreditId.
    const motionSheet: SimpleNode = {
      id: "n2",
      type: "reference-sheet",
      data: {
        type: "turnaround",
        skin: "studio",
        flavour: { outputFormat: "motion", withText: true, showLabels: true, aspect: "landscape", background: "grey" },
      },
    }
    const char: SimpleNode = { id: "n1", type: "character", data: { characterDbId: "char-123" } }
    const edges: SimpleEdge[] = [{ id: "e1", source: "n1", target: "n2" }]
    const result = buildPayload(motionSheet, "job-4", {}, "usage-4", ctx([char, motionSheet], edges))
    expect(result.modelIdentifier).toBe("reference-sheet:assembly-motion")
  })
})
