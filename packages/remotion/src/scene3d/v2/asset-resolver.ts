/**
 * Authorized asset resolution for Scene3D v2.
 *
 * The PERSISTED plan carries ids + digests only; transport URLs are short-lived
 * and live outside it. This module is that seam, and it is deliberately the
 * only place in the renderer that can produce bytes:
 *
 *  - `Scene3DAssetResolver` is what the frontend passes (a real function, so a
 *    signed URL never has to reach the DOM — it can proxy through the
 *    authenticated API client instead).
 *  - `createUrlAssetResolver` is what the Remotion composition builds from the
 *    JSON-only `assetUrls` prop, because a function cannot cross `inputProps`.
 *
 * Every buffer that leaves here has had its byte length AND its SHA-256 digest
 * checked against the manifest. A mismatch fails the render; there is no
 * "close enough" path, and no code path returns unverified bytes.
 */
import { Scene3DError, check, fail } from "./errors"
import type { Scene3DAssetRef } from "./plan-shape"
import { sha256Hex } from "./sha256"

export interface Scene3DAssetResolver {
  /**
   * Resolve one asset to its exact bytes. Implementations SHOULD honour
   * `signal`; the loader aborts on unmount and on a plan change, and a resolver
   * that ignores it only wastes bandwidth (the result is discarded either way).
   */
  resolve(ref: Scene3DAssetRef, signal: AbortSignal): Promise<ArrayBuffer>
}

/** Kinds the browser renderer is ever allowed to fetch. */
const RENDERABLE_KINDS = new Set(["glb", "camera-track-json"])

/**
 * `blend-source` is a separately authorized download and must never be handed
 * to the browser renderer, even if it appears in a manifest.
 */
export function assertRenderableAssetKind(ref: Scene3DAssetRef): void {
  check(
    RENDERABLE_KINDS.has(ref.kind),
    "SCENE_ASSET_INVALID",
    `asset kind "${ref.kind}" is not fetchable by the renderer`,
    ref.assetId,
  )
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The single verification gate. Exported so tests can prove the failure paths
 * without a network, and so a host-supplied resolver cannot bypass it: the
 * loader calls this on whatever the resolver returned.
 */
export async function verifyAssetBytes(
  ref: Scene3DAssetRef,
  bytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  check(
    Number.isInteger(ref.byteLength) && ref.byteLength >= 0,
    "SCENE_ASSET_INVALID",
    `manifest byteLength ${String(ref.byteLength)} is not a byte count`,
    ref.assetId,
  )
  check(
    typeof ref.sha256 === "string" && HEX64.test(ref.sha256),
    "SCENE_ASSET_INVALID",
    "manifest sha256 is not a 64-character lowercase hex digest",
    ref.assetId,
  )
  check(
    bytes.byteLength === ref.byteLength,
    "SCENE_ASSET_INVALID",
    `byte length mismatch: manifest says ${ref.byteLength}, got ${bytes.byteLength}`,
    ref.assetId,
  )
  const digest = await sha256Hex(bytes)
  check(
    digest === ref.sha256,
    "SCENE_ASSET_INVALID",
    `SHA-256 mismatch: manifest says ${ref.sha256}, got ${digest}`,
    ref.assetId,
  )
  return bytes
}

export interface UrlAssetResolverOptions {
  /** Injectable for tests and for a host that wants its own fetch policy. */
  fetchImpl?: typeof fetch
  /** Extra headers (e.g. a bearer token) applied to every request. */
  headers?: Record<string, string>
}

/**
 * Build a resolver over a plain `{assetId: url}` map — the JSON-safe shape the
 * backend puts in `inputProps.assetUrls`.
 *
 * Only `http:`/`https:` are accepted. A `file:`/`data:`/`blob:` URL in a
 * manifest-adjacent map would be a way to make the render worker read its own
 * filesystem, so it is rejected here rather than at the fetch.
 */
export function createUrlAssetResolver(
  urls: Readonly<Record<string, string>>,
  options: UrlAssetResolverOptions = {},
): Scene3DAssetResolver {
  const doFetch = options.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined)

  return {
    async resolve(ref, signal) {
      const url = urls[ref.assetId]
      check(
        typeof url === "string" && url.length > 0,
        "SCENE_ASSET_UNAVAILABLE",
        "no transport URL was provided for this asset",
        ref.assetId,
      )
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return fail("SCENE_ASSET_UNAVAILABLE", "transport URL is not a valid URL", ref.assetId)
      }
      check(
        parsed.protocol === "https:" || parsed.protocol === "http:",
        "SCENE_ASSET_UNAVAILABLE",
        `transport URL protocol "${parsed.protocol}" is not allowed`,
        ref.assetId,
      )
      check(
        typeof doFetch === "function",
        "SCENE_ASSET_UNAVAILABLE",
        "no fetch implementation is available in this environment",
        ref.assetId,
      )

      let response: Response
      try {
        response = await doFetch(url, { signal, headers: options.headers, redirect: "follow" })
      } catch (error) {
        if (signal.aborted) throw error
        return fail(
          "SCENE_ASSET_UNAVAILABLE",
          `fetch failed: ${error instanceof Error ? error.message : String(error)}`,
          ref.assetId,
        )
      }
      check(
        response.ok,
        "SCENE_ASSET_UNAVAILABLE",
        `fetch returned HTTP ${response.status}`,
        ref.assetId,
      )
      return await response.arrayBuffer()
    },
  }
}

/**
 * Resolve + verify. The loader always goes through this, so a host resolver
 * that skipped verification still cannot deliver unchecked bytes.
 */
export async function resolveVerifiedAsset(
  resolver: Scene3DAssetResolver | undefined,
  ref: Scene3DAssetRef,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  assertRenderableAssetKind(ref)
  if (!resolver) {
    fail(
      "SCENE_ASSET_UNAVAILABLE",
      "this plan needs assets but no asset resolver was supplied (pass `assetUrls` when rendering or `assetResolver` in the preview)",
      ref.assetId,
    )
  }
  let bytes: ArrayBuffer
  try {
    bytes = await resolver.resolve(ref, signal)
  } catch (error) {
    if (error instanceof Scene3DError) throw error
    if (signal.aborted) throw error
    return fail(
      "SCENE_ASSET_UNAVAILABLE",
      `resolver failed: ${error instanceof Error ? error.message : String(error)}`,
      ref.assetId,
    )
  }
  check(
    bytes instanceof ArrayBuffer,
    "SCENE_ASSET_INVALID",
    "resolver did not return an ArrayBuffer",
    ref.assetId,
  )
  return await verifyAssetBytes(ref, bytes)
}
