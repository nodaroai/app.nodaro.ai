/**
 * The two byte proxies (`/v1/download`, `/v1/image-proxy`) answer 451 for a
 * file an administrator restricted (lib/content-restrictions.ts), before any
 * fetch, and for another host's address that turns out to redirect to one;
 * an address that is not restricted goes on as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const fake = vi.hoisted(() => ({ restricted: new Set<string>(), fetches: [] as string[], redirectTo: null as string | null }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://pub-test.r2.dev", R2_PUBLIC_FALLBACK_DOMAIN: "" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/content-restrictions.js", () => ({
  isRestrictedAddress: vi.fn(async (url: string) => fake.restricted.has(url)),
}))
vi.mock("@/lib/safe-fetch.js", () => ({
  safeFetch: vi.fn(async (url: string) => {
    fake.fetches.push(url)
    const response = new Response("bytes", { status: 200, headers: { "content-type": "image/png", "content-length": "5" } })
    Object.defineProperty(response, "url", { value: fake.redirectTo ?? url })
    return response
  }),
}))

import { downloadRoutes } from "../download.js"
import { imageProxyRoutes } from "../image-proxy.js"

let app: FastifyInstance

beforeEach(async () => {
  fake.restricted.clear()
  fake.fetches.length = 0
  fake.redirectTo = null
  app = Fastify({ logger: false })
  await app.register(downloadRoutes)
  await app.register(imageProxyRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const OURS = "https://pub-test.r2.dev/videos/a.mp4"
const ELSEWHERE = "https://elsewhere.test/pic.png"

describe("a restricted file", () => {
  it("is answered 451 by both proxies, with one sentence and no fetch", async () => {
    fake.restricted.add(OURS)
    for (const url of [`/v1/download?url=${encodeURIComponent(OURS)}`, `/v1/image-proxy?url=${encodeURIComponent(OURS)}`, `/v1/image-proxy?url=${encodeURIComponent(OURS)}&download=1`]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode).toBe(451)
      expect(res.json()).toEqual({ error: { code: "content_restricted", message: "This content is not available." } })
    }
    expect(fake.fetches).toEqual([])
  })

  it("another host's address that redirects to a restricted file is answered 451 before any byte is streamed", async () => {
    fake.restricted.add(OURS)
    fake.redirectTo = OURS
    const res = await app.inject({ method: "GET", url: `/v1/image-proxy?url=${encodeURIComponent(ELSEWHERE)}` })
    expect(res.statusCode).toBe(451)
    expect(fake.fetches).toEqual([ELSEWHERE])
  })

  it("an address that is not restricted is fetched as before", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/download?url=${encodeURIComponent(OURS)}` })
    expect(res.statusCode).toBe(200)
    expect(fake.fetches).toEqual([OURS])
  })
})
