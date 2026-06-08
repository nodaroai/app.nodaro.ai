import { describe, expect, it } from "vitest"
import { isValidCreatureConnection, IDENTITY_HANDLE_LABELS } from "../identity-handles"
import { IDENTITY_TYPES } from "../generate-image-handles"
import { isValidWorkflowConnection } from "../connection-validation"
import { isVisualPickerType } from "../parameter-picker-types"

// F-batch-B — Animal/Creature identity routing. These assert the keystones
// that let a `creatureRef` act as a valid identity source into image/video
// generation (mirrors the object family).

describe("creature is a recognized identity type", () => {
  it("IDENTITY_TYPES includes creature (so it routes to generate-image's assets handle)", () => {
    expect(IDENTITY_TYPES.has("creature")).toBe(true)
  })

  it("IDENTITY_HANDLE_LABELS has the creature entry (Prompt + Creature type)", () => {
    expect(IDENTITY_HANDLE_LABELS["creature"]).toEqual({
      in: "Prompt",
      type: "Creature type",
    })
  })
})

describe("isValidCreatureConnection", () => {
  it("accepts a text producer on the `in` (Prompt) handle", () => {
    expect(isValidCreatureConnection("in", "text-prompt", isVisualPickerType)).toBe(true)
  })

  it("accepts an animal picker on the `type` handle", () => {
    expect(isValidCreatureConnection("type", "animal", isVisualPickerType)).toBe(true)
  })

  it("rejects a non-picker source on the `type` handle", () => {
    expect(isValidCreatureConnection("type", "text-prompt", isVisualPickerType)).toBe(false)
  })

  it("rejects an unknown target handle", () => {
    expect(isValidCreatureConnection("bogus", "text-prompt", isVisualPickerType)).toBe(false)
  })
})

describe("creatureRef → image edge is valid at the canvas validator", () => {
  // A creature node feeds generate-image's `assets` (identity) handle exactly
  // like character/object. `isValidGenerateImageConnection` gates `assets` on
  // IDENTITY_TYPES membership, so this is the end-to-end creatureRef→image
  // assertion the F-batch-B gate calls for.
  const getType = (id: string): string | undefined =>
    id === "gi1" ? "generate-image" : id === "creature1" ? "creature" : undefined

  it("accepts a creature node wired into generate-image `assets`", () => {
    const ok = isValidWorkflowConnection(
      {
        source: "creature1",
        target: "gi1",
        sourceHandle: "creatureRef",
        targetHandle: "assets",
      },
      getType,
    )
    expect(ok).toBe(true)
  })
})
