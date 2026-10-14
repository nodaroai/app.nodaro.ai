import { describe, it, expect } from "vitest"
import { extractAppInputSchema, flatInputsToOverrides } from "../extract-app-inputs.js"
import { EXPOSABLE_QUICK_FIELDS } from "../generated/exposable-quick-fields.js"
import { quickFieldRefusal } from "../../exposed-quick-field-check.js"

/**
 * An app field derived from a node's quick-strip control (the editor's exposable-fields.ts) reaches
 * get_app_inputs typed by the generated table — a select with the values it takes, a number, or a boolean —
 * and a flat input is coerced to the node-data type, the same values the app card writes.
 */
const app = (items: unknown[]) =>
  extractAppInputSchema({
    snapshotSettings: { presentationSettings: { inputItems: items as never } },
    snapshotNodes: [
      { id: "v2v", type: "video-to-video", data: { label: "Restyle" } },
      { id: "gv", type: "generate-video", data: { label: "Clip" } },
      { id: "anv", type: "assemble-narrated-video", data: { label: "Mix" } },
      { id: "s3d", type: "generate-3d-scene", data: { label: "Scene" } },
    ],
  })
const field = (id: string, nodeId: string, f: string, extra: Record<string, unknown> = {}) => ({ type: "field", id, nodeId, field: f, ...extra })

describe("extractAppInputSchema — strip-derived fields", () => {
  it("a fixed list is a select of exactly its values", () => {
    const schema = app([field("f1", "v2v", "provider")])
    expect(schema.fields[0]).toMatchObject({ key: "restyle_provider", type: "select", options: EXPOSABLE_QUICK_FIELDS["video-to-video"]!.provider!.values })
    expect(schema.fields[0]).not.toHaveProperty("description")
  })

  it("a provider-aware list is a select of every model's values, and says so", () => {
    const schema = app([field("f1", "v2v", "v2vResolution")])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: expect.arrayContaining(["720p", "1080p"]) })
    expect(schema.fields[0]!.description).toMatch(/model/i)
  })

  it("a boolean lever is a boolean, and \"true\" arrives as true", () => {
    const schema = app([field("f1", "v2v", "draft")])
    expect(schema.fields[0]).toMatchObject({ type: "boolean" })
    expect(flatInputsToOverrides({ restyle_draft: "true" }, schema.keyMap)).toEqual({ v2v: { draft: true } })
    expect(flatInputsToOverrides({ restyle_draft: false }, schema.keyMap)).toEqual({ v2v: { draft: false } })
  })

  it("a numeric select keeps number options, and a numeric string arrives as a number", () => {
    const schema = app([field("f1", "anv", "voiceVolume"), field("f2", "gv", "duration")])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: expect.arrayContaining([100]) })
    expect(schema.fields[1]).toMatchObject({ type: "select" })
    expect(flatInputsToOverrides({ mix_voicevolume: "100", clip_duration: "8" }, schema.keyMap)).toEqual({
      anv: { voiceVolume: 100 },
      gv: { duration: 8 },
    })
  })

  it("a lever with a custom range is a number with its bounds", () => {
    const schema = app([field("f1", "s3d", "durationSeconds")])
    const spec = EXPOSABLE_QUICK_FIELDS["generate-3d-scene"]!.durationSeconds!
    expect(schema.fields[0]).toMatchObject({ type: "number", min: spec.min, max: spec.max })
  })

  it("a publisher's restriction still wins, coerced to the field's type", () => {
    const schema = app([field("f1", "anv", "voiceVolume", { allowedValues: [50, 100] })])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: [50, 100] })
    expect(flatInputsToOverrides({ mix_voicevolume: "50" }, schema.keyMap)).toEqual({ anv: { voiceVolume: 50 } })
  })

  it("leaves a hand-declared field as before", () => {
    const schema = app([field("f1", "gv", "provider")])
    expect(schema.fields[0]).toMatchObject({ type: "text" })
  })
})

describe("quickFieldRefusal — what an app run holds a strip-derived field to", () => {
  it("holds a fixed list to its values, typed", () => {
    expect(quickFieldRefusal("video-to-video", "provider", "wan")).toBeNull()
    expect(quickFieldRefusal("video-to-video", "provider", "not-a-model")).toMatch(/Allowed/)
    expect(quickFieldRefusal("assemble-narrated-video", "voiceVolume", 100)).toBeNull()
    expect(quickFieldRefusal("assemble-narrated-video", "voiceVolume", "100")).toMatch(/Allowed/)
  })

  it("takes any in-range number where the strip has a custom range", () => {
    const spec = EXPOSABLE_QUICK_FIELDS["generate-3d-scene"]!.durationSeconds!
    expect(quickFieldRefusal("generate-3d-scene", "durationSeconds", spec.min)).toBeNull()
    expect(quickFieldRefusal("generate-3d-scene", "durationSeconds", spec.max! + 1)).toMatch(/between/)
  })

  it("leaves a provider-aware list, a hand-declared field and an unknown node to the route", () => {
    expect(quickFieldRefusal("video-to-video", "v2vResolution", "8k")).toBeNull()
    expect(quickFieldRefusal("generate-video", "provider", "anything")).toBeNull()
    expect(quickFieldRefusal("no-such-node", "provider", "x")).toBeNull()
    expect(quickFieldRefusal(undefined, "provider", "x")).toBeNull()
  })
})
