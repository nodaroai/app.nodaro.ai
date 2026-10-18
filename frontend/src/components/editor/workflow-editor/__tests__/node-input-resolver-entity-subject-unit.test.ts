// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"
import type { UnitDefinition } from "@/nodes/kit"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

/**
 * The entity-subject seam with a unit on it: two fixture units, one declaring
 * "input:entity-subject" on an imageUrl input and one not, added through the
 * editor's one door to the unit definitions. The resolver names neither.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const base = real.UNIT_NODE_DEFINITIONS[0]!
  const image = { id: "image", label: "Image", accepts: ["image"], field: "imageUrl" } as const
  const fixture = (type: string, capabilities: string[]): UnitDefinition => ({
    ...base, type, label: type, inputs: ["image"], picker: null,
    handles: { inputs: [image], outputs: base.handles.outputs },
    capabilities,
  })
  const units = [...real.UNIT_NODE_DEFINITIONS, fixture("fixture-subject", ["input:entity-subject"]), fixture("fixture-plain", [])]
  return { ...real, UNIT_NODE_DEFINITIONS: units, unitDefinitionOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

import { resolveNodeInputs, ENTITY_SUBJECT_TARGET_TYPES } from "../node-input-resolver"

const URL = "https://e/entity.png"
/** No handle, the plain portrait, and the entity's identity handle (`characterRef`, `faceRef`, …). */
const handlesOf = (entity: string) => [null, "image", `${entity}Ref`]
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as any

function resolveEntityInto(target: string, entity: string, sourceHandle: string | null) {
  const src = node("s", entity, { sourceImageUrl: URL, imageUrl: URL, characterDbId: "db-1" })
  const tgt = node("t", target)
  return resolveNodeInputs(tgt, [src, tgt], [{ id: "e", source: "s", target: "t", sourceHandle }] as any)
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
        expect(plain.referenceImageUrls, `${entity}@${handle}`).toContain(URL)
      }
    })
  }

  it("routes exactly like a legacy subject target (lip-sync) — identity forwarding included", () => {
    for (const entity of ["character", "face", "object", "creature", "location"]) for (const handle of handlesOf(entity)) {
      expect(resolveEntityInto("fixture-subject", entity, handle)).toEqual(resolveEntityInto("lip-sync", entity, handle))
    }
  })
})
