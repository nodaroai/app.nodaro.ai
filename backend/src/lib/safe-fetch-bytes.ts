import { safeFetch } from "./safe-fetch.js"

const MAX_CAPTURE_BYTES = 25 * 1024 * 1024

/** Public HTTP retrieval with the normal SSRF checks and a decoded-byte cap.
 * This does not authorize a source or attach storage credentials. */
export async function safeFetchBytes(url: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CAPTURE_BYTES) {
    throw new Error("Invalid image download limit")
  }
  const response = await safeFetch(url, { timeoutMs: 30_000 })
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Image download returned no body")
  let finished = false
  try {
    if (!response.ok) throw new Error("Image download failed")
    if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Image download exceeds the size limit")
    const chunks: Buffer[] = []
    let length = 0
    while (true) {
      const part = await reader.read()
      if (part.done) { finished = true; break }
      length += part.value.byteLength
      if (length > maxBytes) throw new Error("Image download exceeds the size limit")
      chunks.push(Buffer.from(part.value))
    }
    if (!length) throw new Error("Image download returned no bytes")
    return Buffer.concat(chunks, length)
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
