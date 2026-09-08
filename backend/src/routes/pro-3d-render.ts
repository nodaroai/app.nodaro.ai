/**
 * `POST /v1/pro-3d-render` and `POST /v1/pro-3d-render/quote` — the public
 * facade for 3D Render Pro.
 *
 * ONE durable operation. A `source` says where the scene comes from — a new
 * brief, an existing revision, or a completed desktop export — and one job
 * settles with both the composition and the exported MP4. The caller polls the
 * ordinary jobs API; there is no second result type and no chain of endpoints
 * to hold together in a tab.
 *
 * ## What this file is, and is not
 *
 * It is the wire shape and the refusals that cost nothing: authentication,
 * readiness, engine availability, the request schema, the correction budget,
 * the scene-schema declaration, the reference-list rules the contract already
 * owns, a bounded idempotency key, and whether this deployment has a
 * configured price at all. Every one of those happens BEFORE anything is
 * quoted, inserted, reserved, built or rendered.
 *
 * It is NOT the operation, and it is NOT the economics. Resolving a revision's
 * owner/timing/version, resolving an export's pairing, pricing, the single
 * parent reservation and its settlement all live behind the private engine.
 * The host does not read revisions, so it cannot and must not decide what a
 * `scene` source means.
 *
 * ## The source travels untouched
 *
 * `source` is forwarded exactly as parsed. In particular a `scene` source with
 * NO `editPrompt` is the render-only path, and its absence is meaningful: the
 * host never substitutes an empty string, never copies a brief into it, and
 * never rewrites the kind. Doing any of those turns a free export into a paid
 * authoring run the user did not ask for.
 *
 * ## Quote, then run
 *
 * `/quote` validates the SAME body without a `quoteId` and answers a ceiling
 * plus a `normalizedInputHash`; it reserves and spends nothing. `/` requires
 * that `quoteId`, so no run can start at a price nobody showed. The engine
 * re-checks the hash and the permissions at admission — the host does not
 * compute either, it only guarantees the two endpoints agree about what a
 * valid body IS.
 *
 * ## Why the engine's absence is the gate
 *
 * `scene3DProAvailable()` is false unless an installed engine exposes BOTH
 * halves. Discovery, the capabilities document, the MCP tool list and the
 * canvas picker read that same predicate, so an install that cannot serve this
 * never advertises it, and a hand-written request gets an honest 503.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  PRO3D_RENDER_ASPECT_RATIOS,
  PRO3D_RENDER_ENGINES,
  PRO3D_RENDER_LIMITS,
  PRO3D_RENDER_MAX_REPAIR_PASSES,
  PRO3D_RENDER_MIN_REPAIR_PASSES,
  PRO3D_RENDER_QUALITY_PROFILES,
  PRO3D_RENDER_STYLES,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  pro3DRenderProducedSchemaVersion,
  scene3DReferenceSchema,
  type Pro3DRenderSource,
  type Scene3DReference,
} from "@nodaro/shared"
import { hasCredits } from "../lib/config.js"
import { sendInternalError } from "../lib/http-errors.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { formatZodError } from "../lib/zod-error.js"
import { rateLimiter } from "../middleware/rate-limit.js"
import { scene3DReferenceListError } from "../services/scene3d/index.js"
import {
  dispatchPro3DRender,
  dispatchPro3DRenderQuote,
  scene3DCapabilities,
  scene3DProAvailable,
  refuseDeniedScene3DNode,
} from "../services/scene3d/scene3d-engine.js"

/** The node type / job identifier this route serves. */
export const PRO3D_RENDER_JOB_TYPE = "pro-3d-render"
export const PRO3D_RENDER_ROUTE = "/v1/pro-3d-render"
export const PRO3D_RENDER_QUOTE_ROUTE = "/v1/pro-3d-render/quote"

/**
 * DERIVED from the contract, exactly as the Basic authoring route derives it:
 * the server stamps these references onto the plan, so anything the contract
 * would refuse there is refused here, with the platform's SSRF-aware URL check
 * substituted for the contract's structural one.
 */
const referenceBody = scene3DReferenceSchema.extend({ url: safeUrlSchema })

const boundedId = z.string().trim().min(1).max(PRO3D_RENDER_LIMITS.maxIdLength)

/**
 * The source union — strict, and strict on purpose.
 *
 * `z.discriminatedUnion` refuses an unknown `kind` outright and, because each
 * branch is `.strict()`, refuses a body that carries another branch's fields.
 * A caller cannot send `{kind:'scene', prompt:'...'}` and leave the question of
 * what they meant to whichever layer reads it last.
 *
 * `editPrompt` is `.optional()` with no default. Absence IS the render-only
 * request; a default would erase the distinction here, at the one place every
 * surface passes through.
 */
export const pro3DRenderSourceBody = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("prompt"),
      prompt: z.string().trim().min(1).max(PRO3D_RENDER_LIMITS.promptMax),
      references: z.array(referenceBody).max(PRO3D_RENDER_LIMITS.maxReferences).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scene"),
      revisionId: boundedId,
      sourceJobId: boundedId.optional(),
      editPrompt: z.string().trim().min(1).max(PRO3D_RENDER_LIMITS.editPromptMax).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("local-export"),
      exportId: boundedId,
      connectionId: boundedId,
    })
    .strict(),
])

/**
 * Everything both endpoints validate identically.
 *
 * Timing/aspect are OPTIONAL with no host-side default, and that is
 * load-bearing for a `scene` source: the contract forbids silently overriding
 * a source's own timing, so an omitted field must stay omitted all the way to
 * the engine, which is the only party that can see the conflict and reject it.
 * Defaulting them here would make every render-only export look like an
 * explicit re-time request.
 */
const pro3DRenderCommonShape = {
  source: pro3DRenderSourceBody,
  engine: z.enum(PRO3D_RENDER_ENGINES).optional(),
  /** Names a paired desktop for a local run. The engine authorizes it. */
  localConnectionId: boundedId.optional(),
  durationSeconds: z
    .number()
    .min(PRO3D_RENDER_LIMITS.minDurationSeconds)
    .max(PRO3D_RENDER_LIMITS.maxDurationSeconds)
    .optional(),
  fps: z.number().int().min(PRO3D_RENDER_LIMITS.minFps).max(PRO3D_RENDER_LIMITS.maxFps).optional(),
  aspectRatio: z.enum(PRO3D_RENDER_ASPECT_RATIOS).optional(),
  quality: z.enum(PRO3D_RENDER_QUALITY_PROFILES).optional(),
  style: z.enum(PRO3D_RENDER_STYLES).optional(),
  /** The correction budget. Bounded here because each pass is paid work. */
  maxRepairPasses: z
    .number()
    .int()
    .min(PRO3D_RENDER_MIN_REPAIR_PASSES)
    .max(PRO3D_RENDER_MAX_REPAIR_PASSES)
    .optional(),
  /** Which scene-schema versions the CALLER can render. */
  acceptedSceneSchemaVersions: z.array(z.number().int()).min(1).max(8).optional(),
  workflowId: z.string().optional(),
  nodeId: z.string().optional(),
  forcePrivate: z.boolean().optional(),
}

/** The quote body: the run body minus its `quoteId`, refused if one is sent. */
export const pro3DRenderQuoteBody = z
  .object({ ...pro3DRenderCommonShape, quoteId: z.never().optional() })
  .passthrough()

/** The run body. `quoteId` is required: no run starts at an unquoted price. */
export const pro3DRenderBody = z
  .object({ ...pro3DRenderCommonShape, quoteId: boundedId })
  .passthrough()

export type Pro3DRenderBody = z.infer<typeof pro3DRenderBody>

function unavailable(reply: FastifyReply, message = "3D Render Pro is unavailable on this instance.") {
  return reply.status(503).send({ error: { code: "SCENE_CAPABILITY_UNAVAILABLE", message } })
}

function invalid(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { code: "validation_error", message } })
}

/**
 * Refuse when this deployment has no configured price.
 *
 * Returns true when it has answered. The ee modules load through `import()`
 * (the credit-guard shim idiom) so a community/business build never pulls the
 * billing graph in — and cannot reach here anyway, since readiness already
 * requires the credits edition.
 */
async function refuseWithoutConfiguredPrice(
  req: FastifyRequest,
  reply: FastifyReply,
  routeName: string,
): Promise<boolean> {
  if (!hasCredits()) return false
  const [{ assertPro3DRenderPriceConfigured }, { handlePriceNotConfigured }] = await Promise.all([
    import("../ee/billing/pro-3d-render-credits.js"),
    import("../ee/lib/credit-guard-impl.js"),
  ])
  try {
    await assertPro3DRenderPriceConfigured()
    return false
  } catch (error) {
    if (handlePriceNotConfigured(error, reply, routeName)) return true
    sendInternalError(reply, req, error, "Failed to read 3D Render Pro pricing")
    return true
  }
}

/**
 * The `Idempotency-Key` a run must carry.
 *
 * Required, not optional: this is the most expensive single operation the
 * platform exposes, and a transport retry without a key is a second paid run
 * the caller never intended. Bounded on both ends — the platform's existing
 * 8-character floor (below which keys collide across unrelated requests) and a
 * ceiling so an unbounded header cannot reach a lookup or a column.
 */
function idempotencyKeyError(req: FastifyRequest): string | undefined {
  const raw = req.headers["idempotency-key"]
  const key = typeof raw === "string" ? raw.trim() : ""
  if (key.length === 0) return "3D Render Pro requires an Idempotency-Key header."
  if (key.length < PRO3D_RENDER_LIMITS.minIdempotencyKeyLength) {
    return `Idempotency-Key must be at least ${PRO3D_RENDER_LIMITS.minIdempotencyKeyLength} characters.`
  }
  if (key.length > PRO3D_RENDER_LIMITS.maxIdempotencyKeyLength) {
    return `Idempotency-Key must be at most ${PRO3D_RENDER_LIMITS.maxIdempotencyKeyLength} characters.`
  }
  return undefined
}

/**
 * Everything both endpoints refuse, in the order that keeps a refusal free.
 *
 * Returns `true` when it has answered and the caller must stop. Deliberately
 * shared: quote and run must agree about what a valid body is, or a caller
 * could be quoted for a request the run then rejects (or worse, the reverse).
 */
async function refusedBeforeDispatch(
  req: FastifyRequest,
  reply: FastifyReply,
  source: Pro3DRenderSource,
  body: { engine?: string; acceptedSceneSchemaVersions?: number[] },
  routeName: string,
): Promise<boolean> {
  // Engine availability, from the SAME capabilities document every surface
  // reads — so a menu can never contain an option the route refuses.
  const capabilities = (await scene3DCapabilities()).pro
  const engine = body.engine ?? "blender-cloud"
  if (!capabilities.engines.includes(engine as (typeof capabilities.engines)[number])) {
    unavailable(reply, `The "${engine}" engine is unavailable on this instance.`)
    return true
  }
  // A desktop export is only meaningful with a local engine available; without
  // one there is nothing that could read the export.
  if (source.kind === "local-export" && !capabilities.engines.includes("blender-local")) {
    unavailable(reply, "Local Blender execution is unavailable on this instance.")
    return true
  }

  // Unknown schema declarations are refused outright, and a source that MINTS
  // a fresh v2 manifest refuses a client that cannot read one. A `scene`
  // source is left alone on purpose: it inherits its revision's version, which
  // only the engine can resolve, so demanding v2 here would refuse a perfectly
  // renderable retained v1 scene.
  const accepted = body.acceptedSceneSchemaVersions
  if (accepted) {
    const unknown = accepted.filter((v) => !SCENE3D_SUPPORTED_SCHEMA_VERSIONS.includes(v as 1 | 2))
    if (unknown.length > 0) {
      invalid(reply, `Unknown scene schema version(s): ${unknown.join(", ")}.`)
      return true
    }
    const produced = pro3DRenderProducedSchemaVersion(source)
    if (produced !== null && !accepted.includes(produced)) {
      invalid(reply, `This source produces scene schema version ${produced}; this client did not accept it.`)
      return true
    }
  }

  // The list rules (duplicate ids, the single-video cap, an image carrying a
  // time window) live with the contract and are shared with the Basic route
  // and the orchestrator, so all three refuse the same lists identically.
  if (source.kind === "prompt") {
    const referenceError = scene3DReferenceListError((source.references ?? []) as Scene3DReference[])
    if (referenceError) {
      invalid(reply, referenceError)
      return true
    }
  }

  return refuseWithoutConfiguredPrice(req, reply, routeName)
}

export async function pro3DRenderRoutes(app: FastifyInstance) {
  const limit = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: "pro-3d-render" })
  // Quoting is cheap and a client may re-quote as the user edits controls, so
  // it gets its own, looser budget rather than eating the run allowance.
  const quoteLimit = rateLimiter({ windowMs: 60_000, max: 60, keyPrefix: "pro-3d-render-quote" })

  // Paths spelled literally: the route-parity guard reads this file as text
  // so an orchestrator path can never drift from a registered one.
  app.post("/v1/pro-3d-render/quote", { preHandler: [quoteLimit] }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (refuseDeniedScene3DNode("pro-3d-render", reply)) return
    if (!scene3DProAvailable()) return unavailable(reply)

    const parsed = pro3DRenderQuoteBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    if (await refusedBeforeDispatch(req, reply, parsed.data.source, parsed.data, PRO3D_RENDER_QUOTE_ROUTE)) return

    req.body = parsed.data
    return dispatchPro3DRenderQuote(req, reply)
  })

  app.post("/v1/pro-3d-render", { preHandler: [limit] }, async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    // Readiness first: on an install without the engine every answer other
    // than "unavailable" would be a guess about a service that isn't there.
    if (refuseDeniedScene3DNode("pro-3d-render", reply)) return
    if (!scene3DProAvailable()) return unavailable(reply)

    const keyError = idempotencyKeyError(req)
    if (keyError) return invalid(reply, keyError)

    const parsed = pro3DRenderBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    if (await refusedBeforeDispatch(req, reply, parsed.data.source, parsed.data, PRO3D_RENDER_ROUTE)) return

    req.body = parsed.data
    return dispatchPro3DRender(req, reply)
  })
}
