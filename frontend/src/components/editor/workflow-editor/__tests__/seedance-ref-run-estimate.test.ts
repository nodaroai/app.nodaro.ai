import { describe, it, expect } from "vitest"
import { estimateRunCredits, runModelIds } from "../estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { seedanceRefQuoteKeyFor } from "@/lib/seedance-ref-quote"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * A Seedance run with reference video(s) is billed input + output seconds, so
 * the run estimate (Execute badge, run confirm, precheck, app runner) prices it
 * at the server's quote from the probed clips — the quote key is in the ids it
 * fetches, and a cached quote wins over the row price.
 */

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode

const upload = node("clip", "upload-video", { url: "https://cdn.example/clip.mp4" })
const gv = node("gv", "generate-video", { provider: "seedance-2-5", duration: 8, resolution: "720p" })
const edges = [{ id: "e", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" } as WorkflowEdge]
const all = [upload, gv]

describe("run estimate — Seedance reference-video quote", () => {
  const key = seedanceRefQuoteKeyFor(gv, all, edges)!
  const row = getModelIdentifier(gv, edges, all)

  it("fetches the node's quote key along with its row", () => {
    expect(runModelIds([gv], all, edges)).toEqual(expect.arrayContaining([row, key]))
  })

  it("prices the node at its cached quote, not the row", () => {
    const cached = (id: string) => (id === key ? 1911 : id === row ? 760 : undefined)
    expect(estimateRunCredits([gv], all, edges, cached)).toBe(1911)
  })

  it("falls back to the row while the quote is not cached", () => {
    expect(estimateRunCredits([gv], all, edges, (id) => (id === row ? 760 : undefined))).toBe(760)
  })

  it("a whole run that re-renders the clip's source quotes the clip as unknown (a different key)", () => {
    const producer = node("clip", "generate-video", { provider: "kling-3.0", duration: 5, generatedVideoUrl: "https://cdn.example/old.mp4" })
    const whole = [producer, gv]
    const single = seedanceRefQuoteKeyFor(gv, whole, edges)!
    const rerun = seedanceRefQuoteKeyFor(gv, whole, edges, new Set(["clip", "gv"]))!
    expect(rerun).not.toBe(single)
    expect(runModelIds(whole, whole, edges)).toContain(rerun)
  })
})
