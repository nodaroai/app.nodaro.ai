import { describe, it, expect } from "vitest"
import {
  decideSignupGrant,
  domainKeyOf,
  emailStem,
  hostedDomainOf,
  SIGNUP_GRANT_RULES,
  siblingTakebackDue,
  withheldForKeylessOnly,
  type SignupSignalCounts,
} from "../signup-grant-policy.js"

describe("siblingTakebackDue — rule 6, which withholds are evidence against the first of a series", () => {
  it("the exact links: same browser, same device (on the address or not), same address within the day", () => {
    expect(siblingTakebackDue(["browser_match"])).toBe(true)
    expect(siblingTakebackDue(["device_ip_match"])).toBe(true)
    expect(siblingTakebackDue(["device_cluster"])).toBe(true)
    expect(siblingTakebackDue(["ip_velocity"])).toBe(true)
    expect(siblingTakebackDue(["domain_reuse", "ip_velocity"])).toBe(true)
  })

  it("never a neighbourhood, a domain, a name, a server or a missing key alone", () => {
    for (const r of ["net_velocity", "domain_reuse", "similar_email", "hosting_network", "keyless", "keyless_ip_reuse", "email_only_provider", "ip_reuse"]) {
      expect(siblingTakebackDue([r])).toBe(false)
    }
    expect(siblingTakebackDue([])).toBe(false)
    expect(siblingTakebackDue(null)).toBe(false)
  })
})

describe("withheldForKeylessOnly — which withholds a keyed retry may overturn", () => {
  it("only a withhold made of the keyless reasons alone", () => {
    expect(withheldForKeylessOnly(["keyless"])).toBe(true)
    expect(withheldForKeylessOnly(["keyless", "keyless_ip_reuse"])).toBe(true)
    expect(withheldForKeylessOnly(["keyless_ip_reuse"])).toBe(true)
  })

  it("never one that carries any other rule, and never an empty or missing list", () => {
    expect(withheldForKeylessOnly(["keyless", "email_only_provider"])).toBe(false)
    expect(withheldForKeylessOnly(["keyless", "hosting_network"])).toBe(false)
    expect(withheldForKeylessOnly(["browser_match"])).toBe(false)
    expect(withheldForKeylessOnly([])).toBe(false)
    expect(withheldForKeylessOnly(null)).toBe(false)
    expect(withheldForKeylessOnly(undefined)).toBe(false)
  })
})

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

describe("decideSignupGrant — repeat signups that hide their device", () => {
  it("a claim with no keys withholds when any other account was ever seen on the network", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, ipEverOthers: 1 }, keyless: true })).toEqual({
      decision: "withheld",
      reasons: ["keyless", "keyless_ip_reuse"],
    })
    // With keys, the device rules speak instead; an old neighbour on the network alone is not enough.
    expect(decideSignupGrant({ providers: google, counts: { ...clean, ipEverOthers: 1 }, keyless: false }).decision).toBe("granted")
  })

  it("a claim with no keys gets nothing even when every count is clean (2026-10-12)", () => {
    // Who does not show who they are gets no gift. The reason stands alone,
    // so a keyed retry can tell it apart from a withhold it may not overturn.
    expect(decideSignupGrant({ providers: google, counts: clean, keyless: true })).toEqual({ decision: "withheld", reasons: ["keyless"] })
    expect(decideSignupGrant({ providers: google, counts: null, keyless: true })).toEqual({ decision: "withheld", reasons: ["keyless"] })
    expect(decideSignupGrant({ providers: google, counts: clean, keyless: false })).toEqual({ decision: "granted", reasons: [] })
  })

  it("another account named like this one withholds, keys or not", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, similarEmailOthers: 2 } })).toEqual({ decision: "withheld", reasons: ["similar_email"] })
  })
})

describe("decideSignupGrant — a network that already carries a crowd", () => {
  it("withholds a keyed claim once more than the threshold of accounts were ever seen on the network", () => {
    const at = decideSignupGrant({
      providers: google,
      counts: { ...clean, ipEverOthers: SIGNUP_GRANT_RULES.ipEverOthersMax },
      keyless: false,
    })
    expect(at.decision).toBe("granted")
    const over = decideSignupGrant({
      providers: google,
      counts: { ...clean, ipEverOthers: SIGNUP_GRANT_RULES.ipEverOthersMax + 1 },
      keyless: false,
    })
    expect(over).toEqual({ decision: "withheld", reasons: ["ip_reuse"] })
  })

  it("a keyless claim keeps its own, stricter rule and never carries both", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, ipEverOthers: 10 }, keyless: true })).toEqual({
      decision: "withheld",
      reasons: ["keyless", "keyless_ip_reuse"],
    })
  })

  it("the keyless reason sits right after the provider rule in the stable order", () => {
    const r = decideSignupGrant({
      providers: ["email"],
      counts: { browserKeyOthers: 2, deviceKeySameIpOthers: 2, deviceKeyOthers: 5, ipClaimsInWindow: 9, ipEverOthers: 9 },
      keyless: true,
    })
    expect(r.reasons).toEqual(["email_only_provider", "keyless", "browser_match", "device_ip_match", "device_cluster", "ip_velocity", "keyless_ip_reuse"])
  })

  it("takes its place after velocity in the stable order", () => {
    const r = decideSignupGrant({
      providers: ["email"],
      counts: { browserKeyOthers: 2, deviceKeySameIpOthers: 2, deviceKeyOthers: 5, ipClaimsInWindow: 9, ipEverOthers: 9 },
    })
    expect(r.reasons).toEqual(["email_only_provider", "browser_match", "device_ip_match", "device_cluster", "ip_velocity", "ip_reuse"])
  })
})

describe("emailStem", () => {
  it("cuts the trailing digits, Gmail dots and +tags", () => {
    expect(emailStem("Series.Name027+x@GoogleMail.com")).toEqual({ stem: "seriesname", domain: "googlemail.com", local: "seriesname027" })
    expect(emailStem("seriesname29@example.com")?.stem).toBe("seriesname")
  })

  it("compares only numbered names with enough letters or digits", () => {
    expect(emailStem("seriesname@example.com")).toBeNull()
    expect(emailStem("bob7@example.com")).toBeNull()
    expect(emailStem("ab12@example.com")).toBeNull()
    expect(emailStem("not-an-email")).toBeNull()
  })

  it("the 2026-10-12 series: a name that is mostly digits is still a name", () => {
    // Five accounts on one domain, hours apart, each granted — the stem keeps
    // two letters and eleven characters, and counting letters alone never
    // compared them. The series is the permanent case for this rule.
    const series = [
      "yy516726652_27@2925.com",
      "yy516726652_28@2925.com",
      "yy516726652_29@2925.com",
      "yy516726652_2@2925.com",
      "yy516726652_35@2925.com",
    ]
    for (const email of series) {
      expect(emailStem(email)).toEqual({ stem: "yy516726652_", domain: "2925.com", local: email.split("@")[0] })
    }
    // A whole-digit name is not a series of anything — cutting the digits leaves nothing.
    expect(emailStem("516726652@qq.com")).toBeNull()
  })
})

describe("decideSignupGrant — the network rules (2026-10-12)", () => {
  it("the SECOND claim from one address in a rolling day withholds (the line was four)", () => {
    expect(SIGNUP_GRANT_RULES.ipClaimsLookbackMax).toBe(0)
    expect(decideSignupGrant({ providers: google, counts: { ...clean, ipClaimsInWindow: 1 } })).toEqual({
      decision: "withheld",
      reasons: ["ip_velocity"],
    })
  })

  it("the second claim from one neighbourhood (/24, /48) inside the hour withholds", () => {
    expect(SIGNUP_GRANT_RULES.netLookbackMs).toBe(60 * 60 * 1000)
    expect(decideSignupGrant({ providers: google, counts: { ...clean, netClaimsInWindow: 0 } }).decision).toBe("granted")
    expect(decideSignupGrant({ providers: google, counts: { ...clean, netClaimsInWindow: 1 } })).toEqual({
      decision: "withheld",
      reasons: ["net_velocity"],
    })
  })

  it("a claim from a published hosting range withholds — a server is not a person", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, hosting: true } })).toEqual({
      decision: "withheld",
      reasons: ["hosting_network"],
    })
    expect(decideSignupGrant({ providers: google, counts: { ...clean, hosting: false } }).decision).toBe("granted")
  })

  it("a purchase still outranks every network rule", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, ipClaimsInWindow: 5, netClaimsInWindow: 5, hosting: true }, hasPurchase: true }).decision).toBe("granted")
  })
})

describe("decideSignupGrant — one grant per organisation (temporary, 2026-10)", () => {
  it("the second account from an organisation withholds; the first is granted", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, domainOthers: 0 } }).decision).toBe("granted")
    expect(decideSignupGrant({ providers: google, counts: { ...clean, domainOthers: 1 } })).toEqual({
      decision: "withheld",
      reasons: ["domain_reuse"],
    })
  })

  it("an account with no organisation key (a public provider) is never counted", () => {
    expect(decideSignupGrant({ providers: google, counts: clean }).decision).toBe("granted")
  })

  it("the admin's runtime number replaces the compiled one", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, domainOthers: 3 }, domainOthersMax: 3 }).decision).toBe("granted")
    expect(decideSignupGrant({ providers: google, counts: { ...clean, domainOthers: 4 }, domainOthersMax: 3 }).reasons).toEqual(["domain_reuse"])
  })

  it("takes its place last in the stable order", () => {
    const r = decideSignupGrant({
      providers: ["email"],
      counts: { browserKeyOthers: 2, deviceKeySameIpOthers: 2, deviceKeyOthers: 5, ipClaimsInWindow: 9, ipEverOthers: 9, similarEmailOthers: 1, domainOthers: 1 },
    })
    expect(r.reasons).toEqual(["email_only_provider", "browser_match", "device_ip_match", "device_cluster", "ip_velocity", "ip_reuse", "similar_email", "domain_reuse"])
  })
})

describe("domainKeyOf — the organisation an account belongs to", () => {
  it("Google's hd claim wins, lower-cased", () => {
    expect(domainKeyOf("anna@widgets.example", "WIDGETS.EXAMPLE")).toBe("widgets.example")
    expect(domainKeyOf("someone@qq.com", "acme.example")).toBe("acme.example")
  })

  it("falls back to the email's domain", () => {
    expect(domainKeyOf("Mark@Example-Co.io", null)).toBe("example-co.io")
  })

  it("a public mail provider is no organisation — compiled list or the admin's additions", () => {
    expect(domainKeyOf("dani@qq.com", null)).toBeNull()
    expect(domainKeyOf("yy000000000_00@2925.com", null)).toBeNull()
    expect(domainKeyOf("dani@mail.ru", null)).toBeNull()
    expect(domainKeyOf("dani@mail-provider.example", null)).toBe("mail-provider.example")
    expect(domainKeyOf("dani@mail-provider.example", null, new Set(["mail-provider.example"]))).toBeNull()
  })

  it("an unusable email has no key", () => {
    expect(domainKeyOf(null, null)).toBeNull()
    expect(domainKeyOf("not-an-email", null)).toBeNull()
    expect(domainKeyOf("dani@localhost", null)).toBeNull()
  })
})

describe("hostedDomainOf — where GoTrue files Google's hd claim", () => {
  it("reads custom_claims.hd off the google identity", () => {
    expect(hostedDomainOf([{ provider: "google", identity_data: { email: "a@gkhalh.us", custom_claims: { hd: "gkhalh.us" } } }])).toBe("gkhalh.us")
  })
  it("a personal Google account has none; other providers are ignored", () => {
    expect(hostedDomainOf([{ provider: "google", identity_data: { email: "a@2925.com" } }])).toBeNull()
    expect(hostedDomainOf([{ provider: "email", identity_data: { hd: "x.example" } }])).toBeNull()
    expect(hostedDomainOf(undefined)).toBeNull()
  })
})

describe("decideSignupGrant — a purchase on record is the evidence", () => {
  const everyRuleFires: SignupSignalCounts = {
    browserKeyOthers: 3,
    deviceKeySameIpOthers: 2,
    deviceKeyOthers: SIGNUP_GRANT_RULES.deviceKeyOthersMax + 1,
    ipClaimsInWindow: SIGNUP_GRANT_RULES.ipClaimsLookbackMax + 1,
    ipEverOthers: 4,
    similarEmailOthers: 2,
  }

  it("grants an account that has paid, whatever the device, network, name and provider rules say", () => {
    expect(decideSignupGrant({ providers: ["email"], counts: everyRuleFires, keyless: true, hasPurchase: true })).toEqual({
      decision: "granted",
      reasons: [],
    })
  })

  it("changes nothing for an account that has not paid", () => {
    const r = decideSignupGrant({ providers: ["email"], counts: everyRuleFires, keyless: true, hasPurchase: false })
    expect(r.decision).toBe("withheld")
    expect(r.reasons).toEqual(
      expect.arrayContaining(["email_only_provider", "browser_match", "device_ip_match", "device_cluster", "ip_velocity", "keyless_ip_reuse", "similar_email"]),
    )
  })
})

describe("decideSignupGrant — the signed cookie (PR 5)", () => {
  const google = ["google"]
  const clean: SignupSignalCounts = { browserKeyOthers: 0, deviceKeySameIpOthers: 0, deviceKeyOthers: 0, ipClaimsInWindow: 0 }

  it("shadow by default: a cookie another account carried is recorded, never decides", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, cookieOthers: 3 } })).toEqual({ decision: "granted", reasons: [] })
    expect(decideSignupGrant({ providers: google, counts: { ...clean, cookieOthers: 3 }, cookieRule: false }).decision).toBe("granted")
  })

  it("on: one other account with this browser's cookie withholds", () => {
    expect(decideSignupGrant({ providers: google, counts: { ...clean, cookieOthers: 1 }, cookieRule: true })).toEqual({ decision: "withheld", reasons: ["cookie_match"] })
    expect(decideSignupGrant({ providers: google, counts: { ...clean, cookieOthers: 0 }, cookieRule: true }).decision).toBe("granted")
  })
})
