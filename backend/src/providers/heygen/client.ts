/**
 * HeyGen API client — auth transport, request helper, error mapping.
 *
 * HeyGen auth: `X-Api-Key: <key>` header.
 * Base URL: https://api.heygen.com
 *
 * GOTCHA: HeyGen sometimes returns HTTP 200 with a body of shape
 *   `{ error: { code, message } }`
 * instead of a proper non-2xx status. Both cases are checked here.
 */

import { config } from "../../lib/config.js"
import type { RawHeygenErrorBody } from "./types.js"

export const HEYGEN_BASE_URL = "https://api.heygen.com"

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

/**
 * Returns true when HEYGEN_API_KEY is set (non-empty string).
 * When false, catalog functions return empty arrays and generation calls
 * should short-circuit.
 */
export function isHeygenConfigured(): boolean {
  return !!config.HEYGEN_API_KEY
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class HeygenError extends Error {
  /** HeyGen-supplied error code string (from the error body), if present. */
  readonly code?: string
  /** HTTP status code, if the error came from a non-2xx response. */
  readonly status?: number

  constructor(message: string, opts?: { code?: string; status?: number }) {
    super(message)
    this.name = "HeygenError"
    this.code = opts?.code
    this.status = opts?.status
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, HeygenError.prototype)
  }
}

// ---------------------------------------------------------------------------
// Base fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetches a HeyGen API endpoint.
 *
 * - Prepends HEYGEN_BASE_URL when the path does not start with "http".
 * - Injects `X-Api-Key` and `Content-Type: application/json` headers.
 * - Parses the JSON response.
 * - Throws `HeygenError` on non-2xx HTTP status.
 * - Throws `HeygenError` on a 200 response whose body contains
 *   `{ error: { code, message } }` (HeyGen's mixed-status error pattern).
 */
export async function heygenFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${HEYGEN_BASE_URL}${path}`

  const headers: Record<string, string> = {
    "X-Api-Key": config.HEYGEN_API_KEY,
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  }

  const response = await fetch(url, { ...init, headers })

  // Parse JSON regardless of status — the body may contain useful error info
  let body: T & RawHeygenErrorBody
  try {
    body = (await response.json()) as T & RawHeygenErrorBody
  } catch {
    // Non-JSON body on an error status
    throw new HeygenError(
      `HeyGen API error: HTTP ${response.status} (non-JSON response)`,
      { status: response.status },
    )
  }

  // Non-2xx HTTP status
  if (!response.ok) {
    const message =
      (body as RawHeygenErrorBody).error?.message ??
      (body as RawHeygenErrorBody).message ??
      `HTTP ${response.status}`
    const code = (body as RawHeygenErrorBody).error?.code
    throw new HeygenError(message, { code, status: response.status })
  }

  // 200-with-error body (HeyGen's mixed-status error pattern)
  const errorBody = body as RawHeygenErrorBody
  if (errorBody.error?.message) {
    throw new HeygenError(errorBody.error.message, { code: errorBody.error.code })
  }

  return body as T
}
