import { beforeEach, describe, expect, it, vi } from "vitest"

const { rpcMock, maybeSingleMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}))

vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => true }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
        })),
      })),
    })),
  },
}))

import { buildToolkit } from "../toolkit.js"

describe("tk.jobs Recast rescore transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("finds an idempotent rescore child by owner and stable request key", async () => {
    const row = {
      id: "child-1",
      status: "completed",
      input_data: { operationHash: "hash-1" },
      output_data: { videoUrl: "https://cdn.test/result.mp4" },
      error_message: null,
    }
    maybeSingleMock.mockResolvedValue({ data: row, error: null })

    await expect(
      buildToolkit().jobs.findJobByIdempotencyKey?.("user-1", "recast:r1:req:123"),
    ).resolves.toEqual(row)
  })

  it("claims a revision only through the row-locking RPC", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, audio: { version: 1, revision: "rev-1" } },
      error: null,
    })
    const args = {
      recastId: "recast-1",
      childJobId: "child-1",
      userId: "user-1",
      gvpJobId: "gvp-1",
      expectedAudioRevision: "rev-1",
      pendingRescore: {
        jobId: "child-1",
        requestId: "4b5ed4d3-5028-4f11-9afe-15e781b5ecb7",
        state: "pending" as const,
        expectedAudioRevision: "rev-1",
        requestedEffectiveGain: { music: 35, video: 80 },
      },
    }

    await expect(buildToolkit().jobs.claimRecastRescore?.(args)).resolves.toEqual({
      ok: true,
      audio: { version: 1, revision: "rev-1" },
    })
    expect(rpcMock).toHaveBeenCalledWith("claim_recast_rescore", {
      p_recast_id: "recast-1",
      p_child_job_id: "child-1",
      p_user_id: "user-1",
      p_gvp_job_id: "gvp-1",
      p_expected_audio_revision: "rev-1",
      p_pending_rescore: args.pendingRescore,
    })
  })

  it("clears only the matching pending child through the scoped RPC", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })

    await expect(
      buildToolkit().jobs.clearRecastRescoreClaim?.({
        recastId: "recast-1",
        childJobId: "child-1",
        userId: "user-1",
      }),
    ).resolves.toBe(true)
    expect(rpcMock).toHaveBeenCalledWith("clear_recast_rescore_claim", {
      p_recast_id: "recast-1",
      p_child_job_id: "child-1",
      p_user_id: "user-1",
    })
  })

  it("publishes parent delivery and completes the child in one RPC", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const audio = {
      version: 1,
      revision: "rev-2",
      mode: "bed",
      present: { music: true, video: true },
      layers: {
        music: { url: "https://cdn.test/music.m4a" },
        video: { url: "https://cdn.test/video.m4a" },
      },
      bakedEffectiveGain: { music: 60, video: 80 },
    }
    const rescore = {
      videoUrl: "https://cdn.test/result.mp4",
      gvpJobId: "gvp-1",
      tracks: [{ offsetSec: 0, durationSec: 10, url: "https://cdn.test/raw.mp3" }],
      preparedMusicUrl: "https://cdn.test/music.m4a",
    }

    await expect(
      buildToolkit().jobs.publishRecastRescore?.({
        recastId: "recast-1",
        childJobId: "child-1",
        userId: "user-1",
        gvpJobId: "gvp-1",
        expectedAudioRevision: "rev-1",
        resultUrl: "https://cdn.test/result.mp4",
        audio,
        rescore,
      }),
    ).resolves.toBe(true)
    expect(rpcMock).toHaveBeenCalledWith("publish_recast_rescore", {
      p_recast_id: "recast-1",
      p_child_job_id: "child-1",
      p_user_id: "user-1",
      p_gvp_job_id: "gvp-1",
      p_expected_audio_revision: "rev-1",
      p_result_url: "https://cdn.test/result.mp4",
      p_audio: audio,
      p_rescore: rescore,
    })
  })

  it("throws on an RPC error instead of reporting a false CAS loss", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } })

    await expect(
      buildToolkit().jobs.clearRecastRescoreClaim?.({
        recastId: "recast-1",
        childJobId: "child-1",
        userId: "user-1",
      }),
    ).rejects.toThrow(/clear_recast_rescore_claim failed/)
  })
})
