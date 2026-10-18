// @test-watches backend/src/nodes/**
import { describe, it, expect } from "vitest"
import { resolveNodeInputs, ENTITY_SUBJECT_TARGET_TYPES } from "../input-resolver.js"
import { NODE_REGISTRY } from "../../../lib/node-registry.js"
import { NODE_HANDLES } from "../../../lib/mcp/generated/node-handles.js"
import { UNIT_NODE_DESCRIPTORS } from "../../../lib/unit-descriptors.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * The entity-subject seam (tools/units/README.md) changes nothing while no unit
 * declares "input:entity-subject". Over EVERY node type × every entity × every
 * handle the entity really emits (its declared outputs, plus an edge with no
 * handle), the wired entity's image lands exactly where it did before the
 * seam: the target's subject (`imageUrl`), one more reference image
 * (`referenceImageUrls`), or nowhere — a target that never reads an entity's
 * image. The table was recorded from origin/dev's resolver before the seam
 * (every type has one outcome for every entity and handle). The server's list
 * lacks gif-to-video, which the editor's has (see ENTITY_SUBJECT_TARGET_TYPES):
 * here it takes the entity as a reference.
 */
type Outcome = "subject" | "reference" | "none"
const LEGACY_ENTITY_SUBJECT_TARGETS = ["ai-avatar", "lip-sync", "motion-transfer", "speech-to-video", "still-to-video"]
/** Takes an entity as its image in its own branch, before the entity branch reads the set. */
const ROUTED_BEFORE_THE_ENTITY_BRANCH = ["image-overlay"]
/** Targets the entity's image never reaches. */
const NOT_REACHED = [
  "content-ideas", "deduplicate", "filter-list", "image-collage", "merge-lists", "reduce", "selector",
  "slideshow", "sort-list", "speaker-frames", "telegram-account-send", "ugc-finish-clips", "video-overlay",
]
const outcomeOf = (type: string): Outcome =>
  LEGACY_ENTITY_SUBJECT_TARGETS.includes(type) || ROUTED_BEFORE_THE_ENTITY_BRANCH.includes(type) ? "subject"
    : NOT_REACHED.includes(type) ? "none"
    : "reference"

const ENTITIES = ["character", "face", "object", "creature", "location"]
const URL = "https://e/entity.png"
/** No handle, and every output the entity node declares (its identity handle `<entity>Ref`, and `image` where it has one). */
const handlesOf = (entity: string): (string | null)[] => [null, ...(NODE_HANDLES[entity]?.outputs ?? [])]

function landing(target: string, entity: string, sourceHandle: string | null): Outcome | "both" {
  const src: SimpleNode = { id: "s", type: entity, data: { label: entity, sourceImageUrl: URL } }
  const tgt: SimpleNode = { id: "t", type: target, data: { label: target } }
  const edges: SimpleEdge[] = [{ id: "e", source: "s", target: "t", sourceHandle, targetHandle: null }]
  const states: Record<string, NodeExecutionState> = { s: { status: "completed", output: { imageUrl: URL } } }
  const inputs = resolveNodeInputs(tgt, edges, states, [src, tgt])
  const subject = inputs.imageUrl === URL
  const reference = (inputs.referenceImageUrls ?? []).includes(URL)
  return subject && reference ? "both" : subject ? "subject" : reference ? "reference" : "none"
}

describe("entity-subject targets: zero behaviour change", () => {
  it("no unit declares the capability yet, so the set is the legacy list", () => {
    expect(UNIT_NODE_DESCRIPTORS.filter((u) => u.capabilities.includes("input:entity-subject"))).toEqual([])
    expect([...ENTITY_SUBJECT_TARGET_TYPES].sort()).toEqual(LEGACY_ENTITY_SUBJECT_TARGETS)
  })

  it("covers every node type and each entity's real handles (never vacuous)", () => {
    expect(NODE_REGISTRY.length).toBeGreaterThan(200)
    for (const entity of ENTITIES) expect(handlesOf(entity), entity).toContain(`${entity}Ref`)
    expect(handlesOf("character")).toContain("image")
  })

  it("the table names only node types that exist", () => {
    const types = new Set(NODE_REGISTRY.map((d) => d.type))
    for (const t of [...LEGACY_ENTITY_SUBJECT_TARGETS, ...ROUTED_BEFORE_THE_ENTITY_BRANCH, ...NOT_REACHED]) expect(types.has(t), t).toBe(true)
  })

  for (const { type } of NODE_REGISTRY) {
    it(`${type}: a wired entity lands where it did before the seam (${outcomeOf(type)})`, () => {
      for (const entity of ENTITIES) for (const handle of handlesOf(entity)) {
        expect(landing(type, entity, handle), `${entity}@${handle} → ${type}`).toBe(outcomeOf(type))
      }
    })
  }
})
