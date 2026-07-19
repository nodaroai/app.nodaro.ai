/**
 * Parse a fetch Response as JSON, but NEVER leak a raw parser error
 * ("Unexpected token '<', <!DOCTYPE …") when the upstream returns HTML — which
 * social APIs do for a bad token / rate limit / Cloudflare challenge / wrong
 * host. Those errors bubble up as the user-facing connect/publish message, so
 * a raw parse error reads as gibberish. On non-JSON, throw a clean, provider-
 * named message instead.
 */
export async function parseJsonOrThrow<T>(res: Response, providerLabel: string): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    // Non-JSON body — almost always an HTML error page.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${providerLabel} rejected the credential — check the token/password and try again.`)
    }
    if (res.status === 429) {
      throw new Error(`${providerLabel} is rate‑limiting requests — try again in a moment.`)
    }
    throw new Error(`${providerLabel} returned an unexpected (non‑JSON) response${res.status ? ` (HTTP ${res.status})` : ""}.`)
  }
}
