import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { frameSeatImageCap } = await import("../generate-video.js")

/**
 * The reference assembly reserves the seats a wired frame takes in the same
 * image list, so no `@image_N` directive is numbered onto a reference the
 * provider then drops to keep the frame.
 */
describe("frameSeatImageCap", () => {
  it("subtracts the start frame, and the end frame where the model takes one", () => {
    expect(frameSeatImageCap("seedance-2", true, false)).toBe(8)
    expect(frameSeatImageCap("seedance-2", true, true)).toBe(7)
    expect(frameSeatImageCap("vidu-q4", true, true)).toBe(14) // no end frame on Vidu Q4
    expect(frameSeatImageCap("gemini-omni-video", true, false)).toBe(6)
  })

  it("leaves the provider cap alone when no frame shares the list", () => {
    expect(frameSeatImageCap("seedance-2", false, false)).toBeUndefined()
    expect(frameSeatImageCap("kling", true, false)).toBeUndefined()
  })
})
