/**
 * A server-run workflow's Modify Image (and Image to Image) node on FLUX Fill
 * Pro under a deployment's model restriction (decided 2026-11-12). FLUX Fill
 * Pro has a model-catalog entry, so `models.allow` names it like any other
 * model: a list that leaves it out refuses the node with `model_not_available`
 * at the top of the build, before the executor creates or reserves anything
 * (node-executor-dubbing-source-gate.test.ts pins that a build refusal reserves
 * nothing); a list that names it, and a deployment with no restriction, build
 * the job exactly as before.
 *
 * Also pinned: what an Admin → Availability models override does with it. A
 * stored override is an ENABLED set, and models have no gating generations
 * (lib/availability-override.ts gives them to nodes only), so an override saved
 * before FLUX Fill Pro had a catalog entry does not list it and now withholds
 * it, and turns the deployment into one that restricts models.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { deniedModelRejectionMessage, isModelDenied, modelRestrictionConfigured } from "../../../lib/surface-deny.js"

const SRC = "https://cdn.example.com/src.png"
const MASK = "https://cdn.example.com/mask.png"
/** A model the deployment offers that is not FLUX Fill Pro. */
const OTHER = "gpt-image-2-6-flare-i2i"

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

const node = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({
  id: `${type}-1`,
  type,
  data: { label: "Edit", prompt: "a red scarf", provider: "flux-fill", ...data },
})
const build = (n: SimpleNode) =>
  buildPayload(n, "job-1", { imageUrl: SRC, maskUrl: MASK } as ResolvedInputs, undefined, { nodes: [n], edges: [], nodeStates: {} })

function refusalOf(fn: () => unknown): { code?: unknown; message: string } | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return { code: (err as { code?: unknown }).code, message: (err as Error).message }
  }
}

describe("a workflow's FLUX Fill Pro node under models.allow", () => {
  for (const type of ["modify-image", "image-to-image"]) {
    it(`${type}: an allow list that does not name it refuses the node with model_not_available`, () => {
      setProfile({ models: { allow: [OTHER] } })
      expect(refusalOf(() => build(node(type)))).toEqual({ code: "model_not_available", message: deniedModelRejectionMessage(["flux-fill"]) })
    })

    it(`${type}: an allow list that names it builds the job it built before`, () => {
      const unrestricted = build(node(type))
      setProfile({ models: { allow: [OTHER, "flux-fill"] } })
      const allowed = build(node(type))
      expect(allowed).toEqual(unrestricted)
      expect(allowed.jobName).toBe("image-to-image")
      expect(allowed.modelIdentifier).toBe("flux-fill")
      expect(allowed.payload).toMatchObject({ provider: "flux-fill", imageUrl: SRC, maskUrl: MASK })
    })
  }

  it("a deployment that restricts nothing builds it", () => {
    expect(modelRestrictionConfigured()).toBe(false)
    expect(build(node("modify-image")).payload).toMatchObject({ provider: "flux-fill", maskUrl: MASK })
  })

  it("the same allow list still builds the node's other models (the refusal is FLUX Fill Pro's alone)", () => {
    setProfile({ models: { allow: [OTHER] } })
    expect(build(node("modify-image", { provider: OTHER })).payload).toMatchObject({ provider: OTHER })
  })
})

describe("an Admin → Availability models override and FLUX Fill Pro", () => {
  const everyModelBut = (id: string) => new Set([...GATEABLE_MODEL_IDS].filter((m) => m !== id))

  it("FLUX Fill Pro is a model an override lists (Admin → Availability shows it)", () => {
    expect(GATEABLE_MODEL_IDS.has("flux-fill")).toBe(true)
  })

  it("an override saved before it was listable (every other model ticked) withholds it, and the deployment now restricts models", () => {
    __resetAvailabilityOverridesForTests({ models: everyModelBut("flux-fill") })
    expect(isModelDenied("flux-fill")).toBe(true)
    expect(modelRestrictionConfigured()).toBe(true)
    expect(refusalOf(() => build(node("modify-image")))).toEqual({ code: "model_not_available", message: deniedModelRejectionMessage(["flux-fill"]) })
  })

  it("an override that ticks it runs it, and one that ticks every model restricts nothing", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })
    expect(isModelDenied("flux-fill")).toBe(false)
    expect(modelRestrictionConfigured()).toBe(false)
    expect(build(node("modify-image")).payload).toMatchObject({ provider: "flux-fill" })
  })
})
