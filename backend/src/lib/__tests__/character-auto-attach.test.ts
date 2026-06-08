import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock supabase BEFORE importing the module-under-test.
vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

import { supabase } from "../supabase.js"
import { appendCharacterReferenceVideo } from "../character-auto-attach.js"

const mockRpc = vi.mocked(supabase.rpc)

describe("appendCharacterReferenceVideo", () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it("calls append_character_reference_video with mapped param names and returns true", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null } as never)
    const ok = await appendCharacterReferenceVideo({
      characterId: "char-1",
      userId: "user-1",
      variant: "happy",
      url: "https://r2.example/clip.mp4",
    })
    expect(ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith("append_character_reference_video", {
      p_character_id: "char-1",
      p_user_id: "user-1",
      p_variant: "happy",
      p_url: "https://r2.example/clip.mp4",
    })
  })

  it("returns false + logs on RPC error (best-effort, never throws)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ok = await appendCharacterReferenceVideo({
      characterId: "char-1",
      userId: "user-1",
      variant: "happy",
      url: "https://r2.example/clip.mp4",
    })
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("boom"))
    warnSpy.mockRestore()
  })

  it("returns false + logs on thrown error", async () => {
    mockRpc.mockRejectedValue(new Error("network down"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ok = await appendCharacterReferenceVideo({
      characterId: "char-1",
      userId: "user-1",
      variant: "happy",
      url: "https://r2.example/clip.mp4",
    })
    expect(ok).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("network down"))
    warnSpy.mockRestore()
  })
})
