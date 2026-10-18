/**
 * `NON_PROMPT_TEXT_LANES` is derived from the ROUTER, not remembered.
 *
 * A list that drives a fan-out is written into the prompt unless its wire sits
 * on one of these lanes. The table is only correct while it matches what
 * `resolveNodeInputs` really does with text — so this routes a text source into
 * EVERY input handle of EVERY node type through the real resolver and fails the
 * build on any (node type, handle) pair where the table and the router disagree:
 *
 *   - the router sends the text to a DIFFERENT text input (negativePrompt,
 *     systemPrompt, script, transcript, …) but the table says "prompt" — a list
 *     fanned out through it would be written into the prompt as well; or
 *   - the router sends it to the prompt but the table says "not a prompt" — a
 *     list fanned out through it would lose its per-row prompt override.
 *
 * Handles where text lands in a media slot (`imageUrl`, `maskUrl`, …), an array,
 * or nowhere are not text lanes — the router files whatever arrives on a media
 * handle as that medium, and no text list can be wired there — so they are
 * ignored. The frontend twin runs the same check against the in-browser router.
 */
import { describe, it, expect } from "vitest"
import { NON_PROMPT_TEXT_LANES, fanOutTextFeedsPrompt } from "@nodaro/shared/workflow"
import { ALL_NODE_HANDLES } from "../../../lib/node-handles.js"
import { resolveNodeInputs } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge } from "../types.js"

const TEXT = "FANOUT-TEXT-PROBE"

type Lane = "prompt" | "other-text" | "not-a-text-lane"

function laneOf(nodeType: string, handle: string): { lane: Lane; key?: string } {
  const source: SimpleNode = { id: "src", type: "text-prompt", data: { label: "Probe Source", text: TEXT } }
  const target: SimpleNode = { id: "tgt", type: nodeType, data: { label: "Probe Target" } }
  const edge = { id: "e", source: "src", sourceHandle: "text", target: "tgt", targetHandle: handle } as SimpleEdge
  let inputs: Record<string, unknown>
  try {
    inputs = resolveNodeInputs(target, [edge], {}, [source, target]) as unknown as Record<string, unknown>
  } catch {
    return { lane: "not-a-text-lane" }
  }
  if (inputs.prompt === TEXT) return { lane: "prompt" }
  const key = Object.keys(inputs).find((k) => inputs[k] === TEXT && !/Urls?$/.test(k))
  return key ? { lane: "other-text", key } : { lane: "not-a-text-lane" }
}

describe("NON_PROMPT_TEXT_LANES matches the backend router", () => {
  const pairs = Object.entries(ALL_NODE_HANDLES).flatMap(([nodeType, spec]) =>
    spec.inputs.map((handle) => ({ nodeType, handle, ...laneOf(nodeType, handle) })),
  )
  const textLanes = pairs.filter((p) => p.lane !== "not-a-text-lane")

  it("probes a meaningful surface (the generated handle map is wired in)", () => {
    expect(Object.keys(ALL_NODE_HANDLES).length).toBeGreaterThan(100)
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

  it("every table entry is a real lane (no stale handles, no stale node types)", () => {
    const stale: string[] = []
    for (const [handle, scope] of Object.entries(NON_PROMPT_TEXT_LANES)) {
      const diverting = textLanes.filter((p) => p.handle === handle && p.lane === "other-text").map((p) => p.nodeType)
      if (diverting.length === 0) stale.push(`${handle} (no node type diverts it)`)
      if (scope !== "*") for (const nodeType of scope) if (!diverting.includes(nodeType)) stale.push(`${nodeType}.${handle}`)
    }
    expect(stale).toEqual([])
  })
})
