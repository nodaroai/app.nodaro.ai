// @vitest-environment node
import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec, resolveSeedanceTaskType, SEEDANCE_VIDEO_EDIT_PROVIDERS, SEEDANCE_VIDEO_EDIT_SHAPE, SEEDANCE_VIDEO_EDIT_TASK_TYPE, VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { estimateCombineVideosCredits, estimateLoopVideoCredits, estimateTrimVideoCredits, VIDEO_UTIL_PRICING } from "@nodaro/shared/credits"
import { knownLength, lengthFollowingBoundSec, utilityOutputLength } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { estimateVideoUtilityBaseCredits, maskCompositeQuotedSec, pitchTempoQuotedSec, videoMaskQuotedSec, videoSfxQuotedSec } from "../video-utility-estimate"

/**
 * A generated video whose run recorded its real length (an automatic length,
 * a Seedance Edit / Extend) carries it on its result row (`duration`). The
 * editor's estimates of a step that MEASURES the clip it is given (Video SFX,
 * Video Mask, Mask Composite, Pitch & Tempo) read the generation exactly as
 * before: the recorded length is capped at the run's bound and can sit a few
 * hundredths of a second under the file that step measures.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string) => ({ id: `${source}-${target}`, source, target, targetHandle }) as unknown as WorkflowEdge

const GEN = { provider: "seedance-2-5", duration: 5, prompt: "p" }
const recorded = node("gen", "generate-video", { ...GEN, generatedVideoUrl: "https://m.test/g.mp4", generatedResults: [{ url: "https://m.test/g.mp4", duration: 23.4 }], activeResultIndex: 0 })
const unrecorded = node("gen", "generate-video", { ...GEN, generatedVideoUrl: "https://m.test/g.mp4", generatedResults: [{ url: "https://m.test/g.mp4" }], activeResultIndex: 0 })

describe("a step that measures its clip quotes a generated video as before its length was recorded", () => {
  it.each<[string, (gen: WorkflowNode) => unknown]>([
    ["Video SFX", (gen) => videoSfxQuotedSec(node("sfx", "video-sfx"), [gen, node("sfx", "video-sfx")], [edge("gen", "sfx", "video")])],
    ["Video Mask", (gen) => videoMaskQuotedSec(node("mask", "video-mask"), [gen, node("mask", "video-mask")], [edge("gen", "mask", "video")])],
    ["Mask Composite", (gen) => maskCompositeQuotedSec(node("mc", "mask-composite"), [gen, node("mc", "mask-composite")], [edge("gen", "mc", "video")])],
    ["Pitch & Tempo", (gen) => pitchTempoQuotedSec(node("pt", "pitch-tempo"), [gen, node("pt", "pitch-tempo")], [edge("gen", "pt", "in")])],
  ])("%s", (_name, quote) => {
    expect(quote(recorded)).toStrictEqual(quote(unrecorded))
  })

  it("an upload's recorded length is still read (it is the file the step measures)", () => {
    const upload = node("gen", "upload-video", { url: "https://m.test/u.mp4", generatedResults: [{ url: "https://m.test/u.mp4", duration: 23.4 }] })
    expect(videoSfxQuotedSec(node("sfx", "video-sfx"), [upload, node("sfx", "video-sfx")], [edge("gen", "sfx", "video")])).toBe(23.4)
  })

  it("Trim, Loop and Combine Videos (charged by the length handed to them) are not this rule's", () => {
    // Their reading of a generation is the shared generation rule's (generation-source estimate tests).
    expect(estimateVideoUtilityBaseCredits(node("t", "trim-video", { trimMode: "seconds" }), [unrecorded, node("t", "trim-video")], [edge("gen", "t", "in")])).toBeGreaterThan(0)
  })
})

/**
 * The steps CHARGED by the length handed to them (Trim, Loop, Combine Videos)
 * read a generated video through the shared rule (`generationSourceEstimateSec`,
 * the server's estimate reads it too): a generation that runs and follows its
 * own length (an automatic length, a Seedance Edit / Extend) at the most it can
 * make, so the quote is never below what the run records and charges; one that
 * does not run at the length its result recorded; any other as before.
 */
const TRIM = { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 }
const LOOP = { mode: "repeat", repeatCount: 2 }
const CLIP_URL = "https://m.test/clip.mp4"
const OTHER_URL = "https://m.test/other.mp4"
const OTHER_SEC = 6

/** A clip `clipSec` long (an upload; none when undefined) into a generation node (Generate Video's reference video by default), and that node into Trim, Loop and Combine Videos (beside a 6 s upload). */
function charged(gen: Record<string, unknown>, clipSec: number | undefined, results?: Array<Record<string, unknown>>, source: { type: string; clipHandle: string } = { type: "generate-video", clipHandle: "videoReferences" }) {
  const nodes = [
    ...(clipSec === undefined ? [] : [node("clip", "upload-video", { url: CLIP_URL, generatedResults: [{ url: CLIP_URL, duration: clipSec }] })]),
    node("gen", source.type, { prompt: "p", ...gen, ...(results ? { generatedResults: results, activeResultIndex: 0 } : {}) }),
    node("trim", "trim-video", TRIM),
    node("loop", "loop-video", LOOP),
    node("other", "upload-video", { url: OTHER_URL, generatedResults: [{ url: OTHER_URL, duration: OTHER_SEC }] }),
    node("combine", "combine-videos", {}),
  ]
  const edges = [
    ...(clipSec === undefined ? [] : [edge("clip", "gen", source.clipHandle)]),
    edge("gen", "trim", "in"),
    edge("gen", "loop", "in"),
    edge("gen", "combine", "videos"),
    edge("other", "combine", "videos"),
  ]
  const quote = (id: string, rerunIds: ReadonlySet<string>) => estimateVideoUtilityBaseCredits(nodes.find((n) => n.id === id)!, nodes, edges, rerunIds)!
  return { nodes, quote }
}

/** Each step's charge when the generation hands on `sec` seconds (the 8 s fallback when it hands on none), by the estimators the run charges with. */
const chargesAt = (sec: number | undefined) => ({
  trim: estimateTrimVideoCredits(TRIM as never, sec),
  loop: estimateLoopVideoCredits(LOOP as never, sec),
  combine: estimateCombineVideosCredits({}, [sec, OTHER_SEC]),
})

/**
 * The most the step after the generation can be charged by: the run as SENT —
 * its task type resolved by the shared rule with the clip measured — records at
 * most its bound when it follows its own length; otherwise it hands on its
 * stored length (the fallback when it stores none), as before.
 */
function mostCharged(gen: { provider: string; duration: number; referenceTaskType?: string }, clipSec: number | undefined): number | undefined {
  const sent = resolveSeedanceTaskType({
    provider: gen.provider, requested: gen.referenceTaskType, draft: false, referenceImageCount: 0, referenceAudioCount: 0,
    referenceVideoSec: clipSec === undefined ? [] : [clipSec], aspectRatio: "16:9", duration: gen.duration,
  })
  return lengthFollowingBoundSec({ provider: gen.provider, duration: sent.duration, referenceTaskType: sent.taskType }) ?? (gen.duration > 0 ? gen.duration : undefined)
}

/** Every whole-second clip the model accepts as a reference (its declared bounds; a model that declares none: up to the longest any declares). */
function acceptedClips(provider: string): number[] {
  const limits = VIDEO_REF_VIDEO_DURATION_LIMITS[provider] ?? { minSec: 1, maxSec: Math.max(...Object.values(VIDEO_REF_VIDEO_DURATION_LIMITS).map((l) => l?.maxSec ?? 0)) }
  return Array.from({ length: limits.maxSec - Math.ceil(limits.minSec) + 1 }, (_, i) => Math.ceil(limits.minSec) + i)
}

// Seedance 2.5 and one model of the Seedance 2.0 family (both offer an automatic length).
const MODELS = ["seedance-2-5", "seedance-2"] as const
// Every model the Video to Video node runs as a Seedance edit.
const EDIT_MODELS: readonly string[] = SEEDANCE_VIDEO_EDIT_PROVIDERS
const ALL = new Set(["clip", "gen", "trim", "loop", "other", "combine"])

describe("never under-quote: a length-following generation into Trim, Loop and Combine Videos (brute force)", () => {
  it("the models offer an automatic length", () => {
    for (const p of MODELS) expect(MODEL_CATALOG[p]?.autoDuration, p).toBe(true)
  })

  const cases: Array<[string, { duration: number; referenceTaskType?: string }, boolean]> = [
    ["Auto, no reference video", { duration: VIDEO_DURATION_AUTO }, false],
    ["Auto, a reference clip", { duration: VIDEO_DURATION_AUTO }, true],
    ["a declared Edit at a stored 5 s", { duration: 5, referenceTaskType: "edit" }, true],
    ["a declared Extend at a stored Auto", { duration: VIDEO_DURATION_AUTO, referenceTaskType: "extend" }, true],
  ]
  for (const provider of MODELS) {
    it.each(cases)(`${provider} — %s: the editor's quote of each step is at least the most the run can charge it`, (_name, settings, withClip) => {
      const gen = { provider, ...settings }
      for (const clipSec of withClip ? acceptedClips(provider) : [undefined]) {
        const { quote } = charged(gen, clipSec)
        const most = chargesAt(mostCharged(gen, clipSec))
        // Execute all (everything re-runs), and each step's own price (the generation has no result yet, so it runs).
        for (const rerunIds of [ALL, new Set<string>()]) {
          const at = `clip ${String(clipSec)} s, ${rerunIds.size > 0 ? "execute all" : "its own price"}`
          expect(quote("trim", rerunIds), `Trim, ${at}`).toBeGreaterThanOrEqual(most.trim)
          expect(quote("loop", rerunIds), `Loop, ${at}`).toBeGreaterThanOrEqual(most.loop)
          expect(quote("combine", rerunIds), `Combine Videos, ${at}`).toBeGreaterThanOrEqual(most.combine)
        }
      }
    })
  }

  it.each([
    ["the older Image to Video node on Auto", "image-to-video"],
    ["the older Text to Video node on Auto", "text-to-video"],
  ])("%s: the editor's quote of each step is at least the most the run can charge it", (_name, type) => {
    for (const provider of MODELS) {
      const gen = { provider, duration: VIDEO_DURATION_AUTO }
      const { quote } = charged(gen, undefined, undefined, { type, clipHandle: "" })
      const most = chargesAt(mostCharged(gen, undefined))
      for (const rerunIds of [ALL, new Set<string>()]) {
        expect(quote("trim", rerunIds), `${provider} Trim`).toBeGreaterThanOrEqual(most.trim)
        expect(quote("loop", rerunIds), `${provider} Loop`).toBeGreaterThanOrEqual(most.loop)
        expect(quote("combine", rerunIds), `${provider} Combine Videos`).toBeGreaterThanOrEqual(most.combine)
      }
    }
  })

  it("the Video to Video node's Seedance edit, every accepted source clip: the editor's quote of each step is at least the most the run can charge it", () => {
    for (const provider of EDIT_MODELS) {
      // The lane edits its source clip at an automatic length, requesting the edit.
      const run = { provider, duration: SEEDANCE_VIDEO_EDIT_SHAPE.duration, referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE }
      for (const clipSec of acceptedClips(provider)) {
        const { quote } = charged({ provider }, clipSec, undefined, { type: "video-to-video", clipHandle: "video" })
        const most = chargesAt(mostCharged(run, clipSec))
        for (const rerunIds of [ALL, new Set<string>()]) {
          const at = `${provider}, clip ${clipSec} s`
          expect(quote("trim", rerunIds), `Trim, ${at}`).toBeGreaterThanOrEqual(most.trim)
          expect(quote("loop", rerunIds), `Loop, ${at}`).toBeGreaterThanOrEqual(most.loop)
          expect(quote("combine", rerunIds), `Combine Videos, ${at}`).toBeGreaterThanOrEqual(most.combine)
        }
      }
    }
  })

  it("the example: Seedance 2.5 on Auto into Combine Videos alone is quoted at its longest clip, not the 8 s fallback", () => {
    const nodes = [node("gen", "generate-video", { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO, prompt: "p" }), node("combine", "combine-videos", {})]
    const edges = [edge("gen", "combine", "videos")]
    const quoted = estimateVideoUtilityBaseCredits(nodes[1]!, nodes, edges, new Set(["gen", "combine"]))
    expect(quoted).toBe(estimateCombineVideosCredits({}, [pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO)]))
    expect(quoted! / VIDEO_UTIL_PRICING.CREDIT_UNIT).toBeGreaterThan(estimateCombineVideosCredits({}, [undefined]) / VIDEO_UTIL_PRICING.CREDIT_UNIT)
  })
})

describe("a generation that does not run is quoted at the length its result recorded; one that re-runs never is", () => {
  const gen = { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }
  const results = [{ url: "https://m.test/g.mp4", duration: 5 }]
  const bound = pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO)

  it("re-run with an earlier 5 s take: the bound, not 5 s", () => {
    const { quote } = charged(gen, undefined, results)
    expect(quote("trim", ALL)).toBe(chargesAt(bound).trim)
    expect(quote("combine", ALL)).toBe(chargesAt(bound).combine)
  })

  it("not re-run: the 5 s its take recorded", () => {
    const { quote } = charged(gen, undefined, results)
    expect(quote("trim", new Set(["trim"]))).toBe(chargesAt(5).trim)
    expect(quote("trim", new Set())).toBe(chargesAt(5).trim)
  })

  it("a re-run fixed-length generation is quoted at its stored length, never an earlier take's", () => {
    const { quote } = charged({ provider: "seedance-2-5", duration: 10 }, undefined, [{ url: "https://m.test/g.mp4", duration: 4 }])
    expect(quote("trim", ALL)).toBe(chargesAt(10).trim)
  })
})

describe("unchanged: a fixed-length generation is quoted exactly as before", () => {
  it.each<[string, Record<string, unknown>, number | undefined]>([
    ["Seedance 2.5 at 10 s", { provider: "seedance-2-5", duration: 10 }, 10],
    ["Seedance 2.5 at 5 s, declared Reference", { provider: "seedance-2-5", duration: 5, referenceTaskType: "reference" }, 5],
    ["a model with no automatic length", { provider: "kling-3.0", duration: 10 }, 10],
    ["a model with no automatic length and no duration (the 8 s fallback)", { provider: "kling-3.0" }, undefined],
  ])("%s", (_name, gen, handed) => {
    const { quote } = charged(gen, undefined)
    for (const rerunIds of [ALL, new Set<string>()]) {
      expect(quote("trim", rerunIds)).toBe(chargesAt(handed).trim)
      expect(quote("loop", rerunIds)).toBe(chargesAt(handed).loop)
      expect(quote("combine", rerunIds)).toBe(chargesAt(handed).combine)
    }
  })
})

describe("never under-quote through a chain and through a Teleport", () => {
  const CHAIN_CASES: Array<[string, { provider: string; duration: number; referenceTaskType?: string }, number | undefined]> = [
    ["Seedance 2.5 on Auto", { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }, undefined],
    ["Seedance 2.0 on Auto", { provider: "seedance-2", duration: VIDEO_DURATION_AUTO }, undefined],
    ["Seedance 2.5, a declared Edit at a stored 5 s, a 25 s clip", { provider: "seedance-2-5", duration: 5, referenceTaskType: "edit" }, 25],
  ]
  const clipNodes = (clipSec: number | undefined) =>
    clipSec === undefined ? [] : [node("clip", "upload-video", { url: CLIP_URL, generatedResults: [{ url: CLIP_URL, duration: clipSec }] })]
  const clipEdges = (clipSec: number | undefined) => (clipSec === undefined ? [] : [edge("clip", "gen", "videoReferences")])

  it.each(CHAIN_CASES)("%s → Loop ×2 → Trim: each step's quote is at least the most the run can charge it", (_name, gen, clipSec) => {
    const loopNode = node("loop", "loop-video", LOOP)
    const nodes = [...clipNodes(clipSec), node("gen", "generate-video", { prompt: "p", ...gen }), loopNode, node("trim", "trim-video", TRIM)]
    const edges = [...clipEdges(clipSec), edge("gen", "loop", "in"), edge("loop", "trim", "in")]
    const most = mostCharged(gen, clipSec)
    // What the Loop hands the Trim when it is handed the most the generation can make (the run's own rule).
    const loopHands = knownLength(utilityOutputLength(loopNode, [{ targetHandle: "in" }], [most === undefined ? undefined : { fixedSec: most, perEpisodeSec: 0 }]))?.fixedSec
    for (const rerunIds of [new Set(["clip", "gen", "loop", "trim"]), new Set<string>()]) {
      expect(estimateVideoUtilityBaseCredits(nodes.find((n) => n.id === "loop")!, nodes, edges, rerunIds), "Loop").toBeGreaterThanOrEqual(estimateLoopVideoCredits(LOOP as never, most))
      expect(estimateVideoUtilityBaseCredits(nodes.find((n) => n.id === "trim")!, nodes, edges, rerunIds), "Trim").toBeGreaterThanOrEqual(estimateTrimVideoCredits(TRIM as never, loopHands))
    }
  })

  it.each(CHAIN_CASES)("%s → Teleport → Trim: the quote is at least the most the run can charge", (_name, gen, clipSec) => {
    const nodes = [...clipNodes(clipSec), node("gen", "generate-video", { prompt: "p", ...gen }), node("send", "teleport-send"), node("recv", "teleport-receive"), node("trim", "trim-video", TRIM)]
    const edges = [
      ...clipEdges(clipSec),
      edge("gen", "send", "in"),
      { id: "tp", source: "send", sourceHandle: "out", target: "recv", targetHandle: "in", data: { teleporter: true } } as unknown as WorkflowEdge,
      edge("recv", "trim", "in"),
    ]
    for (const rerunIds of [new Set(["clip", "gen", "send", "recv", "trim"]), new Set<string>()]) {
      expect(estimateVideoUtilityBaseCredits(nodes.find((n) => n.id === "trim")!, nodes, edges, rerunIds)).toBeGreaterThanOrEqual(estimateTrimVideoCredits(TRIM as never, mostCharged(gen, clipSec)))
    }
  })
})
