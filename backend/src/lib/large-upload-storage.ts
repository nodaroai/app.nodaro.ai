// @reads-none talks only to object storage; reads no repo file
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { config } from "./config.js"
import { s3, storageClientOptions, withObjectAcl } from "./storage.js"
import { boundedStorageClientConfig } from "./storage-timeouts.js"
import { hasUploadPolicies } from "./upload-policy.js"

/**
 * The large-upload lane's storage side (decided 2026-11-17): a browser sends a
 * long video or audio file straight to object storage in parts, through
 * presigned UploadPart URLs, so the file never passes through (or is buffered
 * by) this server and any size works. `routes/large-upload.ts` is its only
 * caller.
 *
 * THE UPLOAD-POLICY RULE. A deployment's upload policy (`lib/upload-policy.ts`)
 * reads the bytes of every upload before it is stored. On this lane the bytes
 * never reach us, so no policy could see them: while ANY policy is registered
 * the lane is closed. Every function here that mints a capability or finishes
 * an object asks {@link assertLargeUploadLaneOpen} first, so the refusal lives
 * in the module that holds the signer, not only in the route — the presigner
 * scan in `lib/__tests__/upload-policy.test.ts` allows this file on that proof.
 * A refused client falls back to `POST /v1/upload`, whose bytes the policy sees.
 */

/** How long a part's presigned PUT stays valid: a few hours, so a slow link can send a big file. */
export const LARGE_UPLOAD_PART_URL_TTL_SEC = 6 * 60 * 60

/** How long the presigned GET the server probes the finished object with stays valid. */
const READ_URL_TTL_SEC = 15 * 60

/** The smallest part (16 MiB): well over the store's 5 MiB minimum. */
export const LARGE_UPLOAD_MIN_PART_BYTES = 16 * 1024 * 1024

/** At most this many parts (the store allows 10,000; the margin keeps rounding honest). */
export const LARGE_UPLOAD_MAX_PARTS = 9_000

/**
 * The part size for a file of `sizeBytes`: max(16 MiB, ceil(size / 9,000)).
 * Every part but the last has exactly this size — Cloudflare R2 requires equal
 * parts, so the browser must cut at this size.
 */
export function largeUploadPartSize(sizeBytes: number): number {
  return Math.max(LARGE_UPLOAD_MIN_PART_BYTES, Math.ceil(sizeBytes / LARGE_UPLOAD_MAX_PARTS))
}

/** How many parts a file of `sizeBytes` is sent in at `partSize`. */
export function largeUploadPartCount(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize))
}

/** The lane is closed on this deployment (an upload policy is registered). */
export class LargeUploadUnavailableError extends Error {
  readonly code = "large_upload_unavailable"
  constructor() {
    super("Large uploads are not available on this deployment. Upload the file with POST /v1/upload instead.")
    this.name = "LargeUploadUnavailableError"
  }
}

/** Refuse when any upload policy is registered: its check could never see this lane's bytes. */
export function assertLargeUploadLaneOpen(): void {
  if (hasUploadPolicies()) throw new LargeUploadUnavailableError()
}

let signer: S3Client | undefined

/**
 * The client presigned URLs are made with: the storage client's own options,
 * but with checksums only where the store requires them — otherwise the SDK
 * signs a checksum into each part's URL that a browser's plain PUT cannot send.
 */
function signingClient(): S3Client {
  signer ??= new S3Client({ ...storageClientOptions(), ...boundedStorageClientConfig(), requestChecksumCalculation: "WHEN_REQUIRED" })
  return signer
}

/** Open a multipart upload for `key`; answers its upload id. */
export async function createLargeUpload(key: string, mimeType: string): Promise<string> {
  assertLargeUploadLaneOpen()
  const res = await s3.send(
    new CreateMultipartUploadCommand(withObjectAcl({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    })),
  )
  if (!res.UploadId) throw new Error("Storage opened no multipart upload")
  return res.UploadId
}

/** The exact byte length of part `partNumber` (1-based): `partSize`, the last part the remainder. */
export function largeUploadPartLength(sizeBytes: number, partSize: number, partNumber: number): number {
  return Math.min(partSize, sizeBytes - (partNumber - 1) * partSize)
}

/**
 * One presigned UploadPart PUT URL per part, part 1 first. Each URL has its
 * part's exact length signed in (`content-length` among its signed headers),
 * so storage itself refuses a part of any other size — a client cannot send
 * more than it declared. A browser sets Content-Length from the body itself,
 * so a PUT of exactly that slice matches the signature; no other header is
 * signed but `host`.
 */
export async function presignLargeUploadParts(key: string, uploadId: string, sizeBytes: number, partSize: number): Promise<string[]> {
  assertLargeUploadLaneOpen()
  const client = signingClient()
  const numbers = Array.from({ length: largeUploadPartCount(sizeBytes, partSize) }, (_, i) => i + 1)
  return Promise.all(
    numbers.map((PartNumber) =>
      getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: config.R2_BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          PartNumber,
          ContentLength: largeUploadPartLength(sizeBytes, partSize, PartNumber),
        }),
        { expiresIn: LARGE_UPLOAD_PART_URL_TTL_SEC, signableHeaders: new Set(["content-length"]) },
      ),
    ),
  )
}

export interface UploadedPart {
  readonly partNumber: number
  readonly etag: string
  readonly sizeBytes: number
}

/** Every part the store holds for the upload, in part order (follows the listing's pages). */
export async function listLargeUploadParts(key: string, uploadId: string): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = []
  let marker: string | undefined
  for (;;) {
    const res = await s3.send(
      new ListPartsCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        ...(marker ? { PartNumberMarker: marker } : {}),
      }),
    )
    for (const p of res.Parts ?? []) {
      if (p.PartNumber !== undefined && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, sizeBytes: p.Size ?? 0 })
    }
    if (!res.IsTruncated || !res.NextPartNumberMarker) break
    marker = res.NextPartNumberMarker
  }
  return [...parts].sort((a, b) => a.partNumber - b.partNumber)
}

/** Join the parts into the object. The ETags come from the store's own listing, never the browser. */
export async function completeLargeUpload(key: string, uploadId: string, parts: readonly UploadedPart[]): Promise<void> {
  assertLargeUploadLaneOpen()
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  )
}

/** The finished object's byte size, as the store reports it. */
export async function largeUploadObjectSize(key: string): Promise<number | undefined> {
  const res = await s3.send(new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }))
  return res.ContentLength
}

/** A short-lived presigned GET of the finished object, for the server's own probe and thumbnail. */
export async function presignLargeUploadRead(key: string): Promise<string> {
  return getSignedUrl(signingClient(), new GetObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }), {
    expiresIn: READ_URL_TTL_SEC,
  })
}

/**
 * Abort the upload: the store drops the parts it holds. Not a delete of any
 * object — the upload is one this deployment opened and no object exists yet —
 * so it does not ask the STORAGE_DELETES setting.
 */
export async function abortLargeUpload(key: string, uploadId: string): Promise<void> {
  await s3.send(new AbortMultipartUploadCommand({ Bucket: config.R2_BUCKET_NAME, Key: key, UploadId: uploadId }))
}
