import { SCENE3D_V2_LIMITS, type Scene3DAssetRef } from "@nodaro/shared/scene3d"
import type { NodaroClientCore } from "../core.js"
import type { RunNodeResult, RunAndWaitOptions, NodeJobOutput, NodesResource } from "./nodes.js"
import type { EditScene3DParams, GenerateScene3DParams, Pro3DRenderJobOutput, Pro3DRenderParams, Pro3DRenderQuote, Pro3DRenderRunOptions, Pro3DRenderRunParams, RenderScene3DParams, Scene3DCapabilities, Scene3DJobOutput } from "./scene3d-types.js"
import type { RetainedScene3DEditParams, RetainedScene3DEditResult } from "./scene3d-types.js"
import { SCENE3D_DELIVERY_ASSET_USAGE } from "./scene3d-types.js"
import type { Scene3DDelivery, Scene3DDeliveryAsset } from "./scene3d-types.js"

/**
 * A fresh per-call retry token.
 *
 * Random rather than derived from the request: two deliberate calls with the
 * same parameters are two runs, and collapsing them would silently swallow the
 * second. A caller who wants retry safety passes its own key.
 */
function newIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return `sdk-pro3d-${random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`
}

/** Scene authoring and render-only export through the same platform nodes. */
export class Scene3DResource {
  /** Every operation runs a platform node, so the client must carry `nodes` too. */
  constructor(private client: NodaroClientCore & { readonly nodes: NodesResource }) {}

  capabilities(): Promise<Scene3DCapabilities> {
    return this.client.request("GET", "/v1/3d-scene/capabilities")
  }

  /** Current access to both the delivery and its source is required on every read. */
  getDelivery(jobId: string): Promise<Scene3DDelivery> {
    return this.client.request("GET", `/v1/3d-scene/deliveries/${encodeURIComponent(jobId)}`)
  }

  /**
   * The bytes of one descriptor the delivery listed.
   *
   * Checked against {@link SCENE3D_DELIVERY_ASSET_USAGE} rather than a hardcoded pair, which
   * is why a `shot-still` now works: the route has served stills since they existed, and this
   * guard refused them. `source-json` — the recipe a refused run was kept for — is on the same
   * map; the server still decides whether THIS caller may read it.
   */
  deliveryAssetBytes(jobId: string, asset: Scene3DDeliveryAsset, options?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    if (SCENE3D_DELIVERY_ASSET_USAGE[asset.kind] !== asset.usage) {
      throw new Error("This asset is not available through the delivery endpoint")
    }
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
      throw new Error("Invalid scene delivery asset byte length")
    }
    return this.client.requestBytes("GET", `/v1/3d-scene/deliveries/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(asset.assetId)}`, {
      signal: options?.signal, maxBytes: asset.byteLength,
    })
  }

  /**
   * The recipe a 3D Render Pro run was refused for, parsed — or `null` when there is none.
   *
   * The one thing such a run leaves behind. Its recipe never compiled, so there is no scene
   * revision, no poster and no `.blend`: `output_data` carries a `deliveryId`, the compiler's
   * reasons, and `validation.sourceRetained` saying whether the recipe itself was kept. This
   * fetches it in one call — delivery, then the `source-json` descriptor's bytes.
   *
   * `null` means the delivery has no retained recipe to hand back: no pass ever cleared
   * admission, or this caller holds less than `edit` on the job's workflow and the descriptor
   * is therefore not listed for them.
   *
   * Read it to see what was attempted and to inform the next prompt. There is no input that
   * takes a recipe back: a refused run published no revision, so there is no `{kind:"scene"}`
   * source to re-run it from.
   */
  async retainedRecipe(jobId: string, options?: { signal?: AbortSignal }): Promise<unknown | null> {
    const delivery = await this.getDelivery(jobId)
    const asset = delivery.assets.find((item) => item.kind === "source-json")
    if (!asset) return null
    const bytes = await this.deliveryAssetBytes(jobId, asset, options)
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  }

  /** Persist deterministic overlays without an LLM or a generation charge. */
  applyEdits(revisionId: string, params: RetainedScene3DEditParams): Promise<RetainedScene3DEditResult> {
    return this.client.request("POST", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/edits`, { body: params })
  }

  /** Asset access is scoped to an exact retained revision, with fresh authentication. */
  assetBytes(revisionId: string, asset: Scene3DAssetRef, options?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    if (!["glb", "camera-track-json", "poster", "validation-report"].includes(asset.kind)) {
      throw new Error("This asset is not available through the playback endpoint")
    }
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > SCENE3D_V2_LIMITS.maxRendererAssetBytes) {
      throw new Error("Invalid scene asset byte length")
    }
    return this.client.requestBytes("GET", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/assets/${encodeURIComponent(asset.assetId)}`, {
      signal: options?.signal, maxBytes: asset.byteLength,
    })
  }

  /** The editable native file has its own authorization lane. */
  sourceBytes(revisionId: string, options?: { signal?: AbortSignal }): Promise<ArrayBuffer> {
    return this.client.requestBytes("GET", `/v1/3d-scene/revisions/${encodeURIComponent(revisionId)}/source`, {
      signal: options?.signal, maxBytes: SCENE3D_V2_LIMITS.maxBlendSourceBytes,
    })
  }

  generate(params: GenerateScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("generate-3d-scene", params)
  }

  generateAndWait(params: GenerateScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput> {
    return this.client.nodes.runAndWait("generate-3d-scene", params, options)
  }

  edit(params: EditScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("edit-3d-scene", params)
  }

  editAndWait(params: EditScene3DParams, options?: RunAndWaitOptions): Promise<Scene3DJobOutput> {
    return this.client.nodes.runAndWait("edit-3d-scene", params, options)
  }

  /**
   * Price a 3D Render Pro request WITHOUT starting it.
   *
   * Takes the same body a run takes, minus the `quoteId`, and answers a
   * ceiling (`maxCredits`), a `breakdown` to show, and the
   * `normalizedInputHash` admission re-checks. It reserves nothing and spends
   * nothing — a quote is a price, not a purchase.
   */
  quotePro(params: Pro3DRenderParams): Promise<Pro3DRenderQuote> {
    return this.client.request("POST", "/v1/pro-3d-render/quote", { body: params })
  }

  /**
   * Submit a quoted 3D Render Pro run.
   *
   * Requires the `quoteId` from {@link quotePro}: no run starts at a price
   * nobody showed. Sends an `Idempotency-Key` — a fresh one per call unless you
   * supply your own, which you should when retrying a call that timed out.
   *
   * Availability is a property of the deployment: `capabilities().pro` says
   * whether this install can serve it, and which controls you may offer.
   */
  runPro(params: Pro3DRenderRunParams, options?: Pro3DRenderRunOptions): Promise<RunNodeResult> {
    return this.client.nodes.run("pro-3d-render", params, {
      idempotencyKey: options?.idempotencyKey ?? newIdempotencyKey(),
    })
  }

  /**
   * Quote if needed, run, and wait — the whole operation in one call.
   *
   * Two HTTP requests at most, still ONE paid job: when `quoteId` is absent
   * this quotes the identical body first, so the run is admitted against a
   * hash of exactly what was priced. Pass a `quoteId` to run against a quote
   * you already showed the user.
   *
   * Resolves with the settled result — `videoUrl` (the MP4) and `scenePlan`
   * (the exact composition it was rendered from), plus the revision, poster,
   * validation and renderer metadata. A run that AUTHORED also reports its own
   * account of the answer — `metadata.summary`, `repairPasses`,
   * `admissionRetries`, `mechanicalPasses` (repairs the engine applied from
   * the compiler's own remedy with no planner call, counted APART from
   * `repairPasses` on their own quoted allowance), `restoredAssertions`, and
   * any `SCENE_AUTHORING_ASSUMPTION` warnings. A
   * completed result whose `metadata.review` is present passed every mandatory
   * assertion but did NOT get the visual reviewer's approval: `verdict:
   * "refused"` means it objected, each objection also a `SCENE_REVIEW_REFUSED`
   * warning; `verdict: "unavailable"` means the review produced no usable
   * verdict in `attempts` asks (`reason: "provider"` — never reached its
   * provider; `"unusable"` — it answered, unusably), so nobody judged the scene and
   * `SCENE_REVIEW_UNAVAILABLE` leads the warnings. Re-render that same
   * `scenePlan` later with {@link render}, or with a `{kind:'scene'}` source;
   * that costs no authoring.
   */
  async renderProAndWait(
    params: Pro3DRenderParams | Pro3DRenderRunParams,
    options?: RunAndWaitOptions & Pro3DRenderRunOptions,
  ): Promise<Pro3DRenderJobOutput> {
    const quoteId =
      typeof (params as Pro3DRenderRunParams).quoteId === "string"
        ? (params as Pro3DRenderRunParams).quoteId
        : (await this.quotePro(params)).quoteId
    return this.client.nodes.runAndWait("pro-3d-render", { ...params, quoteId }, {
      ...options,
      idempotencyKey: options?.idempotencyKey ?? newIdempotencyKey(),
    })
  }

  /**
   * Uses the supplied immutable revision; never starts authoring or a rebuild.
   *
   * Priced by the plan's frame size — see {@link RenderScene3DParams}.
   */
  render(params: RenderScene3DParams): Promise<RunNodeResult> {
    return this.client.nodes.run("render-video", params)
  }

  renderAndWait(params: RenderScene3DParams, options?: RunAndWaitOptions): Promise<NodeJobOutput> {
    return this.client.nodes.runAndWait("render-video", params, options)
  }
}
