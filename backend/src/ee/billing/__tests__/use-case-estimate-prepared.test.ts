// @test-units-by-name looks up only the tighten-episode body (USE_CASE_BODIES by that type)
/**
 * What the run route quotes for Tighten Episode on several recordings and a
 * Master audio, through the server's own preparation (`prepareUseCase`, every
 * probe mocked): the Master audio's probed length rides on the built master,
 * so Edit Plan is quoted on the plan's real clock — the length the step then
 * holds and charges by (decided 2026-10-19) — never on the ceiling. The
 * worked figure is use-case-estimate.test.ts's (1352 credits for 90 minutes
 * on three cameras + Master audio).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
const probe = vi.hoisted(() => ({
  streams: vi.fn(async (u: string) => ({ hasVideo: !u.endsWith(".wav"), hasAudio: true })),
  duration: vi.fn(async (_u: string) => 5400),
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaStreams: probe.streams, probeMediaDuration: probe.duration }))
import { STATIC_CREDIT_COSTS, estimateWorkflowCredits } from "../credits.js"
import { prepareUseCase } from "@/lib/use-case/request.js"
import { USE_CASE_BODIES, type UseCaseBody } from "@/lib/use-case/bodies.js"

type Step = readonly [id: string, units?: number]
const listOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + STATIC_CREDIT_COSTS[id]! * units, 0)
const STEPS: Step[] = [["elevenlabs-stt"], ["silence-detect"], ["edit-plan:tighten:standard:per-minute", 90], ["audio-sync:4src"], ["speaker-map"], ["camera-switch"], ["apply-edl", 90]]
const body = (over: Record<string, unknown> = {}) =>
  USE_CASE_BODIES["tighten-episode"].parse({
    mediaUrls: ["https://r2/cam1.mp4", "https://r2/cam2.mp4", "https://r2/cam3.mp4"],
    masterAudioUrl: "https://r2/master.wav",
    captions: false,
    cameras: { wide: 3 },
    ...over,
  }) as UseCaseBody

beforeEach(() => {
  probe.duration.mockReset().mockResolvedValue(5400)
})

describe("Tighten Episode on three cameras + Master audio, prepared by the server (decided 2026-10-19)", () => {
  it("90 minutes each, probed: the chain quotes the worked figure (1352 with the fee), Edit Plan at 90 minutes", async () => {
    const prep = await prepareUseCase("tighten-episode", body())
    if (!prep.ok) throw new Error(prep.message)
    expect(prep.sources.masterAudio).toMatchObject({ durationSec: 5400 })
    const nodes = prep.graph.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } }))
    expect(await estimateWorkflowCredits(nodes, prep.graph.edges)).toBe(listOf(STEPS))
    expect(listOf([...STEPS, ["use-case-fee:tighten-episode"]])).toBe(1352)
  })
  it("the plan's clock is the Master audio's: a longer master quotes Edit Plan (and the render) on its length, not the cameras'", async () => {
    probe.duration.mockImplementation(async (u: string) => (u.endsWith(".wav") ? 5460 : 5400))
    const prep = await prepareUseCase("tighten-episode", body())
    if (!prep.ok) throw new Error(prep.message)
    const nodes = prep.graph.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } }))
    const ninety = await estimateWorkflowCredits(nodes.map((n) => (n.id === "uc-master" ? { ...n, data: { ...n.data, metadata: { durationSeconds: 5400 } } } : n)), prep.graph.edges)
    expect(await estimateWorkflowCredits(nodes, prep.graph.edges)).toBeGreaterThan(ninety)
  })
})

describe("a workflow's estimate of Tighten on two camera wires follows its viewer (decided 2026-10-19)", () => {
  const cam = (id: string) => ({ id, type: "upload-video", data: { url: `https://r2/${id}.mp4`, metadata: { durationSeconds: 5400 } } })
  const t = { id: "t", type: "tighten-episode", data: { label: "Tighten Episode", captions: false } }
  const wire = (source: string) => ({ source, target: "t", sourceHandle: "video", targetHandle: "media" })
  it("by default (a viewer who may not use Speaker Map): the one-recording run's figure", async () => {
    expect(await estimateWorkflowCredits([cam("a"), cam("b"), t], [wire("a"), wire("b")])).toBe(await estimateWorkflowCredits([cam("a"), t], [wire("a")]))
  })
  it("multicam (a viewer who may): Audio Sync, Speaker Map and Camera Switch on both cameras, above it", async () => {
    const one = await estimateWorkflowCredits([cam("a"), t], [wire("a")])
    const both = await estimateWorkflowCredits([cam("a"), cam("b"), t], [wire("a"), wire("b")], { multicam: true })
    expect(both - one).toBe(listOf([["audio-sync:3src"], ["speaker-map"], ["camera-switch"]]))
  })
})
