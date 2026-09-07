import { HeadObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { scene3DArtifactObjectKey } from "../../services/scene3d-artifacts/object-keys.js"
import { SCENE3D_ARTIFACT_CONTENT_TYPES, type Scene3DArtifactKind } from "../../services/scene3d-artifacts/types.js"
import type { Scene3DPrivateStorageConfig } from "../../services/scene3d-artifacts/object-store.js"

/**
 * The one private-build exception to public-media ACLs. Quarantined output
 * bytes are unreadable until receipt verification and revision publication.
 * R2 does not support object ACLs; the bucket itself must remain private.
 */
export function withPrivateSceneObjectParams(
  privateBucket: string,
  publicBucket: string,
  input: Omit<PutObjectCommandInput, "Bucket" | "ACL">,
): PutObjectCommandInput {
  if (!privateBucket || !publicBucket || privateBucket === publicBucket) throw new Error("Scene output requires a separate private bucket")
  if ("Bucket" in input || "ACL" in input) throw new Error("Scene output cannot override its bucket or ACL")
  return { ...input, Bucket: privateBucket }
}

export interface Scene3DUploadGrantInput {
  jobId: string
  userId: string
  revisionId: string
  artifactId: string
  kind: Scene3DArtifactKind
  expiresInSeconds?: number
}
export interface Scene3DUploadGrant {
  key: string
  upload: { method: "PUT"; url: string; headers: Record<string, string> }
  verifyUrl: string
  verifyHeaders: Record<string, string>
  expiresAt: number
}

/**
 * Only the trusted engine receives this capability; it is not a browser upload
 * route. The child process receives one exact-key grant, never S3 credentials.
 * Conditional writes prevent a surviving URL from replacing published bytes.
 */
export function createScene3DUploadGranter(
  cfg: Scene3DPrivateStorageConfig,
  publicBucket: string,
  assertActiveJob: (scope: { jobId: string; userId: string }) => Promise<void>,
  reserveUpload: (input: Scene3DUploadGrantInput & { objectKey: string; ttlSeconds: number }) => Promise<void>,
): (input: Scene3DUploadGrantInput) => Promise<Scene3DUploadGrant> {
  withPrivateSceneObjectParams(cfg.bucket, publicBucket, { Key: "configuration-check" })
  const client = new S3Client({
    region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
  })
  return async (input) => {
    const expiresIn = input.expiresInSeconds ?? 900
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 1800) throw new Error("Scene upload grant lifetime must be 60–1800 seconds")
    const key = scene3DArtifactObjectKey(input.userId, input.revisionId, input.artifactId, input.kind)
    await assertActiveJob({ jobId: input.jobId, userId: input.userId })
    // Failed or interrupted builds still leave a durable cleanup record.
    await reserveUpload({ ...input, objectKey: key, ttlSeconds: expiresIn })
    await assertActiveJob({ jobId: input.jobId, userId: input.userId })
    const contentType = SCENE3D_ARTIFACT_CONTENT_TYPES[input.kind]
    const command = new PutObjectCommand(withPrivateSceneObjectParams(cfg.bucket, publicBucket, {
      Key: key, ContentType: contentType, CacheControl: "no-store", IfNoneMatch: "*",
    }))
    const url = await getSignedUrl(client, command, { expiresIn,
      signableHeaders: new Set(["content-type", "cache-control", "if-none-match"]),
    })
    const verifyUrl = await getSignedUrl(client, new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn })
    return { key, verifyUrl, verifyHeaders: {}, expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      upload: { method: "PUT", url, headers: {
      "Content-Type": contentType, "Cache-Control": "no-store", "If-None-Match": "*",
    } } }
  }
}
