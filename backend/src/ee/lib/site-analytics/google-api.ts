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

/** The older API generation's names (Search Console still answers with them), in today's words. */
const LEGACY_REASONS: Readonly<Record<string, string>> = {
  forbidden: "PERMISSION_DENIED",
  insufficientPermissions: "PERMISSION_DENIED",
  accessNotConfigured: "SERVICE_DISABLED",
}

/**
 * Google's code for a refusal: an ErrorInfo detail's `reason`
 * (SERVICE_DISABLED, …), else the status (PERMISSION_DENIED, …), else the
 * older `errors[].reason` that Search Console's v3 API still sends — its
 * "forbidden" is the same refusal as PERMISSION_DENIED and is named so.
 */
export function googleErrorReason(body: unknown): string | undefined {
  const error = (body as { error?: { status?: unknown; details?: unknown; errors?: unknown } } | null)?.error
  if (!error || typeof error !== "object") return undefined
  const details = Array.isArray(error.details) ? (error.details as Array<{ reason?: unknown }>) : []
  const detailed = details.find((d) => typeof d?.reason === "string")?.reason
  if (typeof detailed === "string") return detailed
  if (typeof error.status === "string") return error.status
  const legacy = (Array.isArray(error.errors) ? (error.errors as Array<{ reason?: unknown }>) : []).find((e) => typeof e?.reason === "string")?.reason
  if (typeof legacy !== "string") return undefined
  return Object.hasOwn(LEGACY_REASONS, legacy) ? LEGACY_REASONS[legacy] : legacy
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
