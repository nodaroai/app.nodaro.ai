/**
 * A server-run workflow's Generate Image node wired to a character with a
 * succeeded trained model, under a deployment's model restriction (decided
 * 2026-11-12). Where the deployment withholds the trained model
 * (`flux-lora-character`), the build does not switch to it: the node runs the
 * model it names and uses the character through its pictures — exactly the job
 * a character with no trained model builds. Offered, or with no restriction,
 * the build switches as before. The built job is judged on the model it runs,
 * so a switched build answers the trained model.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleEdge, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { jobRunModelOfBuild } from "../../../lib/run-model.js"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"

const PICKED = "gpt-image-2"
const OFFERED = [PICKED, "gpt-image-2-i2i"]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
  vi.restoreAllMocks()
})

const LORA = { loraReplicateVersion: "owner/char-kira:abc123", loraTriggerWord: "TOK_kira", loraTrainingStatus: "succeeded" }
const character = (trained: boolean): SimpleNode => ({
  id: "c1",
  type: "character",
  data: { label: "Kira", characterName: "Kira", sourceImageUrl: "https://cdn.example.com/kira.png", ...(trained ? LORA : {}) },
})
const edges: SimpleEdge[] = [{ id: "e1", source: "c1", target: "g1", sourceHandle: "character" }]

function build(trained: boolean) {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const node: SimpleNode = { id: "g1", type: "generate-image", data: { label: "Portrait", provider: PICKED, prompt: "Kira walking on a beach", aspectRatio: "1:1" } }
  return buildPayload(node, "job-1", {} as ResolvedInputs, "usage-1", { nodes: [character(trained), node], edges, nodeStates: {} })
}

describe("a workflow's trained character where the trained model is withheld", () => {
  it("does not switch: the node's own model runs with the character's pictures, as for a character with no trained model", () => {
    const untrained = build(false)
    setProfile({ models: { allow: OFFERED } })
    const withheld = build(true)
    expect(withheld).toEqual(untrained)
    expect(withheld.payload.model).not.toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    expect(withheld.payload.provider).toBe(PICKED)
    expect(withheld.payload.extraParams).toBeUndefined()
    expect((withheld.payload.referenceImageUrls as string[]).length).toBeGreaterThan(0)
    expect(withheld.modelIdentifier).not.toBe(FLUX_LORA_CHARACTER_MODEL_ID)
  })

  it("an explicit deny withholds it the same way", () => {
    const untrained = build(false)
    setProfile({ models: { deny: [FLUX_LORA_CHARACTER_MODEL_ID] } })
    expect(build(true)).toEqual(untrained)
  })

  it("so does an Admin → Availability models override saved before the trained model was listed", () => {
    const untrained = build(false)
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => id !== FLUX_LORA_CHARACTER_MODEL_ID)) })
    expect(build(true)).toEqual(untrained)
  })
})

describe("a workflow's trained character where the trained model is offered", () => {
  it("an allow list that names it switches to it, as before, and the build is judged on it", () => {
    const unrestricted = build(true)
    setProfile({ models: { allow: [...OFFERED, FLUX_LORA_CHARACTER_MODEL_ID] } })
    const allowed = build(true)
    expect(allowed).toEqual(unrestricted)
    expect(allowed.modelIdentifier).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    expect(allowed.payload).toMatchObject({ provider: "replicate", model: FLUX_LORA_CHARACTER_MODEL_ID, referenceImageUrls: [] })
    expect(jobRunModelOfBuild(allowed.jobName, allowed.payload, allowed.modelIdentifier)).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
  })
})
