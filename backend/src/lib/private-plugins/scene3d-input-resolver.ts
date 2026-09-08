import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { z } from "zod"
import { normalizeEtag, type Scene3DPrivateStorageConfig } from "../../services/scene3d-artifacts/object-store.js"
import { Scene3DArtifactError } from "../../services/scene3d-artifacts/types.js"
import type { PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"
import { authorizeScene3DInputArtifact } from "./scene3d-input-authority.js"
import { withPrivateSceneObjectParams } from "./scene3d-upload-grants.js"

const selector = z.object({ userId: z.uuid(), revisionId: z.uuid(), assetId: z.uuid() }).strict()
const missing = () => new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene input is unavailable")
const invalid = () => new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input has no valid immutable receipt")

/** Resolve selectors before a job exists. No caller receipts, URLs or credit reservation. */
export function createScene3DInputResolver(
  cfg: Scene3DPrivateStorageConfig,
  publicBucket: string,
  authorize: typeof authorizeScene3DInputArtifact = authorizeScene3DInputArtifact,
): NonNullable<PluginSceneArtifactToolkit["resolveInput"]> {
  withPrivateSceneObjectParams(cfg.bucket, publicBucket, { Key: "configuration-check" })
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  return async (raw, options) => {
    options?.signal?.throwIfAborted()
    const parsed = selector.safeParse(raw)
    if (!parsed.success) throw invalid()
    const input = parsed.data
    const receipt = async () => {
      const allowed = await authorize(input.userId, input.revisionId, input.assetId)
      options?.signal?.throwIfAborted()
      if (!allowed.ok) throw missing()
      const artifact = allowed.artifact
      const tag = normalizeEtag(artifact.etag)
      const expiry = artifact.expiresAt === null ? null : Date.parse(artifact.expiresAt)
      if (allowed.revision.revisionId !== input.revisionId || artifact.artifactId !== input.assetId ||
          artifact.userId !== allowed.revision.userId || artifact.bucket !== cfg.bucket ||
          !((artifact.kind === "glb" && artifact.usage === "playback") ||
            (artifact.kind === "input-glb" && artifact.usage === "checkpoint")) ||
          !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.byteLength) ||
          artifact.byteLength < 12 || artifact.byteLength > 64 * 1024 * 1024 ||
          !tag || /[\u0000-\u0020"\u007f]/.test(tag) ||
          (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now() + 1800 * 1000))) {
        throw invalid()
      }
      return artifact
    }
    const before = await receipt()
    const timeout = AbortSignal.timeout(15_000)
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let object
    try {
      object = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: before.objectKey }),
        { abortSignal: signal })
    } catch (error) {
      options?.signal?.throwIfAborted()
      const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null
      if (failure?.name === "NotFound" || failure?.name === "NoSuchKey" || failure?.$metadata?.httpStatusCode === 404) {
        throw missing()
      }
      throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Checking the scene input failed")
    }
    options?.signal?.throwIfAborted()
    if (object.ContentLength !== before.byteLength || normalizeEtag(object.ETag) !== normalizeEtag(before.etag)) {
      throw invalid()
    }
    // Revocation or replacement during storage IO must invalidate the quote input.
    const after = await receipt()
    if (after.objectKey !== before.objectKey || after.sha256 !== before.sha256 ||
        after.byteLength !== before.byteLength || normalizeEtag(after.etag) !== normalizeEtag(before.etag)) {
      throw invalid()
    }
    return { assetId: input.assetId, sourceRevisionId: input.revisionId,
      kind: "glb", sha256: before.sha256, byteLength: before.byteLength }
  }
}
