/**
 * A server-run workflow's Motion Transfer node on Wan Animate under a
 * deployment's model restriction (decided 2026-11-12). Wan Animate Move and
 * Replace have model-catalog entries, so `models.allow` names them like any
 * other model: a list that leaves one out refuses the node with
 * `model_not_available` at the top of the build, before the executor creates or
 * reserves anything (node-executor-dubbing-source-gate.test.ts pins that a
 * build refusal reserves nothing); a list that names it, and a deployment with
 * no restriction, build the job exactly as before.
 *
 * Also pinned: an Admin → Availability models override saved before Wan
 * Animate had catalog entries does not list it, so it now withholds it (models
 * have no gating generations), as for FLUX Fill Pro.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { deniedModelRejectionMessage, isModelDenied, modelRestrictionConfigured } from "../../../lib/surface-deny.js"

const IMAGE = "https://cdn.example.com/character.png"
const VIDEO = "https://cdn.example.com/dance.mp4"
const WAN = ["wan-animate-move", "wan-animate-replace"] as const
/** The Kling motion models (Kling 2.6's option `kling` runs catalog `motion-transfer`). */
const KLING_MODELS = ["motion-transfer", "kling-3.0-motion"]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const node = (data: Record<string, unknown>): SimpleNode => ({
  id: "motion-transfer-1",
  type: "motion-transfer",
  data: { label: "Motion", prompt: "a person dancing", ...data },
})
const build = (n: SimpleNode) =>
  buildPayload(n, "job-1", { imageUrl: IMAGE, videoUrl: VIDEO } as ResolvedInputs, undefined, { nodes: [n], edges: [], nodeStates: {} })

function refusalOf(fn: () => unknown): { code?: unknown; message: string } | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return { code: (err as { code?: unknown }).code, message: (err as Error).message }
  }
}

describe("a workflow's Wan Animate node under models.allow", () => {
  for (const provider of WAN) {
    it(`${provider}: an allow list that does not name it refuses the node with model_not_available`, () => {
      setProfile({ models: { allow: KLING_MODELS } })
      expect(refusalOf(() => build(node({ provider, resolution: "580p" })))).toEqual({
        code: "model_not_available",
        message: deniedModelRejectionMessage([provider]),
      })
    })

    it(`${provider}: an allow list that names it builds the job it built before`, () => {
      const unrestricted = build(node({ provider, resolution: "580p" }))
      setProfile({ models: { allow: [...KLING_MODELS, provider] } })
      const allowed = build(node({ provider, resolution: "580p" }))
      expect(allowed).toEqual(unrestricted)
      expect(allowed.jobName).toBe("motion-transfer")
      expect(allowed.modelIdentifier).toBe(`${provider}:580p`)
      expect(allowed.payload).toMatchObject({ provider, resolution: "580p", imageUrl: IMAGE, videoUrl: VIDEO })
    })

    it(`${provider}: a deployment that restricts nothing builds it`, () => {
      expect(modelRestrictionConfigured()).toBe(false)
      expect(build(node({ provider })).payload).toMatchObject({ provider, resolution: "720p" })
    })

    it(`${provider}: a size it does not have is built, and priced, as 720p`, () => {
      const built = build(node({ provider, resolution: "1080p" }))
      expect(built.modelIdentifier).toBe(`${provider}:720p`)
      expect(built.payload).toMatchObject({ provider, resolution: "720p" })
    })
  }

  it("the same allow list still builds the Kling motion models (the refusal is Wan Animate's alone)", () => {
    setProfile({ models: { allow: KLING_MODELS } })
    expect(build(node({ provider: "kling", resolution: "1080p" })).payload).toMatchObject({ provider: "kling", resolution: "1080p" })
    expect(build(node({ provider: "kling-3.0" })).payload).toMatchObject({ provider: "kling-3.0" })
  })
})

describe("an Admin → Availability models override and Wan Animate", () => {
  const everyModelBut = (ids: readonly string[]) => new Set([...GATEABLE_MODEL_IDS].filter((m) => !ids.includes(m)))

  it("both are models an override lists (Admin → Availability shows them)", () => {
    for (const id of WAN) expect(GATEABLE_MODEL_IDS.has(id)).toBe(true)
  })

  it("an override saved before they were listable (every other model ticked) withholds them, and the deployment now restricts models", () => {
    __resetAvailabilityOverridesForTests({ models: everyModelBut(WAN) })
    for (const id of WAN) expect(isModelDenied(id)).toBe(true)
    expect(modelRestrictionConfigured()).toBe(true)
    expect(refusalOf(() => build(node({ provider: "wan-animate-move" })))).toEqual({
      code: "model_not_available",
      message: deniedModelRejectionMessage(["wan-animate-move"]),
    })
  })

  it("an override that ticks them runs them, and one that ticks every model restricts nothing", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })
    expect(isModelDenied("wan-animate-replace")).toBe(false)
    expect(modelRestrictionConfigured()).toBe(false)
    expect(build(node({ provider: "wan-animate-replace" })).payload).toMatchObject({ provider: "wan-animate-replace" })
  })
})
