import { getAuthHeaders } from "@/lib/api"

/** Where consent was answered (best-effort attribution). Each app that mounts
 *  the consent UI passes its own slug; this build is app.nodaro.ai. */
export const SOURCE_APP = "app"

/** Shape of GET /v1/consent/state (Cloud-only backend route). */
export interface ConsentState {
  shouldShow: boolean
  status: string
  /** The admin-configured body copy — present only when shouldShow is true. */
  text?: string
  version?: number
}

/** Whether to show the prompt now. Never throws — any failure is treated as
 *  "don't show" so a hiccup on this poll can't break the app shell. */
export async function fetchConsentState(): Promise<ConsentState> {
  try {
    const res = await fetch("/v1/consent/state", { headers: await getAuthHeaders(), cache: "no-store" })
    if (!res.ok) return { shouldShow: false, status: "error" }
    return (await res.json()) as ConsentState
  } catch {
    return { shouldShow: false, status: "error" }
  }
}

async function postConsent(path: string, body: Record<string, unknown> = {}): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`consent ${path} failed (${res.status})`)
}

/** Read-only current status (does NOT stamp a show — safe for Settings). */
export interface ConsentStatus {
  status: string
  subscribed: boolean
}

export async function fetchConsentStatus(): Promise<ConsentStatus> {
  try {
    const res = await fetch("/v1/consent/status", { headers: await getAuthHeaders(), cache: "no-store" })
    if (!res.ok) return { status: "unknown", subscribed: false }
    return (await res.json()) as ConsentStatus
  } catch {
    return { status: "unknown", subscribed: false }
  }
}

/** Approve — subscribe to marketing email. */
export function grantConsent(sourceApp?: string): Promise<void> {
  return postConsent("/v1/consent/grant", sourceApp ? { sourceApp } : {})
}

/** "No thanks" — terminal decline, never asked again. */
export function declineConsent(): Promise<void> {
  return postConsent("/v1/consent/decline")
}

/** Opt out from Settings after having granted. */
export function withdrawConsent(): Promise<void> {
  return postConsent("/v1/consent/withdraw")
}
