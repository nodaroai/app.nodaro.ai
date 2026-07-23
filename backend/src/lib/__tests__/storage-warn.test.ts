import { describe, it, expect, vi, beforeEach } from "vitest"

const { isMock, eqMock, updateMock } = vi.hoisted(() => ({
  isMock: vi.fn(),
  eqMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: () => ({ update: updateMock }) },
}))

import { recordStorageWarnCrossing, STORAGE_WARN_RATIO } from "../storage-warn.js"

beforeEach(() => {
  vi.clearAllMocks()
  updateMock.mockReturnValue({ eq: eqMock })
  eqMock.mockReturnValue({ is: isMock })
  isMock.mockResolvedValue({ error: null })
})

describe("recordStorageWarnCrossing", () => {
  it("matches the client meter's amber threshold", () => {
    // If this ever diverges from vcp's useStorageStatus.ts, the funnel silently
    // starts comparing two different populations.
    expect(STORAGE_WARN_RATIO).toBe(0.85)
  })

  it("writes once, scoped to the user, only while unset", async () => {
    await recordStorageWarnCrossing("u1", 85, 100)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(eqMock).toHaveBeenCalledWith("id", "u1")
    expect(isMock).toHaveBeenCalledWith("storage_warn_crossed_at", null)
  })

  it("writes at exactly the threshold", async () => {
    await recordStorageWarnCrossing("u1", 850, 1000)
    expect(updateMock).toHaveBeenCalledTimes(1)
  })

  it("does not write below the threshold", async () => {
    await recordStorageWarnCrossing("u1", 84, 100)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it.each([
    ["null limit (uncapped tier)", null],
    ["zero limit", 0],
  ])("does not write with %s", async (_label, limit) => {
    await recordStorageWarnCrossing("u1", 500, limit as number | null)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it("swallows database errors", async () => {
    isMock.mockResolvedValue({ error: { message: "boom" } })
    await expect(recordStorageWarnCrossing("u1", 99, 100)).resolves.toBeUndefined()
  })

  it("swallows thrown errors", async () => {
    updateMock.mockImplementation(() => {
      throw new Error("network")
    })
    await expect(recordStorageWarnCrossing("u1", 99, 100)).resolves.toBeUndefined()
  })
})
