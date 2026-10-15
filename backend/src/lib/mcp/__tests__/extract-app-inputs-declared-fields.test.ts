import { describe, it, expect } from "vitest"
import { extractAppInputSchema, flatInputsToOverrides } from "../extract-app-inputs.js"
import { EXPOSABLE_DECLARED_FIELDS } from "../generated/exposable-declared-fields.js"

/**
 * A HAND-DECLARED app field with a known set of values (a select / aspect-ratio card, a toggle — the editor's
 * NODE_DEFINITIONS exposableFields) reaches get_app_inputs typed by the generated table: a select with the
 * values it stores, a boolean. Without a restriction it used to be free text with no options.
 */
const app = (items: unknown[]) =>
  extractAppInputSchema({
    snapshotSettings: { presentationSettings: { inputItems: items as never } },
    snapshotNodes: [
      { id: "mi", type: "modify-image", data: { label: "Edit" } },
      { id: "t2v", type: "text-to-video", data: { label: "Clip" } },
    ],
  })
const field = (id: string, nodeId: string, f: string, extra: Record<string, unknown> = {}) => ({ type: "field", id, nodeId, field: f, ...extra })

describe("extractAppInputSchema — hand-declared fields", () => {
  it("an unrestricted declared select is a select of every option it stores", () => {
    const schema = app([field("f1", "mi", "provider")])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: EXPOSABLE_DECLARED_FIELDS["modify-image"]!.provider!.values })
  })

  it("a restricted one keeps the publisher's values", () => {
    const schema = app([field("f1", "mi", "provider", { allowedValues: ["a"] })])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: ["a"] })
  })

  it("a declared toggle is a boolean, and \"true\" arrives as true", () => {
    const schema = app([field("f1", "t2v", "generateAudio")])
    expect(schema.fields[0]).toMatchObject({ type: "boolean" })
    expect(flatInputsToOverrides({ clip_generateaudio: "true" }, schema.keyMap)).toEqual({ t2v: { generateAudio: true } })
  })
})
