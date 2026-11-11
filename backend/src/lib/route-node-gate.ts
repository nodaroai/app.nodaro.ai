import { NODE_RUN_ROUTES } from "@nodaro/shared/nodes"
import { SOCIAL_POST_NODE_PLATFORM } from "@nodaro/shared/social"
import { MODIFY_IMAGE_PROVIDERS, TASK_CHAINED_EDIT_PROVIDERS, UPSCALE_IMAGE_PROVIDERS } from "@nodaro/shared/models"
import { USE_CASE_NODE_TYPES, usecaseContinuePath, usecaseDescriptor } from "@nodaro/render-rules"
import {
  FILM_PIPELINE_FEATURE,
  KNOWN_NODE_TYPES,
  ROUTE_GATES_GENERATION,
  VIDEO_DIRECTOR_FEATURE,
  nodeUniverseLoaded,
} from "./availability-override.js"
import { isCapabilityHost } from "./surface-deny.js"
import { runtimeSurfaceProfile } from "./surface-profile.js"

/**
 * Which node a credit-guarded route RUNS — the name `creditGuard`
 * (middleware/credit-guard.ts) asks the availability funnel about
 * (`nodes.allow` / `nodes.deny`, Admin → Availability). One table for every
 * route, the platform's and the Cloud plugin's, since a plugin route is
 * guarded by the same `creditGuard` (the toolkit's `tk.http.creditGuard`).
 *
 * The answer used to be the route path minus `/v1/`. That names a top-level
 * route's node (`/v1/generate-image` → `generate-image`) and nothing else: a
 * nested route was asked about as `suno/generate`, a name no allowlist holds,
 * so a deployment that withdrew Suno still ran `POST /v1/suno/generate`.
 *
 * A route resolves, in order, from:
 *   1. {@link EXEMPT_ROUTES} — a route that runs no node, and why;
 *   2. {@link ROUTE_NODES} — a route whose node is not its path: a node's run on
 *      another route, a step or variant of one node's run, a route several
 *      nodes run (resolved from the body);
 *   3. the shared run-route contract — `NODE_RUN_ROUTES` (`@nodaro/shared`,
 *      what the SDK's `nodes.run(type)` posts to) and the use-case registry's
 *      run and continue routes (`@nodaro/render-rules`), read backwards;
 *   4. the convention `POST /v1/<type>`, when `<type>` is a node this build
 *      knows (`KNOWN_NODE_TYPES`).
 * Anything else is UNCLASSIFIED: on a deployment with a `nodes.allow`
 * whitelist it is refused (a credit-spending route the whitelist cannot name
 * is a route it never allowed — the whitelist's own rule, "not listed ⇒
 * unavailable"); elsewhere it runs, as it always did, and is reported once.
 * src/__tests__/credit-guard-route-nodes.test.ts holds every route the app
 * guards to one of the first four, and {@link PLUGIN_CREDIT_GUARDED_ROUTES}
 * lists the plugin's.
 *
 * GENERATIONS. A route whose node is what the old path derivation already
 * named is the same door as before (generation 0). Any other resolution is a
 * door that opened with route gating (`ROUTE_GATES_GENERATION`), and an admin
 * override stored before it never decided it — see "Gating generations" in
 * lib/availability-override.ts.
 */

export type RouteNodeGate =
  /** The request runs one of `types` (any one available lets it through). */
  | { readonly kind: "node"; readonly types: readonly string[]; readonly since: number }
  /** The route runs no node; `reason` says what governs it instead. */
  | { readonly kind: "exempt"; readonly reason: string }
  /** Nothing names this route's node. */
  | { readonly kind: "unclassified" }

type BodyResolver = (body: Readonly<Record<string, unknown>>) => readonly string[]

/** One spelling per route: a parameter's NAME does not matter (`:id` ≡ `:jobId`). */
function routeKey(route: string): string {
  return route.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":")
}

/**
 * Credit-guarded routes that run no node. Each is governed elsewhere, or by
 * nothing yet — in which case a whitelist deployment cannot withhold it and
 * the reason says so.
 */
export const EXEMPT_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  "/v1/copilot/threads/:id/messages": "Copilot is no node; the surface profile's features.hide (\"copilot\") switches it off",
})

/** `/v1/edit-image` by provider: the canvas node that sends the same request. */
function editImageNode(body: Readonly<Record<string, unknown>>): readonly string[] {
  const provider = typeof body.provider === "string" ? body.provider : "recraft-upscale"
  if (provider === "recraft-remove-bg") return ["remove-background"]
  if ((UPSCALE_IMAGE_PROVIDERS as readonly string[]).includes(provider)) return ["upscale-image"]
  // A prompt edit, or a task-chained edit of a prior generation (no node holds
  // the task id, but it is an image edit all the same).
  if ((MODIFY_IMAGE_PROVIDERS as readonly string[]).includes(provider) || TASK_CHAINED_EDIT_PROVIDERS.has(provider)) return ["modify-image"]
  return ["upscale-image"]
}

/** The post node that publishes to each platform. */
const POST_NODE_OF_PLATFORM: ReadonlyMap<string, string> = new Map(
  Object.entries(SOCIAL_POST_NODE_PLATFORM).map(([type, platform]) => [platform, type]),
)

/** `/v1/social/publish`: the platform's own post node, or the unified node that posts anywhere. */
function socialPublishNodes(body: Readonly<Record<string, unknown>>): readonly string[] {
  const own = typeof body.platform === "string" ? POST_NODE_OF_PLATFORM.get(body.platform) : undefined
  return own ? [own, "publish-social"] : ["publish-social"]
}

/**
 * Routes whose node is not their path. Grouped by why.
 */
export const ROUTE_NODES: Readonly<Record<string, string | BodyResolver>> = Object.freeze({
  // ── A node's run on a route that is not POST /v1/<type> ─────────────────
  "/v1/image-to-image": "modify-image",
  "/v1/edit-image": editImageNode,
  "/v1/social/publish": socialPublishNodes,
  // The entity nodes run on their generation routes (payload-builder's twins).
  "/v1/generate-character": "character",
  "/v1/generate-face": "face",
  "/v1/generate-object": "object",
  "/v1/generate-creature": "creature",
  "/v1/generate-location": "location",

  // ── A step or variant of one node's run ────────────────────────────────
  "/v1/llm-chat/generate-stream": "llm-chat",
  "/v1/ai-writer/generate-stream": "ai-writer",
  "/v1/image-overlay/suggest-placement": "image-overlay",
  "/v1/render-video/scene-graph": "render-video",
  "/v1/render-video/plan": "render-video",
  // The text twin of Describe to Picker (same analyzer, a description for an image).
  "/v1/text-to-picker": "describe-to-picker",
  // The generic LLM calls with no node of their own are Generate Text's
  // capability: a deployment that offers no text generation offers none of them.
  "/v1/llm/structured": "llm-chat",
  "/v1/llm/structured/jobs": "llm-chat",
  "/v1/llm-suggest-description": "llm-chat",
  "/v1/prompt-helper/wizard": "llm-chat",
  // An entity's own steps: its sheet's images and motion, its caption, its
  // approval (with its optional caption), its LoRA training.
  "/v1/generate-character-asset": "character",
  "/v1/generate-character-motion": "character",
  "/v1/characters/:id/llm-caption": "character",
  "/v1/characters/:id/approve-portrait": "character",
  "/v1/characters/:id/train": "character",
  "/v1/generate-object-asset": "object",
  "/v1/generate-object-motion": "object",
  "/v1/objects/:id/llm-caption": "object",
  "/v1/objects/:id/approve-main-image": "object",
  "/v1/generate-creature-asset": "creature",
  "/v1/generate-creature-motion": "creature",
  "/v1/creatures/:id/llm-caption": "creature",
  "/v1/creatures/:id/approve-main-image": "creature",
  "/v1/generate-location-asset": "location",
  "/v1/generate-location-motion": "location",
  "/v1/generate-surround-continuation": "location",
  "/v1/locations/:id/llm-caption": "location",
  "/v1/locations/:id/approve-main-image": "location",

  // ── Nodaro Motion (cast-swap): its own routes and its engine's helpers ──
  "/v1/cast-swap/:jobId/full-quality": "cast-swap",
  // A trend's face mask, made once by the same engine (the platform's own
  // internal call from the trend editor).
  "/v1/cast-swap/face-mask": "cast-swap",
  "/v1/video-face-mesh": "cast-swap",
  "/v1/mask-erase": "cast-swap",
  "/v1/mask-outline": "cast-swap",

  // ── The film pipeline and the Video Director (gateable features with no
  //    canvas node, lib/availability-override.ts) ─────────────────────────
  // A scene's regeneration, a step of a pipeline already started. Every other
  // pipeline route that starts or continues work (a scene helper's included)
  // is refused by the route family's hook, which asks the same id
  // (lib/film-pipeline-availability.ts).
  "/v1/pipelines/:id/stages/script/regenerate-scene": FILM_PIPELINE_FEATURE,
  // MCP create_explainer / create_launch_video. Its speech, alignment and
  // render steps are gated as their own nodes by their own routes.
  "/v1/video-director/run": VIDEO_DIRECTOR_FEATURE,

  // ── The Cloud plugin's nested routes ───────────────────────────────────
  "/v1/generate-video-pro/continue": "generate-video-pro",
  "/v1/voice-changer-pro/analyze": "voice-changer-pro",
  "/v1/voice-changer-pro/export": "voice-changer-pro",
  "/v1/voice-changer-pro/translate": "voice-changer-pro",
  // The split step of UGC Clips' prelude (a job of its own, `ugc-segments`).
  "/v1/ugc/segments": "ugc-clips",
  // Recast produces a Generate Video Pro render (its continue reserves under
  // that node's pricing): every Recast route follows that node, its script
  // revisions, recommendation and plan included.
  "/v1/recast": "generate-video-pro",
  "/v1/recast/:id/continue": "generate-video-pro",
  "/v1/recast/:id/candidates": "generate-video-pro",
  "/v1/recast/:id/refine": "generate-video-pro",
  "/v1/recast/:id/rescore": "generate-video-pro",
  "/v1/recast/:id/audio-derive": "generate-video-pro",
  "/v1/recast/revise": "generate-video-pro",
  "/v1/recast/recommend": "generate-video-pro",
  "/v1/recast/:id/retake/revise": "generate-video-pro",
  "/v1/recast/:id/plan": "generate-video-pro",
  // A Studio production's sequence unit renders one Generate Video request:
  // the unified video node's two modes are the unit's two lanes (with a start
  // frame on POST /v1/generate-video, without on the text-to-video route, each
  // gated as its own node when it runs). The body cannot say which lane (the
  // stored take decides), so the route follows the node that offers both.
  "/v1/studio/productions/:id/sequences/:sequenceId/takes/:takeId/units/:unitId/generate": "generate-video",
})

/**
 * Node types with routes that are in no registry: they run, but no allowlist
 * or override gates them by omission — exactly as their workflow twin is
 * gated (only an explicit `nodes.deny` entry names them).
 */
export const UNGATED_LEGACY_NODE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "ai-writer": "the text node Generate Text replaced: no longer creatable, saved workflows still run it",
})

/**
 * The routes on which the Cloud plugin runs the credit guard
 * (`tk.http.creditGuard`), read from its source: the routes it registers, and
 * the host's own routes whose handler hands the request to a plugin engine
 * that guards it (3D Render Pro's run and preview admissions). A plugin route
 * is invisible to this repo's route scan and to a test that boots the app
 * without the plugin, and a guard a plugin engine runs is invisible to the
 * boot either way, so the list is the record that each one resolves
 * (route-node-gate.test.ts) and that its run model is declared plugin-side
 * (credit-guard-run-model-census.test.ts). One the plugin adds later and
 * nobody lists is unclassified: refused under a whitelist, reported.
 */
export const PLUGIN_CREDIT_GUARDED_ROUTES: readonly string[] = Object.freeze([
  "/v1/camera-switch",
  "/v1/cast-swap",
  "/v1/cast-swap/:jobId/full-quality",
  "/v1/competitor-scan",
  "/v1/content-ideas",
  "/v1/content-recipe",
  "/v1/edit-plan",
  "/v1/edit-video-pro",
  "/v1/generate-video-pro",
  "/v1/generate-video-pro/continue",
  "/v1/recast",
  "/v1/recast/:id/continue",
  "/v1/recast/:id/candidates",
  "/v1/recast/:id/refine",
  "/v1/recast/:id/rescore",
  "/v1/recast/:id/audio-derive",
  // The model and node checks alone (each route keeps its own price and
  // reservation), since plugin 0.464.0.
  "/v1/recast/revise",
  "/v1/recast/recommend",
  "/v1/recast/:id/retake/revise",
  "/v1/recast/:id/plan",
  "/v1/cast-swap/face-mask",
  "/v1/studio/productions/:id/sequences/:sequenceId/takes/:takeId/units/:unitId/generate",
  "/v1/social-search",
  "/v1/speaker-frames",
  "/v1/speaker-view",
  "/v1/ugc/clip",
  "/v1/ugc/script",
  "/v1/ugc/segments",
  "/v1/ugc/finish",
  "/v1/video-analysis",
  "/v1/video-audit",
  "/v1/voice-changer-pro",
  "/v1/voice-changer-pro/analyze",
  "/v1/voice-changer-pro/export",
  "/v1/voice-changer-pro/translate",
  // Host routes whose handler hands the request to the plugin's 3D engine,
  // which runs the guard: the Pro render's run admission
  // (routes/pro-3d-render.ts) and the advanced lane's preview admission
  // (routes/3d-scene.ts, generate and edit, each under both paths).
  "/v1/pro-3d-render",
  "/v1/3d-scene/generate",
  "/v1/generate-3d-scene",
  "/v1/3d-scene/edit",
  "/v1/edit-3d-scene",
])

/**
 * The node a plugin engine's job runs as, for the job names that are not a
 * node type themselves (a job named after its node, `cast-swap`, runs as that
 * node). A step such a job sends to another route — a worker-side child
 * request — is gated as this node, the node the user ran
 * (lib/child-step-node.ts). Read from the Cloud plugin's source.
 */
export const PLUGIN_JOB_NODES: Readonly<Record<string, string>> = Object.freeze({
  // Nodaro Motion's Full Quality render and a trend's face-mask make.
  "cast-swap-full-quality": "cast-swap",
  "cast-swap-face-mask": "cast-swap",
})

/** The node a job named `jobType` runs as, or undefined when no node accounts for it. */
export function nodeOfJobType(jobType: string): string | undefined {
  if (Object.hasOwn(PLUGIN_JOB_NODES, jobType)) return PLUGIN_JOB_NODES[jobType]
  return isKnownNodeType(jobType) ? jobType : undefined
}

const EXEMPT_BY_KEY: ReadonlyMap<string, string> = new Map(Object.entries(EXEMPT_ROUTES).map(([r, why]) => [routeKey(r), why]))
const NODE_BY_KEY: ReadonlyMap<string, string | BodyResolver> = new Map(Object.entries(ROUTE_NODES).map(([r, n]) => [routeKey(r), n]))

/**
 * The shared contracts read backwards: each route some node's run posts to,
 * with every node that posts there. A route several nodes share must resolve
 * from its body, in {@link ROUTE_NODES} (Publish to Social's).
 */
const CONTRACT_RUN_ROUTES: ReadonlyMap<string, readonly string[]> = (() => {
  const byRoute = new Map<string, string[]>()
  const add = (route: string, type: string) => {
    const key = routeKey(route)
    const types = byRoute.get(key) ?? []
    if (!types.includes(type)) byRoute.set(key, [...types, type])
  }
  for (const [type, route] of Object.entries(NODE_RUN_ROUTES)) add(route, type)
  for (const type of USE_CASE_NODE_TYPES) {
    add(usecaseDescriptor(type).route, type)
    add(usecaseContinuePath(type), type)
  }
  return byRoute
})()

/** `POST /v1/<type>`: one path segment that can be a node type. */
const CONVENTION_ROUTE = /^\/v1\/([a-z0-9][a-z0-9-]*)$/

/** The name the old derivation asked about: the path minus `/v1/`. */
function pathDerivedType(route: string): string {
  return route.replace(/^\/v1\//, "")
}

/** A node the availability funnel can answer for — every name a route may resolve to. */
export function isKnownNodeType(type: string): boolean {
  return KNOWN_NODE_TYPES.has(type) || isCapabilityHost(type) || Object.prototype.hasOwnProperty.call(UNGATED_LEGACY_NODE_TYPES, type)
}

function nodeGate(route: string, types: readonly string[]): RouteNodeGate {
  const since = types.length === 1 && types[0] === pathDerivedType(route) ? 0 : ROUTE_GATES_GENERATION
  return { kind: "node", types, since }
}

/** The node `route` (a route PATTERN, `req.routeOptions.url`) runs for `body`. */
export function routeNodeGate(route: string, body: unknown): RouteNodeGate {
  const key = routeKey(route)
  const exempt = EXEMPT_BY_KEY.get(key)
  if (exempt !== undefined) return { kind: "exempt", reason: exempt }

  const explicit = NODE_BY_KEY.get(key)
  if (explicit !== undefined) {
    const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Readonly<Record<string, unknown>>) : {}
    return nodeGate(route, typeof explicit === "string" ? [explicit] : explicit(record))
  }

  const contract = CONTRACT_RUN_ROUTES.get(key)
  if (contract && contract.length === 1) return nodeGate(route, contract)

  const convention = CONVENTION_ROUTE.exec(route)?.[1]
  // Before the registry has filled the universe (boot, a test that never asked
  // for it) "not known" means nothing yet: the path names the node, as it
  // always did.
  if (convention && (!nodeUniverseLoaded() || isKnownNodeType(convention))) return nodeGate(route, [convention])

  return { kind: "unclassified" }
}

/**
 * Whether an unclassified credit-guarded route is refused: under a
 * `nodes.allow` whitelist, once the node universe is loaded (before that,
 * nothing can be told apart from a node the registry has not reported yet).
 */
export function refusesUnclassifiedRoutes(): boolean {
  return nodeUniverseLoaded() && runtimeSurfaceProfile().nodes.allow.length > 0
}

/** The refusal of an unclassified route — the credit guard's `node_not_available` shape. */
export function unclassifiedRouteMessage(route: string): string {
  return `${route} is not available on this deployment: it is linked to no node this deployment can allow.`
}

const reportedUnclassified = new Set<string>()

/** Say once per route, loudly, that a credit-guarded route is linked to no node
 *  (once the universe is loaded: before that "unknown" means nothing yet). */
export function reportUnclassifiedRoute(route: string, refused: boolean): void {
  if (!nodeUniverseLoaded() || reportedUnclassified.has(route)) return
  reportedUnclassified.add(route)
  console.error(
    `[route-node-gate] ${route} spends credits but is linked to no node${refused ? " — refused under nodes.allow" : ""}. ` +
      "Name its node in lib/route-node-gate.ts.",
  )
}
