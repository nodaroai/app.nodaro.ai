// @vitest-environment node
import { describe, expect, it } from "vitest"
import { namesUserDirectionRef, userDirectionRefs } from "../user-direction-refs"

const PALETTE = "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MOODBOARD = "moodboard:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

describe("user direction refs (palette / moodboard) on a node", () => {
  it("finds a palette or moodboard value on any key, alone or in a list", () => {
    expect(userDirectionRefs({ colorLook: PALETTE, style: [MOODBOARD], lighting: "golden-hour" })).toEqual([
      { value: PALETTE, kind: "palette" },
      { value: MOODBOARD, kind: "moodboard" },
    ])
    expect(namesUserDirectionRef({ colorLook: PALETTE })).toBe(true)
  })

  it("names none for catalog values, no direction, or a non-object", () => {
    expect(namesUserDirectionRef({ colorLook: "teal-orange", style: "anime" })).toBe(false)
    expect(namesUserDirectionRef(undefined)).toBe(false)
    expect(namesUserDirectionRef("palette:x")).toBe(false)
    expect(userDirectionRefs([PALETTE])).toEqual([])
  })
})
