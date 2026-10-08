/** The slice of `fetch` Site Analytics uses — injectable, so tests answer for Google. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * Google refused or failed a request. `message` is Google's own words: an
 * admin reads it to fix access. `reason` is Google's code for it
 * (PERMISSION_DENIED, SERVICE_DISABLED, …), so the page can say what to do.
 */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message)
    this.name = "GoogleApiError"
  }
}

const REQUEST_TIMEOUT_MS = 20_000
const MESSAGE_MAX = 500

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Google's reason, from either error shape it answers with: `{ error: { message } }` or OAuth's `{ error, error_description }`. */
export function googleErrorMessage(body: unknown, status: number): string {
  const { error, error_description: description } = (body ?? {}) as { error?: unknown; error_description?: unknown }
  const message =
    typeof description === "string" ? description
    : typeof error === "string" ? error
    : typeof (error as { message?: unknown } | undefined)?.message === "string" ? (error as { message: string }).message
    : `Google answered ${status}.`
  return message.slice(0, MESSAGE_MAX)
}

/** Google's code for a refusal: an ErrorInfo detail's `reason` (SERVICE_DISABLED, …), else the status (PERMISSION_DENIED, …). */
export function googleErrorReason(body: unknown): string | undefined {
  const error = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error
  if (!error || typeof error !== "object") return undefined
  const details = Array.isArray(error.details) ? (error.details as Array<{ reason?: unknown }>) : []
  const detailed = details.find((d) => typeof d?.reason === "string")?.reason
  if (typeof detailed === "string") return detailed
  return typeof error.status === "string" ? error.status : undefined
}

/** One authorized call to a Google API: JSON in (when there is a body), JSON out, Google's reason on failure. */
export async function googleJson<T>(fetch: FetchLike, url: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const parsed = parseJson(await res.text())
  if (!res.ok) throw new GoogleApiError(res.status, googleErrorMessage(parsed, res.status), googleErrorReason(parsed))
  return (parsed ?? {}) as T
}
