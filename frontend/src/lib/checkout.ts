import { createCheckoutSession } from "@/lib/api"
import { isEmbedded } from "@/hooks/use-embed-session-handoff"

/**
 * Guard the Checkout redirect target before it reaches a navigation sink.
 *
 * `url` is Stripe's server-generated `session.url` returned by our own backend
 * (the user only supplies an allowlist-validated `priceId`), so it is already
 * trusted. Validating the scheme is defense in depth: it guarantees a hostile
 * scheme (`javascript:`, `data:`, …) can never execute via `window.location`
 * even if the backend response were ever tampered with. HTTPS-only keeps real
 * Stripe URLs (incl. custom checkout domains) working with no behavior change.
 */
export function assertTrustedCheckoutUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("Invalid checkout URL")
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing to redirect to a non-HTTPS checkout URL (${parsed.protocol})`)
  }
  return url
}

/**
 * Start a Stripe Checkout for `priceId` and take the user to it.
 *
 * Single entry point for every "buy" button (subscription upgrade + credit
 * top-ups) so the embed handling can't drift between call sites:
 *
 * - **Embedded** (inside another app's iframe, e.g. studio.nodaro.ai's pricing
 *   / billing modal): Stripe Checkout can't render framed (`X-Frame-Options:
 *   DENY`), so open it in a new top-level tab, and flag the backend to return
 *   to the public no-auth `/checkout-complete` page (the normal `/billing`
 *   return URL would bounce that tab to login).
 * - **Top-level**: redirect in place, as before.
 *
 * Throws if the session can't be created (caller handles + toasts).
 */
export async function startCheckout(params: {
  priceId: string
  mode?: "subscription" | "payment"
}): Promise<void> {
  const embedded = isEmbedded()
  const url = assertTrustedCheckoutUrl(await createCheckoutSession({ ...params, embedded }))
  if (embedded) {
    window.open(url, "_blank", "noopener,noreferrer")
  } else {
    window.location.href = url
  }
}
