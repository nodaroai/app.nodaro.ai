import { Transform, type Readable } from "node:stream"
import { loadScene3DRevisionArtifacts } from "./db.js"
import { isSyntheticEtag } from "./receipt.js"
import type { Scene3DObjectStore } from "./object-store.js"
import {
  SCENE3D_ARTIFACT_CONTENT_TYPES,
  SCENE3D_PLAYBACK_KINDS,
  SCENE3D_SOURCE_KINDS,
  Scene3DArtifactError,
  type Scene3DAssetDescriptor,
  type Scene3DPinnedArtifact,
} from "./types.js"
import { scene3DIsReadable } from "./authorize.js"

/**
 * Turning an authorized artifact into bytes on the wire.
 *
 * Two things happen here that are easy to leave out and expensive to leave
 * out. First, the live object is compared with the row BEFORE a header is
 * written: the digest in the database is immutable, but the object at that key
 * is not — the producer that wrote it keeps its credentials — so "the row says
 * sha X" is a statement about the past unless something checks the present.
 * ETag and length are the cheap version of that check; re-hashing 64 MiB on
 * every playback is not.
 *
 * Second, the stream is capped at the recorded length. Content-Length alone is
 * a promise to the client, not a limit on the producer.
 */

/** What the manifest response is allowed to mention at all. */
const DESCRIBABLE_KINDS = [...SCENE3D_PLAYBACK_KINDS, ...SCENE3D_SOURCE_KINDS]

export type Scene3DRangeRequest =
  | { kind: "none" }
  | { kind: "range"; start: number; endInclusive: number }
  | { kind: "unsatisfiable" }

/**
 * A deliberately small Range parser: one range, bytes only.
 *
 * Multi-range responses are `multipart/byteranges`, which means composing a
 * body out of parts — more code, in the one place in this module that touches
 * raw sockets, for a case no client of ours makes. An unparseable header is
 * treated as absent (RFC 9110 §14.2 permits exactly that); a syntactically
 * valid but out-of-bounds range is `unsatisfiable`, which is a different
 * answer and gets a 416.
 */
export function parseScene3DRange(
  header: string | undefined,
  byteLength: number,
): Scene3DRangeRequest {
  if (!header) return { kind: "none" }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: "none" }

  const [, rawStart, rawEnd] = match
  if (rawStart === "" && rawEnd === "") return { kind: "none" }

  if (rawStart === "") {
    // `bytes=-N` — the last N bytes.
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" }
    const start = Math.max(0, byteLength - suffix)
    return { kind: "range", start, endInclusive: byteLength - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start < 0 || start >= byteLength) {
    return { kind: "unsatisfiable" }
  }
  const endInclusive = rawEnd === "" ? byteLength - 1 : Math.min(Number(rawEnd), byteLength - 1)
  if (!Number.isSafeInteger(endInclusive) || endInclusive < start) return { kind: "unsatisfiable" }
  return { kind: "range", start, endInclusive }
}

export interface Scene3DArtifactStream {
  status: 200 | 206
  contentType: string
  contentLength: number
  contentRange?: string
  totalLength: number
  body: Readable
}

/** Destroy the pipe rather than trust a producer's length. */
function capped(limit: number): Transform {
  let seen = 0
  return new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length
      if (seen > limit) {
        done(
          new Scene3DArtifactError(
            "SCENE_ASSET_INVALID",
            "the stored artifact is longer than its recorded length",
          ),
        )
        return
      }
      done(null, chunk)
    },
  })
}

export async function openScene3DArtifactStream(
  store: Scene3DObjectStore,
  artifact: Scene3DPinnedArtifact,
  range: Scene3DRangeRequest,
): Promise<Scene3DArtifactStream> {
  // The row records which bucket the bytes were verified in. If the process is
  // now configured against a different one, the honest answer is a failure —
  // reading "the same key" from another bucket is how a private object is
  // served from a public one after a config change.
  if (artifact.bucket !== store.bucket) {
    throw new Scene3DArtifactError(
      "SCENE_STORAGE_FAILED",
      "the scene asset is stored in a bucket this deployment is not configured for",
    )
  }
  if (range.kind === "unsatisfiable") {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "the requested byte range is not satisfiable")
  }

  const wanted = range.kind === "range" ? range : undefined
  const expectedLength = wanted ? wanted.endInclusive - wanted.start + 1 : artifact.byteLength

  let read
  try {
    read = await store.get(artifact.objectKey, wanted)
  } catch (error) {
    throw new Scene3DArtifactError(
      "SCENE_ASSET_MISSING",
      "the scene asset is no longer available",
      error instanceof Error ? error.message : undefined,
    )
  }

  if (read.contentLength !== null && read.contentLength !== expectedLength) {
    read.body.destroy()
    throw new Scene3DArtifactError(
      "SCENE_ASSET_INVALID",
      "the stored scene asset does not match its recorded length",
    )
  }
  // A synthetic tag is one we invented at receipt because the store reported
  // none; comparing it would always pass and would read as a check.
  if (read.etag && !isSyntheticEtag(artifact.etag) && read.etag !== artifact.etag) {
    read.body.destroy()
    throw new Scene3DArtifactError(
      "SCENE_ASSET_INVALID",
      "the stored scene asset has been replaced since it was published",
    )
  }

  return {
    status: wanted ? 206 : 200,
    contentType: SCENE3D_ARTIFACT_CONTENT_TYPES[artifact.kind],
    contentLength: expectedLength,
    ...(wanted
      ? { contentRange: `bytes ${wanted.start}-${wanted.endInclusive}/${artifact.byteLength}` }
      : {}),
    totalLength: artifact.byteLength,
    body: read.body.pipe(capped(expectedLength)),
  }
}

/**
 * The asset list a user is allowed to see: opaque ids and digests.
 *
 * No bucket, no object key, no URL and no expiry — the client asks for bytes
 * by id through the authenticated route, so there is nothing here that would
 * still work if it leaked.
 */
export async function scene3DRevisionAssetDescriptors(
  revisionId: string,
): Promise<Scene3DAssetDescriptor[]> {
  const pinned = await loadScene3DRevisionArtifacts(revisionId)
  return pinned
    .filter(
      (artifact) =>
        DESCRIBABLE_KINDS.includes(artifact.kind) &&
        (scene3DIsReadable(artifact, "playback") || scene3DIsReadable(artifact, "source")),
    )
    .map((artifact) => ({
      assetId: artifact.artifactId,
      kind: artifact.kind,
      usage: artifact.usage,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
    }))
}

/** The revision's single `.blend`, if it retained one. */
export async function scene3DRevisionSourceArtifact(
  revisionId: string,
): Promise<Scene3DPinnedArtifact | null> {
  const pinned = await loadScene3DRevisionArtifacts(revisionId)
  return pinned.find((artifact) => scene3DIsReadable(artifact, "source")) ?? null
}
