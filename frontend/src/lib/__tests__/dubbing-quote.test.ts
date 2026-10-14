/**
 * A Dubbing node is quoted as the WHOLE dub its run is charged: its language's
 * per-minute row × the started minutes of the span, marked up once
 * (`elevenlabs-dubbing:<N>u`, `elevenlabs-dubbing-v2:<N>u` for Hebrew) — the
 * pill, the Run button, the confirm and the workflow badge alike, at the
 * minutes `dubbingQuotedMinutesOf` reads (the rule the server's run estimate
 * reads too, `@nodaro/render-rules`). The shared fixture
 * (tools/fixtures/unit-quote-cases.json) holds the quote to the route's charge.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { dubbingQuotedMinutesOf } from "@/lib/video-utility-estimate"
import { getExactPricingUnits, NO_RERUNS } from "@/components/editor/workflow-editor/types"
import { runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const wire = (source: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-x`, source, target: "x", targetHandle }) as WorkflowEdge

const video = (sec: number) => node("v", "upload-video", { url: "https://m.test/v.mp4", duration: sec })
const audio = (sec: number) => node("a", "upload-audio", { url: "https://m.test/a.mp3", metadata: { durationSeconds: sec } })

function minutes(dub: Record<string, unknown>, sources: WorkflowNode[], edges: WorkflowEdge[]): number {
  const x = node("x", "dubbing", { targetLanguage: "es", ...dub })
  return dubbingQuotedMinutesOf(x, [x, ...sources], edges)
}

describe("the minutes a Dubbing node is quoted at", () => {
  it("is the started minutes of its wired source, at least one", () => {
    expect(minutes({}, [video(290)], [wire("v", "video")])).toBe(5)
    expect(minutes({}, [video(12)], [wire("v", "video")])).toBe(1)
    expect(minutes({}, [audio(61)], [wire("a", "audio")])).toBe(2)
  })

  it("reads the video when both are wired (the node dubs the video and ignores the audio)", () => {
    expect(minutes({}, [video(130), audio(600)], [wire("v", "video"), wire("a", "audio")])).toBe(3)
  })

  it("is the window when one is set, never longer than the source", () => {
    expect(minutes({ startTime: 0, endTime: 400 }, [], [])).toBe(7)
    expect(minutes({ startTime: 60, endTime: 400 }, [video(90)], [wire("v", "video")])).toBe(2)
  })

  it("does not read the wires when a link replaces them (the run measures the link)", () => {
    expect(minutes({ sourceUrl: "https://m.test/watch?v=1" }, [video(600)], [wire("v", "video")])).toBe(1)
    expect(minutes({ sourceUrl: "https://m.test/watch?v=1", startTime: 0, endTime: 200 }, [video(600)], [wire("v", "video")])).toBe(4)
  })

  it("is one minute when nothing tells the span, and at most the 30 a dub may cover", () => {
    expect(minutes({}, [], [])).toBe(1)
    expect(minutes({}, [video(45 * 60)], [wire("v", "video")])).toBe(30)
  })
})

describe("the run estimate prices a dub the same way", () => {
  it("at its language's per-minute row, the minutes and the whole dub's id", () => {
    for (const [language, rateId] of [["es", "elevenlabs-dubbing"], ["he", "elevenlabs-dubbing-v2"]] as const) {
      const x = node("x", "dubbing", { targetLanguage: language })
      const nodes = [x, video(290)]
      const edges = [wire("v", "video")]
      expect(getModelIdentifier(x, edges, nodes, NO_RERUNS)).toBe(rateId)
      expect(getExactPricingUnits(x, nodes, edges, NO_RERUNS)).toBe(5)
      expect(runModelIds([x], nodes, edges)).toEqual(expect.arrayContaining([rateId, `${rateId}:5u`]))
    }
  })
})
