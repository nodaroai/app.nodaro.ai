import type { FastifyReply, FastifyRequest } from "fastify"
import {
  PRO3D_RENDER_ASPECT_RATIOS,
  PRO3D_RENDER_DEFAULT_REPAIR_PASSES,
  PRO3D_RENDER_QUALITY_PROFILES,
  PRO3D_RENDER_STYLES,
  type Pro3DRenderAspectRatio,
  type Pro3DRenderCapabilities,
  type Pro3DRenderEngine,
  type Pro3DRenderQuality,
  type Pro3DRenderStyle,
} from "@nodaro/shared"
import { config, hasCredits } from "../../lib/config.js"
import { getPluginEngines } from "../../lib/private-plugins/engine-registry.js"
import type { PluginScene3DCapabilities, PluginScene3DEngine } from "../../lib/private-plugins/scene3d-contract.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { isNodeDenied, deniedNodeRejectionMessage } from "../../lib/surface-deny.js"

/** Advanced routes bypass Basic's credit guard, including its deployment gate. */
export function refuseDeniedScene3DNode(type: string, reply: FastifyReply): boolean {
  if (!isNodeDenied(type)) return false
  reply.status(403).send({ error: { code: "node_not_available", message: deniedNodeRejectionMessage([type]) } })
  return true
}

function unavailable(reply: FastifyReply) {
  return reply.status(503).send({ error: {
    code: "SCENE_CAPABILITY_UNAVAILABLE",
    message: "The selected 3D authoring engine is unavailable on this instance.",
  } })
}

/** A missing/unknown explicit engine must never become a paid Basic request. */
export function requestedScene3DEngine(body: unknown): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>).engine : undefined
}

/** The installed Advanced engine, or undefined when this edition/config has none. */
function advancedEngine(): PluginScene3DEngine | undefined {
  return hasCredits() && config.SCENE3D_ADVANCED_ENABLED ? getPluginEngines().scene3d : undefined
}

/**
 * Is `pro-3d-render` actually servable right now?
 *
 * READINESS, expressed as a fact rather than a flag: the operation exists iff
 * an engine is installed AND that engine implements the optional `proRender`
 * member. Discovery (`GET /v1/nodes`), the capabilities document, the MCP tool
 * list and the canvas picker all ask THIS question, so they cannot disagree
 * with what the route will do — the failure mode where a node is offered
 * everywhere and 503s on run is structurally unavailable.
 *
 * Synchronous on purpose: every one of those callers is on a hot path where an
 * `await engine.capabilities()` would be a per-request round trip to the
 * plugin for an answer that cannot change without a redeploy.
 */
export function scene3DProAvailable(): boolean {
  if (isNodeDenied("pro-3d-render")) return false
  const engine = advancedEngine()
  // BOTH halves, because the run route requires a `quoteId` that only
  // `quoteProRender` can mint. An engine with one and not the other would be
  // advertised everywhere and unrunnable — the exact failure this predicate
  // exists to make impossible.
  return typeof engine?.proRender === "function" && typeof engine?.quoteProRender === "function"
}

/** Is `blender-local` offerable? Local needs its own flag AND an engine that
 *  says it can do it — never inferred from cloud availability. */
export function scene3DProLocalAvailable(engines: readonly string[]): boolean {
  return config.SCENE3D_LOCAL_ENABLED && engines.includes("blender-local")
}

/**
 * Narrow an engine-declared list to values this contract can express.
 *
 * An engine that advertises a profile the published vocabulary has no name for
 * would put a value on a client that the client cannot type, and one that
 * advertises nothing gets the conservative default rather than an empty menu.
 */
function declared<T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  const kept = (values ?? []).filter((value): value is T => (allowed as readonly string[]).includes(value))
  return kept.length > 0 ? kept : [...fallback]
}

export async function scene3DCapabilities() {
  const engine = advancedEngine()
  const advanced = engine ? await engine.capabilities() : undefined
  return {
    basic: { available: true, sceneSchemaVersions: [1] },
    advanced: advanced ? {
      ...advanced,
      engines: advanced.engines.filter((value) => value !== "blender-local" || config.SCENE3D_LOCAL_ENABLED),
    } : null,
    // The one-operation Pro surface, reported separately from `advanced`
    // because a client asks a different question of it: not "which engines can
    // author" but "which controls may I offer, and can I put the node on a
    // canvas at all".
    pro: proCapabilities(advanced),
  }
}

/**
 * What every surface may offer for the Pro node.
 *
 * Derived from the installed engine, narrowed to the published vocabulary, and
 * with `blender-local` withheld unless the deployment enables it — so a menu
 * can never contain an option the route would refuse.
 */
function proCapabilities(advanced: PluginScene3DCapabilities | undefined): Pro3DRenderCapabilities {
  const pro = advanced?.pro
  const engines = declared<Pro3DRenderEngine>(
    pro?.engines ?? advanced?.engines,
    ["blender-cloud", "blender-local"],
    ["blender-cloud"],
  ).filter((value) => value !== "blender-local" || config.SCENE3D_LOCAL_ENABLED)
  return {
    available: scene3DProAvailable(),
    engines,
    qualityProfiles: declared<Pro3DRenderQuality>(pro?.qualityProfiles, PRO3D_RENDER_QUALITY_PROFILES, PRO3D_RENDER_QUALITY_PROFILES),
    styles: declared<Pro3DRenderStyle>(pro?.styles, PRO3D_RENDER_STYLES, PRO3D_RENDER_STYLES),
    aspectRatios: declared<Pro3DRenderAspectRatio>(pro?.aspectRatios, PRO3D_RENDER_ASPECT_RATIOS, PRO3D_RENDER_ASPECT_RATIOS),
    maxRepairPasses:
      typeof pro?.maxRepairPasses === "number" ? pro.maxRepairPasses : PRO3D_RENDER_DEFAULT_REPAIR_PASSES,
  }
}

/** Called before Basic's credit guard. The private engine owns its admission. */
export async function dispatchAdvancedScene3D(
  operation: "generate" | "edit",
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return
  }
  if (refuseDeniedScene3DNode(operation === "generate" ? "generate-3d-scene" : "edit-3d-scene", reply)) return
  const selected = requestedScene3DEngine(request.body)
  if (selected !== "blender-cloud" && selected !== "blender-local") {
    reply.status(400).send({ error: { code: "validation_error", message: "Unknown 3D authoring engine" } })
    return
  }
  const engine = getPluginEngines().scene3d
  if (!hasCredits() || !config.SCENE3D_ADVANCED_ENABLED || !engine ||
      (selected === "blender-local" && !config.SCENE3D_LOCAL_ENABLED)) {
    unavailable(reply)
    return
  }
  try {
    const capabilities = await engine.capabilities()
    if (!capabilities.engines.includes(selected)) {
      unavailable(reply)
      return
    }
    const output = await engine[operation](request, reply)
    if (!reply.sent) reply.send(output)
  } catch (error) {
    if (!reply.sent) sendInternalError(reply, request, error, "Failed to start 3D scene authoring")
  }
}

/**
 * Hand `POST /v1/pro-3d-render` to the private runtime.
 *
 * The host has already refused everything it can refuse for free by the time
 * this runs (shape, engine vocabulary, authentication, readiness, configured
 * price). What is left is the part the host has no business deciding —
 * ownership, quoting, the parent reservation, the durable stages — so it is
 * handed over whole rather than half-implemented here.
 */
export async function dispatchPro3DRender(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await dispatchPro("proRender", "Failed to start 3D Render Pro", request, reply)
}

/**
 * Hand `POST /v1/pro-3d-render/quote` to the private runtime.
 *
 * Same delegation, and for the same reason: pricing an operation requires
 * resolving the source (a revision's owner, timing and version; an export's
 * pairing) and the deployment's own economics, none of which the host knows.
 * The engine must not reserve or spend anything here.
 */
export async function dispatchPro3DRenderQuote(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await dispatchPro("quoteProRender", "Failed to quote 3D Render Pro", request, reply)
}

async function dispatchPro(
  method: "proRender" | "quoteProRender",
  failureMessage: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (refuseDeniedScene3DNode("pro-3d-render", reply)) return
  const engine = advancedEngine()
  // Readiness is checked as a PAIR, so a half-implemented engine cannot serve
  // one leg of the operation and strand the other.
  if (!scene3DProAvailable() || !engine?.[method]) {
    unavailable(reply)
    return
  }
  try {
    const output = await engine[method]!(request, reply)
    if (!reply.sent) reply.send(output)
  } catch (error) {
    if (!reply.sent) sendInternalError(reply, request, error, failureMessage)
  }
}
