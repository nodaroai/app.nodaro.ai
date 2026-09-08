/**
 * A memoizing wrapper around any `Scene3DAssetResolver`.
 *
 * The canvas rebuilds its scene whenever the plan OBJECT changes, and a v2
 * scene's assets are tens of megabytes. Without memoization, a re-render that
 * produced an equal-but-new plan — or an overlay revision that reuses the same
 * baked GLB — would re-download the whole scene. So bytes are cached
 * CONTENT-ADDRESSED, by `assetId:sha256`: two revisions that share an asset
 * share the download, and a revision whose bytes actually changed gets a
 * different key rather than a stale hit.
 *
 * Deliberately transport-free and DOM-free: it wraps a resolver, it does not
 * know whether the bytes come from the API, from a parent frame, or from a
 * fixture. That is what lets the editor (SDK) and the embed (postMessage) share
 * one caching policy.
 *
 * Failures are NOT cached — an expired session or a dropped message must be
 * retryable — and a rejected entry is evicted so the next attempt is a real
 * attempt.
 */
import { SCENE3D_V2_LIMITS } from "@nodaro/shared"
import type { Scene3DAssetRef } from "@nodaro/shared"
// Type-only, and from the SUBPATH: `@remotion-pkg/scene3d` (the index) statically
// imports the canvas and therefore three.js, which would pull ~600KB into every
// module that imports this one — including the embed's first chunk.
import type { Scene3DAssetResolver } from "@remotion-pkg/scene3d/v2/asset-resolver"

export interface MemoizedAssetResolverOptions {
  /** Distinct assets kept. Defaults to the contract's per-plan asset ceiling. */
  maxEntries?: number
  /** Total cached bytes. Defaults to the renderer's whole-scene budget. */
  maxBytes?: number
}

interface Entry {
  promise: Promise<ArrayBuffer>
  controller: AbortController
  /** Consumers still waiting. At zero an UNRESOLVED entry is abandoned. */
  waiters: number
  /** Known only once resolved; an in-flight entry counts as its declared size. */
  byteLength: number
  resolved: boolean
}

function cacheKey(ref: Scene3DAssetRef): string {
  return `${ref.assetId}:${ref.sha256}`
}

function abortError(): Error {
  const error = new Error("The 3D asset request was cancelled")
  error.name = "AbortError"
  return error
}

/**
 * Wrap `inner` so identical assets are fetched once.
 *
 * Cancellation is per CONSUMER: aborting one caller's signal rejects only that
 * caller. The shared request is aborted only when the last waiter leaves, so a
 * React StrictMode double-invoke (mount → unmount → mount) does not throw away
 * a download that the second mount is about to ask for again.
 */
export function createMemoizedAssetResolver(
  inner: Scene3DAssetResolver,
  options: MemoizedAssetResolverOptions = {},
): Scene3DAssetResolver {
  const maxEntries = options.maxEntries ?? SCENE3D_V2_LIMITS.maxAssets
  const maxBytes = options.maxBytes ?? SCENE3D_V2_LIMITS.maxRendererAssetBytes
  // Insertion-ordered: the oldest entry is the first key.
  const entries = new Map<string, Entry>()

  const cachedBytes = (): number => {
    let total = 0
    for (const entry of entries.values()) total += entry.byteLength
    return total
  }

  const evictWhileOver = (incoming: number) => {
    for (const [key, entry] of entries) {
      if (entries.size < maxEntries && cachedBytes() + incoming <= maxBytes) return
      // Never evict something a caller is still waiting on — that would abort a
      // download the current scene needs in order to draw.
      if (entry.waiters > 0) continue
      entries.delete(key)
    }
  }

  return {
    async resolve(ref: Scene3DAssetRef, signal: AbortSignal): Promise<ArrayBuffer> {
      if (signal.aborted) throw abortError()
      if (!Number.isSafeInteger(ref.byteLength) || ref.byteLength <= 0 || ref.byteLength > maxBytes) {
        throw new Error("The 3D asset exceeds the preview cache limit")
      }
      const key = cacheKey(ref)
      let entry = entries.get(key)

      if (!entry) {
        evictWhileOver(ref.byteLength)
        if (entries.size >= maxEntries || cachedBytes() + ref.byteLength > maxBytes) {
          throw new Error("The 3D asset cache is full while other assets are loading")
        }
        const controller = new AbortController()
        const created: Entry = {
          controller,
          waiters: 0,
          byteLength: ref.byteLength,
          resolved: false,
          promise: Promise.resolve().then(() => inner.resolve(ref, controller.signal)).then((bytes) => {
            if (bytes.byteLength !== ref.byteLength) throw new Error("The 3D asset length does not match its scene")
            return bytes
          }),
        }
        created.promise.then(
          (bytes) => {
            created.resolved = true
            created.byteLength = bytes.byteLength
          },
          () => {
            // A failed asset is never remembered as failed: the next attempt
            // (a retry, a re-mount, a refreshed session) must really try again.
            if (entries.get(key) === created) entries.delete(key)
          },
        )
        entries.set(key, created)
        entry = created
      }

      const active = entry
      active.waiters += 1
      try {
        if (signal.aborted) throw abortError()
        return await new Promise<ArrayBuffer>((resolve, reject) => {
          const onAbort = () => reject(abortError())
          signal.addEventListener("abort", onAbort, { once: true })
          active.promise.then(
            (bytes) => {
              signal.removeEventListener("abort", onAbort)
              resolve(bytes)
            },
            (error) => {
              signal.removeEventListener("abort", onAbort)
              reject(error)
            },
          )
        })
      } finally {
        active.waiters -= 1
        // A RESOLVED entry keeps its bytes for the next revision. An entry
        // nobody is waiting on any more and that never produced bytes is
        // abandoned — otherwise an aborted mount would leave a download running
        // for a scene no one is looking at.
        if (active.waiters <= 0 && !active.resolved && entries.get(key) === active) {
          active.controller.abort()
          entries.delete(key)
        }
      }
    },
  }
}
