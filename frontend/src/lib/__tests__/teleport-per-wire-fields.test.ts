// @vitest-environment node
/**
 * A setting a consumer saves PER node wired into it (a track volume, an order,
 * a selected start frame, …) names that node by the id the wire was DRAWN from
 * — a Teleport Receive's id when the wire leaves one. Both engines read the
 * graph with the pair bypassed, so they name the origin instead, and
 * `carriedNodeSettings` (@nodaro/render-rules teleport-bypass.ts) translates the
 * saved ids at the one place a run is built — but only for the fields it lists.
 * A field it misses is silently lost through a pair (Mix Audio's volumes and
 * duck key were).
 *
 * This census reads every node type's declared data fields (NODE_DATA_FIELDS,
 * generated from types/nodes.ts) and fails on any field whose NAME says it
 * holds wired node ids that is neither listed in render-rules nor exempted
 * below with its reason.
 */
import { describe, expect, it } from "vitest"
import {
  NODE_DATA_FIELDS,
  PER_WIRE_ENTRY_FIELDS,
  PER_WIRE_ID_FIELDS,
  PER_WIRE_KEYED_FIELDS,
  PER_WIRE_ORDER_FIELDS,
} from "@nodaro/render-rules"

/** Names that read as "ids of the nodes wired in" (or settings keyed by them). */
const LOOKS_PER_WIRE = /(Order|BySource|SourceIds?|NodeIds?|Roles|ObjectIds|Volumes|Offsets|Settings|Map|Injections|Config|Under)$|^reference$/

/** Fields that match the name rule but do not hold the ids of wired nodes. */
const NOT_PER_WIRE: Record<string, string> = {
  itemOrder: "Preview's order of preview-item keys, written from the run's own results",
  lockedObjectIds: "ids of objects in a 3D scene, not nodes",
  selectedObjectIds: "ids of objects in a 3D scene, not nodes",
  createdNodeIds: "nodes a writer CREATED downstream, never a wire into it",
  exposedSettings: "an app's exposed settings, keyed by field",
  strategyConfig: "Reduce's strategy options, keyed by option",
  speakerMap: "speaker label → the EDL's camera id, minted by Edit Plan's run (already the run's id)",
}

describe("every per-wire node-data field is translated through a Teleport pair", () => {
  const classified = new Set<string>([
    ...PER_WIRE_ORDER_FIELDS,
    ...PER_WIRE_KEYED_FIELDS,
    ...PER_WIRE_ID_FIELDS,
    ...Object.keys(PER_WIRE_ENTRY_FIELDS),
  ])
  const allFields = new Set(Object.values(NODE_DATA_FIELDS).flatMap((spec) => spec.fields))

  it("the census sees the fields", () => {
    expect(allFields.has("trackSettings")).toBe(true)
    expect(allFields.has("trackVolumes")).toBe(true)
  })

  for (const field of [...allFields].filter((f) => LOOKS_PER_WIRE.test(f)).sort()) {
    it(`${field} is listed in render-rules teleport-bypass.ts or exempted with a reason`, () => {
      expect(
        classified.has(field) || field in NOT_PER_WIRE,
        `${field}: add it to the PER_WIRE_* list matching its shape, or to NOT_PER_WIRE with why it holds no wired node id`,
      ).toBe(true)
    })
  }

  it("no exemption is also listed, and every exemption is a real field", () => {
    for (const field of Object.keys(NOT_PER_WIRE)) {
      expect(classified.has(field), field).toBe(false)
      expect(allFields.has(field), field).toBe(true)
    }
  })
})
