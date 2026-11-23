/**
 * LTX 2.5 Fast audio-to-video in the editor (decided 2026-11-23): with an
 * audio clip wired into Generate Video the node is quoted on the clip's
 * length rounded up to a whole second (the run's own rule), the longest clip
 * the run can hold while the length is not known; Pro, and Fast without a
 * clip, keep the node's own length.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { drivingAudioQuotedCreditId } from "@/lib/video-utility-estimate"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown>) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const audioWire = (source: string): WorkflowEdge => ({ id: `${source}-x`, source, target: "x", targetHandle: "audioReferences" }) as WorkflowEdge
const upload = (sec: number) => node("a", "upload-audio", { url: "https://m.test/a.mp3", metadata: { durationSeconds: sec } })
const gv = (provider: string, resolution = "720p") => node("x", "generate-video", { provider, resolution, duration: 6 })

describe("Generate Video on LTX 2.5 Fast with an audio clip wired", () => {
  it("is quoted on the clip's length, rounded up to a whole second", () => {
    const x = gv("ltx-2.5-fast")
    expect(drivingAudioQuotedCreditId(x, [x, upload(7.2)], [audioWire("a")])).toBe("ltx-2.5-fast:8s:720p")
    expect(getModelIdentifier(x, [audioWire("a")], [x, upload(7.2)])).toBe("ltx-2.5-fast:8s:720p")
  })

  it("a length not known quotes the longest clip the run can hold at its resolution", () => {
    const x = gv("ltx-2.5-fast", "1440p")
    const unknown = node("a", "upload-audio", { url: "https://m.test/a.mp3" })
    expect(getModelIdentifier(x, [audioWire("a")], [x, unknown])).toBe("ltx-2.5-fast:10s:1440p")
  })

  it("Pro, and Fast without a clip, keep the node's own length", () => {
    const pro = gv("ltx-2.5-pro")
    expect(drivingAudioQuotedCreditId(pro, [pro, upload(7.2)], [audioWire("a")])).toBeUndefined()
    expect(getModelIdentifier(pro, [audioWire("a")], [pro, upload(7.2)])).toBe("ltx-2.5-pro:6s:720p")
    const fast = gv("ltx-2.5-fast")
    expect(getModelIdentifier(fast, [], [fast])).toBe("ltx-2.5-fast:6s:720p")
  })
})
