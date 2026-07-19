import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "node:crypto"
import Fastify, { type FastifyInstance } from "fastify"
import formbody from "@fastify/formbody"

// ---- mocks -----------------------------------------------------------------
/** Every `.delete()` chain the route built, in order. */
let deleteCalls: ReadonlyArray<{ table: string; eq?: [string, unknown]; in?: [string, unknown] }> = []
let deletedRows: ReadonlyArray<{ id: string }> = []
let deleteError: { message: string } | null = null

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => {
        const captured: { table: string; eq?: [string, unknown]; in?: [string, unknown] } = { table }
        const chain = {
          eq(col: string, val: unknown) {
            captured.eq = [col, val]
            return chain
          },
          in(col: string, vals: unknown) {
            captured.in = [col, vals]
            return chain
          },
          select() {
            deleteCalls = [...deleteCalls, captured]
            return { data: deleteError ? null : deletedRows, error: deleteError }
          },
        }
        return chain
      },
    }),
  },
}))

import { metaCallbackRoutes, issueConfirmationCode } from "../meta-callbacks.js"

// ---- helpers ---------------------------------------------------------------
const SECRET = "meta-app-secret-fixture" // gitleaks:allow — fake fixture

/** Build a Meta-shaped signed_request: base64url(sig) "." base64url(payload). */
function sign(payload: Record<string, unknown>, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `${sig}.${body}`
}

function form(signedRequest: string): { payload: string; headers: Record<string, string> } {
  return {
    payload: new URLSearchParams({ signed_request: signedRequest }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  }
}

const VALID = () => sign({ algorithm: "HMAC-SHA256", user_id: "fb-user-1", issued_at: 1_700_000_000 })

let app: FastifyInstance
let savedSecret: string | undefined

beforeEach(async () => {
  savedSecret = process.env.META_APP_SECRET
  process.env.META_APP_SECRET = SECRET
  deleteCalls = []
  deletedRows = [{ id: "conn-1" }]
  deleteError = null

  app = Fastify({ logger: false })
  // Meta posts urlencoded — mirror app.ts so the test exercises the real parse.
  await app.register(formbody)
  await app.register(metaCallbackRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (savedSecret === undefined) delete process.env.META_APP_SECRET
  else process.env.META_APP_SECRET = savedSecret
})

// ---- tests -----------------------------------------------------------------
describe("POST /v1/social/meta/data-deletion", () => {
  it("deletes the user's Meta connections and returns Meta's response shape", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/social/meta/data-deletion", ...form(VALID()) })

    expect(r.statusCode).toBe(200)
    const body = r.json() as { url: string; confirmation_code: string }
    expect(body.confirmation_code).toBeTruthy()
    expect(body.url).toContain("/v1/social/meta/data-deletion/status?code=")
    expect(body.url).toContain(encodeURIComponent(body.confirmation_code))

    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0]!.table).toBe("social_connections")
    // Matched on the person (root_internal_id), never the Page/IG id.
    expect(deleteCalls[0]!.eq).toEqual(["root_internal_id", "fb-user-1"])
  })

  it("scopes the delete to Meta-backed platforms, derived from the registry", async () => {
    await app.inject({ method: "POST", url: "/v1/social/meta/data-deletion", ...form(VALID()) })

    const [column, platforms] = deleteCalls[0]!.in as [string, string[]]
    expect(column).toBe("platform")
    // Whatever the registry currently declares — must include both Meta networks
    // and must NOT sweep unrelated providers into a Meta deletion request.
    expect(platforms).toEqual(expect.arrayContaining(["facebook", "instagram"]))
    expect(platforms).not.toContain("telegram")
    expect(platforms).not.toContain("bluesky")
  })

  it("rejects a forged signature without touching the database", async () => {
    const forged = sign({ algorithm: "HMAC-SHA256", user_id: "fb-user-1" }, "wrong-secret")

    const r = await app.inject({ method: "POST", url: "/v1/social/meta/data-deletion", ...form(forged) })

    expect(r.statusCode).toBe(400)
    expect((r.json() as { error: { code: string } }).error.code).toBe("invalid_signed_request")
    expect(deleteCalls).toHaveLength(0)
  })

  it("rejects a payload swapped in under a valid signature", async () => {
    const [sig] = VALID().split(".")
    const swapped = Buffer.from(JSON.stringify({ user_id: "victim" }), "utf8").toString("base64url")

    const r = await app.inject({
      method: "POST",
      url: "/v1/social/meta/data-deletion",
      ...form(`${sig}.${swapped}`),
    })

    expect(r.statusCode).toBe(400)
    expect(deleteCalls).toHaveLength(0)
  })

  it("rejects an algorithm downgrade", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/social/meta/data-deletion",
      ...form(sign({ algorithm: "none", user_id: "fb-user-1" })),
    })

    expect(r.statusCode).toBe(400)
    expect(deleteCalls).toHaveLength(0)
  })

  it("rejects a request with no user id and one with no signed_request at all", async () => {
    const noUser = await app.inject({
      method: "POST",
      url: "/v1/social/meta/data-deletion",
      ...form(sign({ algorithm: "HMAC-SHA256" })),
    })
    expect(noUser.statusCode).toBe(400)

    const empty = await app.inject({
      method: "POST",
      url: "/v1/social/meta/data-deletion",
      payload: "",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })
    expect(empty.statusCode).toBe(400)
    expect(deleteCalls).toHaveLength(0)
  })

  it("does not hand out a confirmation code when the delete failed", async () => {
    deleteError = { message: "connection reset" }

    const r = await app.inject({ method: "POST", url: "/v1/social/meta/data-deletion", ...form(VALID()) })

    expect(r.statusCode).toBe(500)
    expect(r.json()).not.toHaveProperty("confirmation_code")
  })

  it("503s when the deployment has no Meta app configured", async () => {
    delete process.env.META_APP_SECRET

    const r = await app.inject({ method: "POST", url: "/v1/social/meta/data-deletion", ...form(VALID()) })

    expect(r.statusCode).toBe(503)
    expect(deleteCalls).toHaveLength(0)
  })
})

describe("POST /v1/social/meta/deauthorize", () => {
  it("deletes the connections behind a revoked login", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/social/meta/deauthorize", ...form(VALID()) })

    expect(r.statusCode).toBe(200)
    expect(deleteCalls[0]!.eq).toEqual(["root_internal_id", "fb-user-1"])
  })

  it("rejects a forged signature", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/social/meta/deauthorize",
      ...form(sign({ algorithm: "HMAC-SHA256", user_id: "x" }, "wrong-secret")),
    })

    expect(r.statusCode).toBe(400)
    expect(deleteCalls).toHaveLength(0)
  })
})

describe("GET /v1/social/meta/data-deletion/status", () => {
  it("confirms deletion for a code we issued", async () => {
    const code = issueConfirmationCode("fb-user-1", SECRET, 1_700_000_000_000)

    const r = await app.inject({
      method: "GET",
      url: `/v1/social/meta/data-deletion/status?code=${encodeURIComponent(code)}`,
    })

    expect(r.statusCode).toBe(200)
    expect(r.headers["content-type"]).toContain("text/html")
    expect(r.body).toContain("have been deleted")
  })

  it("404s a code minted with someone else's secret", async () => {
    const forged = issueConfirmationCode("fb-user-1", "wrong-secret", 1_700_000_000_000)

    const r = await app.inject({
      method: "GET",
      url: `/v1/social/meta/data-deletion/status?code=${encodeURIComponent(forged)}`,
    })

    expect(r.statusCode).toBe(404)
    expect(r.body).toContain("could not find")
  })

  it("404s a missing code instead of throwing", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/social/meta/data-deletion/status" })
    expect(r.statusCode).toBe(404)
  })
})
