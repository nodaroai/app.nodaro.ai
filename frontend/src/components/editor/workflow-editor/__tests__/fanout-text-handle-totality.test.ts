/**
 * `NON_PROMPT_TEXT_LANES` is derived from the ROUTER, not remembered — the
 * in-browser engine's half of backend `fanout-text-handle-totality.test.ts`.
 *
 * A list that drives a fan-out is passed as the prompt override unless its wire
 * sits on one of these lanes. This routes a text source into EVERY input handle
 * of EVERY node definition through the real `resolveNodeInputs` and fails the
 * build on any (node type, handle) pair where the shared table and THIS router
 * disagree, in either direction. Both engines read one table, so a lane the two
 * routers treat differently cannot pass both guards — that would be a routing
 * parity bug, and this is where it surfaces.
 *
 * Handles where text lands in a media slot (`imageUrl`, …), an array, or nowhere
 * are not text lanes and are ignored.
 */
import { describe, it, expect, vi } from "vitest"
import { NON_PROMPT_TEXT_LANES, fanOutTextFeedsPrompt } from "@nodaro/shared/workflow"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ characterDefinitions: [], nodes: [], edges: [] }) },
}))

import { NODE_DEFINITIONS } from "@/types/nodes"
import { resolveNodeInputs } from "../node-input-resolver"

const TEXT = "FANOUT-TEXT-PROBE"

type Lane = "prompt" | "other-text" | "not-a-text-lane"

/* eslint-disable @typescript-eslint/no-explicit-any */
function laneOf(nodeType: string, handle: string): { lane: Lane; key?: string } {
  const source: any = { id: "src", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Probe Source", text: TEXT } }
  const target: any = { id: "tgt", type: nodeType, position: { x: 0, y: 0 }, data: { label: "Probe Target" } }
  const edge: any = { id: "e", source: "src", sourceHandle: "text", target: "tgt", targetHandle: handle }
  let inputs: Record<string, unknown>
  try {
    inputs = resolveNodeInputs(target, [source, target], [edge]) as unknown as Record<string, unknown>
  } catch {
    return { lane: "not-a-text-lane" }
  }
  if (inputs.prompt === TEXT) return { lane: "prompt" }
  const key = Object.keys(inputs).find((k) => inputs[k] === TEXT && !/Urls?$/.test(k))
  return key ? { lane: "other-text", key } : { lane: "not-a-text-lane" }
}

describe("NON_PROMPT_TEXT_LANES matches the in-browser router", () => {
  const pairs = NODE_DEFINITIONS.flatMap((def) =>
    (def.inputs ?? []).map((handle: string) => ({ nodeType: def.type as string, handle, ...laneOf(def.type, handle) })),
  )
  const textLanes = pairs.filter((p) => p.lane !== "not-a-text-lane")

  it("probes a meaningful surface", () => {
    expect(NODE_DEFINITIONS.length).toBeGreaterThan(100)
    expect(textLanes.filter((p) => p.lane === "prompt").length).toBeGreaterThan(20)
    expect(textLanes.filter((p) => p.lane === "other-text").length).toBeGreaterThan(5)
  })

  it("a lane the router sends to ANOTHER text input is in the table", () => {
    const missing = textLanes
      .filter((p) => p.lane === "other-text" && fanOutTextFeedsPrompt(p.nodeType, p.handle))
      .map((p) => `${p.nodeType}.${p.handle} -> inputs.${p.key}`)
    expect(missing).toEqual([])
  })

  it("a lane the router sends to the PROMPT is not in the table", () => {
    const wrong = textLanes
      .filter((p) => p.lane === "prompt" && !fanOutTextFeedsPrompt(p.nodeType, p.handle))
      .map((p) => `${p.nodeType}.${p.handle}`)
    expect(wrong).toEqual([])
  })

  it("every table entry is a real lane here too (no stale handles, no stale node types)", () => {
    const stale: string[] = []
    for (const [handle, scope] of Object.entries(NON_PROMPT_TEXT_LANES)) {
      const diverting = textLanes.filter((p) => p.handle === handle && p.lane === "other-text").map((p) => p.nodeType)
      if (diverting.length === 0) stale.push(`${handle} (no node type diverts it)`)
      if (scope !== "*") for (const nodeType of scope) if (!diverting.includes(nodeType)) stale.push(`${nodeType}.${handle}`)
    }
    expect(stale).toEqual([])
  })
})
