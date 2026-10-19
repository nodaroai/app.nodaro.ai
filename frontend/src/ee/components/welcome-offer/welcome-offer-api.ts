import { getAuthHeaders } from "@/lib/api"
import { consentInterfaceLocale } from "@/ee/lib/consent-locale"

/** Where the offer was answered (best-effort attribution). Each app that
 *  mounts the welcome offer passes its own slug; this build is app.nodaro.ai. */
export const SOURCE_APP = "app"

export type WelcomeGrantState = "unclaimed" | "granted" | "withheld"

/** Shape of POST /v1/credits/welcome-offer/claim (Cloud-only backend route). */
export interface WelcomeOfferClaimResult {
  consent: "granted"
  grant: WelcomeGrantState
  credits: number
}

/**
 * "Yes, email me & add the credits" — ONE server action: the marketing-email
 * consent is recorded and the signup grant is claimed with the consent gate
 * on. The fingerprints ride along like the boot-time claim's, so the abuse
 * gate scores the same signals it would have at signup, and so does the
 * interface language the "yes" was given in, which the server records with
 * the consent. Throws on failure; the popup keeps its CTA up so the user can
 * retry.
 */
export async function claimWelcomeOffer(keys: { browserKey?: string; deviceKey?: string }): Promise<WelcomeOfferClaimResult> {
  const res = await fetch("/v1/credits/welcome-offer/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ sourceApp: SOURCE_APP, locale: consentInterfaceLocale(), ...keys }),
  })
  if (!res.ok) throw new Error(`welcome offer claim failed (${res.status})`)
  return (await res.json()) as WelcomeOfferClaimResult
}

/** The popup was shown once. Never throws — a failed stamp only means the
 *  popup may show once more on the next visit. */
export async function markWelcomeOfferSeen(): Promise<void> {
  try {
    await fetch("/v1/credits/welcome-offer/seen", { method: "POST", headers: await getAuthHeaders() })
  } catch {
    // deliberately silent
  }
}
