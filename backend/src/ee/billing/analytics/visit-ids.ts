import { z } from "zod"

/**
 * The visitor's Google Analytics ids, carried from a checkout request into the
 * payment's Stripe metadata, so the payment can later be reported against the
 * visit that started it (report-purchase.ts). The browser reads them from the
 * GA cookies (frontend/src/lib/analytics/ga-cookies.ts).
 *
 * Never required, and never trusted for anything else: a malformed value is
 * dropped, not refused — a purchase never fails over analytics, and nothing in
 * billing reads these keys.
 */

export const GA_CLIENT_ID_KEY = "ga_client_id"
export const GA_SESSION_ID_KEY = "ga_session_id"

const CLIENT_ID = /^\d{1,20}\.\d{1,20}$/
const SESSION_ID = /^\d{1,20}$/

/** Request-body fields: a malformed value parses as absent. */
export const gaClientIdField = z.string().regex(CLIENT_ID).optional().catch(undefined)
export const gaSessionIdField = z.string().regex(SESSION_ID).optional().catch(undefined)

export interface GaVisitIds {
  readonly gaClientId?: string
  readonly gaSessionId?: string
}

/** The Stripe metadata entries for a checkout's visit ids (none when absent). */
export function gaVisitMetadata(ids: GaVisitIds): Record<string, string> {
  return {
    ...(ids.gaClientId && CLIENT_ID.test(ids.gaClientId) ? { [GA_CLIENT_ID_KEY]: ids.gaClientId } : {}),
    ...(ids.gaSessionId && SESSION_ID.test(ids.gaSessionId) ? { [GA_SESSION_ID_KEY]: ids.gaSessionId } : {}),
  }
}

/** The visit ids a payment's metadata carries, checked again (metadata is only strings). */
export function gaVisitIdsOf(metadata: Readonly<Record<string, string>> | null | undefined): {
  readonly clientId: string | null
  readonly sessionId: string | null
} {
  const clientId = metadata?.[GA_CLIENT_ID_KEY]
  const sessionId = metadata?.[GA_SESSION_ID_KEY]
  return {
    clientId: typeof clientId === "string" && CLIENT_ID.test(clientId) ? clientId : null,
    sessionId: typeof sessionId === "string" && SESSION_ID.test(sessionId) ? sessionId : null,
  }
}
