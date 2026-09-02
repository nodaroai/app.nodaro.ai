/**
 * W1-a minor-age floor — the generate-face DAG lane.
 *
 * `case "face"` is the orchestrator's equivalent of POST /v1/generate-face, and
 * both feed `makeEntityImageHandler("generate-face")` — the same entity-image
 * chokepoint the character lanes use. The whole-branch review found this lane
 * had NO age signal at all: a face node carrying the incident wording enqueued
 * with `subjectMinor` absent, so the policy at the handler was the identity and
 * the flagged text reached the provider.
 *
 * A face node carries no `person` picker value (FaceNodeData has no such
 * field), so the text signal is the whole signal here.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

function faceNode(data: Record<string, unknown>): SimpleNode {
  return { id: "face-1", type: "face", data: { provider: "nano-banana", ...data } }
}

function build(data: Record<string, unknown>) {
  const n = faceNode(data)
  return buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
}

describe('payload-builder case "face" — subjectMinor (W1-a)', () => {
  it("adult byte-identity pin: the payload prompt is the pre-change string", () => {
    const result = build({ name: "Ana", description: "a woman in her 30s, auburn hair", style: "realistic" })
    expect(result.jobName).toBe("generate-face")
    expect(result.payload.prompt).toBe(
      "Create a professional close-up face portrait headshot: Ana, a woman in her 30s, auburn hair. " +
        "Style: realistic. Looking directly at camera, sharp focus on facial features, clean background, " +
        "studio lighting, high resolution. Maintain exact facial identity and features from the reference image.",
    )
    expect(result.payload.subjectMinor).toBe(false)
  })

  it("a minor described in the node's description -> subjectMinor true", () => {
    expect(build({ name: "Ana", description: "a young child around 5 years old" }).payload.subjectMinor).toBe(true)
    expect(build({ name: "Ana", description: "a 7 year old on a swing" }).payload.subjectMinor).toBe(true)
  })

  // The colloquial shapes Commit A added — the lane must inherit them for free.
  it("reads the colloquial age spellings too", () => {
    expect(build({ name: "Ana", description: "aged 12, school portrait" }).payload.subjectMinor).toBe(true)
    expect(build({ name: "Ana", description: "12yo, school portrait" }).payload.subjectMinor).toBe(true)
    expect(build({ name: "Ana", description: "aged 45, studio portrait" }).payload.subjectMinor).toBe(false)
  })

  it("the nameless path reads the node's own description / prompt field", () => {
    expect(build({ description: "a pre-teen around 11 years old in a school corridor" }).payload.subjectMinor).toBe(true)
    expect(build({ prompt: "a 9 year old in a school corridor" }).payload.subjectMinor).toBe(true)
    expect(build({ prompt: "a woman in her 30s in a school corridor" }).payload.subjectMinor).toBe(false)
  })

  it("no age evidence at all -> subjectMinor false (mainline nodes are untouched)", () => {
    expect(build({ name: "Ana", description: "auburn hair, green eyes" }).payload.subjectMinor).toBe(false)
  })
})
