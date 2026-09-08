import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { z } from "zod"
import { authorizeScene3DArtifact } from "../../services/scene3d-artifacts/authorize.js"
import { normalizeEtag, type Scene3DPrivateStorageConfig } from "../../services/scene3d-artifacts/object-store.js"
import { Scene3DArtifactError } from "../../services/scene3d-artifacts/types.js"
import type { PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"
import { withPrivateSceneObjectParams } from "./scene3d-upload-grants.js"

type InputGranter = NonNullable<PluginSceneArtifactToolkit["grantInput"]>
const inputSchema = z.object({
  jobId: z.uuid(), userId: z.uuid(), sourceRevisionId: z.uuid(),
  asset: z.object({ assetId: z.uuid(), kind: z.literal("glb"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(64 * 1024 * 1024),
  }).strict(),
  expiresInSeconds: z.number().int().min(60).max(1800),
}).strict()

const missing = () => new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene input is unavailable")
const changed = () => new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input no longer matches its receipt")

/** A source revision grants access, never an artifact-owner shortcut or caller URL. */
export function createScene3DInputGranter(
  cfg: Scene3DPrivateStorageConfig,
  publicBucket: string,
  assertActiveJob: (scope: { jobId: string; userId: string }) => Promise<unknown>,
  authorize: typeof authorizeScene3DArtifact = authorizeScene3DArtifact,
): InputGranter {
  withPrivateSceneObjectParams(cfg.bucket, publicBucket, { Key: "configuration-check" })
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return async (raw, options) => {
    options?.signal?.throwIfAborted()
    const parsed = inputSchema.safeParse(raw)
    if (!parsed.success) throw changed()
    const input = parsed.data
    const active = async () => {
      options?.signal?.throwIfAborted()
      await assertActiveJob({ jobId: input.jobId, userId: input.userId })
      options?.signal?.throwIfAborted()
    }
    const source = async () => {
      const allowed = await authorize(input.userId, input.sourceRevisionId, input.asset.assetId, "playback")
      options?.signal?.throwIfAborted()
      if (!allowed.ok) throw missing()
      const artifact = allowed.artifact
      const expiry = artifact.expiresAt === null ? null : Date.parse(artifact.expiresAt)
      const tag = normalizeEtag(artifact.etag)
      if (allowed.revision.revisionId !== input.sourceRevisionId || artifact.artifactId !== input.asset.assetId ||
          artifact.kind !== "glb" || artifact.usage !== "playback" || artifact.bucket !== cfg.bucket ||
          artifact.sha256 !== input.asset.sha256 || artifact.byteLength !== input.asset.byteLength ||
          !tag || /[\u0000-\u0020"\u007f]/.test(tag) ||
          (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now() + input.expiresInSeconds * 1000))) {
        throw changed()
      }
      return artifact
    }
    await active()
    const artifact = await source()
    const tag = normalizeEtag(artifact.etag)!
    let current
    try {
      current = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: artifact.objectKey }),
        { abortSignal: options?.signal })
    } catch (error) {
      options?.signal?.throwIfAborted()
      const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null
      if (failure?.name === "NotFound" || failure?.name === "NoSuchKey" || failure?.$metadata?.httpStatusCode === 404) {
        throw missing()
      }
      throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Checking the scene input failed")
    }
    options?.signal?.throwIfAborted()
    if (current.ContentLength !== artifact.byteLength || normalizeEtag(current.ETag) !== tag) throw changed()
    const ifMatch = `"${tag}"`
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: artifact.objectKey,
      IfMatch: ifMatch, ResponseCacheControl: "no-store" }), {
      expiresIn: input.expiresInSeconds, signableHeaders: new Set(["if-match"]),
    })
    // A revocation or cancellation while storage/signing was awaited must not release a URL.
    await active()
    const confirmed = await source()
    if (confirmed.objectKey !== artifact.objectKey || normalizeEtag(confirmed.etag) !== tag) throw changed()
    return { ...input.asset, fetch: { method: "GET", url, headers: { "If-Match": ifMatch } } }
  }
}
