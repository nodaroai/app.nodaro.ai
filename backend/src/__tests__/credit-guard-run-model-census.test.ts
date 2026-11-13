// @test-watches backend/src/routes/pro-3d-render.ts backend/src/routes/3d-scene.ts
/**
 * TOTALITY: every credit guard decides how a deployment's model restriction
 * judges the model its request RUNS on.
 *
 * The guard's own deny reads the raw `provider` when it is the model the
 * route's node runs (an engine name is not: lib/provider-model.ts), and
 * generate-image's `models`. A request that names no model runs on a default
 * its route fills in AFTER the guard; a route priced on a composite or a
 * feature id (`gpt-image-2-6-sunburst:medium:1K`, `llm-chat`) never shows the
 * guard the model; and a route whose model field is not `provider` (`llmModel`, Suno's
 * `model`) is invisible to it. Each of those ran a model a deployment withheld
 * with `models.allow` / `models.deny`, at the deployment's expense. So every
 * guard either declares the model its request runs on (`runModel`, or the
 * older `denyResolvedModel`), or this file says why it need not.
 *
 * This boots the whole app (Cloud edition), records every `creditGuard()`
 * call — the guards routes attach and the ones run inside a wrapper — and:
 *  - holds each to a declaration or an exemption with a reason;
 *  - trips when an exempted guard prices something that looks like a model
 *    run by default (a catalog id, a job the resolved-model registry knows,
 *    an LLM feature with a default), unless its reason is one that allows it;
 *  - runs every declared run model over malformed bodies (it must not throw:
 *    it reads the raw body, before validation) and checks it answers in the
 *    deny's vocabulary.
 *
 * The Cloud plugin's routes are declared plugin-side: the toolkit hands the
 * plugin this same `creditGuard`, and its `runModel` option.
 */
import { describe, it, expect, expectTypeOf, vi, beforeAll, afterAll } from "vitest"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const h = vi.hoisted(() => {
  const routes: Array<{ method: string; url: string; preHandlers: unknown[] }> = []
  const created: Array<{ guard: unknown; site: string }> = []
  /** Every Zod object schema the app built at boot, with the backend file that built it. */
  const schemas: Array<{ schema: unknown; file: string }> = []
  function chain(): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null })
        return () => proxy
      },
    })
    return proxy
  }
  /** The backend source file that called `creditGuard()`, relative to backend/src. */
  function callerFile(stack: string | undefined): string {
    for (const line of (stack ?? "").split("\n").slice(1)) {
      const m = /backend\/src\/([^:)]+\.ts):\d+:\d+/.exec(line)
      if (m && !m[1]!.startsWith("middleware/credit-guard") && !m[1]!.includes("__tests__/")) return m[1]!
    }
    return "?"
  }
  return {
    routes,
    created,
    schemas,
    callerFile,
    supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
// Pass-through: the REAL guard, recorded with the file that created it.
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middleware/credit-guard.js")>()
  return {
    ...actual,
    creditGuard: (...args: Parameters<typeof actual.creditGuard>) => {
      const guard = actual.creditGuard(...args)
      h.created.push({ guard, site: h.callerFile(new Error().stack) })
      return guard
    },
  }
})
// Pass-through: the REAL object schemas, each recorded with the file that built
// it, so a route's own schema says which values its model fields accept.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zod")>()
  const record = <F extends (...args: never[]) => unknown>(make: F): F =>
    ((...args: Parameters<F>) => {
      const schema = make(...args)
      h.schemas.push({ schema, file: h.callerFile(new Error().stack) })
      return schema
    }) as F
  const z = { ...actual.z, object: record(actual.z.object), strictObject: record(actual.z.strictObject), looseObject: record(actual.z.looseObject) }
  return { ...actual, z }
})
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>()
  const make = ((...args: unknown[]) => {
    const app = (actual.default as unknown as (...a: unknown[]) => FastifyInstance)(...args)
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method]
      const preHandlers: unknown[] = r.preHandler ? (Array.isArray(r.preHandler) ? r.preHandler : [r.preHandler]) : []
      for (const method of methods) if (method !== "HEAD") h.routes.push({ method, url: r.url, preHandlers })
    })
    return app
  }) as unknown as typeof actual.default
  return { ...actual, default: make }
})

import { creditGuardModelOf, isCreditGuard, type CreditGuardModel, type CreditGuardOpts } from "../middleware/credit-guard.js"
import type { PluginCreditGuardOpts } from "../lib/private-plugins/types.js"
import { GATEABLE_MODEL_IDS } from "../lib/availability-override.js"
import { ownLabelModelIds } from "../lib/house-models-served.js"
import { RESOLVED_MODEL_OF_JOB, resolvedModelOfJob } from "../lib/job-resolved-model.js"
import { llmFeatureDefault } from "../lib/run-model.js"
import { PLUGIN_CREDIT_GUARDED_ROUTES, routeNodeGate } from "../lib/route-node-gate.js"
import { providerIsItsModel } from "../lib/provider-model.js"
import { KIE_IMAGE_MODELS } from "../providers/kie/models.js"
import { REPLICATE_IMAGE_MODEL_IDS } from "../providers/replicate/image.js"

// ── The reasons a guard may leave its run model undeclared ───────────────────

/** Runs no model at all: local media work, storage, publishing, a scrape, a service. */
const NO_MODEL = "runs no AI model: local media work, storage, publishing, a scrape or a non-AI service"
/** Runs one model with no entry in the catalog: no restriction can name it, so its node is the lever. */
const OUTSIDE_CATALOG = "runs a model the model catalog does not list, so no model restriction can name it — its node is the lever"
/** A use-case run: its graph's steps name their models, and each is judged at dispatch. */
const USE_CASE = "a use-case run: each step's node names its model, and the orchestrator judges it at dispatch"
/** The schema requires the model: the raw `provider` check judges every request that runs. */
const MODEL_REQUIRED = "the schema requires the model, so the raw `provider` check judges every request that runs"
/** A preHandler writes the resolved default into `provider` first: the raw check judges it. */
const RESOLVED_INTO_PROVIDER = "a preHandler writes the resolved default into `provider` before the guard, so the raw check judges it"
/** A pipeline's own step: the jobs a pipeline queues are judged by its own model check. */
const PIPELINE = "a pipeline: every job it queues passes the pipeline's own model check (`assertModelAdmitted`); the model its authoring step runs follows the account's tier, not the request"

/** The reasons that may still price something that looks like a model (the tripwire allows them). */
const SIGNAL_ALLOWED = new Set([MODEL_REQUIRED, RESOLVED_INTO_PROVIDER])

/** Attached guards, by `METHOD url`, that declare no run model — and why. */
const RUN_MODEL_EXEMPT: Readonly<Record<string, string>> = {
  // The schema requires the model; a preHandler resolves it into `provider`.
  "POST /v1/reference-board": MODEL_REQUIRED,
  "POST /v1/video-depth": RESOLVED_INTO_PROVIDER,
  // Use cases: a graph of nodes, each judged at dispatch.
  "POST /v1/tighten-episode": USE_CASE,
  "POST /v1/tighten-episode/continue": USE_CASE,
  "POST /v1/episode-chapters": USE_CASE,
  "POST /v1/episode-chapters/continue": USE_CASE,
  "POST /v1/episode-trailer": USE_CASE,
  "POST /v1/episode-trailer/continue": USE_CASE,
  "POST /v1/clip-pack": USE_CASE,
  "POST /v1/clip-pack/continue": USE_CASE,
  "POST /v1/speaker-layout": USE_CASE,
  "POST /v1/speaker-layout/continue": USE_CASE,
  // Pipelines (no node).
  "POST /v1/video-director/run": PIPELINE,
  "POST /v1/pipelines/:id/stages/script/regenerate-scene": PIPELINE,
  // One model the catalog does not list.
  "POST /v1/video-sfx": OUTSIDE_CATALOG,
  "POST /v1/generate-music": OUTSIDE_CATALOG,
  "POST /v1/face-swap": OUTSIDE_CATALOG,
  "POST /v1/generate-mask": OUTSIDE_CATALOG,
  "POST /v1/video-mask": OUTSIDE_CATALOG,
  // KIE's seedream-5-5-layer-decomposition, which has no catalog entry.
  "POST /v1/split-into-layers": OUTSIDE_CATALOG,
  "POST /v1/audio-separation": OUTSIDE_CATALOG,
  "POST /v1/voice-remix": OUTSIDE_CATALOG,
  "POST /v1/speech-to-video": OUTSIDE_CATALOG,
  "POST /v1/ai-avatar": OUTSIDE_CATALOG,
  "POST /v1/cinematic-avatar": OUTSIDE_CATALOG,
  "POST /v1/switchx": OUTSIDE_CATALOG,
  "POST /v1/characters/:id/train": OUTSIDE_CATALOG,
  "POST /v1/suno/lyrics": OUTSIDE_CATALOG,
  "POST /v1/suno/separate": OUTSIDE_CATALOG,
  "POST /v1/suno/music-video": OUTSIDE_CATALOG,
  "POST /v1/suno/replace-section": OUTSIDE_CATALOG,
  "POST /v1/suno/style-boost": OUTSIDE_CATALOG,
  "POST /v1/suno/convert-wav": OUTSIDE_CATALOG,
  "POST /v1/suno/voice/generate": OUTSIDE_CATALOG,
  // No AI model at all.
  "POST /v1/combine-videos": NO_MODEL,
  "POST /v1/apply-edl": NO_MODEL,
  "POST /v1/image-collage": NO_MODEL,
  "POST /v1/image-overlay": NO_MODEL,
  "POST /v1/assemble-narrated-video": NO_MODEL,
  "POST /v1/reference-sheet": NO_MODEL,
  "POST /v1/merge-video-audio": NO_MODEL,
  "POST /v1/trim-audio": NO_MODEL,
  "POST /v1/trim-video": NO_MODEL,
  "POST /v1/extract-frame": NO_MODEL,
  "POST /v1/resize-video": NO_MODEL,
  "POST /v1/adjust-volume": NO_MODEL,
  "POST /v1/audio-fx": NO_MODEL,
  "POST /v1/pitch-tempo": NO_MODEL,
  "POST /v1/speed-ramp": NO_MODEL,
  "POST /v1/loop-video": NO_MODEL,
  "POST /v1/fade-video": NO_MODEL,
  "POST /v1/video-overlay": NO_MODEL,
  "POST /v1/still-to-video": NO_MODEL,
  "POST /v1/slideshow": NO_MODEL,
  "POST /v1/transcode-video": NO_MODEL,
  "POST /v1/mix-audio": NO_MODEL,
  "POST /v1/combine-audio": NO_MODEL,
  "POST /v1/split-media": NO_MODEL,
  "POST /v1/extract-audio": NO_MODEL,
  "POST /v1/silence-detect": NO_MODEL,
  "POST /v1/audio-sync": NO_MODEL,
  "POST /v1/gif-to-video": NO_MODEL,
  "POST /v1/remove-audio": NO_MODEL,
  "POST /v1/shot-cuts": NO_MODEL,
  "POST /v1/speaker-map": NO_MODEL,
  "POST /v1/mask-composite": NO_MODEL,
  "POST /v1/mask-erase": NO_MODEL,
  "POST /v1/mask-outline": NO_MODEL,
  "POST /v1/video-face-mesh": NO_MODEL,
  "POST /v1/render-video": NO_MODEL,
  "POST /v1/render-video/scene-graph": NO_MODEL,
  "POST /v1/render-video/plan": NO_MODEL,
  "POST /v1/collection-write": NO_MODEL,
  "POST /v1/collection-read": NO_MODEL,
  "POST /v1/inspiration-read": NO_MODEL,
  "POST /v1/competitor-read": NO_MODEL,
  "POST /v1/web-scrape": NO_MODEL,
  "POST /v1/site-capture": NO_MODEL,
  "POST /v1/social-media-format": NO_MODEL,
  "POST /v1/social/publish": NO_MODEL,
  "POST /v1/telegram-channel/fetch": NO_MODEL,
  "POST /v1/save-to-storage": NO_MODEL,
}

/** Guards run inside a wrapper or a handler (no route attaches them), by creating file — and why. */
const INLINE_RUN_MODEL_EXEMPT: Readonly<Record<string, string>> = {
  // Extend Video: one of two guards by `provider`, which its schema requires.
  "routes/extend-video.ts": MODEL_REQUIRED,
}

// ── Probing ──────────────────────────────────────────────────────────────────

/** Bodies that make a resolver show a model it can default to. */
const PROBE_BODIES: ReadonlyArray<Record<string, unknown>> = [
  {},
  { aspectRatio: "4:5" },
  { aspectRatio: "9:8" },
  { strategyId: "pick-best-llm" },
  { engine: "lottie" },
  { analyze: true },
]

/** Bodies a raw-body reader must survive: every field a run model reads, of the wrong type. */
const MALFORMED_BODIES: readonly unknown[] = [
  undefined,
  null,
  [],
  42,
  "x",
  {
    provider: 42,
    model: [],
    models: "x",
    llmModel: {},
    analysisModel: 7,
    aspectRatio: 7,
    engine: 5,
    tier: {},
    targetLanguage: 3,
    strategyId: 1,
    strategyConfig: "x",
    analyze: "yes",
    operations: "x",
    _internalLora: null,
  },
  { provider: "not-a-model", llmModel: "not-a-model", model: "not-a-version" },
]

function fakeRequest(url: string, body: unknown): FastifyRequest {
  const log = { warn() {}, info() {}, error() {}, debug() {} }
  return { body, url, routeOptions: { url }, headers: {}, params: {}, query: {}, userId: "00000000-0000-4000-8000-000000000001", log } as unknown as FastifyRequest
}

function ids(value: unknown): unknown[] {
  return typeof value === "string" ? [value] : Array.isArray(value) ? value : value === undefined ? [] : [value]
}

/** Why `resolver`'s pricing looks like a model run by default — empty when it does not. */
function modelSignals(resolver: (req: FastifyRequest) => string, url: string): string[] {
  const found = new Set<string>()
  for (const body of PROBE_BODIES) {
    let priced: unknown
    try {
      priced = resolver(fakeRequest(url, { ...body }))
    } catch {
      continue
    }
    if (typeof priced !== "string" || priced === "") continue
    const parts = priced.split(":")
    for (let n = parts.length; n >= 1; n--) {
      const id = parts.slice(0, n).join(":")
      if (GATEABLE_MODEL_IDS.has(id)) found.add(`prices the model ${id}`)
      const job = Object.hasOwn(RESOLVED_MODEL_OF_JOB, id) ? resolvedModelOfJob(id, body) : undefined
      if (job && GATEABLE_MODEL_IDS.has(job)) found.add(`prices the job ${id}, which runs ${job}`)
      const llm = llmFeatureDefault(id)
      if (llm) found.add(`prices the LLM feature ${id}, which defaults to ${llm}`)
    }
  }
  return [...found]
}

const declares = (m: CreditGuardModel): boolean => m.denyResolvedModel || typeof m.runModel === "function"

// ── Boot ─────────────────────────────────────────────────────────────────────

let app: FastifyInstance

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
}, 120_000)

afterAll(async () => {
  await app?.close()
})

/** Every attached guard, with its route. */
function attached(): Array<{ key: string; url: string; model: CreditGuardModel }> {
  const out: Array<{ key: string; url: string; model: CreditGuardModel }> = []
  for (const r of h.routes) {
    for (const fn of r.preHandlers) {
      const model = creditGuardModelOf(fn)
      if (model) out.push({ key: `${r.method} ${r.url}`, url: r.url, model })
    }
  }
  return out
}

/** Every guard created but attached to no route (run inside a wrapper or a handler), with its file. */
function inline(): Array<{ site: string; model: CreditGuardModel }> {
  const onRoutes = new Set(h.routes.flatMap((r) => r.preHandlers))
  return h.created
    .filter((c) => !onRoutes.has(c.guard))
    .map((c) => ({ site: c.site, model: creditGuardModelOf(c.guard)! }))
}

describe("every credit guard declares the model its request runs on, or says why not", () => {
  it("found the guards (the boot, the marks and the recorder work)", () => {
    const guards = attached()
    expect(guards.length).toBeGreaterThan(100)
    expect(h.created.every((c) => isCreditGuard(c.guard))).toBe(true)
    expect(guards.map((g) => g.key)).toEqual(expect.arrayContaining(["POST /v1/generate-image", "POST /v1/image-to-image"]))
    expect(inline().length).toBeGreaterThan(0)
  })

  it("every attached guard declares its run model or carries a reason", () => {
    const unclassified = attached()
      .filter((g) => !declares(g.model) && !Object.hasOwn(RUN_MODEL_EXEMPT, g.key))
      .map((g) => `${g.key} — ${modelSignals(g.model.modelResolver, g.url).join("; ") || "no model signal"}`)
    expect(unclassified).toEqual([])
  })

  it("every inline guard declares its run model or its file carries a reason", () => {
    const unclassified = inline()
      .filter((g) => !declares(g.model) && !Object.hasOwn(INLINE_RUN_MODEL_EXEMPT, g.site))
      .map((g) => g.site)
    expect(unclassified).toEqual([])
  })

  it("no exemption is stale: each names a guard that exists and declares nothing", () => {
    const byKey = new Map(attached().map((g) => [g.key, g.model]))
    const stale = Object.keys(RUN_MODEL_EXEMPT).filter((key) => {
      const model = byKey.get(key)
      return !model || declares(model)
    })
    expect(stale).toEqual([])
    const inlineSites = new Map(inline().map((g) => [g.site, g.model]))
    const staleInline = Object.keys(INLINE_RUN_MODEL_EXEMPT).filter((site) => {
      const model = inlineSites.get(site)
      return !model || declares(model)
    })
    expect(staleInline).toEqual([])
  })

  it("tripwire: an exempted guard shows no sign of running a model by default, unless its reason allows it", () => {
    const tripped = attached()
      .filter((g) => Object.hasOwn(RUN_MODEL_EXEMPT, g.key) && !SIGNAL_ALLOWED.has(RUN_MODEL_EXEMPT[g.key]!))
      .map((g) => ({ key: g.key, signals: modelSignals(g.model.modelResolver, g.url) }))
      .filter((g) => g.signals.length > 0)
      .map((g) => `${g.key}: ${g.signals.join("; ")} — declare runModel, or give a reason that allows it`)
    const trippedInline = inline()
      .filter((g) => Object.hasOwn(INLINE_RUN_MODEL_EXEMPT, g.site) && !SIGNAL_ALLOWED.has(INLINE_RUN_MODEL_EXEMPT[g.site]!))
      .map((g) => ({ site: g.site, signals: modelSignals(g.model.modelResolver, "") }))
      .filter((g) => g.signals.length > 0)
      .map((g) => `${g.site}: ${g.signals.join("; ")}`)
    expect([...tripped, ...trippedInline]).toEqual([])
  })
})

describe("every declared run model is total and speaks the deny's vocabulary", () => {
  const declared = () => [
    ...attached().map((g) => ({ name: g.key, url: g.url, model: g.model })),
    ...inline().map((g) => ({ name: g.site, url: "", model: g.model })),
  ].filter((g) => typeof g.model.runModel === "function")

  it("never throws on a malformed body, and answers a string, a list of strings or nothing", () => {
    const broken: string[] = []
    for (const g of declared()) {
      for (const body of MALFORMED_BODIES) {
        try {
          const answer = g.model.runModel!(fakeRequest(g.url, body))
          if (!ids(answer).every((id) => typeof id === "string")) broken.push(`${g.name}: answered ${JSON.stringify(answer)} for ${JSON.stringify(body)}`)
        } catch (err) {
          broken.push(`${g.name}: threw "${err instanceof Error ? err.message : String(err)}" for ${JSON.stringify(body)}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it("for a request that names no model, answers ids a restriction can name — catalog or LLM ids, never a pricing id", () => {
    const outside: string[] = []
    for (const g of declared()) {
      for (const body of PROBE_BODIES) {
        for (const id of ids(g.model.runModel!(fakeRequest(g.url, { ...body })))) {
          if (typeof id !== "string" || !GATEABLE_MODEL_IDS.has(id)) outside.push(`${g.name}: ${JSON.stringify(id)} for ${JSON.stringify(body)}`)
        }
      }
    }
    expect(outside).toEqual([])
  })
})

/**
 * A house model is reached ONLY by naming it. On an install that does not
 * serve one, the guard judges nothing but the house model, and asks a route's
 * `runModel` only when the body names one (`namesHouseModel`,
 * withheldRunModels) — sound only while no request that names no house model
 * runs on one. Held here over every guard this boot records: its run model
 * (`runModel`) and its pricing (`modelResolver`), for bodies that name every
 * OTHER model in every field a model is named in — so a default, an engine
 * name's alias (lib/provider-model.ts), an image-to-image swap with
 * references attached, a fixed run model or a text-length choice that landed
 * on a house model would trip it.
 */
describe("a house model is reached only by naming it", () => {
  const own = ownLabelModelIds()
  const REF = "https://cdn.example/ref.png"
  const others = [...GATEABLE_MODEL_IDS].filter((id) => !own.has(id))
  const BODIES: ReadonlyArray<Record<string, unknown>> = [
    ...PROBE_BODIES,
    { text: "x".repeat(6_000) },
    { imageUrl: REF, referenceImageUrls: [REF] },
    ...others.flatMap((id) => [
      { provider: id },
      { provider: id, imageUrl: REF, referenceImageUrls: [REF] },
      { model: id },
      { models: [id] },
      { llmModel: id },
      { analysisModel: id },
      { engine: id },
    ]),
  ]
  const guards = () => [
    ...attached().map((g) => ({ name: g.key, url: g.url, model: g.model })),
    ...inline().map((g) => ({ name: g.site, url: "", model: g.model })),
  ]
  const isOwn = (id: unknown) => typeof id === "string" && (own.has(id) || own.has(id.split(":")[0]!))

  it("the catalog has a house model to hold this for", () => {
    expect(own.size).toBeGreaterThan(0)
    expect(others.length).toBeGreaterThan(100)
  })

  it("no run model answers a house model for a body that names none", () => {
    const reached: string[] = []
    for (const g of guards()) {
      if (typeof g.model.runModel !== "function") continue
      for (const body of BODIES) {
        let answer: unknown
        try {
          answer = g.model.runModel(fakeRequest(g.url, { ...body }))
        } catch {
          continue
        }
        for (const id of ids(answer)) if (isOwn(id)) reached.push(`${g.name}: ${String(id)} for ${JSON.stringify(body)}`)
      }
    }
    expect(reached).toEqual([])
  })

  it("no guard prices a house model for a body that names none", () => {
    const priced: string[] = []
    for (const g of guards()) {
      for (const body of BODIES) {
        let id: unknown
        try {
          id = g.model.modelResolver(fakeRequest(g.url, { ...body }))
        } catch {
          continue
        }
        if (isOwn(id)) priced.push(`${g.name}: ${String(id)} for ${JSON.stringify(body)}`)
      }
    }
    expect(priced).toEqual([])
  })
})

// ── Every option a route accepts names a model a restriction can name ────────

/**
 * TOTALITY for "a route that runs catalog models runs no model a restriction
 * cannot name" (decided 2026-11-12). An allow list withholds only the ids the
 * model catalog (and the LLM list) knows, so a route that runs catalog models
 * AND accepts an option with no catalog entry runs that model wherever the
 * allow list leaves it out — and its node is no lever, since withholding it
 * withholds every other model with it (FLUX Fill Pro on /v1/image-to-image,
 * until it had an entry). A route whose EVERY model is outside the catalog is
 * the existing rule: its node is the lever (OUTSIDE_CATALOG above).
 *
 * The options come from each route's own Zod schema, read at boot: every value
 * of every enum or literal field of the object schemas built in the guard's
 * file (and its same-stem siblings, `generate-image-body.ts`), each sent alone
 * through what the guard's door judges — the raw `provider` where it is the
 * node's model, `models`, the resolved id (`denyResolvedModel`) and `runModel`.
 * A field that takes any string is probed with a value no list holds: one the
 * judge sees verbatim is an OPEN field, listed below with what can run there.
 */
const PROBE = "zz-not-a-model"

/** A schema field's accepted values: a finite set, or any string. */
interface Accepts {
  readonly values: ReadonlySet<string>
  readonly anyString: boolean
  readonly inArray: boolean
}

type ZodDef = { type?: string; innerType?: unknown; in?: unknown; entries?: Record<string, unknown>; values?: readonly unknown[]; options?: readonly unknown[]; element?: unknown; shape?: unknown }
const defOf = (schema: unknown): ZodDef | undefined => (schema as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def

function accepts(schema: unknown, depth = 0, inArray = false): Accepts {
  const none = { values: new Set<string>(), anyString: false, inArray }
  const def = defOf(schema)
  if (!def || depth > 8) return none
  switch (def.type) {
    case "optional": case "default": case "nullable": case "catch": case "prefault": case "readonly": case "nonoptional":
      return accepts(def.innerType, depth + 1, inArray)
    case "pipe":
      return accepts(def.in, depth + 1, inArray)
    case "enum":
      return { values: new Set(Object.values(def.entries ?? {}).filter((v): v is string => typeof v === "string")), anyString: false, inArray }
    case "literal":
      return { values: new Set((def.values ?? []).filter((v): v is string => typeof v === "string")), anyString: false, inArray }
    case "string":
      return { values: new Set(), anyString: true, inArray }
    case "array":
      return accepts(def.element, depth + 1, true)
    case "union": {
      const parts = (def.options ?? []).map((o) => accepts(o, depth + 1, inArray))
      return { values: new Set(parts.flatMap((p) => [...p.values])), anyString: parts.some((p) => p.anyString), inArray: inArray || parts.some((p) => p.inArray) }
    }
    default:
      return none
  }
}

/** The top-level fields of the object schemas built in `files`, merged by name. */
function schemaFieldsOf(files: ReadonlySet<string>): Map<string, Accepts> {
  const out = new Map<string, Accepts>()
  for (const { schema, file } of h.schemas) {
    if (!files.has(file)) continue
    const shape = (schema as { shape?: Record<string, unknown> }).shape
    if (!shape || typeof shape !== "object") continue
    for (const [field, fieldSchema] of Object.entries(shape)) {
      const a = accepts(fieldSchema)
      const prev = out.get(field)
      out.set(field, prev
        ? { values: new Set([...prev.values, ...a.values]), anyString: prev.anyString || a.anyString, inArray: prev.inArray || a.inArray }
        : a)
    }
  }
  return out
}

/** The guard's file and its same-stem siblings (`routes/generate-image.ts` → `routes/generate-image-body.ts`). */
function schemaFilesOf(site: string): Set<string> {
  const stem = site.replace(/\.ts$/, "")
  return new Set([site, ...h.schemas.map((s) => s.file).filter((f) => f.startsWith(`${stem}-`) || f.startsWith(`${stem}.`))])
}

/** What the guard's door judges for this body on a deployment that restricts models (middleware/credit-guard.ts). */
function judgedIds(model: CreditGuardModel, url: string, body: Record<string, unknown>): string[] {
  const out = new Set<string>()
  const req = fakeRequest(url, body)
  const gate = routeNodeGate(url, body)
  const raw = typeof body.provider === "string" ? body.provider : undefined
  if (raw && providerIsItsModel(gate.kind === "node" ? gate.types : [], raw, body)) out.add(raw)
  if (Array.isArray(body.models)) for (const m of body.models) if (typeof m === "string") out.add(m)
  if (model.denyResolvedModel) {
    const resolved = model.modelResolver(req)
    if (typeof resolved === "string" && resolved && resolved !== raw) out.add(resolved)
  }
  if (typeof model.runModel === "function") for (const id of ids(model.runModel(req))) if (typeof id === "string" && id) out.add(id)
  return [...out]
}

interface OptionCensus {
  readonly name: string
  /** Catalog / LLM ids some accepted option runs. */
  readonly gateable: ReadonlySet<string>
  /** Ids an accepted option runs that no restriction can name, with the option. */
  readonly outside: ReadonlyMap<string, string>
  /** Fields that take any string and whose value the judge sees verbatim. */
  readonly open: readonly string[]
  /** How many schema fields and values were probed. */
  readonly probed: number
}

function optionCensusOf(name: string, url: string, site: string, model: CreditGuardModel): OptionCensus {
  const gateable = new Set<string>()
  const outside = new Map<string, string>()
  const open: string[] = []
  const note = (ids: readonly string[], option: string) => {
    for (const id of ids) {
      if (GATEABLE_MODEL_IDS.has(id)) gateable.add(id)
      else if (!outside.has(id)) outside.set(id, option)
    }
  }
  const judge = (body: Record<string, unknown>): string[] => {
    try {
      return judgedIds(model, url, body)
    } catch {
      return []
    }
  }
  note(judge({}), "(no option)")
  let probed = 0
  for (const [field, a] of schemaFieldsOf(schemaFilesOf(site))) {
    for (const value of a.values) {
      probed += 1
      note(judge({ [field]: a.inArray ? [value] : value }), `${field}=${value}`)
    }
    if (a.anyString) {
      const seen = judge({ [field]: a.inArray ? [PROBE] : PROBE })
      if (seen.includes(PROBE)) open.push(field)
      note(seen.filter((id) => id !== PROBE), `${field}=(any)`)
    }
  }
  return { name, gateable, outside, open, probed }
}

/**
 * Routes that run catalog models AND accept options with no catalog entry, each
 * with what deciding it needs. Only shrinks: an entry here is a model a
 * deployment's allow list cannot withhold on a route it cannot withhold either.
 */
const LIP_SYNC_AWAITING = "Wav2Lip, VideoReTalking and SadTalker run beside its catalog models and have no catalog entry. They are being retired from Lip Sync (decided 2026-11-12), which removes them from the route"
const MIXED_AWAITING_DECISION: Readonly<Record<string, string>> = {
  "POST /v1/lip-sync": LIP_SYNC_AWAITING,
}

/**
 * The image ids the image router can run that the catalog does not list. A
 * route whose `provider` takes any string runs only what the router serves, so
 * this is what such a route could run unjudged.
 */
const SERVED_IMAGE_IDS_OUTSIDE_CATALOG = [...new Set([...Object.keys(KIE_IMAGE_MODELS), ...REPLICATE_IMAGE_MODEL_IDS])]
  .filter((id) => !GATEABLE_MODEL_IDS.has(id))
  .sort()

/** An image route whose `provider` takes any string: what can run there is what the image router serves. */
const OPEN_IMAGE_PROVIDER =
  "`provider` takes any string, and what runs is what the image router serves: catalog ids only (the trained-character model `flux-lora-character` among them, a hidden entry)"

/** A structured-LLM route whose wrapper schema takes any `llmModel` string. */
const OPEN_STRUCTURED_LLM =
  "the wrapper takes any string, and the request is then validated against the LLM list (lib/llm-structured-request.ts): an unknown id is refused 400 before any job, and every LLM id is one a restriction names"

/** Routes with a model field that takes any string the judge sees verbatim, by field — and why that is safe. */
const OPEN_MODEL_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "POST /v1/llm/structured": { llmModel: OPEN_STRUCTURED_LLM },
  "POST /v1/llm/structured/jobs": { llmModel: OPEN_STRUCTURED_LLM },
  "POST /v1/prompt-helper/wizard": {
    provider:
      "names the model the prompt is written for, not one the request runs (that is its LLM, judged through `runModel`); the door judges it as a model, so a withheld one is refused, and any other string runs nothing",
  },
  "POST /v1/generate-character": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-character-asset": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-face": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-object": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-object-asset": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-creature": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-creature-asset": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-location": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-location-asset": { provider: OPEN_IMAGE_PROVIDER },
  "POST /v1/generate-surround-continuation": { provider: OPEN_IMAGE_PROVIDER },
}

describe("every option a credit-guarded route accepts runs a model a restriction can name, or its node is the lever", () => {
  const censuses = (): OptionCensus[] => [
    ...attached().map((g) => optionCensusOf(g.key, g.url, siteOf(g.key), g.model)),
    ...inline().map((g) => optionCensusOf(`INLINE ${g.site}`, "", g.site, g.model)),
  ]
  let all: OptionCensus[] = []
  const byName = (name: string) => all.find((c) => c.name === name)

  beforeAll(() => {
    all = censuses()
  })

  it("read the routes' schemas, and sees the case it guards: FLUX Fill Pro on /v1/image-to-image is a model a restriction names", () => {
    expect(h.schemas.length).toBeGreaterThan(300)
    expect(all.reduce((n, c) => n + c.probed, 0)).toBeGreaterThan(1_000)
    const i2i = byName("POST /v1/image-to-image")!
    expect(i2i.gateable).toContain("flux-fill")
    expect(i2i.outside.size).toBe(0)
    // Wan Animate on /v1/motion-transfer, beside the Kling motion models (decided 2026-11-12).
    const motion = byName("POST /v1/motion-transfer")!
    expect([...motion.gateable]).toEqual(expect.arrayContaining(["wan-animate-move", "wan-animate-replace", "motion-transfer", "kling-3.0-motion"]))
    expect(motion.outside.size).toBe(0)
    // The trained-character model on /v1/generate-image (decided 2026-11-12).
    const image = byName("POST /v1/generate-image")!
    expect([...image.gateable]).toContain("flux-lora-character")
    expect(image.outside.size).toBe(0)
    // LatentSync, HeyGen Lipsync Precision and Lipsync 2 Pro on /v1/lip-sync (decided 2026-11-12).
    const lipSync = byName("POST /v1/lip-sync")!
    expect([...lipSync.gateable]).toEqual(expect.arrayContaining(["latentsync", "heygen-lipsync-precision", "lipsync-2-pro", "kling-avatar"]))
    // A mixed route is visible to it: the Lip Sync options being retired.
    expect([...lipSync.outside.keys()].sort()).toEqual(["sadtalker", "video-retalking", "wav2lip"])
    // Suno V4_5PLUS, V4_5ALL and V4_5 on every Suno route that runs a version (decided 2026-11-12).
    for (const op of ["generate", "cover", "extend", "mashup", "upload-extend"]) {
      const suno = byName(`POST /v1/suno/${op}`)!
      expect([...suno.gateable], op).toEqual(expect.arrayContaining(["suno-v4_5plus", "suno-v4_5all", "suno-v4_5", "suno-v6", "suno"]))
      expect(suno.outside.size, op).toBe(0)
    }
    for (const op of ["add-instrumental", "add-vocals"]) {
      const suno = byName(`POST /v1/suno/${op}`)!
      expect([...suno.gateable], op).toEqual(expect.arrayContaining(["suno-v4_5plus", "suno-v6"]))
      expect(suno.outside.size, op).toBe(0)
    }
  })

  it("no route runs both a catalog model and one no restriction can name, unless it awaits a decision listed above", () => {
    const mixed = all
      .filter((c) => c.gateable.size > 0 && c.outside.size > 0 && !Object.hasOwn(MIXED_AWAITING_DECISION, c.name))
      .map((c) => `${c.name}: ${[...c.outside].map(([id, option]) => `${id} (${option})`).join(", ")} — give each a catalog entry`)
    expect(mixed).toEqual([])
  })

  it("a route whose every model is outside the catalog is exempt as OUTSIDE_CATALOG (its node is the lever)", () => {
    const unlisted = all
      .filter((c) => c.gateable.size === 0 && c.outside.size > 0 && RUN_MODEL_EXEMPT[c.name] !== OUTSIDE_CATALOG)
      .map((c) => `${c.name}: ${[...c.outside.keys()].join(", ")}`)
    expect(unlisted).toEqual([])
  })

  it("an OUTSIDE_CATALOG route runs no catalog model for any option it accepts", () => {
    const named = all.filter((c) => RUN_MODEL_EXEMPT[c.name] === OUTSIDE_CATALOG && c.gateable.size > 0).map((c) => `${c.name}: ${[...c.gateable].join(", ")}`)
    expect(named).toEqual([])
  })

  it("every open model field is listed with its reason, and the image router serves nothing outside the catalog", () => {
    const unlisted = all.flatMap((c) => c.open.filter((f) => !Object.hasOwn(OPEN_MODEL_FIELDS[c.name] ?? {}, f)).map((f) => `${c.name}: ${f}`))
    expect(unlisted).toEqual([])
    expect(SERVED_IMAGE_IDS_OUTSIDE_CATALOG).toEqual([])
  })

  it("no listed entry is stale", () => {
    const staleMixed = Object.keys(MIXED_AWAITING_DECISION).filter((name) => {
      const c = byName(name)
      return !c || c.gateable.size === 0 || c.outside.size === 0
    })
    expect(staleMixed).toEqual([])
    const staleOpen = Object.entries(OPEN_MODEL_FIELDS).flatMap(([name, fields]) =>
      Object.keys(fields).filter((f) => !byName(name)?.open.includes(f)).map((f) => `${name}: ${f}`),
    )
    expect(staleOpen).toEqual([])
  })
})

/** The file that created an attached guard. */
function siteOf(key: string): string {
  const [method, url] = key.split(" ")
  const route = h.routes.find((r) => r.method === method && r.url === url)
  const guard = route?.preHandlers.find((fn) => creditGuardModelOf(fn))
  return h.created.find((c) => c.guard === guard)?.site ?? "?"
}

/**
 * The host's routes whose handler hands the request to a plugin engine that
 * runs the credit guard (3D Render Pro's run and preview admissions). They are
 * registered here, but that guard — and its `runModel` — is the plugin's, so
 * this file never judges it (the 3D scene routes' own Basic guard is judged
 * above, as an inline guard). Each names the engine dispatcher its route file
 * calls.
 */
const HANDED_TO_A_PLUGIN_ENGINE: Readonly<Record<string, { readonly file: string; readonly dispatch: string }>> = {
  "/v1/pro-3d-render": { file: "routes/pro-3d-render.ts", dispatch: "dispatchPro3DRender" },
  "/v1/3d-scene/generate": { file: "routes/3d-scene.ts", dispatch: "dispatchAdvancedScene3D" },
  "/v1/generate-3d-scene": { file: "routes/3d-scene.ts", dispatch: "dispatchAdvancedScene3D" },
  "/v1/3d-scene/edit": { file: "routes/3d-scene.ts", dispatch: "dispatchAdvancedScene3D" },
  "/v1/edit-3d-scene": { file: "routes/3d-scene.ts", dispatch: "dispatchAdvancedScene3D" },
}

describe("the Cloud plugin's routes declare it plugin-side", () => {
  const routeKey = (r: string) => r.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")

  it("the toolkit's guard options carry the same `runModel`", () => {
    expectTypeOf<NonNullable<PluginCreditGuardOpts["runModel"]>>().toEqualTypeOf<NonNullable<CreditGuardOpts["runModel"]>>()
  })

  it("a plugin-guarded route registered here is one whose handler hands the request to a plugin engine (so no plugin guard is judged by this file)", () => {
    const urls = new Set(h.routes.map((r) => routeKey(r.url)))
    expect(PLUGIN_CREDIT_GUARDED_ROUTES.filter((r) => urls.has(routeKey(r))).sort()).toEqual(Object.keys(HANDED_TO_A_PLUGIN_ENGINE).sort())
  })

  it("each of those is the plugin's, and its route file hands it to the engine", () => {
    for (const [route, { file, dispatch }] of Object.entries(HANDED_TO_A_PLUGIN_ENGINE)) {
      expect(PLUGIN_CREDIT_GUARDED_ROUTES, route).toContain(route)
      const src = readFileSync(join(__dirname, "..", file), "utf8")
      expect(src.includes(`${dispatch}(`), `${file} calls ${dispatch}`).toBe(true)
    }
  })
})
