/**
 * Asset bytes for the EMBED, over `postMessage` — protocol version 2.
 *
 * `/embed/scene3d` has no session and makes no network call, but a v2 scene is
 * ids + digests only: its geometry and its baked camera live behind an
 * authenticated endpoint. So the frame asks its parent — the page that DOES
 * hold the session — for exactly the bytes the manifest declares, and the
 * parent answers with an `ArrayBuffer`.
 *
 * What must never cross the frame boundary is a CREDENTIAL. Not a token, not a
 * cookie, not a signed URL: a URL that grants access is a bearer token with a
 * different spelling, and handing one to a frame gives it (and anything that
 * later reads its DOM or its network log) an access it can replay. Only opaque
 * bytes come in.
 *
 * The frame therefore trusts the parent for DELIVERY and for nothing else:
 *
 *  - a response is only looked at if it comes from the exact expected window
 *    AND origin AND channel;
 *  - it must correlate to a request THIS instance made, for THIS revision, for
 *    THAT asset id — a parent answering a question nobody asked, or answering
 *    it with a different asset, is a protocol violation and fails the asset;
 *  - the bytes are checked against the manifest's `byteLength` and SHA-256
 *    before they are handed on (the renderer re-verifies them anyway; this is
 *    the earlier of the two gates, and it is what makes a wrong-bytes answer a
 *    clean per-asset failure rather than a confusing decoder crash);
 *  - a stale answer — for a revision the frame has moved on from — is dropped,
 *    because the whole point of pushing a new revision is that the old one is
 *    no longer what the user is looking at.
 *
 * Everything here is DOM-free and injectable (`post`, `newRequestId`), so the
 * malicious and stale cases are unit-testable without a browser. The route
 * owns the `window` wiring.
 */
import { z } from "zod"
import { SCENE3D_V2_LIMITS } from "@nodaro/shared"
import type { Scene3DAssetRef } from "@nodaro/shared"
// Runtime import from the SUBPATH: `verifyAssetBytes` is the renderer's own
// digest gate (three-free), so the embed and the export apply the identical
// check rather than a second implementation that could drift.
import { verifyAssetBytes } from "@remotion-pkg/scene3d/v2/asset-resolver"
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"
import type { Scene3DEmbedContext, Scene3DEmbedTransport } from "./embed-protocol"

export const SCENE3D_EMBED_ASSET_REQUEST_TYPE = "nodaro:scene3d:asset-request"
export const SCENE3D_EMBED_ASSET_RESPONSE_TYPE = "nodaro:scene3d:asset-response"

/** Asset transport exists only in protocol 2. A v1 parent cannot serve bytes. */
export const SCENE3D_EMBED_ASSET_PROTOCOL_VERSION = 2

export const SCENE3D_EMBED_ASSET_LIMITS = {
  /** Requests in flight at once; the rest queue. The parent is a browser tab
   *  doing authenticated fetches, not a CDN. */
  maxOutstanding: 4,
  /** Requests one revision may ever make. Matches the manifest's asset ceiling,
   *  so a well-formed plan can always finish and a loop cannot outrun it. */
  maxRequestsPerRevision: SCENE3D_V2_LIMITS.maxAssets,
  /** Bytes one revision may accept in total — the renderer's own budget. */
  maxBytesPerRevision: SCENE3D_V2_LIMITS.maxRendererAssetBytes,
  /** A parent that has not answered by now is not going to. */
  requestTimeoutMs: 20_000,
  /** A parent's error text is shown to the user, so it is bounded. */
  maxErrorLength: 200,
} as const

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface Scene3DEmbedAssetRequestMessage {
  type: typeof SCENE3D_EMBED_ASSET_REQUEST_TYPE
  version: typeof SCENE3D_EMBED_ASSET_PROTOCOL_VERSION
  channel: string
  requestId: string
  /** The current retained revision pins reused assets too. Origins are provenance only. */
  revisionId: string
  assetId: string
  kind: Scene3DAssetRef["kind"]
  byteLength: number
  sha256: string
}

export function buildScene3DAssetRequestMessage(
  channel: string,
  requestId: string,
  revisionId: string,
  ref: Scene3DAssetRef,
): Scene3DEmbedAssetRequestMessage {
  return {
    type: SCENE3D_EMBED_ASSET_REQUEST_TYPE,
    version: SCENE3D_EMBED_ASSET_PROTOCOL_VERSION,
    channel,
    requestId,
    revisionId,
    assetId: ref.assetId,
    kind: ref.kind,
    byteLength: ref.byteLength,
    sha256: ref.sha256,
  }
}

const responseSchema = z
  .object({
    type: z.literal(SCENE3D_EMBED_ASSET_RESPONSE_TYPE),
    version: z.number(),
    channel: z.string(),
    requestId: z.string(),
    revisionId: z.string().max(SCENE3D_V2_LIMITS.maxIdLength),
    assetId: z.string().max(SCENE3D_V2_LIMITS.maxAssetIdLength),
    ok: z.boolean(),
    error: z.string().max(SCENE3D_EMBED_ASSET_LIMITS.maxErrorLength).optional(),
    bytes: z.unknown().optional(),
  })
  .strict()

/** What the frame asked for, kept so an answer can be matched against it. */
export interface Scene3DEmbedAssetPending {
  requestId: string
  revisionId: string
  ref: Scene3DAssetRef
}

export type Scene3DEmbedAssetVerdict =
  /** Not ours, or an answer to a question we are no longer asking. Silent. */
  | { kind: "ignore" }
  /** Ours, and wrong. The named request fails with `reason`. */
  | { kind: "reject"; requestId: string; reason: string }
  /** Structurally valid and correlated. The digest is checked by the caller. */
  | { kind: "accept"; requestId: string; ref: Scene3DAssetRef; bytes: ArrayBuffer }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Realm-independent `instanceof ArrayBuffer`.
 *
 * A structured clone arrives in the RECEIVING realm, so plain `instanceof`
 * holds in a browser — but a host that hands bytes over some other seam (a test
 * harness, a worker, an embedder that proxies through a second context) can
 * produce a perfectly good buffer from a different realm, and refusing it would
 * be refusing correct bytes for a reason that has nothing to do with them. The
 * length and digest checks below are the gate that matters.
 */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]"
}

/**
 * The one funnel every inbound asset response goes through.
 *
 * `pending` is a lookup, not a list, so this stays pure: the caller owns the
 * outstanding set and this decides what the message is allowed to do to it.
 */
export function classifyScene3DAssetResponse(
  transport: Scene3DEmbedTransport,
  context: Scene3DEmbedContext,
  pending: (requestId: string) => Scene3DEmbedAssetPending | undefined,
): Scene3DEmbedAssetVerdict {
  // 1. Transport + addressing. Identical rules to the state channel: the
  //    parent window itself, its exact origin, and our channel.
  if (transport.source !== context.expectedSource) return { kind: "ignore" }
  if (transport.origin !== context.parentOrigin) return { kind: "ignore" }
  const data = transport.data
  if (!isRecord(data)) return { kind: "ignore" }
  if (data.type !== SCENE3D_EMBED_ASSET_RESPONSE_TYPE) return { kind: "ignore" }
  if (data.channel !== context.channel) return { kind: "ignore" }

  // 2. Correlation. An answer we have no outstanding question for is IGNORED
  //    rather than surfaced: a late answer to a request we already timed out or
  //    abandoned is normal, and a duplicate must not fail an asset that already
  //    succeeded. This is also what makes an unsolicited "here are some bytes"
  //    a no-op instead of an injection point.
  const requestId = typeof data.requestId === "string" ? data.requestId : null
  if (!requestId) return { kind: "ignore" }
  const request = pending(requestId)
  if (!request) return { kind: "ignore" }

  // 3. Content. From here on the request fails, visibly.
  if (data.version !== SCENE3D_EMBED_ASSET_PROTOCOL_VERSION) {
    return {
      kind: "reject",
      requestId,
      reason: `asset response used protocol version ${String(data.version)}; this frame speaks version ${SCENE3D_EMBED_ASSET_PROTOCOL_VERSION}`,
    }
  }
  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join(".")
    return {
      kind: "reject",
      requestId,
      reason: `malformed asset response${path ? ` (${path}: ${issue?.message})` : ""}`,
    }
  }
  const message = parsed.data

  // The answer must be to the question that was asked. A parent that returns
  // some OTHER asset — or the same asset under a different revision — is not
  // "close enough": it is exactly how an authorized parent would be talked into
  // handing over bytes for a revision this frame was never shown.
  if (message.revisionId !== request.revisionId || message.assetId !== request.ref.assetId) {
    return {
      kind: "reject",
      requestId,
      reason: "asset response did not match the asset that was requested",
    }
  }

  if (!message.ok) {
    return {
      kind: "reject",
      requestId,
      reason: message.error ? `the host could not supply this asset: ${message.error}` : "the host could not supply this asset",
    }
  }

  const bytes = message.bytes
  if (!isArrayBuffer(bytes)) {
    return { kind: "reject", requestId, reason: "asset response did not carry the bytes as an ArrayBuffer" }
  }
  if (bytes.byteLength > SCENE3D_EMBED_ASSET_LIMITS.maxBytesPerRevision) {
    return {
      kind: "reject",
      requestId,
      reason: `asset response is ${bytes.byteLength} bytes; the limit is ${SCENE3D_EMBED_ASSET_LIMITS.maxBytesPerRevision}`,
    }
  }
  if (bytes.byteLength !== request.ref.byteLength) {
    return {
      kind: "reject",
      requestId,
      reason: `asset response is ${bytes.byteLength} bytes; the scene declares ${request.ref.byteLength}`,
    }
  }

  return { kind: "accept", requestId, ref: request.ref, bytes }
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

export interface Scene3DEmbedAssetTransportOptions {
  channel: string
  /** The revision being displayed. Requests and answers are scoped to it. */
  revisionId: string
  /** Posts to the parent at its exact origin. Injected so this stays DOM-free. */
  post: (message: Scene3DEmbedAssetRequestMessage) => void
  newRequestId?: () => string
  timeoutMs?: number
  maxOutstanding?: number
}

interface Outstanding extends Scene3DEmbedAssetPending {
  resolve: (bytes: ArrayBuffer) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function randomId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  // A request id only has to be unique within this frame's own outstanding set
  // — it is a correlation token, not a secret.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * A `Scene3DAssetResolver` that asks the parent frame for bytes.
 *
 * One instance per REVISION. When the frame accepts a new revision the old
 * instance is disposed, which rejects everything still in flight — so a slow
 * answer for a scene the user has already left can never be drawn, and the
 * canvas's own abort path is not the only thing standing between a stale buffer
 * and the screen.
 */
export class Scene3DEmbedAssetTransport implements Scene3DAssetResolver {
  private readonly options: Required<Omit<Scene3DEmbedAssetTransportOptions, "post">> & {
    post: (message: Scene3DEmbedAssetRequestMessage) => void
  }
  private readonly outstanding = new Map<string, Outstanding>()
  private readonly queue: Array<() => void> = []
  private requestCount = 0
  private acceptedBytes = 0
  private disposed: Error | null = null

  constructor(options: Scene3DEmbedAssetTransportOptions) {
    this.options = {
      channel: options.channel,
      revisionId: options.revisionId,
      post: options.post,
      newRequestId: options.newRequestId ?? randomId,
      timeoutMs: options.timeoutMs ?? SCENE3D_EMBED_ASSET_LIMITS.requestTimeoutMs,
      maxOutstanding: options.maxOutstanding ?? SCENE3D_EMBED_ASSET_LIMITS.maxOutstanding,
    }
  }

  /** The revision this transport serves. Answers for any other are dropped. */
  get revisionId(): string {
    return this.options.revisionId
  }

  resolve(ref: Scene3DAssetRef, signal: AbortSignal): Promise<ArrayBuffer> {
    if (this.disposed) return Promise.reject(this.disposed)
    if (signal.aborted) return Promise.reject(abortError())

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const start = () => {
        if (this.disposed) return reject(this.disposed)
        if (signal.aborted) return reject(abortError())
        if (this.requestCount >= SCENE3D_EMBED_ASSET_LIMITS.maxRequestsPerRevision) {
          return reject(
            new Error(
              `this scene asked for more than ${SCENE3D_EMBED_ASSET_LIMITS.maxRequestsPerRevision} assets`,
            ),
          )
        }
        this.requestCount += 1

        const requestId = this.options.newRequestId()
        const revisionId = this.options.revisionId
        const settle = (fn: () => void) => {
          const entry = this.outstanding.get(requestId)
          if (!entry) return
          clearTimeout(entry.timer)
          this.outstanding.delete(requestId)
          signal.removeEventListener("abort", onAbort)
          fn()
          this.pump()
        }
        const onAbort = () => settle(() => reject(abortError()))

        const timer = setTimeout(() => {
          settle(() =>
            reject(new Error(`the host did not supply "${ref.assetId}" within ${this.options.timeoutMs}ms`)),
          )
        }, this.options.timeoutMs)

        this.outstanding.set(requestId, {
          requestId,
          revisionId,
          ref,
          timer,
          resolve: (bytes) => settle(() => resolve(bytes)),
          reject: (error) => settle(() => reject(error)),
        })
        signal.addEventListener("abort", onAbort, { once: true })

        try {
          this.options.post(buildScene3DAssetRequestMessage(this.options.channel, requestId, revisionId, ref))
        } catch (error) {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))))
        }
      }

      if (this.outstanding.size < this.options.maxOutstanding) start()
      else this.queue.push(start)
    })
  }

  /**
   * Feed one inbound message in. Returns the rejection reason when the message
   * failed an asset, so the route can show it — a scene that will never draw
   * has to say why, before the viewport's blank frame does the explaining.
   */
  handleMessage(transport: Scene3DEmbedTransport, context: Scene3DEmbedContext): string | null {
    const verdict = classifyScene3DAssetResponse(transport, context, (id) => this.outstanding.get(id))
    if (verdict.kind === "ignore") return null
    const entry = this.outstanding.get(verdict.requestId)
    if (!entry) return null
    if (verdict.kind === "reject") {
      entry.reject(new Error(verdict.reason))
      return verdict.reason
    }

    this.acceptedBytes += verdict.bytes.byteLength
    if (this.acceptedBytes > SCENE3D_EMBED_ASSET_LIMITS.maxBytesPerRevision) {
      const reason = `this scene delivered more than ${SCENE3D_EMBED_ASSET_LIMITS.maxBytesPerRevision} bytes of assets`
      entry.reject(new Error(reason))
      return reason
    }

    // The digest gate is async, so the entry is resolved from the promise —
    // and only after the bytes prove they are the bytes the manifest names.
    void verifyAssetBytes(verdict.ref, verdict.bytes).then(
      (bytes) => entry.resolve(bytes),
      (error: unknown) => entry.reject(error instanceof Error ? error : new Error(String(error))),
    )
    return null
  }

  /** Reject everything in flight. Called when the revision changes or the frame unmounts. */
  dispose(reason = "this scene was replaced before its assets arrived"): void {
    this.disposed = new Error(reason)
    for (const entry of [...this.outstanding.values()]) entry.reject(this.disposed)
    this.outstanding.clear()
    this.queue.length = 0
  }

  private pump(): void {
    while (this.queue.length > 0 && this.outstanding.size < this.options.maxOutstanding) {
      this.queue.shift()?.()
    }
  }
}

function abortError(): Error {
  const error = new Error("The 3D asset request was cancelled")
  error.name = "AbortError"
  return error
}
