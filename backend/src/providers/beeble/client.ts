/**
 * Beeble API client — auth transport, request helper, error mapping.
 *
 * Beeble (https://beeble.ai) is a direct-call vendor (no registry/router),
 * the same shape as the HeyGen provider: a single-provider node (`switchx`)
 * calls the SwitchX relight endpoints directly.
 *
 * Auth: `x-api-key: <key>` header.
 * Base URL: https://api.beeble.ai
 */

import { config } from "../../lib/config.js"

const BASE_URL = "https://api.beeble.ai"

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

/**
 * Returns true when BEEBLE_API_KEY is set (non-empty string).
 * When false, the SwitchX route/worker should short-circuit before any call.
 */
export function isBeebleConfigured(): boolean {
  return !!config.BEEBLE_API_KEY
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class BeebleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "BeebleError"
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, BeebleError.prototype)
  }
}

// ---------------------------------------------------------------------------
// Base fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetches a Beeble API endpoint.
 *
 * - Prepends BASE_URL to the given path.
 * - Injects `x-api-key` and `Content-Type: application/json` headers
 *   (caller-supplied headers win on conflict).
 * - Parses the JSON response (empty body → `{}`).
 * - Throws `BeebleError` (carrying `.code` + `.status`) on a non-2xx status
 *   OR on a response whose body contains `{ error: { code, message } }`.
 */
export async function beebleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": config.BEEBLE_API_KEY,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  const text = await res.text()
  const body = text ? JSON.parse(text) : {}

  if (!res.ok || body?.error) {
    const code = body?.error?.code ?? `HTTP_${res.status}`
    const msg = body?.error?.message ?? `Beeble request failed (${res.status})`
    throw new BeebleError(msg, code, res.status)
  }

  return body as T
}
