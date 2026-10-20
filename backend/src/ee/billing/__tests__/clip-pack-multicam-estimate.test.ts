// @test-units-by-name prices only the clip-pack nodes it builds
/**
 * Clip Pack's estimate on several recordings and following faces (decided
 * 2026-10-17/18): its built chain priced by the ordinary rules plus its fee,
 * exactly as one recording (use-case-estimate.test.ts) — Camera Switch is a
 * per-clip step like the render and is priced once per clip; Audio Sync and
 * Speaker Map run once for the pack; Speaker Frames runs ONCE over the whole
 * pack. The public docs (docs/nodes/processing-video/clip-pack.md) state the
 * CHARGED price: each worked example there is pinned here — its steps, as
 * price ids, sum to the engine's figure at the static rows, and the same
 * steps priced by `statedPrices()` sum to the figure the page states.
 */
import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
import { STATIC_CREDIT_COSTS, estimateRunSetCredits, estimateWorkflowCredits } from "../credits.js"
import { statedPrices } from "../stated-prices.js"
import { editPlanRenderEstimateLength } from "@nodaro/render-rules"

type Step = readonly [id: string, units?: number]
const listOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + STATIC_CREDIT_COSTS[id]! * units, 0)
const chargedOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + statedPrices().credits(id, units)!, 0)
const each = (n: number, step: Step): Step[] => Array.from({ length: n }, () => step)

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle: string; targetHandle: string }
const pack = (data: Record<string, unknown>): N => ({ id: "cp", type: "clip-pack", data: { label: "Clip Pack", ...data } })
const cam = (n: number, sec: number): N => ({ id: `cam${n}`, type: "upload-video", data: { url: `https://r2/cam${n}.mp4`, metadata: { durationSeconds: sec } } })
const mic = (sec: number): N => ({ id: "mic", type: "upload-audio", data: { url: "https://r2/master.wav", metadata: { durationSeconds: sec } } })
/** `cams` cameras of `camSec` seconds and a Master audio of `masterSec` wired into a Clip Pack node. */
function wired(node: N, cams: number, camSec: number, masterSec: number): [N[], E[]] {
  const c = Array.from({ length: cams }, (_, i) => cam(i + 1, camSec))
  return [
    [...c, mic(masterSec), node],
    [...c.map((x) => ({ source: x.id, target: "cp", sourceHandle: "video", targetHandle: "media" })), { source: "mic", target: "cp", sourceHandle: "audio", targetHandle: "masterAudio" }],
  ]
}

const CLIP_MINUTES = editPlanRenderEstimateLength({ mode: "clips", targetDurationSec: 60 }, 3600).fixedMinutes
const head = (minutes: number): Step[] => [["elevenlabs-stt"], ["edit-plan:clips:standard:per-minute", minutes], ["edit-plan:clips:standard:flat"]]
const fee: Step = ["use-case-fee:clip-pack"]
const multicam = { multicam: true } as const

describe("Clip Pack on two cameras + Master audio (a viewer who may use Speaker Map)", () => {
  const cases: ReadonlyArray<{ name: string; steps: Step[]; engine: () => Promise<number>; docs: number }> = [
    {
      name: "60 min each, 8 clips, the default framing, captions on: Audio Sync over three sources, Speaker Map once, Camera Switch once per clip",
      steps: [...head(60), ["audio-sync:3src"], ["speaker-map"], ...each(8, ["camera-switch"]), ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee],
      engine: () => estimateWorkflowCredits(...wired(pack({}), 2, 3600, 3600), multicam),
      docs: 1099,
    },
    {
      // 2 cameras × ⌈(3,600 + 4) × 2⌉ = 14,416 frames → 15 blocks, once for the whole pack (never once per clip).
      name: "the same, following faces: ONE Speaker Frames run over every switched clip (both cameras sampled)",
      steps: [...head(60), ["audio-sync:3src"], ["speaker-map"], ...each(8, ["camera-switch"]), ["speaker-frames", 15], ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee],
      engine: () => estimateWorkflowCredits(...wired(pack({ framingSource: "tracking" }), 2, 3600, 3600), multicam),
      docs: 1132,
    },
  ]
  for (const c of cases) {
    it(`${c.name}: the engine's steps, charged = ${c.docs}`, async () => {
      expect(listOf(c.steps)).toBe(await c.engine())
      expect(chargedOf(c.steps)).toBe(c.docs)
    })
  }
  it("a viewer who may not use Speaker Map: two cameras and a Master audio are quoted as the first camera alone, exactly as before multicam", async () => {
    const one = await estimateWorkflowCredits([cam(1, 3600), pack({})], [{ source: "cam1", target: "cp", sourceHandle: "video", targetHandle: "media" }])
    expect(await estimateWorkflowCredits(...wired(pack({}), 2, 3600, 3600))).toBe(one)
    expect(await estimateWorkflowCredits(...wired(pack({}), 2, 3600, 3600), { multicam: false })).toBe(one)
  })
  it("the Master audio longer than the cameras: Edit Plan is quoted on the master's length (M2)", async () => {
    // Cameras 50 min, the master 70: the plan's clock is the master's — its 90-minute step, never the cameras' 60.
    const steps: Step[] = [...head(90), ["audio-sync:3src"], ["speaker-map"], ...each(8, ["camera-switch"]), ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee]
    expect(await estimateWorkflowCredits(...wired(pack({}), 2, 3000, 4200), multicam)).toBe(listOf(steps))
    // The other way round (cameras 70, the master 50): the master's 60-minute step.
    expect(await estimateWorkflowCredits(...wired(pack({}), 2, 4200, 3000), multicam)).toBe(await estimateWorkflowCredits(...wired(pack({}), 2, 3600, 3600), multicam))
  })
  it("review on, its Render final: Camera Switch again on each kept clip, then the render and the captions; never Speaker Frames; no fee", async () => {
    const preview = pack({ reviewBeforeRender: true, framingSource: "tracking", cameras: {} })
    const PLAN = Array.from({ length: 8 }, (_, i) => ({
      version: 1, clock: "master",
      sources: [{ id: "uc-source", url: "https://r2/cam1.mp4", kind: "video" }, { id: "uc-cam-2", url: "https://r2/cam2.mp4", kind: "video" }],
      segments: [{ id: `c${i}`, inMs: i * 300_000, outMs: i * 300_000 + 55_000, video: "uc-source" }], dropped: [], meta: { title: `Clip ${i + 1}` },
    }))
    const final = { ...preview, data: { ...preview.data, generatedJson: PLAN, useCaseContinue: { mode: "render-final", jobId: "job-0" } } }
    const [nodes, edges] = wired(final, 2, 3600, 3600)
    const steps: Step[] = [...each(8, ["camera-switch"]), ...each(8, ["speaker-view:complex", 1]), ...each(8, ["add-captions:kinetic"])]
    expect(await estimateRunSetCredits(nodes, edges, new Set(["cp"]), undefined, multicam)).toBe(listOf(steps))
  })
})

describe("Clip Pack on one recording, following faces", () => {
  const one = (data: Record<string, unknown>): [N[], E[]] => [[cam(1, 3600), pack(data)], [{ source: "cam1", target: "cp", sourceHandle: "video", targetHandle: "media" }]]
  it("60 min, 8 clips, the default framing, captions on: ONE Speaker Frames run over the plan's whole clip set (8 blocks), never once per clip", async () => {
    // 1 camera × ⌈(3,600 + 4) × 2⌉ = 7,208 frames → 8 blocks.
    const steps: Step[] = [...head(60), ["speaker-frames", 8], ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee]
    expect(await estimateWorkflowCredits(...one({ framingSource: "tracking" }))).toBe(listOf(steps))
    expect(chargedOf(steps)).toBe(996)
  })
  it("Automatic: following faces while Speaker Frames is available to the viewer; the even split's quote for a viewer it is withheld from", async () => {
    expect(await estimateWorkflowCredits(...one({ framingSource: "auto" }))).toBe(await estimateWorkflowCredits(...one({ framingSource: "tracking" })))
    expect(await estimateWorkflowCredits(...one({ framingSource: "auto" }), { framesWithheld: true })).toBe(await estimateWorkflowCredits(...one({})))
  })
  it("a saved node without a framing source, or static: the even split's quote, unchanged", async () => {
    expect(await estimateWorkflowCredits(...one({ framingSource: "static" }))).toBe(await estimateWorkflowCredits(...one({})))
  })
})
