/** Bound decoded response bytes even when Content-Length is absent or compressed. */
export async function readBinaryResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const advertised = response.headers.get("content-length")
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) {
    await response.body?.cancel()
    throw new Error("Binary response exceeds its declared size limit")
  }
  if (!response.body) return new ArrayBuffer(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error("Binary response exceeds its declared size limit")
      }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes.buffer
}
