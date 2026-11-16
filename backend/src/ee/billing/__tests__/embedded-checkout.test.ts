import { describe, it, expect } from "vitest"
import {
  EMBEDDED_CHECKOUT_BRANDING,
  embeddedSessionAnswer,
  embeddedSessionParams,
  stripePublishableKey,
} from "../embedded-checkout.js"

/** A fake Stripe key, built at run time so the secret scan never sees the shape. */
const key = (kind: string, mode: string) => [kind, mode, "0".repeat(12)].join("_")

describe("embedded Checkout", () => {
  it("an embedded session never redirects, has no return addresses and is dark", () => {
    expect(embeddedSessionParams()).toEqual({ ui_mode: "embedded", redirect_on_completion: "never", branding_settings: EMBEDDED_CHECKOUT_BRANDING })
    expect(EMBEDDED_CHECKOUT_BRANDING).toEqual({ background_color: "#0c0d10", button_color: "#E11D6B", border_style: "rounded", font_family: "inter" })
    for (const k of ["success_url", "cancel_url", "return_url"]) expect(embeddedSessionParams()).not.toHaveProperty(k)
  })

  it("the embedded answer carries the client secret and the session id, and no url", () => {
    expect(embeddedSessionAnswer({ id: "cs_test_1", client_secret: "sec_1" })).toStrictEqual({ url: null, clientSecret: "sec_1", sessionId: "cs_test_1" })
    expect(() => embeddedSessionAnswer({ id: "cs_test_1", client_secret: null })).toThrow(/cs_test_1/)
    // A session whose secret is missing from the answer, or empty, is no better.
    expect(() => embeddedSessionAnswer({ id: "cs_test_1", client_secret: undefined as unknown as null })).toThrow(/cs_test_1/)
    expect(() => embeddedSessionAnswer({ id: "cs_test_1", client_secret: "" })).toThrow(/cs_test_1/)
  })
})

describe("stripePublishableKey", () => {
  it("the publishable key: its own setting first, the frontend's name second", () => {
    const sk = key("sk", "test")
    expect(stripePublishableKey({ STRIPE_PUBLISHABLE_KEY: key("pk", "test"), VITE_STRIPE_PUBLISHABLE_KEY: "", STRIPE_SECRET_KEY: sk })).toBe(key("pk", "test"))
    expect(stripePublishableKey({ STRIPE_PUBLISHABLE_KEY: "", VITE_STRIPE_PUBLISHABLE_KEY: key("pk", "test"), STRIPE_SECRET_KEY: sk })).toBe(key("pk", "test"))
    expect(stripePublishableKey({ STRIPE_PUBLISHABLE_KEY: ` ${key("pk", "test")}\n`, VITE_STRIPE_PUBLISHABLE_KEY: "", STRIPE_SECRET_KEY: sk })).toBe(key("pk", "test"))
  })

  it("never publishes anything that is not a publishable key of the secret key's mode", () => {
    const cases: Array<[string, string]> = [
      ["", key("sk", "test")], // unset
      [key("sk", "test"), key("sk", "test")], // a secret key pasted in
      [key("rk", "live"), key("sk", "live")], // a restricted key pasted in
      [key("pk", "live"), key("sk", "test")], // live key on a test-mode deployment
      [key("pk", "test"), key("rk", "live")], // test key on a live deployment
      [key("pk", "test"), ""], // no Stripe at all
      ["pk_test_", key("sk", "test")], // empty body
    ]
    for (const [pk, sk] of cases) expect(stripePublishableKey({ STRIPE_PUBLISHABLE_KEY: pk, VITE_STRIPE_PUBLISHABLE_KEY: "", STRIPE_SECRET_KEY: sk }), pk).toBeNull()
  })

  it("a setting left undefined (config mocked wholesale) reads as empty and never throws", () => {
    const settings = { STRIPE_SECRET_KEY: key("sk", "test") } as unknown as Parameters<typeof stripePublishableKey>[0]
    expect(stripePublishableKey(settings)).toBeNull()
  })
})
