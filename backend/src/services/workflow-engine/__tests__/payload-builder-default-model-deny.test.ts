/**
 * buildPayload: a workflow node that names no model is judged, on a deployment
 * that restricts models, on the model its BUILD filled in.
 *
 * The run-time backstop at the top of the build judges the model a node names
 * (`effectiveDispatchProvider`). A node that names none runs a default the
 * build fills in — Generate Image the general default for its ratio, Image to
 * Image the edit default, a video node its type's default, Text to Speech the
 * default speech model — and that default reached the provider unjudged, so a
 * server-run workflow, app run or MCP-written graph could run a model the
 * deployment withholds. Now the build's own answer is judged before it is
 * returned (`refuseWithheldDefaultModel`), with the same coded refusal.
 *
 * Every expected model is read from the sources the build reads (the role
 * defaults, the video default, the registry), or from the unrestricted build
 * itself — never typed out here.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../../lib/model-switch.js"
import { deniedModelRejectionMessage, modelRestrictionConfigured } from "../../../lib/surface-deny.js"
import { resolvedModelOfJob } from "../../../lib/job-resolved-model.js"
import { llmFeatureDefault } from "../../../lib/run-model.js"
import { AUDIO_ISOLATION_CREDIT_ID } from "../../../lib/fixed-row-credit-ids.js"
import { defaultImageModel, IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { applyDefaultVideoSelection, DEFAULT_TTS_PROVIDER } from "@nodaro/shared/models"

const IMG = "https://cdn.example.com/a.png"
const VID = "https://cdn.example.com/a.mp4"
const AUD = "https://cdn.example.com/a.mp3"
/** What a wired graph hands most nodes. */
const WIRED = { prompt: "a quiet harbour at dawn", text: "Hello there.", imageUrl: IMG, videoUrl: VID, audioUrl: AUD, imageUrls: [IMG], startFrameUrl: IMG }
/** An allowed model that is none of the defaults below. */
const OTHER = "nano-banana-2"

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}
const allow = (...ids: string[]) => setProfile({ models: { allow: ids } })

afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const node = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: `${type}-1`, type, data: { label: "My Node", ...data } })
const build = (n: SimpleNode, inputs: Record<string, unknown> = {}) =>
  buildPayload(n, "job-1", { ...inputs } as ResolvedInputs, undefined, { nodes: [n], edges: [], nodeStates: {} })

/** The refusal `fn` throws, as the run reads it; undefined when it builds. */
function refusalOf(fn: () => unknown): { code?: unknown; message: string } | undefined {
  try {
    fn()
    return undefined
  } catch (e) {
    return { code: (e as { code?: unknown }).code, message: (e as Error).message }
  }
}
const refused = (id: string) => ({ code: "model_not_available", message: deniedModelRejectionMessage([id]) })

interface Case {
  readonly name: string
  readonly node: () => SimpleNode
  readonly inputs?: Record<string, unknown>
  /** The model the node runs when it names none, from the source its build reads. */
  readonly runsOn: (unrestricted: ReturnType<typeof build>) => string
}

const CASES: readonly Case[] = [
  { name: "Generate Image", node: () => node("generate-image", { prompt: "a quiet harbour" }), runsOn: () => defaultImageModel("general") },
  { name: "Generate Image at 4:5", node: () => node("generate-image", { prompt: "a quiet harbour", aspectRatio: "4:5" }), runsOn: () => defaultImageModel("general", "4:5") },
  { name: "Generate Image at 5:4", node: () => node("generate-image", { prompt: "a quiet harbour", aspectRatio: "5:4" }), runsOn: () => defaultImageModel("general", "5:4") },
  { name: "Image to Image", node: () => node("image-to-image"), inputs: WIRED, runsOn: () => defaultImageModel("edit") },
  { name: "Modify Image", node: () => node("modify-image"), inputs: WIRED, runsOn: () => defaultImageModel("edit") },
  { name: "Generate Video", node: () => node("generate-video"), inputs: WIRED, runsOn: () => applyDefaultVideoSelection({}).provider },
  // The older video nodes fill their own default; it is judged as built.
  { name: "Image to Video", node: () => node("image-to-video"), inputs: WIRED, runsOn: (b) => b.payload.provider as string },
  { name: "Text to Video", node: () => node("text-to-video"), inputs: WIRED, runsOn: (b) => b.payload.provider as string },
  { name: "Character", node: () => node("character"), inputs: WIRED, runsOn: () => IMAGE_MODEL_ROLE_DEFAULTS.character },
  { name: "Text to Speech", node: () => node("text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "hi" }), runsOn: () => DEFAULT_TTS_PROVIDER },
  { name: "Text to Speech with an empty provider", node: () => node("text-to-speech", { voiceId: "Rachel", provider: "", textSource: "direct", directText: "hi" }), runsOn: () => DEFAULT_TTS_PROVIDER },
  { name: "Audio Isolation (one fixed model)", node: () => node("audio-isolation"), inputs: WIRED, runsOn: () => AUDIO_ISOLATION_CREDIT_ID },
  { name: "Suno Generate", node: () => node("suno-generate", { prompt: "a song about the sea" }), runsOn: () => resolvedModelOfJob("suno-generate", {})! },
  { name: "Generate Script", node: () => node("generate-script"), inputs: WIRED, runsOn: () => llmFeatureDefault("generate-script")! },
]

describe("a node that names no model is judged on the model its build runs", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("refuses the build, with the named-model refusal, when the deployment's allowlist does not hold that model", () => {
        const unrestricted = build(c.node(), c.inputs)
        const runsOn = c.runsOn(unrestricted)
        expect(GATEABLE_MODEL_IDS.has(runsOn), `${runsOn} is a model a restriction can name`).toBe(true)
        expect(runsOn).not.toBe(OTHER)
        allow(OTHER)
        expect(refusalOf(() => build(c.node(), c.inputs))).toEqual(refused(runsOn))
      })

      it("builds exactly as before when the allowlist holds it", () => {
        const unrestricted = build(c.node(), c.inputs)
        allow(c.runsOn(unrestricted))
        const restricted = build(c.node(), c.inputs)
        expect(restricted.jobName).toBe(unrestricted.jobName)
        expect(restricted.modelIdentifier).toBe(unrestricted.modelIdentifier)
        expect(restricted.payload.provider).toEqual(unrestricted.payload.provider)
      })
    })
  }

  it("a models.deny naming the default refuses it too", () => {
    setProfile({ models: { deny: [defaultImageModel("edit")] } })
    expect(refusalOf(() => build(node("image-to-image"), WIRED))).toEqual(refused(defaultImageModel("edit")))
  })

  it("an admin's stored models override that leaves the default off refuses it", () => {
    __resetAvailabilityOverridesForTests({ models: new Set([OTHER]) })
    expect(refusalOf(() => build(node("image-to-image"), WIRED))).toEqual(refused(defaultImageModel("edit")))
  })

  it("the refusal is the one a node naming the same model gets at the top of the build", () => {
    allow(OTHER)
    const named = refusalOf(() => build(node("image-to-image", { provider: defaultImageModel("edit") }), WIRED))
    const defaulted = refusalOf(() => build(node("image-to-image"), WIRED))
    expect(defaulted).toEqual(named)
  })
})

describe("only a node that names no model is judged on its default", () => {
  it("a node that names an allowed model runs it, though the default is withheld", () => {
    allow("nano-banana-pro")
    const built = build(node("generate-image", { prompt: "a quiet harbour", provider: "nano-banana-pro" }))
    expect(built.payload.provider).toBe("nano-banana-pro")
  })

  it("Generate Image is judged before its image-to-image swap, as a named model is", () => {
    const unrestricted = build(node("generate-image", { prompt: "a quiet harbour" }), { imageUrl: IMG })
    // The base image swaps the run to the default's image-to-image sibling…
    expect(resolvedModelOfJob("generate-image", unrestricted.payload)).not.toBe(defaultImageModel("general"))
    // …which the allowlist need not list: the model chosen is the default.
    allow(defaultImageModel("general"))
    expect(refusalOf(() => build(node("generate-image", { prompt: "a quiet harbour" }), { imageUrl: IMG }))).toBeUndefined()
  })

  it("a node whose dispatched model the top of the build already resolves is judged there, not again (Video Depth)", () => {
    allow(OTHER)
    // video-depth's effective provider is its resolved default, so the named-model backstop refuses it.
    const r = refusalOf(() => build(node("video-depth"), WIRED))
    expect(r?.code).toBe("model_not_available")
  })
})

describe("inert without a model restriction — Nodaro builds exactly as before", () => {
  const inertCases: Array<[string, () => void]> = [
    ["no profile", () => setProfile(null)],
    ["a nodes-only profile", () => setProfile({ nodes: { deny: ["web-scrape"] } })],
    ["only the admin's switch on the default's row", () => __resetModelSwitchForTests([defaultImageModel("edit"), defaultImageModel("general")])],
    ["a stored models override that ticks every model", () => __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })],
  ]
  for (const [name, configure] of inertCases) {
    it(`${name}: no restriction is configured, and every default builds`, () => {
      configure()
      expect(modelRestrictionConfigured()).toBe(false)
      for (const c of CASES) expect(refusalOf(() => build(c.node(), c.inputs)), c.name).toBeUndefined()
    })
  }

  it("the build is the same object shape with and without a restriction that holds its model", () => {
    const before = build(node("image-to-image"), WIRED)
    allow(defaultImageModel("edit"))
    const after = build(node("image-to-image"), WIRED)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    expect({ ...after.payload, jobId: undefined }).toEqual({ ...before.payload, jobId: undefined })
  })
})
