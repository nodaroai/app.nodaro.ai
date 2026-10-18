// @test-watches backend/src/nodes/**
import { describe, it, expect, vi } from "vitest"
import type { UnitDescriptor } from "../../../nodes/kit.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * The entity-subject seam with a unit on it: two fixture units, one declaring
 * "input:entity-subject" on an imageUrl input and one not, added through the
 * server's one door to the unit descriptors. The resolver names neither.
 */
vi.mock("../../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../lib/unit-descriptors.js")>()
  const base = real.UNIT_NODE_DESCRIPTORS[0]!
  const image = { id: "image", label: "Image", accepts: ["image"], field: "imageUrl" } as const
  const fixture = (type: string, capabilities: string[]): UnitDescriptor => ({
    ...base, type, label: type, inputs: ["image"],
    handles: { inputs: [image], outputs: base.handles.outputs },
    capabilities,
  })
  const units = [...real.UNIT_NODE_DESCRIPTORS, fixture("fixture-subject", ["input:entity-subject"]), fixture("fixture-plain", [])]
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

const { resolveNodeInputs, ENTITY_SUBJECT_TARGET_TYPES } = await import("../input-resolver.js")

const URL = "https://e/entity.png"
/** No handle, the plain portrait, and the entity's identity handle (`characterRef`, `faceRef`, …). */
const handlesOf = (entity: string) => [null, "image", `${entity}Ref`]
function resolveEntityInto(target: string, entity: string, sourceHandle: string | null = null) {
  const src: SimpleNode = { id: "s", type: entity, data: { label: entity, sourceImageUrl: URL } }
  const tgt: SimpleNode = { id: "t", type: target, data: { label: target } }
  const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "t", sourceHandle, targetHandle: null }]
  const states: Record<string, NodeExecutionState> = { s: { status: "completed", output: { imageUrl: URL } } }
  return resolveNodeInputs(tgt, edges, states, [src, tgt])
}

describe("entity-subject seam: a unit declaring the capability", () => {
  it("joins ENTITY_SUBJECT_TARGET_TYPES beside the legacy rows; a unit without it does not", () => {
    expect(ENTITY_SUBJECT_TARGET_TYPES.has("fixture-subject")).toBe(true)
    expect(ENTITY_SUBJECT_TARGET_TYPES.has("fixture-plain")).toBe(false)
    expect(ENTITY_SUBJECT_TARGET_TYPES.has("lip-sync")).toBe(true)
  })

  for (const entity of ["character", "face", "object", "creature", "location"]) {
    it(`a wired ${entity} is the subject (imageUrl) of the declaring unit, a reference of the other`, () => {
      for (const handle of handlesOf(entity)) {
        const subject = resolveEntityInto("fixture-subject", entity, handle)
        expect(subject.imageUrl, `${entity}@${handle}`).toBe(URL)
        expect(subject.referenceImageUrls ?? []).not.toContain(URL)
        const plain = resolveEntityInto("fixture-plain", entity, handle)
        expect(plain.imageUrl, `${entity}@${handle}`).toBeUndefined()
        expect(plain.referenceImageUrls).toContain(URL)
      }
    })
  }

  it("routes exactly like a legacy subject target (lip-sync)", () => {
    for (const entity of ["character", "face", "object", "creature", "location"]) for (const handle of handlesOf(entity)) {
      expect(resolveEntityInto("fixture-subject", entity, handle)).toEqual(resolveEntityInto("lip-sync", entity, handle))
    }
  })
})
