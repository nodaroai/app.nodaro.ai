import { guardStorageReadBody } from "../../lib/storage-timeouts.js"
import type { TransferRateLimits } from "../../lib/transfer-watchdog.js"
import type { Scene3DObjectRead, Scene3DObjectStore } from "./object-store.js"

/**
 * Read a private-bucket object the APP consumes (a receipt hash, a plugin's
 * buffered read, an authoring source, a render's local copy) — never a
 * viewer's stream, which stays bounded at the headers only. The body comes
 * back under the storage body rule (`guardStorageReadBody`, Track 0.12): a
 * stalled read errors with "Download timeout: …" instead of hanging, and the
 * request is aborted so its connection is released.
 */
export async function readScene3DObjectForApp(
  store: Scene3DObjectStore,
  objectKey: string,
  opts: { readonly limits?: TransferRateLimits } = {},
): Promise<Scene3DObjectRead> {
  const controller = new AbortController()
  const read = await store.get(objectKey, undefined, { signal: controller.signal })
  return {
    ...read,
    body: guardStorageReadBody(read.body, {
      // Never the key: it names the owner and the revision, and the error's
      // detail can reach a run's customer-facing outcome.
      sizeBytes: read.contentLength, startedAt: Date.now(), label: "a private scene object", controller, limits: opts.limits,
    }),
  }
}
