/**
 * The built-in ("factory") preset catalog is public: a client app shows it to
 * visitors who are not signed in and asks for a login only when they generate.
 * It holds no user data — the deployment's catalog, the same for every caller —
 * so `GET /v1/node-presets/factory` takes no credential, exactly like
 * `GET /v1/models`. A user's OWN presets (`GET /v1/node-presets`, favorites,
 * folders) stay behind one. Pinned three ways: the matcher, the OpenAPI lens
 * (`isAnonymousRoute`), and the real hook in front of the real routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      throw new Error("an anonymous request must not reach the database")
    }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
// The preview check reaches the storage (covered in lib/presets/__tests__); the
// factory route never calls it, but the route file imports it.
vi.mock("../../lib/presets/preview-url.js", () => ({
  PREVIEW_URL_MAX_LENGTH: 2048,
  previewUrlProblem: async () => null,
  previewStorageKey: (url: string) => url,
}))
vi.mock("../../lib/presets/preview-copy.js", () => ({
  storePresetPreviews: async (_userId: string, keys: string[]) => new Map(keys.map((k) => [k, k])),
  releasePresetPreviews: async () => {},
}))

import { __isPublicRouteForTest as isPublicRoute, isAnonymousRoute, registerAuthHook } from "../auth.js"
import { nodePresetRoutes } from "../../routes/node-presets.js"

describe("the public-route matcher", () => {
  it("GET /v1/node-presets/factory takes no credential, with or without its query", () => {
    expect(isPublicRoute("GET", "/v1/node-presets/factory")).toBe(true)
    expect(isPublicRoute("GET", "/v1/node-presets/factory?nodeType=generate-image")).toBe(true)
    expect(isAnonymousRoute("GET", "/v1/node-presets/factory")).toBe(true)
  })

  it("nothing else under /v1/node-presets does", () => {
    expect(isPublicRoute("POST", "/v1/node-presets/factory")).toBe(false)
    expect(isPublicRoute("GET", "/v1/node-presets/factoryX")).toBe(false)
    expect(isPublicRoute("GET", "/v1/node-presets/factory/x")).toBe(false)
    // The user's own library stays behind a credential.
    expect(isPublicRoute("GET", "/v1/node-presets")).toBe(false)
    expect(isPublicRoute("GET", "/v1/node-presets?nodeType=generate-image")).toBe(false)
    expect(isPublicRoute("GET", "/v1/node-presets/favorites")).toBe(false)
    expect(isPublicRoute("GET", "/v1/node-preset-groups")).toBe(false)
    expect(isAnonymousRoute("GET", "/v1/node-presets")).toBe(false)
    expect(isAnonymousRoute("GET", "/v1/node-presets/favorites")).toBe(false)
  })
})

describe("the auth hook in front of the routes", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = Fastify({ logger: false })
    registerAuthHook(app)
    await app.register(nodePresetRoutes)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("serves the factory catalog without a credential, with every field a signed-in call gets", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/factory?nodeType=generate-image" })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as Array<Record<string, unknown>>
    expect(data.length).toBeGreaterThan(0)
    for (const p of data) {
      expect(p).toHaveProperty("id")
      expect(p).toHaveProperty("name")
      expect(p).toHaveProperty("data")
      expect(Number.isInteger(p.minReferences), String(p.id)).toBe(true)
      expect(typeof p.needsImage, String(p.id)).toBe("boolean")
      expect(p.previewUrl === null || typeof p.previewUrl === "string", String(p.id)).toBe(true)
    }
  })

  it("a missing nodeType is a 400, not a 401 — the request reaches the handler", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/node-presets/factory" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("ignores a bearer that does not resolve (optional auth on a public route)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/node-presets/factory?nodeType=generate-image",
      headers: { authorization: "Bearer eyJ.not-a-session" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.length).toBeGreaterThan(0)
  })

  it("the user's own presets still answer 401 without a credential", async () => {
    for (const url of ["/v1/node-presets", "/v1/node-presets?nodeType=generate-image", "/v1/node-presets/favorites?nodeType=generate-image"]) {
      const res = await app.inject({ method: "GET", url })
      expect(res.statusCode, url).toBe(401)
      expect(res.json().error.code, url).toBe("unauthorized")
    }
  })
})
