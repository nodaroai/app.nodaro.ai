/**
 * Same-site voice previews (`VOICE_PREVIEW_PROXY=true`), for a deployment
 * whose browsers may reach only its own host: a white-label deployment that
 * serves every product from one host behind a network filter that blocks
 * every other domain. The voice lists' `preview_url` points at the speech
 * provider's storage, which such a filter blocks, so a voice picker there
 * could not play a single preview.
 *
 * With the switch on, the lists (routes/voices.ts) give each preview as a
 * same-site address, `/v1/voices/<voiceId>/preview?src=…&sig=…`, and that
 * route streams the provider's file from here. With it off (the default) the
 * lists answer exactly as before and the route answers 404.
 *
 * WHY A SIGNATURE IS THE CREDENTIAL. A preview plays in an `<audio src>`,
 * which sends no `Authorization` header, so a bearer-checked route would
 * refuse every play — the platform's own pickers included. The address
 * carries the provider's file address (`src`) and an HMAC over it and the
 * voice id (`sig`), keyed from the server's own secret, as the signed upload
 * addresses are. So the route fetches only a file the platform itself listed,
 * for the voice it listed it under: it cannot be pointed at any other address,
 * and a signature taken from one voice does not open another's file. The lists
 * themselves are public, as are the provider's preview files.
 *
 * THE VOICE LOCK. The route asks the lock (`voice.allowedGenders`) about the
 * voice on every request, with the same resolver the speech routes use, and
 * refuses a voice it would refuse there, before anything is fetched: an
 * address minted before a lock was set, or for a voice the lock has since
 * locked out, plays nothing.
 *
 * Fetched through `safeFetch`; only an `audio/*` answer of at most
 * MAX_PREVIEW_BYTES is served (the cap is held while reading, whatever the
 * provider says the length is). Kept in memory for a day, within a byte
 * budget, so the provider is asked once per file rather than once per play.
 */
import { createHmac, timingSafeEqual } from "node:crypto"
import { config } from "./config.js"
import { safeFetch } from "./safe-fetch.js"
import { PREVIEW_VOICE_ID } from "./voice-preview-address.js"

/** The largest preview served. A provider's preview is a few seconds of audio, well under this. */
export const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
/** What the in-memory cache may hold, all previews together. */
const CACHE_BUDGET_BYTES = 32 * 1024 * 1024
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000
/** The longest `src` / `sig` accepted (a provider address is a few hundred characters). */
const MAX_SRC_LENGTH = 4096
const MAX_SIG_LENGTH = 128

/** Whether this deployment serves its voice previews from its own host. Read at call time. */
export function voicePreviewProxyOn(): boolean {
  return config.VOICE_PREVIEW_PROXY === true
}

let keyMaterial: Buffer | null = null

/** The proxy's own key, derived from the server's secret (the same in every process of one deployment). */
function signingKey(): Buffer {
  keyMaterial ??= createHmac("sha256", config.INTERNAL_ORCHESTRATOR_SECRET).update("nodaro:voice-preview:v1").digest()
  return keyMaterial
}

function signatureOf(voiceId: string, upstream: string): string {
  return createHmac("sha256", signingKey()).update(`${voiceId}\n${upstream}`).digest("base64url")
}

function isHttpsUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * The same-site address of `voiceId`'s preview, whose file is at `upstream`
 * (the provider's address); null for one this proxy does not serve (not an
 * https address, an id the route does not accept).
 */
export function sameSitePreviewPath(voiceId: string, upstream: string): string | null {
  if (!PREVIEW_VOICE_ID.test(voiceId) || !isHttpsUrl(upstream)) return null
  const src = Buffer.from(upstream, "utf8").toString("base64url")
  return `/v1/voices/${voiceId}/preview?src=${src}&sig=${signatureOf(voiceId, upstream)}`
}

/** The provider address a same-site preview address names, when its signature is ours for this voice; else null. */
export function verifiedPreviewSource(voiceId: string, src: unknown, sig: unknown): string | null {
  if (!PREVIEW_VOICE_ID.test(voiceId) || typeof src !== "string" || typeof sig !== "string") return null
  if (src.length === 0 || src.length > MAX_SRC_LENGTH || sig.length === 0 || sig.length > MAX_SIG_LENGTH) return null
  const upstream = Buffer.from(src, "base64url").toString("utf8")
  if (!isHttpsUrl(upstream)) return null
  const expected = Buffer.from(signatureOf(voiceId, upstream), "utf8")
  const given = Buffer.from(sig, "utf8")
  return expected.length === given.length && timingSafeEqual(expected, given) ? upstream : null
}

/**
 * `voices` with each preview given as its same-site address, as a copy (the
 * caller's list, which may be a cache's, is left as it is). A voice with no
 * preview keeps its empty one; one whose preview this proxy cannot serve gets
 * none rather than an address the deployment's browsers cannot reach.
 */
export function withSameSitePreviews<T extends { voice_id: string; preview_url: string }>(voices: readonly T[]): T[] {
  return voices.map((voice) =>
    voice.preview_url ? { ...voice, preview_url: sameSitePreviewPath(voice.voice_id, voice.preview_url) ?? "" } : voice,
  )
}

// ---------------------------------------------------------------------------
// Fetching, capped and cached
// ---------------------------------------------------------------------------

export interface PreviewFile {
  readonly body: Buffer
  /** The provider's media type, without parameters (`audio/mpeg`). */
  readonly contentType: string
}

/** Why a preview could not be served: the provider failed, answered something other than audio, or a file over the cap. */
export class PreviewUnavailableError extends Error {
  constructor(readonly reason: "upstream" | "not_audio" | "too_large") {
    super(`voice preview unavailable: ${reason}`)
    this.name = "PreviewUnavailableError"
  }
}

interface CacheEntry extends PreviewFile {
  readonly storedAt: number
}

/** Insertion-ordered, so the first entry is the one used longest ago. */
const cache = new Map<string, CacheEntry>()
let cachedBytes = 0
const inflight = new Map<string, Promise<PreviewFile>>()

function forget(key: string): void {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cachedBytes -= entry.body.byteLength
}

function recall(key: string): PreviewFile | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    forget(key)
    return undefined
  }
  // Used now: to the back of the line.
  cache.delete(key)
  cache.set(key, entry)
  return { body: entry.body, contentType: entry.contentType }
}

function remember(key: string, file: PreviewFile): void {
  forget(key)
  for (const oldest of cache.keys()) {
    if (cachedBytes + file.body.byteLength <= CACHE_BUDGET_BYTES) break
    forget(oldest)
  }
  cache.set(key, { ...file, storedAt: Date.now() })
  cachedBytes += file.body.byteLength
}

async function fetchPreview(upstream: string): Promise<PreviewFile> {
  let res: Response
  try {
    res = await safeFetch(upstream, { timeoutMs: FETCH_TIMEOUT_MS })
  } catch {
    throw new PreviewUnavailableError("upstream")
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {})
    throw new PreviewUnavailableError("upstream")
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (!contentType.startsWith("audio/")) {
    await res.body.cancel().catch(() => {})
    throw new PreviewUnavailableError("not_audio")
  }
  const declared = Number(res.headers.get("content-length") ?? NaN)
  if (Number.isFinite(declared) && declared > MAX_PREVIEW_BYTES) {
    await res.body.cancel().catch(() => {})
    throw new PreviewUnavailableError("too_large")
  }
  // Held while reading: a missing or wrong Content-Length does not lift the cap.
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const step = await reader.read().catch(() => {
      throw new PreviewUnavailableError("upstream")
    })
    if (step.done) break
    total += step.value.byteLength
    if (total > MAX_PREVIEW_BYTES) {
      await reader.cancel().catch(() => {})
      throw new PreviewUnavailableError("too_large")
    }
    chunks.push(Buffer.from(step.value))
  }
  return { body: Buffer.concat(chunks, total), contentType }
}

/** The preview file at `upstream`, from the cache or the provider (one fetch per file at a time). */
export async function loadPreview(upstream: string): Promise<PreviewFile> {
  const hit = recall(upstream)
  if (hit) return hit
  const pending = inflight.get(upstream)
  if (pending) return pending
  const load = fetchPreview(upstream)
    .then((file) => {
      remember(upstream, file)
      return file
    })
    .finally(() => inflight.delete(upstream))
  inflight.set(upstream, load)
  return load
}

/** Test hook: an empty cache, and the key re-derived from the current secret. */
export function __resetVoicePreviewProxyForTests(): void {
  cache.clear()
  cachedBytes = 0
  inflight.clear()
  keyMaterial = null
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export type ByteRange = { readonly start: number; readonly end: number }

/**
 * The one byte range a `Range` header asks of a file of `size` bytes: a range
 * to send (206), `"unsatisfiable"` (416), or null for the whole file (200 —
 * no header, a form this route does not serve, or several ranges). A media
 * player asks for ranges, and some will not play a file served without them.
 */
export function requestedRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header || size === 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, from, to] = match
  if (from === "" && to === "") return null
  if (from === "") {
    // The last `to` bytes.
    const suffix = Number(to)
    if (suffix === 0) return "unsatisfiable"
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(from)
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1)
  if (start >= size || start > end) return "unsatisfiable"
  return { start, end }
}
