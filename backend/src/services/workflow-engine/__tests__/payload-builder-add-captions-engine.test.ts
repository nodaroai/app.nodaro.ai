// @test-units-by-name looks up only the node types it builds (add-captions, generate-video-pro, edit-video-pro)
/**
 * A server-run workflow's Add Captions node and the transcription engine it
 * runs on (Run, Run from here, a published app, MCP `run_workflow`, a use case
 * that embeds it). This records, for each engine, what a deployment that
 * restricts no model builds: the job, the engine its payload carries, the id
 * it is priced on, the model the workflow lane judges it on, and the hold the
 * executor stamps before it reserves — so the change that makes the engine
 * follow what a deployment offers can be shown to change none of it there —
 * and what a deployment that restricts models builds (decided 2026-11-15): a
 * node that names no engine runs the first engine offered, written into its
 * job; one that names a withheld engine, or must transcribe where none is
 * offered, is refused (`model_not_available`) before anything is reserved; a
 * Generate / Edit Video Pro node that names no model is judged on the one its
 * build fills in.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { addCaptionsNemotronMinutesId, addCaptionsNemotronQuoteCreditId } from "@nodaro/shared/credits"

// A Nemotron caption video is measured before anything is held (lib/add-captions-nemotron.ts).
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/video/ffmpeg-utils.js")>()),
  assertSafeProbeSource: vi.fn(async () => {}),
  probeMediaDurationAndSize: vi.fn(async () => ({ durationSec: 600, sizeBytes: 900 * 1024 * 1024 })),
}))
vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => false }))

import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { jobRunModelOfBuild } from "../../../lib/run-model.js"
import { stampAddCaptionsNemotronInput } from "../../../lib/add-captions-nemotron.js"
import { getNodeModelIdentifier } from "../../../ee/billing/credits.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { NO_CAPTION_ENGINE_OFFERED_MESSAGE } from "@nodaro/render-rules"
import { defaultCaptionEngineCannotServeMessage } from "../../../lib/add-captions-engine.js"

const VIDEO = "https://cdn.example.com/talk.mp4"
const ENGINES = ["whisper", "incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe"] as const

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
})

const node = (data: Record<string, unknown>): SimpleNode => ({ id: "captions-1", type: "add-captions", data: { label: "Add Captions", ...data } })
const build = (n: SimpleNode, inputs: ResolvedInputs = { videoUrl: VIDEO } as ResolvedInputs) =>
  buildPayload(n, "job-1", inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })

/** What one node builds: the job, its engine, its price id, its judged model and its hold. */
async function built(data: Record<string, unknown>, inputs?: ResolvedInputs) {
  const result = build(node(data), inputs)
  const payload = { ...result.payload }
  await stampAddCaptionsNemotronInput(result.jobName, payload)
  return {
    jobName: result.jobName,
    engine: result.payload.transcribe_provider,
    pricedOn: result.modelIdentifier,
    judgedOn: jobRunModelOfBuild(result.jobName, result.payload, result.modelIdentifier),
    hold: payload.bucketKey,
  }
}

describe("with no model restricted, each engine builds as it always has", () => {
  it("a kinetic node that names no engine carries none (the worker's default runs), priced on the render", async () => {
    expect(await built({ style: "word-highlight" })).toMatchObject({
      jobName: "add-captions",
      engine: undefined,
      pricedOn: "add-captions:kinetic",
      hold: undefined,
    })
  })

  it("a transcribed subtitle that names no engine carries none either", async () => {
    expect(await built({ style: "subtitle" })).toMatchObject({ engine: undefined, pricedOn: "add-captions:kinetic", hold: undefined })
  })

  it.each(ENGINES.filter((e) => e !== "nemotron-3-5-transcribe"))("a kinetic node on %s carries it, priced on the render", async (engine) => {
    expect(await built({ style: "word-highlight", transcribeProvider: engine })).toMatchObject({
      engine,
      pricedOn: "add-captions:kinetic",
      hold: undefined,
    })
  })

  it("a kinetic node on Nemotron 3.5 Transcribe holds the render plus the video's minutes", async () => {
    expect(await built({ style: "word-highlight", transcribeProvider: "nemotron-3-5-transcribe" })).toMatchObject({
      engine: "nemotron-3-5-transcribe",
      pricedOn: "add-captions:kinetic",
      hold: addCaptionsNemotronMinutesId(10),
    })
  })

  it("a node whose wired text is its static subtitle transcribes nothing and is priced on the plain burn", async () => {
    expect(await built({ style: "subtitle" }, { videoUrl: VIDEO, prompt: "Hello there" } as ResolvedInputs)).toMatchObject({
      engine: undefined,
      pricedOn: "add-captions",
      hold: undefined,
    })
  })

  it("an engine that is not one of Add Captions' own is refused before anything is reserved", () => {
    expect(() => build(node({ style: "word-highlight", transcribeProvider: "zz-not-an-engine" }))).toThrow(/is not an engine Add Captions transcribes on/)
  })
})

/** An admin override that releases every model but `withheld` (Admin → Availability). */
function withhold(...withheld: string[]): void {
  __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((m) => !withheld.includes(m))) })
}

function refusalOf(fn: () => unknown): { code?: unknown; message: string } | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return { code: (err as { code?: unknown }).code, message: (err as Error).message }
  }
}

describe("on a deployment that restricts models, the engine follows what it offers", () => {
  it("a node that names no engine runs the first engine offered, written into its job and judged on it", async () => {
    withhold("incredibly-fast-whisper")
    expect(await built({ style: "word-highlight" })).toMatchObject({
      engine: "elevenlabs-stt",
      pricedOn: "add-captions:kinetic",
      judgedOn: "elevenlabs-stt",
      hold: undefined,
    })
  })

  it("the same through the models allow list of the deployment's profile", async () => {
    setProfile({ models: { allow: ["elevenlabs-stt"] } })
    expect(await built({ style: "subtitle" })).toMatchObject({ engine: "elevenlabs-stt", judgedOn: "elevenlabs-stt" })
  })

  it("a default that lands on Nemotron 3.5 Transcribe is held per minute, like a named one", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(await built({ style: "word-highlight" })).toMatchObject({
      engine: "nemotron-3-5-transcribe",
      judgedOn: "nemotron-3-5-transcribe",
      hold: addCaptionsNemotronMinutesId(10),
    })
  })

  it("a default on Whisper is refused for a kinetic node it cannot serve, and builds where it can", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt", "nemotron-3-5-transcribe")
    expect(refusalOf(() => build(node({ style: "word-highlight" })))).toEqual({
      code: "model_not_available",
      message: defaultCaptionEngineCannotServeMessage("whisper"),
    })
    expect(await built({ style: "subtitle" })).toMatchObject({ engine: "whisper", judgedOn: "whisper" })
    // A kinetic node with text to fall back to still runs, as it did before word timings existed.
    expect(await built({ style: "word-highlight", text: "Hello there" })).toMatchObject({ engine: "whisper" })
  })

  it.each(ENGINES)("a node that names %s where it is withheld is refused before anything is reserved", (engine) => {
    withhold(engine)
    const refusal = refusalOf(() => build(node({ style: "word-highlight", transcribeProvider: engine })))
    expect(refusal?.code).toBe("model_not_available")
    expect(refusal?.message).toContain(engine)
  })

  it("a node that names an offered engine runs it as named, never another", async () => {
    withhold("incredibly-fast-whisper")
    expect(await built({ style: "word-highlight", transcribeProvider: "whisper" })).toMatchObject({ engine: "whisper", judgedOn: "whisper" })
  })

  it("where no engine is offered, a node that must transcribe is refused, saying what to list", () => {
    withhold(...ENGINES)
    expect(refusalOf(() => build(node({ style: "word-highlight" })))).toEqual({ code: "model_not_available", message: NO_CAPTION_ENGINE_OFFERED_MESSAGE })
  })

  it("where no engine is offered, a node whose wired text is its subtitle still builds, on no model", async () => {
    withhold(...ENGINES)
    expect(await built({ style: "subtitle" }, { videoUrl: VIDEO, prompt: "Hello there" } as ResolvedInputs)).toMatchObject({ engine: undefined, judgedOn: undefined })
  })
})

describe("Generate Video Pro and Edit Video Pro: a node that names no model is judged on the one its build fills in", () => {
  const proNode = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: `${type}-1`, type, data: { label: "Pro", prompt: "a harbour at dawn", ...data } })
  const proInputs = { videoUrl: VIDEO, imageUrl: "https://cdn.example.com/a.png", startFrameUrl: "https://cdn.example.com/a.png", prompt: "a harbour at dawn" } as ResolvedInputs

  it.each(["generate-video-pro", "edit-video-pro"])("%s builds on seedance-2, and is judged on it", (type) => {
    const result = build(proNode(type), proInputs)
    expect(result.payload.provider).toBe("seedance-2")
    expect(jobRunModelOfBuild(result.jobName, result.payload, result.modelIdentifier)).toBe("seedance-2")
  })

  it.each(["generate-video-pro", "edit-video-pro"])("%s naming no model is refused where seedance-2 is withheld", (type) => {
    withhold("seedance-2")
    expect(refusalOf(() => build(proNode(type), proInputs))?.code).toBe("model_not_available")
  })

  it.each(["generate-video-pro", "edit-video-pro"])("%s naming an offered model still builds where seedance-2 is withheld", (type) => {
    withhold("seedance-2")
    expect(refusalOf(() => build(proNode(type, { provider: "seedance-2-fast" }), proInputs))).toBeUndefined()
    // And a named model it withholds is refused at the top of the build, as before.
    withhold("seedance-2-fast")
    expect(refusalOf(() => build(proNode(type, { provider: "seedance-2-fast" }), proInputs))?.code).toBe("model_not_available")
  })
})

describe("the workflow estimate prices the engine the run will take", () => {
  const estimateOf = (data: Record<string, unknown>) => getNodeModelIdentifier({ id: "captions-1", type: "add-captions", data: { label: "Add Captions", ...data } }, {})

  it("with no model restricted: the render, as before", () => {
    expect(estimateOf({ style: "word-highlight" })).toBe("add-captions:kinetic")
  })

  it("where the first offered engine is Nemotron 3.5 Transcribe, the estimate is per minute and the run holds per minute", async () => {
    withhold("incredibly-fast-whisper", "elevenlabs-stt")
    expect(estimateOf({ style: "word-highlight" })).toBe(addCaptionsNemotronQuoteCreditId(undefined))
    expect(await built({ style: "word-highlight" })).toMatchObject({ engine: "nemotron-3-5-transcribe", hold: addCaptionsNemotronMinutesId(10) })
  })

  it("where the first offered engine is flat-priced, both stay on the render's row", async () => {
    withhold("incredibly-fast-whisper")
    expect(estimateOf({ style: "word-highlight" })).toBe("add-captions:kinetic")
    expect(await built({ style: "word-highlight" })).toMatchObject({ engine: "elevenlabs-stt", pricedOn: "add-captions:kinetic", hold: undefined })
  })
})
