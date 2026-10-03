/**
 * A node's Settings input sets its model and length at run time (the
 * orchestrator resolves it before it reserves), so the workflow estimate must
 * price the wired values too — an estimate below the reservation lets a run
 * start on a balance that cannot pay for it.
 */
import { describe, it, expect } from "vitest"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS, type EstimateEdge, type EstimateNode } from "../credits.js"

const video: EstimateNode = { id: "v", type: "generate-video", data: { label: "Video", provider: "seedance-2-fast", duration: 4 } }
const length: EstimateNode = { id: "len", type: "duration", data: { label: "Duration", seconds: 60 } }
const veo: EstimateNode = { id: "veo", type: "provider", data: { label: "Provider", category: "video", provider: "veo3" } }
const wired: EstimateEdge[] = [
  { source: "len", target: "v", targetHandle: "settings" },
  { source: "veo", target: "v", targetHandle: "settings" },
]
const asRun: EstimateNode = { ...video, data: { ...video.data, provider: "veo3", duration: 8 } }

describe("workflow estimate — parameter nodes", () => {
  // A Provider node's data names a model; it must not be priced as a run of it.
  it("charges nothing for the settings nodes themselves", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([length, veo], [])).toBe(0)
  })

  // The estimate skips every parameter type on the claim that none is ever
  // charged; a priced one would silently drop out of every estimate.
  it("no parameter node type has a price", () => {
    expect([...PARAMETER_NODE_TYPES].filter((type) => STATIC_CREDIT_COSTS[type] !== undefined)).toEqual([])
  })
})

describe("workflow estimate — Settings input", () => {
  it("prices the wired model at the length the run renders", () => {
    const quoted = CreditsService.estimateWorkflowBaseCredits([video, length, veo], wired)
    expect(quoted).toBe(CreditsService.estimateWorkflowBaseCredits([asRun], []))
    expect(quoted).not.toBe(CreditsService.estimateWorkflowBaseCredits([video], []))
  })

  it("prices a node as stored when the caller has no edges", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([video, length, veo])).toBe(
      CreditsService.estimateWorkflowBaseCredits([video]),
    )
  })

  it("ignores a settings node wired into another input", () => {
    const elsewhere: EstimateEdge[] = [{ source: "veo", target: "v", targetHandle: "prompt" }]
    expect(CreditsService.estimateWorkflowBaseCredits([video, veo], elsewhere)).toBe(
      CreditsService.estimateWorkflowBaseCredits([video], []),
    )
  })
})
