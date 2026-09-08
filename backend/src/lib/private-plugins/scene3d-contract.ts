import type { FastifyReply, FastifyRequest } from "fastify"

/** Optional, additive engine boundary. Public requests stay on the host API. */
export interface PluginScene3DEngine {
  capabilities(): Promise<PluginScene3DCapabilities>
  generate(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
  edit(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
  /**
   * `POST /v1/pro-3d-render` — ONE durable operation that authors a scene and
   * exports it, settling with `{ scenePlan, videoUrl }`.
   *
   * OPTIONAL, and its absence is the readiness signal for the whole public
   * surface: the host hides the node from discovery and the picker, and
   * refuses the route with 503, whenever this member is missing. That makes
   * "not ready yet" a structural fact about the installed engine rather than a
   * flag someone has to remember to leave off — an engine build that predates
   * the operation cannot be talked into serving it.
   *
   * The implementation owns everything the host deliberately does not know:
   * admission, ownership/access, quoting, the single parent reservation, the
   * durable stages and settlement. The host contributes the wire shape, the
   * refusals it can make without spending anything, and nothing else.
   */
  proRender?(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
  /**
   * `POST /v1/pro-3d-render/quote` — price the SAME body without a `quoteId`.
   *
   * Answers `{quoteId, expiresAt, maxCredits, breakdown, pricingVersion,
   * capabilitiesVersion, normalizedInputHash}`. It resolves source metadata
   * (which the host cannot: it does not read revisions, exports or pairings),
   * and it MUST NOT reserve or spend anything — a quote is a ceiling, not a
   * charge.
   *
   * Paired with `proRender` deliberately: an engine that can run but cannot
   * quote would leave the run route demanding a `quoteId` nothing can mint, so
   * readiness requires BOTH and the surface stays hidden until both exist.
   */
  quoteProRender?(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
}

export interface PluginScene3DCapabilities {
  version: string
  engines: Array<"blender-cloud" | "blender-local">
  sceneSchemaVersions: number[]
  maxRepairPasses: number
  /**
   * What the installed engine will accept for the Pro operation.
   *
   * OPTIONAL and additive: an engine that does not declare it gets the
   * contract's conservative defaults. It exists so a surface advertises only
   * profiles/ratios this build can actually serve — offering a quality profile
   * the engine rejects is a run that fails after the user chose it.
   */
  pro?: {
    engines?: Array<"blender-cloud" | "blender-local">
    qualityProfiles?: string[]
    styles?: string[]
    aspectRatios?: string[]
    maxRepairPasses?: number
  }
}

/** The scope is checked against the parent job before every journal access. */
export interface PluginStageKey {
  jobId: string
  userId: string
  attemptIndex: number
  stage: string
  inputHash: string
  engineVersion: string
}

export interface PluginStageLease {
  token: string
  fence: number
  expiresAt: number
}

export type PluginStageClaim =
  | { status: "claimed"; lease: PluginStageLease; checkpoint: Record<string, unknown> | null }
  | { status: "busy"; expiresAt: number }
  | { status: "completed"; output: Record<string, unknown> }

/** Private durable stage metadata, never placed in user-readable job output. */
export interface PluginStageToolkit {
  claim(key: PluginStageKey, leaseMs: number): Promise<PluginStageClaim>
  renew(key: PluginStageKey, lease: PluginStageLease, leaseMs: number): Promise<PluginStageLease | null>
  checkpoint(key: PluginStageKey, lease: PluginStageLease, checkpoint: Record<string, unknown>): Promise<boolean>
  complete(key: PluginStageKey, lease: PluginStageLease, output: Record<string, unknown>): Promise<boolean>
  release(key: PluginStageKey, lease: PluginStageLease): Promise<boolean>
}
