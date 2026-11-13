/**
 * A server-run workflow's Lip Sync node on LatentSync, HeyGen Lipsync
 * Precision or Lipsync 2 Pro, and its Suno nodes on V4_5PLUS, V4_5ALL or
 * V4_5, under a deployment's model restriction (decided 2026-11-12). Each has
 * a model-catalog entry, so `models.allow` names it like any other model: a
 * list that leaves one out refuses the node with `model_not_available` at the
 * top of the build, before the executor creates or reserves anything
 * (node-executor-dubbing-source-gate.test.ts pins that a build refusal
 * reserves nothing); a list that names it, and a deployment with no
 * restriction, build the job exactly as before.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { deniedModelRejectionMessage, isModelDenied, modelRestrictionConfigured } from "../../../lib/surface-deny.js"

const VIDEO = "https://cdn.example.com/face.mp4"
const AUDIO = "https://cdn.example.com/line.mp3"

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

const build = (n: SimpleNode, inputs: ResolvedInputs) => buildPayload(n, "job-1", inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })

function refusalOf(fn: () => unknown): { code?: unknown; message: string } | undefined {
  try {
    fn()
    return undefined
  } catch (err) {
    return { code: (err as { code?: unknown }).code, message: (err as Error).message }
  }
}

describe("a workflow's Lip Sync node under models.allow", () => {
  const LISTED = ["latentsync", "heygen-lipsync-precision", "lipsync-2-pro"] as const
  const KLING_AVATARS = ["kling-avatar", "kling-avatar-pro"]
  const node = (data: Record<string, unknown>): SimpleNode => ({ id: "lip-sync-1", type: "lip-sync", data: { label: "Lip Sync", ...data } })
  const buildLipSync = (n: SimpleNode) => build(n, { videoUrl: VIDEO, audioUrl: AUDIO } as ResolvedInputs)

  for (const provider of LISTED) {
    it(`${provider}: an allow list that does not name it refuses the node with model_not_available`, () => {
      setProfile({ models: { allow: KLING_AVATARS } })
      expect(refusalOf(() => buildLipSync(node({ provider, audioDurationSec: 42 })))).toEqual({
        code: "model_not_available",
        message: deniedModelRejectionMessage([provider]),
      })
    })

    it(`${provider}: an allow list that names it builds the job it built before`, () => {
      const unrestricted = buildLipSync(node({ provider, audioDurationSec: 42 }))
      setProfile({ models: { allow: [...KLING_AVATARS, provider] } })
      const allowed = buildLipSync(node({ provider, audioDurationSec: 42 }))
      expect(allowed).toEqual(unrestricted)
      expect(allowed.jobName).toBe("lip-sync")
      expect(allowed.modelIdentifier).toBe(provider === "latentsync" ? "latentsync" : `${provider}:60s`)
      expect(allowed.payload).toMatchObject({ provider, videoUrl: VIDEO, audioUrl: AUDIO })
    })

    it(`${provider}: a deployment that restricts nothing builds it`, () => {
      expect(modelRestrictionConfigured()).toBe(false)
      expect(buildLipSync(node({ provider })).payload).toMatchObject({ provider })
    })
  }

  it("the same allow list still builds the Kling avatars", () => {
    setProfile({ models: { allow: KLING_AVATARS } })
    expect(buildLipSync(node({ provider: "kling-avatar" })).payload).toMatchObject({ provider: "kling-avatar" })
  })

  it("an Admin → Availability models override saved before they were listed withholds them", () => {
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((m) => !(LISTED as readonly string[]).includes(m))) })
    for (const provider of LISTED) {
      expect(GATEABLE_MODEL_IDS.has(provider), provider).toBe(true)
      expect(isModelDenied(provider), provider).toBe(true)
      expect(refusalOf(() => buildLipSync(node({ provider })))?.code, provider).toBe("model_not_available")
    }
  })
})

describe("a workflow's Suno nodes under models.allow", () => {
  const VERSIONS = { V4_5PLUS: "suno-v4_5plus", V4_5ALL: "suno-v4_5all", V4_5: "suno-v4_5" } as const
  const CURRENT = ["suno-v6", "suno-v6_wild", "suno-v6_mini"]
  /** Each node, its data, its inputs, and the row it is priced under on one of these versions. */
  const NODES: ReadonlyArray<{ type: string; data: Record<string, unknown>; inputs: Record<string, unknown>; row: (catalogId: string) => string }> = [
    { type: "suno-generate", data: { prompt: "an upbeat song about the sea" }, inputs: {}, row: (id) => id },
    { type: "suno-cover", data: { prompt: "a slow acoustic cover", uploadUrl: AUDIO }, inputs: {}, row: (id) => id },
    { type: "suno-extend", data: { audioId: "track-1", prompt: "keep going" }, inputs: {}, row: (id) => id },
    { type: "suno-mashup", data: {}, inputs: { audioUrl: AUDIO, audioUrl2: "https://cdn.example.com/track-2.mp3" }, row: () => "suno-mashup" },
    { type: "suno-upload-extend", data: { uploadUrl: AUDIO }, inputs: {}, row: () => "suno-upload-extend" },
    { type: "suno-add-instrumental", data: { taskId: "task-1", audioId: "track-1" }, inputs: {}, row: () => "suno-add-instrumental" },
    { type: "suno-add-vocals", data: { taskId: "task-1", audioId: "track-1" }, inputs: {}, row: () => "suno-add-vocals" },
  ]
  const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: `${type}-1`, type, data: { label: "Suno", ...data } })

  for (const [version, catalogId] of Object.entries(VERSIONS)) {
    for (const spec of NODES) {
      it(`${spec.type} @ ${version}: refused with model_not_available when the list leaves ${catalogId} out; built as before when it names it`, () => {
        const n = node(spec.type, { ...spec.data, model: version })
        const unrestricted = build(n, spec.inputs as ResolvedInputs)
        expect(unrestricted.modelIdentifier).toBe(spec.row(catalogId))
        setProfile({ models: { allow: CURRENT } })
        expect(refusalOf(() => build(n, spec.inputs as ResolvedInputs))).toEqual({
          code: "model_not_available",
          message: deniedModelRejectionMessage([catalogId]),
        })
        setProfile({ models: { allow: [...CURRENT, catalogId] } })
        expect(build(n, spec.inputs as ResolvedInputs)).toEqual(unrestricted)
      })
    }
  }

  it("the same allow list builds the current versions", () => {
    setProfile({ models: { allow: CURRENT } })
    expect(build(node("suno-generate", { prompt: "a song", model: "V6_WILD" }), {} as ResolvedInputs).modelIdentifier).toBe("suno-v6_wild")
  })
})
