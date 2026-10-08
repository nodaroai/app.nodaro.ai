import { beforeAll, describe, expect, it, vi } from "vitest"
import { exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from "jose"
import { createTokenSource, GOOGLE_TOKEN_URL, KeyFileError, SITE_ANALYTICS_SCOPES } from "../google-token.js"
import { GoogleApiError } from "../google-api.js"
import type { ServiceAccount } from "../setup.js"

const NOW = Date.parse("2026-10-08T09:00:00Z")
const MINUTE = 60_000

let account: ServiceAccount
let publicKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  account = { clientEmail: "reader@nodaro-analytics.iam.gserviceaccount.com", privateKey: await exportPKCS8(pair.privateKey) }
  publicKey = pair.publicKey
})

const granted = (token: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn, token_type: "Bearer" }), { status: 200 })

describe("createTokenSource", () => {
  it("trades a signed assertion for a token: the account as issuer, Google as audience, both read-only scopes, one hour", async () => {
    const fetch = vi.fn(async () => granted("tok-1"))
    expect(await createTokenSource(account, { fetch, now: () => NOW })()).toBe("tok-1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(GOOGLE_TOKEN_URL)
    const form = new URLSearchParams(String(init.body))
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer")
    const { payload } = await jwtVerify(form.get("assertion") ?? "", publicKey, { currentDate: new Date(NOW) })
    expect(payload).toMatchObject({ iss: account.clientEmail, aud: GOOGLE_TOKEN_URL, scope: SITE_ANALYTICS_SCOPES })
    expect(SITE_ANALYTICS_SCOPES.split(" ").sort()).toEqual([
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ])
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(3600)
  })

  it("reuses the token until five minutes before it lapses, then fetches a new one", async () => {
    let now = NOW
    const fetch = vi.fn().mockResolvedValueOnce(granted("tok-1")).mockResolvedValueOnce(granted("tok-2"))
    const token = createTokenSource(account, { fetch, now: () => now })
    expect(await token()).toBe("tok-1")
    now = NOW + 54 * MINUTE
    expect(await token()).toBe("tok-1")
    expect(fetch).toHaveBeenCalledTimes(1)
    now = NOW + 56 * MINUTE
    expect(await token()).toBe("tok-2")
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("two requests at once share one fetch", async () => {
    const fetch = vi.fn(async () => granted("tok-1"))
    const token = createTokenSource(account, { fetch, now: () => NOW })
    expect(await Promise.all([token(), token()])).toEqual(["tok-1", "tok-1"])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("a key that will not load is a key-file error naming no bytes of it, and Google is never called", async () => {
    const fetch = vi.fn(async () => granted("tok-1"))
    const broken = { clientEmail: account.clientEmail, privateKey: "-----BEGIN PRIVATE KEY-----\nAAAAsecretBYTES\n-----END PRIVATE KEY-----\n" }
    const error = await createTokenSource(broken, { fetch, now: () => NOW })().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KeyFileError)
    expect(String((error as Error).message)).not.toMatch(/secretBYTES|PRIVATE KEY/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("a refusal carries Google's reason and status, and is not remembered", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid JWT Signature." }), { status: 400 }))
      .mockResolvedValueOnce(granted("tok-1"))
    const token = createTokenSource(account, { fetch, now: () => NOW })
    const refusal = await token().catch((e: unknown) => e)
    expect(refusal).toBeInstanceOf(GoogleApiError)
    expect(refusal).toMatchObject({ status: 400, message: "Invalid JWT Signature." })
    expect(await token()).toBe("tok-1")
  })
})
