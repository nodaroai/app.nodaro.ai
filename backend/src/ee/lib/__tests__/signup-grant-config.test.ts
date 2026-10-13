import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import {
  getSignupGrantConfig,
  invalidateSignupGrantConfigCache,
  parseDomainOthersMax,
  parsePublicEmailDomains,
  SIGNUP_GRANT_CONFIG_DEFAULTS,
  SIGNUP_GRANT_COOKIE_RULE_KEY,
  SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY,
  SIGNUP_GRANT_PUBLIC_DOMAINS_KEY,
} from "../signup-grant-config.js"
import { supabase } from "../../../lib/supabase.js"

function mockRows(rows: Array<{ key: string; value: unknown }> | null, error: unknown = null) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error })
  const select = vi.fn().mockReturnValue({ in: inFn })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { inFn }
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateSignupGrantConfigCache()
})

describe("getSignupGrantConfig", () => {
  it("is the defaults when no row exists: one grant per organisation, no extra providers", async () => {
    mockRows([])
    expect(await getSignupGrantConfig()).toEqual(SIGNUP_GRANT_CONFIG_DEFAULTS)
  })

  it("reads exactly the three keys", async () => {
    const { inFn } = mockRows([])
    await getSignupGrantConfig()
    expect(inFn).toHaveBeenCalledWith("key", [SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY, SIGNUP_GRANT_PUBLIC_DOMAINS_KEY, SIGNUP_GRANT_COOKIE_RULE_KEY])
  })

  it("takes the admin's number and domains", async () => {
    mockRows([
      { key: SIGNUP_GRANT_DOMAIN_OTHERS_MAX_KEY, value: 2 },
      { key: SIGNUP_GRANT_PUBLIC_DOMAINS_KEY, value: ["Mail-Provider.example ", "other.example"] },
    ])
    const cfg = await getSignupGrantConfig()
    expect(cfg.domainOthersMax).toBe(2)
    expect([...cfg.publicEmailDomains]).toEqual(["mail-provider.example", "other.example"])
  })

  it("a cold-cache DB error is the defaults and never throws", async () => {
    mockRows(null, { message: "boom" })
    expect(await getSignupGrantConfig()).toEqual(SIGNUP_GRANT_CONFIG_DEFAULTS)
  })
})

describe("parseDomainOthersMax", () => {
  it("accepts a non-negative integer and nothing else", () => {
    expect(parseDomainOthersMax(0)).toBe(0)
    expect(parseDomainOthersMax(5)).toBe(5)
    for (const bad of ["3", 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000, null, true]) {
      expect(parseDomainOthersMax(bad)).toBe(SIGNUP_GRANT_CONFIG_DEFAULTS.domainOthersMax)
    }
  })
})

describe("parsePublicEmailDomains", () => {
  it("keeps plain domains, lower-cased, and drops the rest", () => {
    expect([...parsePublicEmailDomains(["A.example", " b.example ", "nodomain", "bad domain.example", 42, "", "-x.example"])]).toEqual([
      "a.example",
      "b.example",
    ])
    expect(parsePublicEmailDomains("a.example").size).toBe(0)
  })
})
