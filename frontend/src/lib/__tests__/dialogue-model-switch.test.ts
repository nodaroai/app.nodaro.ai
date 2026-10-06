import { describe, it, expect } from "vitest"
import { dialogueModelSwitchPatch, nearestStabilityStep } from "../dialogue-model-switch"

describe("nearestStabilityStep", () => {
  it.each([
    [0.3, 0.5], [0.2, 0], [0.25, 0.5], [0.75, 1], [0.74, 0.5], [0, 0], [1, 1],
  ])("%s → %s on the steps 0 / 0.5 / 1 (a tie goes up)", (value, expected) => {
    expect(nearestStabilityStep(value, [0, 0.5, 1])).toBe(expected)
  })
})

describe("dialogueModelSwitchPatch — what a user's dialogue model switch writes", () => {
  it("to v3 dialogue: similarity goes, a stability off v3's steps snaps to the nearest step", () => {
    const patch = dialogueModelSwitchPatch("elevenlabs-dialogue", { stability: 0.3, similarityBoost: 0.8 })
    expect(patch).toStrictEqual({ stability: 0.5, similarityBoost: undefined })
    expect(Object.keys(patch).sort()).toEqual(["similarityBoost", "stability"])
  })

  it("to v3 dialogue: a stability already on a step stays (no key)", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", { stability: 1 })).toStrictEqual({})
  })

  it("to v4 dialogue: nothing to clear — every v3 value is a valid v4 value", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue-v4", { stability: 0.5 })).toStrictEqual({})
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue-v4", { stability: 0.3, similarityBoost: 0.8 })).toStrictEqual({})
  })

  it("an unknown or missing id reads as v3 dialogue", () => {
    for (const next of ["nope", "constructor", "elevenlabs-v4", ""]) {
      expect(dialogueModelSwitchPatch(next, { stability: 0.3, similarityBoost: 0.8 }), next).toStrictEqual({ stability: 0.5, similarityBoost: undefined })
    }
  })

  it("a node that carries neither setting yields an empty patch", () => {
    expect(dialogueModelSwitchPatch("elevenlabs-dialogue", {})).toStrictEqual({})
  })
})
