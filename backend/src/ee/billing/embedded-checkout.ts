/**
 * Stripe's embedded Checkout: the payment form drawn inside an app's own page
 * instead of on Stripe's Checkout page.
 *
 * A billing route asked for `uiMode: "embedded"` creates its session with
 * `embeddedSessionParams()` in place of the hosted session's return
 * addresses, and answers `embeddedSessionAnswer(session)`: the client secret
 * the app mounts the form with, and the session id it asks about once the
 * form completes. The app mounts the form with the publishable key that
 * `stripePublishableKey()` hands it; without one it stays on the hosted page.
 */
import type Stripe from "stripe"
import { config } from "../../lib/config.js"

/** How a Checkout is shown: Stripe's own page (the default) or the form inside the app. */
export const BILLING_UI_MODES = ["hosted", "embedded"] as const
export type BillingUiMode = (typeof BILLING_UI_MODES)[number]

/**
 * The embedded form's look, on the apps' dark surface. No `display_name`,
 * `icon` or `logo`: the Stripe dashboard's business name and marks show.
 */
export const EMBEDDED_CHECKOUT_BRANDING: Stripe.Checkout.SessionCreateParams.BrandingSettings = {
  background_color: "#0c0d10",
  button_color: "#E11D6B",
  border_style: "rounded",
  font_family: "inter",
}

/**
 * What an embedded session sets in place of a hosted one's return addresses:
 * it never redirects (the app learns the outcome itself), so it carries no
 * `success_url`, `cancel_url` or `return_url` at all.
 */
export function embeddedSessionParams(): Pick<
  Stripe.Checkout.SessionCreateParams,
  "ui_mode" | "redirect_on_completion" | "branding_settings"
> {
  return { ui_mode: "embedded", redirect_on_completion: "never", branding_settings: EMBEDDED_CHECKOUT_BRANDING }
}

/** A route's answer for an embedded session: no address to go to, the form's secret and the session's id. */
export interface EmbeddedSessionAnswer {
  url: null
  clientSecret: string
  sessionId: string
}

/** The answer for an embedded session; one Stripe returned without a client secret is an error. */
export function embeddedSessionAnswer(session: Pick<Stripe.Checkout.Session, "id" | "client_secret">): EmbeddedSessionAnswer {
  if (!session.client_secret) throw new Error(`embedded Checkout session ${session.id} has no client secret`)
  return { url: null, clientSecret: session.client_secret, sessionId: session.id }
}

const PUBLISHABLE_KEY = /^pk_(live|test)_[A-Za-z0-9]+$/
const SECRET_KEY_MODE = /^(sk|rk)_(live|test)_/

interface PublishableKeySettings {
  STRIPE_PUBLISHABLE_KEY: string
  VITE_STRIPE_PUBLISHABLE_KEY: string
  STRIPE_SECRET_KEY: string
}

/**
 * The Stripe publishable key apps mount the embedded form with:
 * `STRIPE_PUBLISHABLE_KEY`, else `VITE_STRIPE_PUBLISHABLE_KEY`, and only a
 * publishable key of the secret key's own mode. Anything else (unset, a
 * secret or restricted key pasted in, the other mode, no secret key) is
 * `null`, and apps use the hosted page. A setting that is `undefined` (a
 * test that mocks `config` wholesale) reads as empty.
 */
export function stripePublishableKey(settings: PublishableKeySettings = config): string | null {
  const own = (settings.STRIPE_PUBLISHABLE_KEY ?? "").trim()
  const candidate = own !== "" ? own : (settings.VITE_STRIPE_PUBLISHABLE_KEY ?? "").trim()
  const publishable = PUBLISHABLE_KEY.exec(candidate)
  const secret = SECRET_KEY_MODE.exec((settings.STRIPE_SECRET_KEY ?? "").trim())
  if (!publishable || !secret) return null
  return publishable[1] === secret[2] ? candidate : null
}
