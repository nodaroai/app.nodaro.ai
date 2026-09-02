/**
 * W1-a minor-age floor — the DAG lane.
 *
 * `case "character"` is the orchestrator's equivalent of POST
 * /v1/generate-character: it assembles the entity prompt itself and enqueues
 * straight to the entity worker. It must therefore make the SAME age decision
 * the route makes — once, from the node's `person` picker value — and ride it
 * to the worker as `subjectMinor`, where the minor-age-floor policy fires.
 *
 * Note the DAG prompt is built by `buildCharacterPrompt`, not
 * `buildPortraitPrompt`, so no scaffolding function runs on this lane: the
 * policy at the entity handler is this lane's only Layer-2 point, and
 * `subjectMinor` is what arms it.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

function characterNode(data: Record<string, unknown>): SimpleNode {
  return { id: "char-1", type: "character", data: { name: "Kira", provider: "nano-banana", ...data } }
}

function build(data: Record<string, unknown>) {
  const n = characterNode(data)
  return buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
}

describe("payload-builder case \"character\" — subjectMinor (W1-a)", () => {
  it("adult byte-identity pin: the payload prompt is the pre-change string", () => {
    const result = build({ description: "young woman, auburn hair", person: { age: "age-30s" } })
    expect(result.jobName).toBe("generate-character")
    expect(result.payload.prompt).toBe(
      "Kira, young woman, auburn hair, realistic style, front view, looking at camera, full body portrait, 4k, highly detailed, clean background.",
    )
  })

  it("adult person value -> subjectMinor false", () => {
    expect(build({ description: "young woman", person: { age: "age-30s" } }).payload.subjectMinor).toBe(false)
  })

  it("minor person value -> subjectMinor true", () => {
    expect(build({ description: "a child", person: { age: "age-child" } }).payload.subjectMinor).toBe(true)
  })

  it("a custom age under 20 is a minor; 20+ is not", () => {
    expect(build({ description: "a kid", person: { age: "age-custom", customAge: 12 } }).payload.subjectMinor).toBe(true)
    expect(build({ description: "an adult", person: { age: "age-custom", customAge: 34 } }).payload.subjectMinor).toBe(false)
  })

  it("a minor-implying type with no age is a minor", () => {
    expect(build({ description: "a storybook girl", person: { type: "alice-wonderland" } }).payload.subjectMinor).toBe(true)
  })

  it("no person value at all -> subjectMinor false (mainline nodes are untouched)", () => {
    expect(build({ description: "young woman" }).payload.subjectMinor).toBe(false)
  })

  // The DAG lane's own incident shape: a node written straight into workflow
  // JSON (agent / import / template) carries prompt text but no picker value.
  it("no person value, but the assembled text describes a minor -> subjectMinor true", () => {
    expect(build({ description: "a young child around 5 years old, red raincoat" }).payload.subjectMinor).toBe(true)
    expect(build({ description: "a 7 year old on a swing" }).payload.subjectMinor).toBe(true)
  })

  it("no person value and adult text -> subjectMinor false, prompt byte-identical", () => {
    const adult = build({ description: "a woman in her 30s holding her child" })
    expect(adult.payload.subjectMinor).toBe(false)
    expect(adult.payload.prompt).toBe(
      "Kira, a woman in her 30s holding her child, realistic style, front view, looking at camera, full body portrait, 4k, highly detailed, clean background.",
    )
  })

  it("the nameless path reads the node's own prompt field", () => {
    const n: SimpleNode = {
      id: "char-2",
      type: "character",
      data: { provider: "nano-banana", prompt: "a pre-teen around 11 years old in a school corridor" },
    }
    const result = buildPayload(n, "job-2", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    expect(result.payload.subjectMinor).toBe(true)
  })
})
