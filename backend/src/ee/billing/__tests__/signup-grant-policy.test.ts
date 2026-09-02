import { describe, it, expect } from "vitest"
import {
  decideSignupGrant,
  SIGNUP_GRANT_RULES,
  type SignupSignalCounts,
} from "../signup-grant-policy.js"

const clean: SignupSignalCounts = {
  browserKeyOthers: 0,
  deviceKeySameIpOthers: 0,
  deviceKeyOthers: 0,
  ipClaimsInWindow: 0,
}

const google = ["google"]

describe("decideSignupGrant — the provider gate (primary close)", () => {
  it("grants a Google account with clean signals", () => {
    expect(decideSignupGrant({ providers: google, counts: clean })).toEqual({
      decision: "granted",
      reasons: [],
    })
  })

  it("withholds an account whose ONLY identity is the email provider", () => {
    expect(decideSignupGrant({ providers: ["email"], counts: clean })).toEqual({
      decision: "withheld",
      reasons: ["email_only_provider"],
    })
  })

  it("grants an email account that has ALSO linked a non-email provider", () => {
    expect(decideSignupGrant({ providers: ["email", "google"], counts: clean }).decision).toBe("granted")
  })

  it("treats any non-email provider as an identity (SSO, phone, GitHub)", () => {
    for (const p of ["sso:acme", "phone", "github", "azure"]) {
      expect(decideSignupGrant({ providers: [p], counts: clean }).decision).toBe("granted")
    }
  })

  it("FAILS OPEN when the provider list could not be read", () => {
    expect(decideSignupGrant({ providers: null, counts: clean }).decision).toBe("granted")
  })

  it("FAILS OPEN on an empty provider list — GoTrue always stamps at least one", () => {
    expect(decideSignupGrant({ providers: [], counts: clean }).decision).toBe("granted")
  })
})

describe("decideSignupGrant — device and network signals (the residual)", () => {
  it("withholds when another account already claimed from the same browser", () => {
    const r = decideSignupGrant({ providers: google, counts: { ...clean, browserKeyOthers: 1 } })
    expect(r).toEqual({ decision: "withheld", reasons: ["browser_match"] })
  })

  it("withholds when another account claimed from the same device on the same network", () => {
    const r = decideSignupGrant({ providers: google, counts: { ...clean, deviceKeySameIpOthers: 1, deviceKeyOthers: 1 } })
    expect(r.decision).toBe("withheld")
    expect(r.reasons).toContain("device_ip_match")
  })

  it("tolerates a device-signature collision from a DIFFERENT network below the cluster threshold", () => {
    // Identical-spec machines (a Mac fleet in one timezone) collide on the
    // hardware key; a different network is what says "probably a different
    // machine". Only a cluster of them is suspicious.
    const r = decideSignupGrant({
      providers: google,
      counts: { ...clean, deviceKeyOthers: SIGNUP_GRANT_RULES.deviceKeyOthersMax },
    })
    expect(r.decision).toBe("granted")
  })

  it("withholds a device-signature cluster even across networks", () => {
    const r = decideSignupGrant({
      providers: google,
      counts: { ...clean, deviceKeyOthers: SIGNUP_GRANT_RULES.deviceKeyOthersMax + 1 },
    })
    expect(r).toEqual({ decision: "withheld", reasons: ["device_cluster"] })
  })

  it("withholds on signup velocity from one network", () => {
    const at = decideSignupGrant({
      providers: google,
      counts: { ...clean, ipClaimsInWindow: SIGNUP_GRANT_RULES.ipClaimsLookbackMax },
    })
    expect(at.decision).toBe("granted")
    const over = decideSignupGrant({
      providers: google,
      counts: { ...clean, ipClaimsInWindow: SIGNUP_GRANT_RULES.ipClaimsLookbackMax + 1 },
    })
    expect(over).toEqual({ decision: "withheld", reasons: ["ip_velocity"] })
  })

  it("lists EVERY rule that fired, in a stable order", () => {
    const r = decideSignupGrant({
      providers: ["email"],
      counts: { browserKeyOthers: 2, deviceKeySameIpOthers: 2, deviceKeyOthers: 5, ipClaimsInWindow: 9 },
    })
    expect(r.reasons).toEqual([
      "email_only_provider",
      "browser_match",
      "device_ip_match",
      "device_cluster",
      "ip_velocity",
    ])
  })

  it("FAILS OPEN when the signal counts could not be read", () => {
    expect(decideSignupGrant({ providers: google, counts: null }).decision).toBe("granted")
  })

  it("a missing fingerprint is never, on its own, a reason to withhold", () => {
    // Stale bundles, privacy browsers and the server-side fallback claim all
    // arrive with no keys. Their counts are zero by construction, and zero
    // must grant — the provider gate is the close, not the fingerprint.
    expect(decideSignupGrant({ providers: google, counts: clean }).decision).toBe("granted")
  })
})

import { fallbackClaimDue, isForeignOrigin, FALLBACK_CLAIM_GRACE_MS } from "../signup-grant.js"

describe("fallbackClaimDue — the balance-read fallback yields to the browser first", () => {
  const now = Date.parse("2026-09-01T20:00:00Z")
  it("leaves a fresh account to the keyed boot-time claim", () => {
    expect(fallbackClaimDue(new Date(now - 5_000), now)).toBe(false)
    expect(fallbackClaimDue(new Date(now - FALLBACK_CLAIM_GRACE_MS + 1), now)).toBe(false)
  })
  it("claims once the grace has passed — a stale bundle never will", () => {
    expect(fallbackClaimDue(new Date(now - FALLBACK_CLAIM_GRACE_MS), now)).toBe(true)
    expect(fallbackClaimDue(new Date(now - 3_600_000), now)).toBe(true)
  })
  it("claims when the age is unknown — never strands an account at zero", () => {
    expect(fallbackClaimDue(null, now)).toBe(true)
    expect(fallbackClaimDue(new Date("garbage"), now)).toBe(true)
  })
})

describe("isForeignOrigin — any page but our own SPA skips the grace", () => {
  const PUBLIC_URL = "https://app.nodaro.ai"

  const call = (over: Partial<Parameters<typeof isForeignOrigin>[0]>) =>
    isForeignOrigin({ origin: undefined, publicUrl: PUBLIC_URL, host: "app.nodaro.ai", ...over })

  it("is false when there is no Origin header — a same-origin GET sends none", () => {
    expect(call({ origin: undefined })).toBe(false)
    expect(call({ origin: "" })).toBe(false)
    expect(call({ origin: "   " })).toBe(false)
  })

  it("is TRUE for a thin client — the production bug (a recast signup stranded at zero)", () => {
    // recast/studio/person/voice call this API cross-origin and never send
    // the keyed boot-time claim. No allowlist is consulted: every surface the
    // operator forgot to list would otherwise silently keep stranding users.
    expect(call({ origin: "https://recast.nodaro.ai" })).toBe(true)
    expect(call({ origin: "https://studio.nodaro.ai" })).toBe(true)
    expect(call({ origin: "chrome-extension://ourrealextensionid" })).toBe(true)
  })

  it("is TRUE for an origin we never published — a forged header buys only the 2 minutes", () => {
    expect(call({ origin: "https://x.invalid" })).toBe(true)
    expect(call({ origin: "https://recast.nodaro.ai.evil.test" })).toBe(true)
  })

  it("is false for our own origin — PUBLIC_URL", () => {
    expect(call({ origin: PUBLIC_URL })).toBe(false)
    expect(call({ origin: "https://APP.nodaro.ai" })).toBe(false)
  })

  it("is false when the Origin host equals the Host header, even with PUBLIC_URL unset", () => {
    expect(call({ origin: "https://self.host.example", publicUrl: "", host: "self.host.example" })).toBe(false)
    expect(call({ origin: "https://self.host.example", publicUrl: "", host: "Self.Host.Example" })).toBe(false)
    // And a different page on a self-host with no PUBLIC_URL is still foreign.
    expect(call({ origin: "https://other.example", publicUrl: "", host: "self.host.example" })).toBe(true)
  })

  it("is false when the Origin host equals the FIRST X-Forwarded-Host hop", () => {
    expect(
      call({
        origin: "https://front.example",
        publicUrl: "",
        host: "internal.railway.app",
        forwardedHost: "front.example, proxy.internal",
      }),
    ).toBe(false)
    // A later hop is not the host the client asked for.
    expect(
      call({
        origin: "https://proxy.internal",
        publicUrl: "",
        host: "internal.railway.app",
        forwardedHost: "front.example, proxy.internal",
      }),
    ).toBe(true)
  })

  it("is false for the localhost dev origins — the SPA on Vite still sends the keyed claim", () => {
    expect(call({ origin: "http://localhost:3000", publicUrl: "" })).toBe(false)
    expect(call({ origin: "http://localhost:5173", publicUrl: "" })).toBe(false)
    expect(call({ origin: "http://127.0.0.1:5173", publicUrl: "" })).toBe(false)
    expect(call({ origin: "http://[::1]:5173", publicUrl: "" })).toBe(false)
  })

  it("keeps the grace on an opaque, unparseable or hostless Origin — decides nothing on garbage", () => {
    for (const origin of ["null", "NULL", "not a url", "://///", "file:///etc/passwd"]) {
      expect(call({ origin })).toBe(false)
    }
  })

  it("ignores an unparseable PUBLIC_URL instead of throwing", () => {
    expect(call({ origin: PUBLIC_URL, publicUrl: "not a url" })).toBe(false)
    expect(call({ origin: "https://recast.nodaro.ai", publicUrl: "not a url" })).toBe(true)
  })

  it("handles ports on both sides", () => {
    // The Host header may carry the default port the origin omits.
    expect(call({ origin: PUBLIC_URL, publicUrl: "", host: "app.nodaro.ai:443" })).toBe(false)
    // An explicit, different port is a different origin.
    expect(call({ origin: "http://app.nodaro.ai:8080", publicUrl: "", host: "app.nodaro.ai" })).toBe(true)
    expect(call({ origin: "http://app.nodaro.ai:8080", publicUrl: "", host: "app.nodaro.ai:8080" })).toBe(false)
  })
})
