import { describe, expect, it } from "vitest"
import { readStudioAction, readStudioSlot } from "../freecut-studio"

describe("the editor's studio layout messages", () => {
  it("reads the slot the editor keeps for Edit with AI", () => {
    expect(readStudioSlot({ open: true, x: 1200, y: 54, width: 360, height: 520 })).toEqual({
      open: true,
      x: 1200,
      y: 54,
      width: 360,
      height: 520,
    })
  })

  it("refuses a slot with a missing or broken number", () => {
    expect(readStudioSlot({ open: true, x: 1, y: 2, width: Number.NaN, height: 4 })).toBeNull()
    expect(readStudioSlot({ x: 1, y: 2 })).toBeNull()
    expect(readStudioSlot(null)).toBeNull()
  })

  it("reads only the buttons it knows", () => {
    expect(readStudioAction({ action: "toggle-side" })).toBe("toggle-side")
    expect(readStudioAction({ action: "close" })).toBe("close")
    expect(readStudioAction({ action: "delete-everything" })).toBeNull()
    expect(readStudioAction(undefined)).toBeNull()
  })
})
