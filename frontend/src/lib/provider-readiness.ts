/**
 * One reader for "can this install generate anything at all".
 *
 * `GET /v1/setup/status` is the single source for what an install can reach
 * (it needs no auth, on purpose — the setup screen runs before login). This
 * wraps the one field callers actually branch on, so nothing has to re-derive
 * readiness from a key list or, worse, from matching an error string.
 *
 * Used by the dashboard callout and by the editor's connect dialog (#771).
 */
export interface ProviderReadiness {
  /** False when the install has no provider key AND no nodaro.ai connection. */
  readonly ok: boolean
  /** True when a nodaro.ai connection is what covers this install. */
  readonly nodaroCloud: boolean
}

interface StatusShape {
  readonly checks?: {
    readonly providers?: { readonly ok?: boolean; readonly nodaroCloud?: boolean }
  }
}

/**
 * Returns null when the answer is unknown (offline, 5xx, malformed). Callers
 * must treat null as "do not act" rather than as "not ready" — a transient
 * failure must never be rendered as a configuration problem.
 */
export async function fetchProviderReadiness(): Promise<ProviderReadiness | null> {
  try {
    // Bounded: a hung request must resolve to the unknown answer callers
    // already handle, not leave the decision pending forever.
    const res = await fetch("/v1/setup/status", {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as StatusShape
    const providers = json.checks?.providers
    if (!providers || typeof providers.ok !== "boolean") return null
    return { ok: providers.ok, nodaroCloud: providers.nodaroCloud === true }
  } catch {
    return null
  }
}
