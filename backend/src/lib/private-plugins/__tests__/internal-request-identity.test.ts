/**
 * `tk.http.internalRequest` / `tk.http.workerRequest` act as `opts.userId` —
 * and only as `opts.userId` — whatever the payload holds.
 *
 * The request goes through the REAL auth hook: that hook is where an internal
 * request's identity is decided, and it reads `body.userId` ahead of the
 * `x-internal-user-id` header. So a payload naming somebody else must reach
 * the route as the caller, and a payload that cannot be checked is refused
 * before it is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => false }))

import { registerAuthHook } from "../../../middleware/auth.js"
import { buildToolkit } from "../toolkit.js"

const CALLER = "00000000-0000-4000-8000-0000000000a1"
const VICTIM = "00000000-0000-4000-8000-0000000000f2"

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  registerAuthHook(app)
  app.post("/v1/echo", async (req) => ({ ranAs: req.userId ?? null, body: req.body }))
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const tk = () => buildToolkit({ workerApp: async () => app })

async function ranAs(payload: unknown) {
  const res = await tk().http.internalRequest!(app, {
    method: "POST", url: "/v1/echo", userId: CALLER, payload: payload as object,
  })
  return JSON.parse(res.body) as { ranAs: string | null; body: unknown }
}

describe("tk.http.internalRequest pins the caller's identity", () => {
  it("a payload naming another user still runs as the caller", async () => {
    const got = await ranAs({ prompt: "p", userId: VICTIM })
    expect(got.ranAs).toBe(CALLER)
    expect(got.body).toEqual({ prompt: "p", userId: CALLER })
  })

  it("a non-string userId in the payload is pinned too", async () => {
    const got = await ranAs({ prompt: "p", userId: { id: VICTIM } })
    expect(got.ranAs).toBe(CALLER)
    expect(got.body).toEqual({ prompt: "p", userId: CALLER })
  })

  it("a payload repeating the caller's own userId is sent unchanged", async () => {
    const got = await ranAs({ prompt: "p", userId: CALLER })
    expect(got).toEqual({ ranAs: CALLER, body: { prompt: "p", userId: CALLER } })
  })

  it("a payload without a userId gets none added (the body stays byte-identical)", async () => {
    const got = await ranAs({ prompt: "p", nested: { userId: VICTIM } })
    expect(got).toEqual({ ranAs: CALLER, body: { prompt: "p", nested: { userId: VICTIM } } })
  })

  it("a userId that only appears through toJSON is pinned as the wire sees it", async () => {
    const sneaky = { prompt: "p", toJSON: () => ({ prompt: "p", userId: VICTIM }) }
    const got = await ranAs(sneaky)
    expect(got.ranAs).toBe(CALLER)
  })

  it("never mutates the caller's object", async () => {
    const payload = { prompt: "p", userId: VICTIM }
    await ranAs(payload)
    expect(payload).toEqual({ prompt: "p", userId: VICTIM })
  })

  it("refuses a payload it cannot check: a string, a Buffer, a typed array", async () => {
    for (const payload of [
      JSON.stringify({ userId: VICTIM }),
      Buffer.from(JSON.stringify({ userId: VICTIM })),
      new TextEncoder().encode(JSON.stringify({ userId: VICTIM })),
    ]) {
      await expect(tk().http.internalRequest!(app, {
        method: "POST", url: "/v1/echo", userId: CALLER, payload: payload as object,
        headers: { "content-type": "application/json" },
      })).rejects.toThrow(/plain object/)
    }
  })

  it("a bodyless request still runs as the caller", async () => {
    app = Fastify({ logger: false })
    registerAuthHook(app)
    app.get("/v1/echo", async (req) => ({ ranAs: req.userId ?? null }))
    await app.ready()
    const res = await tk().http.internalRequest!(app, { method: "GET", url: "/v1/echo", userId: CALLER })
    expect(JSON.parse(res.body)).toEqual({ ranAs: CALLER })
  })
})

describe("tk.http.workerRequest pins the caller's identity", () => {
  it("a payload naming another user still runs as the caller", async () => {
    const res = await tk().http.workerRequest!({
      method: "POST", url: "/v1/echo", userId: CALLER, payload: { userId: VICTIM, prompt: "p" },
    })
    expect(JSON.parse(res.body)).toEqual({ ranAs: CALLER, body: { userId: CALLER, prompt: "p" } })
  })
})

describe("tk.http.internalRequest owns how the body is read and who it acts as", () => {
  /** The app as it runs: the form parser registered alongside JSON. */
  async function appWithForms() {
    const formbody = (await import("@fastify/formbody")).default
    const a = Fastify({ logger: false })
    await a.register(formbody)
    registerAuthHook(a)
    a.post("/v1/echo", async (req) => ({
      ranAs: req.userId ?? null,
      body: req.body ?? null,
      headers: req.headers,
      isAppRun: req.isAppRun ?? false,
      webFreeMode: req.webFreeMode ?? false,
    }))
    await a.ready()
    return a
  }

  it("a caller-chosen content type cannot change how the body is parsed", async () => {
    const a = await appWithForms()
    try {
      const res = await tk().http.internalRequest!(a, {
        method: "POST", url: "/v1/echo", userId: CALLER,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        payload: { prompt: `p&userId=${VICTIM}&x` },
      })
      const got = JSON.parse(res.body) as { ranAs: string; body: unknown; headers: Record<string, string> }
      expect(got.ranAs).toBe(CALLER)
      expect(got.body).toEqual({ prompt: `p&userId=${VICTIM}&x` })
      expect(got.headers["content-type"]).toBe("application/json")
    } finally {
      await a.close()
    }
  })

  it("identity, billing and transport headers come only from the typed options", async () => {
    const a = await appWithForms()
    try {
      const res = await tk().http.internalRequest!(a, {
        method: "POST", url: "/v1/echo", userId: CALLER, payload: { prompt: "p" },
        headers: {
          "X-Internal-User-Id": VICTIM,
          "x-internal-orchestrator": "1",
          "X-App-Run": "true",
          "x-web-free-mode": "true",
          "X-Nodaro-Workspace": "00000000-0000-4000-8000-0000000000c3",
          Authorization: "Bearer someone-else",
          Cookie: "sb=someone-else",
          "Content-Length": "1",
          Host: "elsewhere.example",
          "idempotency-key": "k-1",
        },
      })
      const got = JSON.parse(res.body) as {
        ranAs: string; body: unknown; headers: Record<string, string>; isAppRun: boolean; webFreeMode: boolean
      }
      expect(got.ranAs).toBe(CALLER)
      expect(got.body).toEqual({ prompt: "p" })
      expect(got.isAppRun).toBe(false)
      expect(got.webFreeMode).toBe(false)
      expect(got.headers["x-internal-user-id"]).toBe(CALLER)
      for (const name of ["x-internal-orchestrator", "x-app-run", "x-web-free-mode", "x-nodaro-workspace", "authorization", "cookie"]) {
        expect(got.headers[name]).toBeUndefined()
      }
      expect(got.headers.host).not.toBe("elsewhere.example")
      // A header a route legitimately needs still arrives.
      expect(got.headers["idempotency-key"]).toBe("k-1")
    } finally {
      await a.close()
    }
  })

  it("a header name that only becomes an owned name once lower-cased is dropped too", async () => {
    const a = await appWithForms()
    try {
      // U+212A (KELVIN SIGN) lower-cases to an ASCII "k".
      const res = await tk().http.internalRequest!(a, {
        method: "POST", url: "/v1/echo", userId: CALLER, payload: { prompt: "p" },
        headers: { "x-nodaro-worKspace": "00000000-0000-4000-8000-0000000000c3", "cooKie": "sb=someone-else" },
      })
      const got = JSON.parse(res.body) as { headers: Record<string, string> }
      expect(got.headers["x-nodaro-workspace"]).toBeUndefined()
      expect(got.headers.cookie).toBeUndefined()
    } finally {
      await a.close()
    }
  })

  it("the workspace header is the typed option's, whatever the caller's headers say", async () => {
    const a = await appWithForms()
    const WS = "00000000-0000-4000-8000-0000000000c4"
    try {
      const res = await tk().http.internalRequest!(a, {
        method: "POST", url: "/v1/echo", userId: CALLER, workspaceId: WS, payload: { prompt: "p" },
        headers: { "X-Nodaro-Workspace": "00000000-0000-4000-8000-0000000000c3" },
      })
      expect((JSON.parse(res.body) as { headers: Record<string, string> }).headers["x-nodaro-workspace"]).toBe(WS)
    } finally {
      await a.close()
    }
  })

  it("a bodyless POST still goes out without a body or a content type", async () => {
    const a = await appWithForms()
    try {
      const res = await tk().http.internalRequest!(a, {
        method: "POST", url: "/v1/echo", userId: CALLER,
        headers: { "content-type": "application/json" },
      })
      expect(res.statusCode).toBe(200)
      const got = JSON.parse(res.body) as { ranAs: string; headers: Record<string, string> }
      expect(got.ranAs).toBe(CALLER)
      expect(got.headers["content-type"]).toBeUndefined()
    } finally {
      await a.close()
    }
  })

  it("refuses a FormData, URLSearchParams or Blob payload", async () => {
    const form = new FormData()
    form.set("userId", VICTIM)
    for (const payload of [form, new URLSearchParams({ userId: VICTIM }), new Blob([JSON.stringify({ userId: VICTIM })])]) {
      await expect(tk().http.internalRequest!(app, {
        method: "POST", url: "/v1/echo", userId: CALLER, payload,
      })).rejects.toThrow(/plain object/)
    }
  })
})
