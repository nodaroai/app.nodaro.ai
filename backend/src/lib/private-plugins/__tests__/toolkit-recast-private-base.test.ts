import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  fromMock,
  upsertMock,
  maybeSingleMock,
  deleteTerminalMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  deleteTerminalMock: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: fromMock },
}))

import { buildToolkit } from "../toolkit.js"

describe("tk.jobs private Recast audio base", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockImplementation(() => ({
      upsert: upsertMock,
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ eq: deleteTerminalMock })),
        })),
      })),
    }))
    upsertMock.mockResolvedValue({ error: null })
    maybeSingleMock.mockResolvedValue({
      data: { base_url: "https://private.test/remux.mp4" },
      error: null,
    })
    deleteTerminalMock.mockResolvedValue({ error: null })
  })

  it("stores and reads the base only through the private table", async () => {
    const jobs = buildToolkit().jobs

    await expect(jobs.storeRecastAudioBase?.({
      gvpJobId: "gvp-1",
      userId: "user-1",
      baseUrl: "https://private.test/remux.mp4",
    })).resolves.toBeUndefined()
    await expect(jobs.readRecastAudioBase?.({
      gvpJobId: "gvp-1",
      userId: "user-1",
    })).resolves.toBe("https://private.test/remux.mp4")

    expect(fromMock).toHaveBeenCalledWith("recast_audio_bases")
    expect(upsertMock).toHaveBeenCalledWith({
      gvp_job_id: "gvp-1",
      user_id: "user-1",
      base_url: "https://private.test/remux.mp4",
      updated_at: expect.any(String),
    }, { onConflict: "gvp_job_id" })
  })

  it("scoped-clears an unpublished base", async () => {
    await expect(buildToolkit().jobs.clearRecastAudioBase?.({
      gvpJobId: "gvp-1",
      userId: "user-1",
      baseUrl: "https://private.test/remux.mp4",
    })).resolves.toBeUndefined()

    expect(deleteTerminalMock).toHaveBeenCalledWith("base_url", "https://private.test/remux.mp4")
  })

  it("throws rather than silently losing a required private base", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "permission denied" } })

    await expect(buildToolkit().jobs.storeRecastAudioBase?.({
      gvpJobId: "gvp-1",
      userId: "user-1",
      baseUrl: "https://private.test/remux.mp4",
    })).rejects.toThrow(/permission denied/)
  })
})
