import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The finalize gate is FAIL-CLOSED and runs before anything is reserved: a
 * foreign, unknown, non-draft, non-Seedance, unfinished or relayed source is
 * refused with a coded 4xx, and a valid draft is priced from the SOURCE job.
 */

type Row = {
  id: string
  user_id: string | null
  status: string | null
  provider_task_id: string | null
  provider_kind: string | null
  relay_job_id?: string | null
  input_data: Record<string, unknown> | null
  output_data: Record<string, unknown> | null
}

const db = vi.hoisted(() => ({ rows: [] as Row[], filters: [] as Array<[string, string]> }))
vi.mock("../supabase.js", () => {
  const chain = () => {
    const filters: Array<[string, string]> = []
    const q = {
      select: () => q,
      eq: (col: string, val: string) => { filters.push([col, val]); db.filters.push([col, val]); return q },
      limit: async () => ({
        data: db.rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)),
        error: null,
      }),
    }
    return q
  }
  return { supabase: { from: () => chain() } }
})

const probe = vi.hoisted(() => ({ fn: (async () => 4.04) as (url: string) => Promise<number>, urls: [] as string[] }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: async () => {},
  getVideoStreamDuration: async (url: string) => {
    probe.urls.push(url)
    return probe.fn(url)
  },
}))
vi.mock("../ref-video-probe.js", () => ({ probeRefVideoDurations: async () => [6] }))

import {
  measureSeedanceDraftRenderSec,
  resolveSeedanceDraftFinalize,
  seedanceDraftFinalizeStamp,
  seedanceDraftFinalizeReserveId,
} from "../seedance-draft-finalize.js"

const USER = "user-a"
const DRAFT_ID = "11111111-2222-4333-8444-555555555555"

function draftRow(over: Partial<Row> = {}, input: Record<string, unknown> = {}): Row {
  return {
    id: DRAFT_ID,
    user_id: USER,
    status: "completed",
    provider_task_id: "task-draft",
    provider_kind: "kie-standard",
    input_data: { provider: "seedance-2-5", draft: true, resolution: "480p", duration: 4, ...input },
    output_data: { videoUrl: "https://cdn.example/draft.mp4" },
    ...over,
  }
}

beforeEach(() => {
  db.rows = []
  db.filters = []
  probe.fn = async () => 4.04
  probe.urls = []
})

describe("resolveSeedanceDraftFinalize — refusals", () => {
  it("needs a task id or a job id", async () => {
    const r = await resolveSeedanceDraftFinalize({ userId: USER })
    expect(r).toMatchObject({ ok: false, status: 400, code: "draft_source_required" })
  })

  it("an unknown id is 404 (also a malformed job id, without a query)", async () => {
    expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "nope" })).toMatchObject({ ok: false, status: 404, code: "draft_not_found" })
    expect(await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: "not-a-uuid" })).toMatchObject({ ok: false, status: 404 })
  })

  it("another user's draft is refused (IDOR), by task id and by job id", async () => {
    db.rows = [draftRow({ user_id: "someone-else" })]
    expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })).toMatchObject({ ok: false, status: 403, code: "forbidden" })
    expect(await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_ID })).toMatchObject({ ok: false, status: 403 })
  })

  it("a Seedance 2.5 run made without Draft is not finalizable", async () => {
    db.rows = [draftRow({}, { draft: undefined })]
    expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })).toMatchObject({ ok: false, status: 422, code: "not_a_draft" })
  })

  it("another model's video is refused, even if it says draft", async () => {
    db.rows = [draftRow({}, { provider: "veo3.1", draft: true })]
    expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })).toMatchObject({ ok: false, status: 422, code: "not_a_seedance_draft" })
  })

  it("an unfinished or failed draft is refused", async () => {
    for (const status of ["processing", "failed", "pending"]) {
      db.rows = [draftRow({ status })]
      expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })).toMatchObject({ ok: false, status: 409, code: "draft_not_ready" })
    }
  })

  it("a draft relayed through a connected account is refused, saying so", async () => {
    db.rows = [draftRow({ provider_kind: "nodaro-cloud" })]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: false, status: 409, code: "draft_not_finalizable" })
    expect((r as { message: string }).message).toMatch(/connected nodaro\.ai account/)
    db.rows = [{ ...draftRow(), relay_job_id: "cloud-job" } as Row]
    expect(await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_ID })).toMatchObject({ ok: false, code: "draft_not_finalizable" })
  })

  it("a draft with no recorded provider task is refused, without blaming a relay", async () => {
    db.rows = [draftRow({ provider_task_id: null })]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_ID })
    expect(r).toMatchObject({ ok: false, status: 409, code: "draft_not_finalizable" })
    expect((r as { message: string }).message).toMatch(/no provider task recorded/)
  })

  it("a voiced draft (its kind still the pickup sentinel) is finalizable once its task id is recorded", async () => {
    db.rows = [draftRow({ provider_kind: "pre-task" })]
    expect(await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_ID })).toMatchObject({ ok: true })
  })

  it("a draft whose length cannot be read is refused, nothing priced", async () => {
    db.rows = [draftRow()]
    probe.fn = async () => { throw new Error("ffprobe failed") }
    expect(await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })).toMatchObject({ ok: false, status: 422, code: "invalid_media_duration" })
  })
})

describe("resolveSeedanceDraftFinalize — pricing from the source job", () => {
  it("a no-reference draft prices its delivered length", async () => {
    db.rows = [draftRow()]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, sourceJobId: DRAFT_ID })
    expect(r).toEqual({
      ok: true,
      sourceJobId: DRAFT_ID,
      draftTaskId: "task-draft",
      outputSec: 4,
      hasRefVideo: false,
      refVideoDurationsSec: [],
      creditId: "seedance-2-5-hd:4s",
    })
  })

  it("a reference-video draft carries its own reservation probe", async () => {
    db.rows = [draftRow({}, { referenceVideoUrls: ["https://cdn.example/in.mp4"], refVideoDurationsSec: [4.04], duration: -1 })]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, hasRefVideo: true, refVideoDurationsSec: [4.04], creditId: "seedance-2-5-hd:4s-ref" })
  })

  it("picks the draft among rows sharing a task id", async () => {
    db.rows = [
      draftRow({ id: "child", input_data: { provider: "veo-1080p" } }),
      draftRow(),
    ]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, sourceJobId: DRAFT_ID })
  })

  it("bills the RAW take recorded at completion, not an audio-muxed stored clip (no over-bill)", async () => {
    // A 4 s draft whose stored clip was muxed with a 10 s audio track
    // (amix duration=longest): the take KIE re-renders is still 4 s.
    db.rows = [draftRow({ output_data: { videoUrl: "https://cdn.example/muxed.mp4", draftRenderSec: 4.04 } })]
    probe.fn = async () => 10
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, outputSec: 4, creditId: "seedance-2-5-hd:4s" })
    expect(probe.urls).toEqual([])
  })

  it("an Auto-duration draft later loop-cut bills its full raw take (no under-bill)", async () => {
    db.rows = [draftRow(
      { output_data: { videoUrl: "https://cdn.example/cut.mp4", draftRenderSec: 12.04 } },
      { duration: -1, loopTrim: { enabled: true } },
    )]
    probe.fn = async () => 7.5
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, outputSec: 12, creditId: "seedance-2-5-hd:12s" })
  })

  it("an edit-mode reference draft bills its raw take with the reference-video row", async () => {
    db.rows = [draftRow(
      { output_data: { videoUrl: "https://cdn.example/edit.mp4", draftRenderSec: 9.04 } },
      { duration: -1, referenceVideoUrls: ["https://cdn.example/in.mp4"], refVideoDurationsSec: [9.04] },
    )]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, outputSec: 9, hasRefVideo: true, creditId: "seedance-2-5-hd:9s-ref" })
  })

  it("without a recorded take, reads the stored clip's VIDEO stream", async () => {
    db.rows = [draftRow()]
    probe.fn = async () => 6.04
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, outputSec: 6 })
    expect(probe.urls).toEqual(["https://cdn.example/draft.mp4"])
  })

  it("without a recorded take, a smart-loop-cut draft bills at least its requested length (the finalize renders the full take)", async () => {
    db.rows = [draftRow({}, { duration: 8, loopTrim: { enabled: true } })]
    probe.fn = async () => 6.5
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, outputSec: 8, creditId: "seedance-2-5-hd:8s" })
  })
})

describe("resolveSeedanceDraftFinalize — the draft's audio mux rides the plan", () => {
  it("a voiced draft carries its recorded voice-track recipe and the stored clip (fallback source)", async () => {
    const mux = { kind: "voice-track", audioUrl: "https://r2/track.mp3" }
    db.rows = [draftRow({ output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: 4.04, draftAudioMux: mux, voiceApplied: true } })]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true, audioMux: mux, draftVideoUrl: "https://cdn.example/draft.mp4" })
  })

  it("a plain draft (recorded null) carries no mux", async () => {
    db.rows = [draftRow({ output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: 4.04, draftAudioMux: null } })]
    const r = await resolveSeedanceDraftFinalize({ userId: USER, taskId: "task-draft" })
    expect(r).toMatchObject({ ok: true })
    expect(r).not.toHaveProperty("audioMux")
  })

  it("the workflow stamp carries the recipe to the worker", async () => {
    const mux = { kind: "voice-track", audioUrl: "https://r2/track.mp3" }
    db.rows = [draftRow({ output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: 4.04, draftAudioMux: mux } })]
    const payload: Record<string, unknown> = { provider: "seedance-2-5-hd", kieTaskId: "task-draft" }
    const stamp = await seedanceDraftFinalizeStamp("video-upscale", payload, USER)
    expect(stamp).toMatchObject({ ok: true, patch: { draftAudioMux: mux, draftVideoUrl: "https://cdn.example/draft.mp4" } })
    expect(payload).toStrictEqual({ provider: "seedance-2-5-hd", kieTaskId: "task-draft" })
  })

  it("a plain draft's patch has no mux keys at all (not undefined ones)", async () => {
    db.rows = [draftRow({ output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: 4.04, draftAudioMux: null } })]
    const stamp = await seedanceDraftFinalizeStamp("video-upscale", { provider: "seedance-2-5-hd", kieTaskId: "task-draft" }, USER)
    expect(stamp.ok && Object.keys(stamp.patch).sort()).toStrictEqual(
      ["draftHasRefVideo", "draftOutputSec", "draftRefVideoDurationsSec", "kieTaskId", "reservedCreditId", "sourceJobId"],
    )
  })
})

describe("seedanceDraftFinalizeStamp (workflow run)", () => {
  it("returns the draft's task, the price row and the source as a patch — the payload itself is never mutated", async () => {
    db.rows = [draftRow()]
    const payload: Record<string, unknown> = { provider: "seedance-2-5-hd", kieTaskId: "task-draft" }
    const stamp = await seedanceDraftFinalizeStamp("video-upscale", payload, USER)
    expect(stamp).toMatchObject({ ok: true, patch: { sourceJobId: DRAFT_ID, kieTaskId: "task-draft", reservedCreditId: "seedance-2-5-hd:4s" } })
    expect(payload).toStrictEqual({ provider: "seedance-2-5-hd", kieTaskId: "task-draft" })
    const stamped = { ...payload, ...(stamp.ok ? stamp.patch : {}) }
    expect(seedanceDraftFinalizeReserveId("video-upscale", stamped)).toBe("seedance-2-5-hd:4s")
  })

  it("returns the route's refusal, and an empty patch for every other job", async () => {
    db.rows = [draftRow({ user_id: "someone-else" })]
    expect(await seedanceDraftFinalizeStamp("video-upscale", { provider: "seedance-2-5-hd", kieTaskId: "task-draft" }, USER))
      .toMatchObject({ ok: false, refusal: { code: "forbidden" } })
    const topaz: Record<string, unknown> = { provider: "topaz", videoUrl: "https://x/v.mp4" }
    expect(await seedanceDraftFinalizeStamp("video-upscale", topaz, USER)).toStrictEqual({ ok: true, patch: {} })
    expect(topaz).toStrictEqual({ provider: "topaz", videoUrl: "https://x/v.mp4" })
    expect(seedanceDraftFinalizeReserveId("video-upscale", topaz)).toBeUndefined()
  })
})

describe("measureSeedanceDraftRenderSec (recorded when a draft completes)", () => {
  it("measures the raw provider clip of a draft", async () => {
    probe.fn = async () => 4.04
    expect(await measureSeedanceDraftRenderSec({ draft: true, provider: "seedance-2-5", outputUrl: "https://kie.example/raw.mp4" })).toBe(4.04)
    expect(probe.urls).toEqual(["https://kie.example/raw.mp4"])
  })

  it("is undefined (and probes nothing) for a non-draft run or a model without drafts", async () => {
    expect(await measureSeedanceDraftRenderSec({ draft: undefined, provider: "seedance-2-5", outputUrl: "u" })).toBeUndefined()
    expect(await measureSeedanceDraftRenderSec({ draft: true, provider: "kling-3.0", outputUrl: "u" })).toBeUndefined()
    expect(probe.urls).toEqual([])
  })

  it("is undefined when the clip cannot be measured (the gate then reads the stored clip)", async () => {
    probe.fn = async () => { throw new Error("ffprobe failed") }
    expect(await measureSeedanceDraftRenderSec({ draft: true, provider: "seedance-2-5", outputUrl: "u" })).toBeUndefined()
  })
})
