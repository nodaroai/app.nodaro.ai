/**
 * THE MEDIA-INPUT FUNNEL — CENSUS (decided 2026-11-16; lib/input-links.ts).
 * Boots the whole app (Cloud edition) and holds the funnel to every route:
 *
 *  1. every route that takes a body is JUDGED by the one hook
 *     (`judgeRequestInputLinks`), in front of all of its own preHandlers — or
 *     its exemption is written down with why (`EXEMPT_ROUTES`), and every
 *     exemption names a registered route;
 *  2. every field ANY schema of the app declares as an address (a URL format,
 *     an address-named or media-named string) is judged by its name — or its
 *     name is declared (`ADDRESS_NAMES`: judged as an address; `NOT_MEDIA_NAMES`:
 *     looked at and not media), and every declared name is a field some
 *     schema declares. A schema built in `lib/` or as a shared module counts
 *     like a route's own: the hook reads the body by its names, wherever its
 *     schema was written;
 *  3. every value of a route's body schema that takes ANY shape (`z.unknown`,
 *     a record of anything) is accounted for: read by a reader the route
 *     declares (`ROUTE_READINGS`), or walked by name — its media fields named
 *     — with why that is enough (`SUBTREES` below). An entry that no longer
 *     matches a schema fails, so the list only shrinks.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import type { FastifyInstance } from "fastify"

const h = vi.hoisted(() => {
  const routes: Array<{ method: string; url: string; file: string; preHandlers: unknown[] }> = []
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
  /** The backend source file nearest the caller, relative to backend/src. */
  function callerFile(stack: string | undefined): string {
    for (const line of (stack ?? "").split("\n").slice(1)) {
      const m = /backend\/src\/([^:)]+\.ts):\d+:\d+/.exec(line)
      if (m && !m[1]!.includes("__tests__/")) return m[1]!
    }
    return "?"
  }
  return { routes, schemas, callerFile, supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } } }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
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
      const file = h.callerFile(new Error().stack)
      for (const method of methods) if (method !== "HEAD") h.routes.push({ method, url: r.url, file, preHandlers })
    })
    return app
  }) as unknown as typeof actual.default
  return { ...actual, default: make }
})

import { NODE_DATA_FIELDS } from "@nodaro/render-rules"
import { addressArguments, jsonInputSchema } from "../mcp/tool-addresses.js"
import { collectNodeInputMediaUrls } from "../media-portability.js"
import { PLUGIN_CREDIT_GUARDED_ROUTES } from "../route-node-gate.js"
import { fieldFormByName } from "../address-fields.js"
import { ADDRESS_NAMES, EXEMPT_ROUTES, NODE_DATA_NOT_INPUT, NODE_IO_NOT_CONTENT, NODE_TYPES_NOT_JUDGED, NOT_MEDIA_NAMES, ROUTE_READINGS, exemptionOf, isNodeResultField } from "../input-link-lanes.js"

const WALKED_BY_NAME = "walked by name: the media fields inside it are named (`…url`, `…image`), and the hook reads every one"
const NOT_CONTENT = "carries no media: settings, ids, words or numbers"
const EXEMPT_BODY = "the body of a route that is exempt (a stored graph, a listing, a configuration, an estimate): never judged"

/**
 * Values of a judged route's body that take any shape, by `file path`, and
 * why the name walk is what reads them. A value a reader reads instead is
 * declared on its route (`ROUTE_READINGS`).
 */
/** The podcast pack's per-tool settings: sent on to each tool's own route, which judges them as its own body. */
const PACK_TOOL_SETTINGS = "a podcast pack tool's settings: sent on, inside the tool's own body, to that tool's own judged route"

const SUBTREES: Readonly<Record<string, string>> = {
  "lib/use-case/pack-body.ts tools.tighten-episode": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts tools.episode-chapters": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts tools.episode-trailer": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts tools.clip-pack": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts tools.speaker-layout": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts cameras": NOT_CONTENT,
  // The same settings as the tools object's own entries (built over the pack's tool list).
  "lib/use-case/pack-body.ts tighten-episode": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts episode-chapters": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts episode-trailer": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts clip-pack": PACK_TOOL_SETTINGS,
  "lib/use-case/pack-body.ts speaker-layout": PACK_TOOL_SETTINGS,
  // Taken by routes that are exempt (EXEMPT_ROUTES), or by none from outside.
  "lib/nodaro-motion-style-only.ts enginePrompt": EXEMPT_BODY,
  "lib/nodaro-motion-engine-keys.ts nodaro-prism.enginePrompt": EXEMPT_BODY,
  "lib/nodaro-motion-engine-keys.ts nodaro-pulse.enginePrompt": EXEMPT_BODY,
  "lib/nodaro-motion-precise-art-style.ts styleRefs": EXEMPT_BODY,
  "lib/nodaro-motion-engine-keys.ts nodaro-prism.styleRefs": EXEMPT_BODY,
  "lib/nodaro-motion-engine-keys.ts nodaro-pulse.styleRefs": EXEMPT_BODY,
  "lib/plugin-account-secrets.ts metadata": "a plugin's own stored records, never a request body",
  "lib/plugin-daemons/client.ts body": "a request this server sends to its own daemon host, never one it receives",
  "lib/http-credentials.ts config": EXEMPT_BODY,
  "routes/projects.ts settings": EXEMPT_BODY,
  "routes/api-tokens.ts inputs.*": EXEMPT_BODY,
  "ee/routes/credits.ts edges[].data": EXEMPT_BODY,
  "ee/routes/credits.ts nodes[].data": EXEMPT_BODY,
  "routes/published-apps.ts allowedValues[]": EXEMPT_BODY,
  "routes/published-apps.ts defaultValue": EXEMPT_BODY,
  "routes/published-apps.ts exposedSettings[].allowedValues[]": EXEMPT_BODY,
  "routes/published-apps.ts exposedSettings[].defaultValue": EXEMPT_BODY,
  "routes/published-apps.ts componentMetadata.exposedSettings[].allowedValues[]": EXEMPT_BODY,
  "routes/published-apps.ts componentMetadata.exposedSettings[].defaultValue": EXEMPT_BODY,
  "lib/workflow-assets.ts edges[]": EXEMPT_BODY,
  "lib/workflow-assets.ts nodes[]": EXEMPT_BODY,
  "lib/workflow-assets.ts settings": EXEMPT_BODY,
  "routes/workflows.ts edges[]": EXEMPT_BODY,
  "routes/workflows.ts nodes[]": EXEMPT_BODY,
  "routes/workflows.ts settings": EXEMPT_BODY,
  "routes/workflows.ts set.settings": EXEMPT_BODY,
  "routes/workflows.ts upsertEdges[]": EXEMPT_BODY,
  "routes/workflows.ts upsertNodes[]": EXEMPT_BODY,
  "routes/workflows.ts delta.set.settings": EXEMPT_BODY,
  "routes/workflows.ts delta.upsertEdges[]": EXEMPT_BODY,
  "routes/workflows.ts delta.upsertNodes[]": EXEMPT_BODY,
  "routes/workflows.ts workflow_json.edges[]": EXEMPT_BODY,
  "routes/workflows.ts workflow_json.nodes[]": EXEMPT_BODY,
  "routes/workflows.ts workflow_json.settings": EXEMPT_BODY,
  // Taken by judged routes.
  "ee/lib/nodaro-motion-settings-sets.ts settings": NOT_CONTENT,
  "ee/lib/trends/schemas.ts slots": WALKED_BY_NAME,
  "ee/lib/trends/schemas.ts examples[].slots": WALKED_BY_NAME,
  "ee/lib/ugc-quote.ts args": WALKED_BY_NAME,
  "ee/lib/ugc-quote.ts clipSeconds": NOT_CONTENT,
  "ee/routes/node-quote.ts params": WALKED_BY_NAME,
  "ee/routes/trend-radar.ts data[]": WALKED_BY_NAME,
  "ee/routes/ugc-quote.ts tickets[]": WALKED_BY_NAME,
  "lib/image-batch.ts _internalLora": NOT_CONTENT,
  "lib/image-batch.ts provider": NOT_CONTENT,
  "lib/llm-structured-request.ts jsonSchema": "the JSON schema a structured reply follows: words, never fetched",
  "lib/plan-schemas.ts lottie": WALKED_BY_NAME,
  "lib/plan-schemas.ts slots": WALKED_BY_NAME,
  "lib/plan-schemas.ts slotValues": WALKED_BY_NAME,
  "lib/plan-schemas.ts params": WALKED_BY_NAME,
  "lib/plan-schemas.ts blueprint.params": WALKED_BY_NAME,
  "lib/plan-schemas.ts reveals[].blueprint.params": WALKED_BY_NAME,
  "lib/plan-schemas.ts shots[].reveals[].blueprint.params": WALKED_BY_NAME,
  "lib/plan-schemas.ts scenes[].shots[].reveals[].blueprint.params": WALKED_BY_NAME,
  "lib/use-case/request.ts billingContext": NOT_CONTENT,
  "lib/use-case/request.ts editedEdl": WALKED_BY_NAME,
  "nodes/clip-pack/use-case.ts billingContext": NOT_CONTENT,
  "nodes/clip-pack/use-case.ts cameras": NOT_CONTENT,
  "nodes/episode-chapters/use-case.ts billingContext": NOT_CONTENT,
  "nodes/episode-trailer/use-case.ts billingContext": NOT_CONTENT,
  "nodes/episode-trailer/use-case.ts cameras": NOT_CONTENT,
  "nodes/speaker-layout/use-case.ts billingContext": NOT_CONTENT,
  "nodes/speaker-layout/use-case.ts cameras": NOT_CONTENT,
  "nodes/speaker-map/route.ts offsets": NOT_CONTENT,
  "nodes/speaker-map/route.ts transcript": "a transcript: words and times, handed back as data",
  "nodes/tighten-episode/use-case.ts billingContext": NOT_CONTENT,
  "nodes/tighten-episode/use-case.ts cameras": NOT_CONTENT,
  "routes/3d-scene.ts operations": WALKED_BY_NAME,
  "routes/3d-scene.ts scenePlan": WALKED_BY_NAME,
  "routes/add-captions.ts transcript": "a transcript: words and times, handed back as data",
  "routes/app-runner.ts inputOverrides.*": WALKED_BY_NAME,
  "routes/app-runner.ts inputs": WALKED_BY_NAME,
  "routes/app-runner.ts inputValues.*": WALKED_BY_NAME,
  "routes/app-runner.ts nodeStates": WALKED_BY_NAME,
  "routes/apply-edl.ts edl": WALKED_BY_NAME,
  "routes/apply-edl.ts transcript": "a transcript: words and times, handed back as data",
  "routes/characters.ts person": WALKED_BY_NAME,
  "routes/characters.ts wardrobe": WALKED_BY_NAME,
  "routes/collections.ts item": WALKED_BY_NAME,
  "routes/collection-nodes.ts item": WALKED_BY_NAME,
  "routes/component-execute.ts billingContext": NOT_CONTENT,
  "routes/component-execute.ts inputOverrides.*": WALKED_BY_NAME,
  "routes/component-execute.ts exposedSettings": WALKED_BY_NAME,
  "routes/library.ts metadata": WALKED_BY_NAME,
  "routes/llm-suggest-description.ts context": WALKED_BY_NAME,
  "routes/nodaro-exclusive.ts sources[]": WALKED_BY_NAME,
  "routes/nodaro-exclusive.ts transcript": "a transcript: words and times, handed back as data",
  "routes/nodaro-exclusive.ts edl": WALKED_BY_NAME,
  "routes/pipelines.ts value": WALKED_BY_NAME,
  "routes/pipelines.ts edits[].value": WALKED_BY_NAME,
  "routes/plugin-node-voices.ts data": WALKED_BY_NAME,
  "routes/plugin-node-voices.ts inputs": WALKED_BY_NAME,
  "routes/presentation.ts inputOverrides.*": WALKED_BY_NAME,
  "routes/reduce.ts strategyConfig": WALKED_BY_NAME,
  "routes/render-video.ts plan": WALKED_BY_NAME,
  "routes/saved-posts.ts post": WALKED_BY_NAME,
  "routes/shot-sequence.ts brief.scenes[].shots[].reveals[].blueprint.params": WALKED_BY_NAME,
  "routes/shots.ts selectionState": NOT_CONTENT,
  "routes/text-to-speech.ts accent": NOT_CONTENT,
  "routes/text-to-speech.ts audioProfile": NOT_CONTENT,
  "routes/text-to-speech.ts nextText": NOT_CONTENT,
  "routes/text-to-speech.ts pace": NOT_CONTENT,
  "routes/text-to-speech.ts previousText": NOT_CONTENT,
  "routes/text-to-speech.ts styleDirection": NOT_CONTENT,
  "routes/workflow-render-final.ts inputOverrides.*": WALKED_BY_NAME,
  "routes/workflow-render-final.ts data.inputOverrides.*": WALKED_BY_NAME,
  "services/shot-sequence/brief-schema.ts params": WALKED_BY_NAME,
  "services/shot-sequence/brief-schema.ts blueprint.params": WALKED_BY_NAME,
  "services/shot-sequence/brief-schema.ts reveals[].blueprint.params": WALKED_BY_NAME,
  "services/shot-sequence/brief-schema.ts shots[].reveals[].blueprint.params": WALKED_BY_NAME,
  "services/shot-sequence/brief-schema.ts scenes[].shots[].reveals[].blueprint.params": WALKED_BY_NAME,
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"])

/** A draft-07 tuple (`items: [...]`) read as its items, which the MCP derivation does not walk. */
function withTuples(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withTuples)
  if (!schema || typeof schema !== "object") return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) out[k === "items" && Array.isArray(v) ? "prefixItems" : k] = withTuples(v)
  return out
}

/** The nearest property name of a derived path (`a.b[]` → b, `a.*` → a, `a.*[]` → a). */
function nameOf(path: string): string {
  const segments = path.split(".").map((s) => s.replace(/\[\]/g, "")).filter((s) => s !== "*")
  return segments.at(-1) ?? ""
}

/** Whether any segment of the path is a declared address name (everything under it is judged). */
const underAddressName = (path: string) => path.split(".").some((s) => Object.hasOwn(ADDRESS_NAMES, s.replace(/\[\]/g, "")))

let app: FastifyInstance
const derived: Array<{ file: string; path: string; form: string }> = []

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
  const seen = new Set<string>()
  for (const { schema, file } of h.schemas) {
    if (file === "?" || file.startsWith("lib/config") || file.startsWith("lib/surface-profile")) continue
    let args: Array<{ path: string; form: string }>
    try {
      args = addressArguments(withTuples(jsonInputSchema(schema)))
    } catch {
      continue
    }
    for (const a of args) {
      const key = `${file} ${a.form} ${a.path}`
      if (seen.has(key)) continue
      seen.add(key)
      derived.push({ file, ...a })
    }
  }
}, 120_000)

afterAll(async () => {
  await app?.close()
})

const bodyRoutes = () => {
  const out = new Map<string, { file: string; preHandlers: unknown[] }>()
  for (const r of h.routes) if (BODY_METHODS.has(r.method)) out.set(`${r.method} ${r.url}`, { file: r.file, preHandlers: r.preHandlers })
  return out
}

/** Each route's preHandlers, in the order they run, as `printRoutes` names them. */
function preHandlerNames(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string[] = []
  for (const line of app.printRoutes({ includeHooks: true, commonPrefix: false }).split("\n")) {
    const route = /([/][^\s]*) \(([A-Z, ]+)\)/.exec(line)
    if (route) {
      current = route[2]!.split(", ").map((m) => `${m} ${route[1]}`)
      continue
    }
    const hooks = /• \(preHandler\) (\[.*\])/.exec(line)
    if (hooks) for (const key of current) out.set(key, JSON.parse(hooks[1]!) as string[])
  }
  return out
}

describe("every route that takes a body is judged, or exempt with why", () => {
  it("the boot saw the routes and the schemas", () => {
    expect(bodyRoutes().size).toBeGreaterThan(400)
    expect(derived.length).toBeGreaterThan(300)
  })

  it("the judge is a preHandler of every judged route, ahead of every hook the route brings", () => {
    const names = preHandlerNames()
    const problems: string[] = []
    for (const [key, route] of bodyRoutes()) {
      const hooks = names.get(key)
      if (!hooks) continue
      const at = hooks.indexOf("judgeRequestInputLinks()")
      if (at === -1) {
        problems.push(`${key}: not judged`)
        continue
      }
      const ownFirst = hooks.length - route.preHandlers.length
      if (at >= ownFirst) problems.push(`${key}: judged after its own preHandlers`)
    }
    expect(problems).toEqual([])
    expect(names.size).toBeGreaterThan(400)
  })

  it("every exemption names a registered route (a prefix: at least one), and says why", () => {
    const routes = [...bodyRoutes().keys()]
    for (const [key, why] of Object.entries(EXEMPT_ROUTES)) {
      expect(why.length, `${key}: say why`).toBeGreaterThan(20)
      expect(routes.some((r) => exemptionOf(r) === key), `${key} names no registered route`).toBe(true)
    }
  })

  it("every declared reading is a registered, judged route's (a Cloud plugin's route: one the plugin is recorded to register)", () => {
    const routes = bodyRoutes()
    for (const key of Object.keys(ROUTE_READINGS)) {
      const pluginRoute = PLUGIN_CREDIT_GUARDED_ROUTES.includes(key.slice(key.indexOf(" ") + 1))
      expect(routes.has(key) || pluginRoute, `${key} is not a registered route`).toBe(true)
      expect(exemptionOf(key), `${key} is exempt: its reading is never read`).toBeUndefined()
    }
  })
})

describe("every address a schema declares is judged by its name, or its name is declared", () => {
  it("an address-typed field whose name says nothing of an address is a declared name", () => {
    const missing = derived
      .filter((d) => d.form === "address" || d.form === "text" || d.form === "json")
      .filter((d) => !underAddressName(d.path))
      .filter((d) => {
        const name = nameOf(d.path)
        const byName = fieldFormByName(name)
        if (byName === "address" || (byName === "text" && d.form !== "address")) return false
        if (byName === "text" && d.form === "address") return false
        return !Object.hasOwn(NOT_MEDIA_NAMES, name)
      })
      .map((d) => `${d.file} ${d.form} ${d.path}`)
    expect(missing, "a schema declares an address under a name the funnel does not judge: add the name to ADDRESS_NAMES (judged) or NOT_MEDIA_NAMES (with why)").toEqual([])
  })

  it("every declared name is a field some schema declares, and says why", () => {
    const names = new Set(derived.flatMap((d) => d.path.split(".").map((s) => s.replace(/\[\]/g, ""))))
    for (const [name, why] of [...Object.entries(ADDRESS_NAMES), ...Object.entries(NOT_MEDIA_NAMES)]) {
      expect(why.length, `${name}: say why`).toBeGreaterThan(20)
      expect(names.has(name), `${name} is declared, but no schema has a field by that name`).toBe(true)
    }
  })
})

describe("every value of a judged route's body that takes any shape is accounted for", () => {
  it("a subtree in a judged route's file is read by a declared reader or listed with why", () => {
    const routes = bodyRoutes()
    const judgedFiles = new Set([...routes].filter(([key]) => exemptionOf(key) === undefined).map(([, r]) => r.file))
    const readerPaths = new Set(Object.values(ROUTE_READINGS).flatMap((r) => Object.keys(r.readers ?? {})))
    const subtrees = derived.filter((d) => d.form === "subtree")
    const inJudgedFiles = subtrees.filter((d) => judgedFiles.has(d.file) || !d.file.match(/^(routes|ee\/routes|nodes)\//))
    const missing = inJudgedFiles.filter((d) => !Object.hasOwn(SUBTREES, `${d.file} ${d.path}`) && !readerPaths.has(d.path)).map((d) => `${d.file} ${d.path}`)
    expect(missing).toEqual([])
  })

  it("every listed subtree still is one", () => {
    const subtrees = new Set(derived.filter((d) => d.form === "subtree").map((d) => `${d.file} ${d.path}`))
    const stale = Object.keys(SUBTREES).filter((key) => !subtrees.has(key))
    expect(stale, "SUBTREES lists a value no schema takes whole any more: remove it").toEqual([])
  })
})

/**
 * The media settings of every node type that its run judges as its own
 * inputs, as `type field`: what the workflow import reads as media in a
 * node's data, less `NODE_DATA_NOT_INPUT`. A new media setting fails here
 * until it is named an input or not.
 */
const NODE_DATA_INPUTS = [
  "3d-title backgroundMediaUrl",
  "after-effects inputVideoUrl",
  "ai-avatar audioUrl",
  "ai-avatar imageUrl",
  "character defaultAssetUrl",
  "character subjectVideoUrl",
  "creature defaultAssetUrl",
  "dubbing sourceUrl",
  "edit-video-pro referenceImageUrls",
  "generate-image baseImageUrl",
  "generate-image maskUrl",
  "generate-image referenceImageUrl",
  "generate-image referenceImageUrls",
  "generate-music referenceAudioUrl",
  "generate-music referenceYouTubeUrl",
  "gif-to-video gifUrl",
  "llm-chat referenceAudioUrls",
  "llm-chat referenceFileUrls",
  "llm-chat referenceImageUrls",
  "llm-chat referenceVideoUrls",
  "location defaultAssetUrl",
  "lottie-overlay inputVideoUrl",
  "manual-edit inputVideoUrl",
  "modify-image maskUrl",
  "modify-image referenceImageUrl",
  "motion-graphics lottieUrl",
  "object defaultAssetUrl",
  "reference-board referenceImageUrls",
  "replace-audio musicUrl",
  "replace-audio videoUrl",
  "shot-cuts videoUrl",
  "site-capture url",
  "split-into-layers imageUrl",
  "switchx maskUrl",
  "switchx referenceImageUrl",
  "ugc-creator photoUrl",
  "video-analysis videoUrl",
  "video-analysis youtubeUrl",
  "video-audit videoUrl",
  "video-mask videoUrl",
  "video-sfx videoUrl",
  "web-scrape url",
]

describe("the workflow lane: every node type's media settings are its inputs or named otherwise", () => {
  const readAsMedia = Object.entries(NODE_DATA_FIELDS).flatMap(([type, spec]) =>
    spec.fields
      .filter((field) => !isNodeResultField(field))
      .filter((field) => collectNodeInputMediaUrls([{ id: "n", type, data: { [field]: "https://a.example/x" } }]).length > 0)
      .map((field) => `${type} ${field}`),
  )

  it("each is an input, or not an input with why", () => {
    expect(readAsMedia.length).toBeGreaterThan(50)
    const notInput = Object.entries(NODE_DATA_NOT_INPUT).flatMap(([type, fields]) => Object.keys(fields).map((field) => `${type} ${field}`))
    const unclassified = readAsMedia.filter((key) => !NODE_DATA_INPUTS.includes(key) && !notInput.includes(key) && !Object.hasOwn(NODE_TYPES_NOT_JUDGED, key.split(" ")[0]!))
    expect(unclassified, "a node type has a media setting nobody classified: add it to NODE_DATA_INPUTS here, or to NODE_DATA_NOT_INPUT with why").toEqual([])
    const stale = [...NODE_DATA_INPUTS, ...notInput].filter((key) => !readAsMedia.includes(key))
    expect(stale, "a classified node setting is no media setting of its type any more: remove it").toEqual([])
    for (const fields of Object.values(NODE_DATA_NOT_INPUT)) for (const why of Object.values(fields)) expect(why.length).toBeGreaterThan(20)
  })

  it("every node type a lanes table names is a node type", () => {
    for (const type of Object.keys(NODE_IO_NOT_CONTENT)) expect(Object.hasOwn(NODE_DATA_FIELDS, type), `${type} is no node type`).toBe(true)
  })

  it("every node type not judged is a node type", () => {
    for (const [type, why] of Object.entries(NODE_TYPES_NOT_JUDGED)) {
      expect(Object.hasOwn(NODE_DATA_FIELDS, type), `${type} is no node type`).toBe(true)
      expect(why.length).toBeGreaterThan(20)
    }
  })
})
