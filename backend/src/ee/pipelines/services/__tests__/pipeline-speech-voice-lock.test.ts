/**
 * Film-studio pipeline speech under a voice lock (`voice.allowedGenders`).
 *
 * The pipeline creates its speech jobs itself (no route): a shot's dialogue
 * line, the narration track, and the revoice of a clip a video model spoke in
 * its own voice. Each judges the voice it sends, as the pipeline's user, before
 * any job row or reservation — a refused voice is the lock's coded refusal,
 * which the scene step treats like any failed line (the shot keeps no voice)
 * and the narration step like any failed narration. With no lock nothing is
 * asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  judgeVoices: vi.fn(async (_voices: readonly string[], _lookup: { userId?: string | null }) => ({ allowed: true }) as { allowed: boolean; reason?: string }),
  queueAdd: vi.fn(async () => undefined),
  reserve: vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 0, watermark: false })),
}))

vi.mock("../../../../lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd } }))
vi.mock("../../pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async (_sb: unknown, _pid: string, userId: string) => ({ payer: "user", userId })),
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(async () => ({ allowed: true })), reserveCredits: mocks.reserve },
}))
// The lock's resolver (lib/voice-gender.ts, tested in its own module).
vi.mock("@/lib/voice-gender.js", () => ({ judgeVoices: mocks.judgeVoices }))

import { pipelineGenerateSpeech } from "../pipeline-generate-speech.js"
import { pipelineGenerateNarration } from "../pipeline-generate-narration.js"
import { pipelineVoiceChange } from "../pipeline-voice-change.js"
import { config } from "../../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../../lib/surface-profile.js"
import { VoiceNotAvailableError } from "../../../../lib/voice-policy.js"

const USER = "user-1"
const prevEdition = config.EDITION

/** A pipeline database whose job insert fails: the run stops right after the row would be written. */
function failingInsertDb() {
  const inserts: unknown[] = []
  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== "jobs") throw new Error(`Unmocked table: ${table}`)
      return {
        insert: (row: unknown) => {
          inserts.push(row)
          return { select: () => ({ single: async () => ({ data: null, error: { message: "stop: the row was written" } }) }) }
        },
      }
    }),
  }
  return { supabase: supabase as never, inserts }
}

function maleOnly(): void {
  config.EDITION = "business" // surfaceGateOpen() → true (read live)
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.judgeVoices.mockResolvedValue({ allowed: true })
})
afterEach(() => {
  config.EDITION = prevEdition
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

type Run = (supabase: never) => Promise<unknown>
const LANES: Array<[string, Run, string]> = [
  ["a shot's dialogue line", (supabase) => pipelineGenerateSpeech({ supabase, pipelineId: "p-1", userId: USER, text: "Hello there.", voice: "LibVoice000000000001" }), "LibVoice000000000001"],
  ["the narration track", (supabase) => pipelineGenerateNarration({ supabase, pipelineId: "p-1", userId: USER, text: "Once upon a time.", voiceId: "LibVoice000000000002" }), "LibVoice000000000002"],
  ["the revoice of a spoken clip", (supabase) => pipelineVoiceChange({ supabase, pipelineId: "p-1", userId: USER, videoUrl: "https://r2.example.com/shot.mp4", voiceId: "LibVoice000000000003" }), "LibVoice000000000003"],
]

describe("film-studio pipeline speech — the voice lock", () => {
  it.each(LANES)("%s: a refused voice is refused before any job row or reservation", async (_label, run) => {
    maleOnly()
    mocks.judgeVoices.mockResolvedValueOnce({ allowed: false, reason: "gender_not_allowed" })
    const db = failingInsertDb()

    const err = await run(db.supabase).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(VoiceNotAvailableError)
    expect(db.inserts).toHaveLength(0)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it.each(LANES)("%s: asks about the voice it sends, as the pipeline's user, then writes the job", async (_label, run, voice) => {
    maleOnly()
    const db = failingInsertDb()

    await expect(run(db.supabase)).rejects.toThrow(/stop: the row was written/)

    expect(mocks.judgeVoices).toHaveBeenCalledWith([voice], { userId: USER })
    expect(db.inserts).toHaveLength(1)
  })

  it("a dialogue line or narration with no voice has nothing to judge (the worker speaks it in the policy's default)", async () => {
    maleOnly()
    for (const run of [
      (supabase: never) => pipelineGenerateSpeech({ supabase, pipelineId: "p-1", userId: USER, text: "Hello." }),
      (supabase: never) => pipelineGenerateNarration({ supabase, pipelineId: "p-1", userId: USER, text: "Once." }),
    ]) {
      const db = failingInsertDb()
      await expect(run(db.supabase)).rejects.toThrow(/stop: the row was written/)
      expect(db.inserts).toHaveLength(1)
    }
    expect(mocks.judgeVoices).not.toHaveBeenCalled()
  })

  it.each(LANES)("%s: with no lock, asks nothing", async (_label, run) => {
    const db = failingInsertDb()

    await expect(run(db.supabase)).rejects.toThrow(/stop: the row was written/)

    expect(mocks.judgeVoices).not.toHaveBeenCalled()
    expect(db.inserts).toHaveLength(1)
  })
})
