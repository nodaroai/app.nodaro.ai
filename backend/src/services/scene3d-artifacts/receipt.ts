import { createHash } from "node:crypto"
import { Scene3DArtifactError, type Scene3DArtifactKind } from "./types.js"
import type { Scene3DObjectStore } from "./object-store.js"

/**
 * Verify bytes at receipt, before any metadata exists.
 *
 * The builder writes to a key we chose with credentials we did not issue, so
 * "the builder told us the digest" is not evidence of anything. This module is
 * where the claim becomes a fact: we read the object back, hash it ourselves,
 * count it ourselves, and look at its first bytes to see whether it is the
 * kind of file it claims to be. Only then may a row exist.
 *
 * Ordering matters as much as the checks. A digest recorded first and verified
 * later is a manifest that is valid-looking for the length of the window, and
 * every consumer downstream trusts the manifest.
 *
 * Everything here is bounded. The declared length is a CEILING enforced against
 * the actual stream, so a producer that declares 1 KiB and serves 4 GiB gets
 * its pipe destroyed at 1 KiB + 1 rather than getting the API's heap.
 */

/** Buffer at most this much for the kinds we must parse. Matches the camera
 *  track's own 8 MiB decoded ceiling in `@nodaro/shared`. */
export const SCENE3D_JSON_RECEIPT_MAX_BYTES = 8 * 1024 * 1024

/** The largest object the schema will hold a row for. */
export const SCENE3D_MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024

/** Enough for every magic number below (GLB needs 12). */
const HEAD_BYTES = 16

const JSON_KINDS: readonly Scene3DArtifactKind[] = [
  "camera-track-json",
  "validation-report",
  "source-json",
]

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b])
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const BLENDER_MAGIC = Buffer.from("BLENDER", "ascii")

export interface Scene3DReceiptExpectation {
  kind: Scene3DArtifactKind
  sha256: string
  byteLength: number
}

export interface Scene3DReceipt {
  /** Normalized ETag, or `sha256:<digest>` when the store reports none. */
  etag: string
  /** The decoded body, for the kinds this module had to buffer anyway. The
   *  TEXT and not the parsed value: `@nodaro/shared`'s parsers take the text
   *  so the size gate applies to what was actually transferred. */
  text?: string
}

/** A tag we made up because the store gave us none. `read.ts` knows not to
 *  compare against it — a synthetic tag would "match" forever and read as a
 *  check that is not happening. */
export function isSyntheticEtag(etag: string): boolean {
  return etag.startsWith("sha256:")
}

function fail(message: string, detail?: string): never {
  throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message, detail)
}

/**
 * Magic-number check per kind.
 *
 * Not security theatre and not a content sniffer: it is the cheapest way to
 * catch a producer that wrote the wrong file to the right key, and it is what
 * lets `SCENE3D_ARTIFACT_CONTENT_TYPES` be a pure function of `kind` — a
 * poster is served as `image/png` because a poster that is not a PNG never
 * became an artifact.
 */
export function assertScene3DArtifactMagic(
  kind: Scene3DArtifactKind,
  head: Buffer,
  byteLength: number,
): void {
  if (kind === "glb") {
    if (head.length < 12 || head.readUInt32LE(0) !== 0x46546c67) {
      fail("artifact is not a binary glTF (GLB) file")
    }
    const version = head.readUInt32LE(4)
    if (version !== 2) fail(`GLB container version ${version} is not supported (expected 2)`)
    const declared = head.readUInt32LE(8)
    if (declared !== byteLength) {
      fail(`GLB header declares ${declared} bytes but the object is ${byteLength}`)
    }
    return
  }
  if (kind === "poster") {
    if (!head.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) fail("poster is not a PNG image")
    return
  }
  if (kind === "blend-source") {
    // Blender writes uncompressed ("BLENDER…"), gzip (legacy) or zstd (3.0+).
    const ok =
      head.subarray(0, BLENDER_MAGIC.length).equals(BLENDER_MAGIC) ||
      head.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC) ||
      head.subarray(0, ZSTD_MAGIC.length).equals(ZSTD_MAGIC)
    if (!ok) fail("source artifact is not a Blender project file")
  }
  // JSON kinds are proved by parsing, which the caller already did.
}

/**
 * Read the object once: hash it, count it, keep its head, and keep the whole
 * body only for the kinds that must be parsed.
 *
 * `limit` is a hard ceiling enforced against the actual stream, so a producer
 * that declares 1 KiB and serves 4 GiB gets its pipe destroyed rather than the
 * API's heap.
 */
async function consume(
  store: Scene3DObjectStore,
  objectKey: string,
  options: { limit: number; expectedLength: number | null; keepBody: boolean },
): Promise<{ sha256: string; byteLength: number; head: Buffer; body: Buffer | null; etag: string | null }> {
  let read
  try {
    read = await store.get(objectKey)
  } catch (error) {
    throw new Scene3DArtifactError(
      "SCENE_ASSET_MISSING",
      "the uploaded artifact could not be read back from private storage",
      error instanceof Error ? error.message : undefined,
    )
  }

  if (
    read.contentLength !== null &&
    options.expectedLength !== null &&
    read.contentLength !== options.expectedLength
  ) {
    read.body.destroy()
    fail(
      `artifact declares ${options.expectedLength} bytes but private storage holds ${read.contentLength}`,
    )
  }

  const hash = createHash("sha256")
  const heads: Buffer[] = []
  const kept: Buffer[] = []
  let headBytes = 0
  let total = 0

  try {
    for await (const chunk of read.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferView["buffer"])
      total += buf.length
      if (total > options.limit) {
        read.body.destroy()
        fail(`artifact is larger than the ${options.limit} bytes it declared`)
      }
      hash.update(buf)
      if (headBytes < HEAD_BYTES) {
        const slice = buf.subarray(0, HEAD_BYTES - headBytes)
        heads.push(slice)
        headBytes += slice.length
      }
      if (options.keepBody) kept.push(buf)
    }
  } catch (error) {
    read.body.destroy()
    if (error instanceof Scene3DArtifactError) throw error
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_FAILED",
      "reading the uploaded artifact from private storage failed",
      error instanceof Error ? error.message : undefined,
    )
  }

  return {
    sha256: hash.digest("hex"),
    byteLength: total,
    head: Buffer.concat(heads),
    body: options.keepBody ? Buffer.concat(kept) : null,
    etag: read.etag,
  }
}

/**
 * The whole receipt gate for one artifact.
 *
 * Throws on the first thing that does not add up; returns the tag to record
 * (and the parsed body, when there was one) on success.
 */
export async function verifyScene3DArtifactBytes(
  store: Scene3DObjectStore,
  objectKey: string,
  expected: Scene3DReceiptExpectation,
): Promise<Scene3DReceipt> {
  if (!/^[a-f0-9]{64}$/.test(expected.sha256)) {
    fail(`artifact digest "${expected.sha256}" is not a lowercase hex SHA-256`)
  }
  if (!Number.isSafeInteger(expected.byteLength) || expected.byteLength <= 0) {
    fail("artifact byte length must be a positive integer")
  }

  const isJson = JSON_KINDS.includes(expected.kind)
  if (isJson && expected.byteLength > SCENE3D_JSON_RECEIPT_MAX_BYTES) {
    fail(
      `${expected.kind} is ${expected.byteLength} bytes; the limit is ${SCENE3D_JSON_RECEIPT_MAX_BYTES}`,
    )
  }

  const seen = await consume(store, objectKey, {
    limit: expected.byteLength,
    expectedLength: expected.byteLength,
    keepBody: isJson,
  })

  if (seen.byteLength !== expected.byteLength) {
    fail(`artifact declares ${expected.byteLength} bytes but is ${seen.byteLength}`)
  }
  if (seen.sha256 !== expected.sha256) {
    fail("artifact bytes do not match the digest the producer declared")
  }
  assertScene3DArtifactMagic(expected.kind, seen.head, seen.byteLength)

  let text: string | undefined
  if (isJson) {
    text = (seen.body ?? Buffer.alloc(0)).toString("utf8")
    try {
      JSON.parse(text)
    } catch {
      fail(`${expected.kind} artifact is not valid JSON`)
    }
  }

  return { etag: seen.etag ?? `sha256:${seen.sha256}`, text }
}

export interface Scene3DObjectInspection {
  sha256: string
  byteLength: number
  etag: string
}

/**
 * Hash and shape-check an object whose digest and length are not yet known —
 * the reservation lane, where the platform learns what the builder wrote
 * rather than being told.
 */
export async function inspectScene3DObject(
  store: Scene3DObjectStore,
  objectKey: string,
  kind: Scene3DArtifactKind,
): Promise<Scene3DObjectInspection> {
  const isJson = JSON_KINDS.includes(kind)
  const seen = await consume(store, objectKey, {
    limit: isJson ? SCENE3D_JSON_RECEIPT_MAX_BYTES : SCENE3D_MAX_ARTIFACT_BYTES,
    expectedLength: null,
    keepBody: isJson,
  })
  if (seen.byteLength === 0) fail("the uploaded artifact is empty")
  assertScene3DArtifactMagic(kind, seen.head, seen.byteLength)
  if (isJson) {
    try {
      JSON.parse((seen.body ?? Buffer.alloc(0)).toString("utf8"))
    } catch {
      fail(`${kind} artifact is not valid JSON`)
    }
  }
  return {
    sha256: seen.sha256,
    byteLength: seen.byteLength,
    etag: seen.etag ?? `sha256:${seen.sha256}`,
  }
}
