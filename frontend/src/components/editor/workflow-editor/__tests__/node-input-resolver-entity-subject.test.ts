// @test-watches frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { resolveNodeInputs, ENTITY_SUBJECT_TARGET_TYPES } from "../node-input-resolver"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"

/**
 * The entity-subject seam (tools/units/README.md) changes nothing while no unit
 * declares "input:entity-subject". Over EVERY node type × every entity × every
 * handle the entity really emits (its declared outputs, plus an edge with no
 * handle), the wired entity's image lands exactly where it did before the
 * seam: the target's subject (`imageUrl`), one more reference image
 * (`referenceImageUrls`), or nowhere — a target that never reads an entity's
 * image. The table was recorded from origin/dev's resolver before the seam
 * (every type has one outcome for every entity and handle). gif-to-video, a
 * unit declaring "input:entity-subject" since its migration, keeps its outcome
 * (subject) through the capability instead of the legacy list.
 */
type Outcome = "subject" | "reference" | "none"
const LEGACY_ENTITY_SUBJECT_TARGETS = ["ai-avatar", "lip-sync", "motion-transfer", "speech-to-video", "still-to-video"]
/** Units declaring "input:entity-subject": the same outcome, through the capability. */
const UNIT_ENTITY_SUBJECT_TARGETS = ["gif-to-video"]
/** Takes an entity as its image in its own branch, before the entity branch reads the set. */
const ROUTED_BEFORE_THE_ENTITY_BRANCH = ["image-overlay"]
/** Targets the entity's image never reaches. */
const NOT_REACHED = [
  "content-ideas", "deduplicate", "filter-list", "image-collage", "merge-lists", "reduce", "selector",
  "slideshow", "sort-list", "speaker-frames", "telegram-account-send", "ugc-finish-clips", "video-overlay",
]
const outcomeOf = (type: string): Outcome =>
  LEGACY_ENTITY_SUBJECT_TARGETS.includes(type) || UNIT_ENTITY_SUBJECT_TARGETS.includes(type) || ROUTED_BEFORE_THE_ENTITY_BRANCH.includes(type) ? "subject"
    : NOT_REACHED.includes(type) ? "none"
    : "reference"

const ENTITIES = ["character", "face", "object", "creature", "location"]
const URL = "https://e/entity.png"
const definitionOf = (type: string) => NODE_DEFINITIONS.find((d) => d.type === type)
/** No handle, and every output the entity node declares (its identity handle `<entity>Ref`, and `image` where it has one). */
const handlesOf = (entity: string): (string | null)[] => [null, ...(definitionOf(entity)?.outputs ?? [])]

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as any

function landing(target: string, entity: string, sourceHandle: string | null): Outcome | "both" {
  const src = node("s", entity, { sourceImageUrl: URL, imageUrl: URL })
  const tgt = node("t", target)
  const inputs = resolveNodeInputs(tgt, [src, tgt], [{ id: "e", source: "s", target: "t", sourceHandle }] as any)
  const subject = inputs.imageUrl === URL
  const reference = (inputs.referenceImageUrls ?? []).includes(URL)
  return subject && reference ? "both" : subject ? "subject" : reference ? "reference" : "none"
}

describe("entity-subject targets: zero behaviour change", () => {
  it("the set is the legacy list and the units declaring the capability", () => {
    expect(UNIT_NODE_DEFINITIONS.filter((u) => u.capabilities.includes("input:entity-subject")).map((u) => u.type)).toEqual(UNIT_ENTITY_SUBJECT_TARGETS)
    expect([...ENTITY_SUBJECT_TARGET_TYPES].sort()).toEqual([...LEGACY_ENTITY_SUBJECT_TARGETS, ...UNIT_ENTITY_SUBJECT_TARGETS].sort())
  })

  it("covers every node type and each entity's real handles (never vacuous)", () => {
    expect(NODE_DEFINITIONS.length).toBeGreaterThan(200)
    for (const entity of ENTITIES) expect(handlesOf(entity), entity).toContain(`${entity}Ref`)
    expect(handlesOf("character")).toContain("image")
  })

  it("the table names only node types that exist", () => {
    const types = new Set<string>(NODE_DEFINITIONS.map((d) => d.type))
    for (const t of [...LEGACY_ENTITY_SUBJECT_TARGETS, ...UNIT_ENTITY_SUBJECT_TARGETS, ...ROUTED_BEFORE_THE_ENTITY_BRANCH, ...NOT_REACHED]) expect(types.has(t), t).toBe(true)
  })

  for (const { type } of NODE_DEFINITIONS) {
    it(`${type}: a wired entity lands where it did before the seam (${outcomeOf(type)})`, () => {
      for (const entity of ENTITIES) for (const handle of handlesOf(entity)) {
        expect(landing(type, entity, handle), `${entity}@${handle} → ${type}`).toBe(outcomeOf(type))
      }
    })
  }
})
