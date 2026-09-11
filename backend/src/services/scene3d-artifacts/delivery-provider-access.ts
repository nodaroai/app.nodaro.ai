/**
 * Handing a delivery artifact to an EXTERNAL provider.
 *
 * A 3D Render Pro delivery keeps its bytes in the private scene bucket by
 * contract, so a shot still's `url` is the authenticated
 * `GET /v1/3d-scene/deliveries/{jobId}/assets/{assetId}`. That works for every
 * caller who has credentials — the canvas, the SDK, an agent — and fails for
 * the one caller that has none: a third-party image or video model that fetches
 * `referenceImageUrls` server-to-server and gets a 401. Wiring the `stills`
 * handle into a downstream node's image input was therefore reachable in the
 * editor and broken at the provider.
 *
 * The fix is a SIGNED, BOUNDED GET — the shape `grantInput` already uses to
 * hand a GLB to the trusted engine — and deliberately NOT a re-host onto the
 * public media host: a re-host is permanent and public, and these bytes are
 * private by contract.
 *
 * THREE PROPERTIES MAKE THAT SAFE:
 *
 *  1. **Authorization is asked at MINT time, with the job owner's identity**,
 *     through `authorizeScene3DDeliveryArtifact` — the SAME check the
 *     authenticated route runs, so another user's `jobId` yields no URL and a
 *     revoked membership yields no URL. Nothing here re-implements access.
 *  2. **The grant is bounded** (`SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS`)
 *     and `no-store`, so the capability is gone shortly after the fetch it
 *     exists for.
 *  3. **The signed URL never becomes durable state.** It is produced at
 *     provider-dispatch time and lives only in the in-memory job data of the
 *     run that is about to fetch it; `jobs.input_data` keeps the authenticated
 *     URL, which is the one that is still meaningful tomorrow.
 *
 * This is the documented exception to the "bytes are proxied, never signed"
 * rule in `routes/scene3d-artifacts.ts`. It differs from that rule's reason —
 * "a signed URL outlives the check that minted it" — only in degree: the window
 * is minutes and is opened once, per run, for one artifact the owner already
 * had access to.
 *
 * One deliberate divergence from `grantInput`: NO `If-Match`. That grant binds
 * its URL to an etag because the trusted engine can send the header; an
 * external provider sends nothing but a bare GET, and an `If-Match` it cannot
 * send would 412 every fetch.
 */
import { S3Client } from "@aws-sdk/client-s3"
import { config } from "../../lib/config.js"
import { authorizeScene3DDeliveryArtifact } from "./delivery-authorize.js"
import { isScene3DId } from "./object-keys.js"
import { resolveScene3DPrivateStorageConfig, signScene3DPrivateObjectGet, type Scene3DPrivateStorageConfig } from "./object-store.js"

/**
 * How long a provider-bound grant lives.
 *
 * 15 minutes. The grant is minted at worker pickup, immediately before the
 * provider call, so the window has to cover: the provider accepting the request,
 * its own server-side fetch of each reference, and the retries it makes when
 * that fetch fails transiently. Minutes, not hours — and comfortably inside the
 * 30-minute ceiling `grantInput`'s own schema imposes on the same shape.
 *
 * A provider that fetched a reference for the first time more than 15 minutes
 * after accepting the job would see a 403 and the run would fail with a
 * fetch error rather than silently producing a wrong result.
 */
export const SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS = 900

/** `/v1/3d-scene/deliveries/{jobId}/assets/{assetId}` — and nothing else. */
const DELIVERY_ASSET_PATH = /^\/v1\/3d-scene\/deliveries\/([^/]+)\/assets\/([^/]+)$/

/**
 * The delivery artifact a URL names, or `null` when it names something else.
 *
 * STRICT on purpose. A prefix test on `/v1/3d-scene/` (which is what the
 * browser-side helper does, for a different job — deciding whether to fetch
 * with credentials) would also match revision assets, which are a different
 * lane with a different authorizer. Both ids must be UUIDs, because that is
 * what the route's own params accept and what `authorizeScene3DDeliveryArtifact`
 * requires; anything else is not a URL this function can speak for.
 *
 * Host-agnostic: the same delivery is `next.nodaro.ai` on staging, the install's
 * own origin in a self-host and a bare path in a same-origin write, and all
 * three name the same artifact.
 */
export function parseScene3DDeliveryAssetUrl(
  url: unknown,
): { jobId: string; assetId: string } | null {
  if (typeof url !== "string" || !url) return null
  let pathname: string
  try {
    // A relative URL is resolved against a placeholder purely to read its path.
    pathname = new URL(url, "https://placeholder.invalid").pathname
  } catch {
    return null
  }
  const match = DELIVERY_ASSET_PATH.exec(pathname)
  if (!match) return null
  const [, jobId, assetId] = match
  if (!isScene3DId(jobId) || !isScene3DId(assetId)) return null
  return { jobId: jobId.toLowerCase(), assetId: assetId.toLowerCase() }
}

export type Scene3DDeliveryAssetSigner = (input: {
  actorId: string
  jobId: string
  assetId: string
}) => Promise<string | null>

/**
 * A signer over one private-storage configuration.
 *
 * Answers `null` — never throws — when the artifact is not readable by this
 * actor, or when it is not in the configured private bucket. A refusal must
 * leave the caller's URL exactly as it was: the authenticated URL is what the
 * owner sees everywhere else, and replacing it with nothing would turn "you
 * cannot read that" into "this field is missing".
 */
export function createScene3DDeliveryAssetSigner(
  cfg: Scene3DPrivateStorageConfig,
  authorize: typeof authorizeScene3DDeliveryArtifact = authorizeScene3DDeliveryArtifact,
  ttlSeconds: number = SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS,
): Scene3DDeliveryAssetSigner {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return async ({ actorId, jobId, assetId }) => {
    const auth = await authorize(actorId, jobId, assetId)
    if (!auth.ok) return null
    const artifact = auth.artifact
    // A pin that lives somewhere else is not something this bucket's key can
    // sign for, and signing against the wrong bucket would produce a URL that
    // 404s rather than an honest refusal.
    if (artifact.bucket !== cfg.bucket) return null
    // GET-only, and not by convention: the presigner lives in exactly one
    // function (`signScene3DPrivateObjectGet`), which cannot express a PUT. No
    // `ifMatch` — a provider sends a bare GET and a header it cannot send would
    // 412 every fetch (the one divergence from `grantInput`, see the header).
    return signScene3DPrivateObjectGet(client, cfg.bucket, {
      objectKey: artifact.objectKey,
      expiresInSeconds: ttlSeconds,
    })
  }
}

let cached: Scene3DDeliveryAssetSigner | null | undefined

/** The deployment's signer, or `null` where no private bucket is configured
 *  (community and every self-host without Scene3D storage). */
export function scene3DDeliveryAssetSigner(): Scene3DDeliveryAssetSigner | null {
  if (cached !== undefined) return cached
  let cfg: Scene3DPrivateStorageConfig | null = null
  try {
    cfg = resolveScene3DPrivateStorageConfig(process.env, config.R2_BUCKET_NAME)
  } catch {
    // A misconfigured private bucket already fails loudly wherever Scene3D is
    // actually used. It must not take down an unrelated generation here.
    cfg = null
  }
  cached = cfg ? createScene3DDeliveryAssetSigner(cfg) : null
  return cached
}

/** Test seam — the module-level signer is resolved once per process. */
export function _resetScene3DDeliveryAssetSigner(): void {
  cached = undefined
}

/**
 * Replace every delivery-asset URL in a job payload with a signed, bounded one.
 *
 * DATA-DRIVEN, not a field list: every top-level string and every string in a
 * top-level string array is offered to the recogniser, and only an exact
 * delivery-asset URL is rewritten. A hardcoded list of fields
 * (`referenceImageUrls`, `imageUrl`, …) is the drift this codebase keeps paying
 * for — the point of the `stills` handle is that a still can be wired into ANY
 * image input, and a new input field must be covered without an edit here.
 *
 * Returns the SAME object when nothing matched, so a payload with no delivery
 * URL — which is almost every payload — is byte-identical and costs one shallow
 * walk. Never throws: a storage or authorization failure leaves the URL as it
 * was, which is exactly the behaviour before this existed.
 */
export async function signScene3DDeliveryUrlsForProvider<T extends Record<string, unknown>>(
  payload: T,
  actorId: string | undefined,
  signer: Scene3DDeliveryAssetSigner | null = scene3DDeliveryAssetSigner(),
): Promise<T> {
  if (!actorId || !signer) return payload
  // One grant per artifact, however many fields carry it.
  const resolved = new Map<string, string | null>()
  const sign = async (url: string): Promise<string | null> => {
    const asset = parseScene3DDeliveryAssetUrl(url)
    if (!asset) return null
    const key = `${asset.jobId}/${asset.assetId}`
    if (resolved.has(key)) return resolved.get(key) ?? null
    let signed: string | null = null
    try {
      signed = await signer({ actorId, jobId: asset.jobId, assetId: asset.assetId })
    } catch {
      signed = null
    }
    resolved.set(key, signed)
    return signed
  }

  let next: Record<string, unknown> | undefined
  const put = (key: string, value: unknown) => {
    next ??= { ...payload }
    next[key] = value
  }
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      const signed = await sign(value)
      if (signed) put(key, signed)
      continue
    }
    if (!Array.isArray(value) || !value.some((entry) => typeof entry === "string")) continue
    let changed = false
    const list = [...value]
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i] !== "string") continue
      const signed = await sign(list[i] as string)
      if (signed) {
        list[i] = signed
        changed = true
      }
    }
    if (changed) put(key, list)
  }
  return (next as T) ?? payload
}
