import { config } from "../../lib/config.js"
import { requireProviderKey } from "../provider-keys.js"
import { safeFetch } from "../../lib/safe-fetch.js"

/** THE ElevenLabs host. Every module that talks to ElevenLabs imports this
 *  one const — a second local copy silently escapes the override. */
export const ELEVENLABS_BASE_URL = config.ELEVENLABS_BASE_URL

export function getElevenLabsApiKey(): string {
  const apiKey = config.ELEVENLABS_API_KEY
  if (!apiKey) {
    requireProviderKey(apiKey, "ELEVENLABS_API_KEY")
  }
  return apiKey
}

export function getElevenLabsHeaders(): Record<string, string> {
  return {
    "xi-api-key": getElevenLabsApiKey(),
  }
}

export async function fetchAudioFromUrl(url: string): Promise<Buffer> {
  // safeFetch: url is user-supplied (dubbing / voice-changer / forced-alignment
  // audioUrl|videoUrl). safeUrlSchema at the route gates literal private hosts;
  // safeFetch blocks DNS-rebinding to internal/metadata IPs at connect time.
  const response = await safeFetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch audio from URL (${response.status})`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/** Thrown when a source file exceeds the caller's byte budget — the message is
 *  user-facing and actionable (trim, or hand ElevenLabs the link directly). */
export class MediaTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(
      `The source file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. ` +
      `Trim the clip first, or dub from a public link (source URL) so the file never passes through this server.`,
    )
    this.name = "MediaTooLargeError"
  }
}

/**
 * `fetchAudioFromUrl` with a hard byte cap — for callers that buffer the whole
 * source into worker memory before re-uploading it (dubbing can take a
 * 30-minute VIDEO, which unbounded would stream multi-GB through RAM). Checks
 * Content-Length first (cheap reject), then enforces the cap on the actual
 * stream — a server that lies about (or omits) the header can't blow past it.
 */
export async function fetchMediaFromUrl(url: string, maxBytes: number): Promise<Buffer> {
  const response = await safeFetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch media from URL (${response.status})`)
  }
  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MediaTooLargeError(maxBytes)
  }
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.byteLength > maxBytes) throw new MediaTooLargeError(maxBytes)
    return buf
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new MediaTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks)
}
