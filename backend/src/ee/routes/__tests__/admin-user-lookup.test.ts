/**
 * GET /v1/admin/user-lookup: the admin pickers' accounts, read on the server —
 * a search over EVERY account (not the first 1,000 the browser could load),
 * one address, a set of ids, every admin; admin-only, the payer hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { UserLookupReader } from "../admin-user-lookup.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const PAYER = "00000000-0000-4000-8000-0000000000bb"
const state = vi.hoisted(() => ({ payer: null as string | null }))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (req.userId !== "00000000-0000-4000-8000-0000000000ad" && req.userId !== "00000000-0000-4000-8000-0000000000bb") {
      return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerId: () => state.payer }))

import { adminUserLookupRoutes, escapeLike } from "../admin-user-lookup.js"

type Row = { id: string; email: string | null; full_name: string | null; role: string | null }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

/** 1,063 accounts, as production had when the 1,000-row picker missed some. */
const ROWS: Row[] = Array.from({ length: 1063 }, (_, i) => ({
  id: id(i + 1),
  email: `user${i + 1}@example.com`,
  full_name: null,
  role: "user",
}))
ROWS.push(
  { id: id(5000), email: "ops.lead@example.com", full_name: "Ops Lead", role: "super_admin" },
  { id: id(5001), email: "dana_k@example.com", full_name: "Dana Cohen", role: "admin" },
  { id: id(5002), email: "danaXk@example.com", full_name: null, role: "user" },
  { id: PAYER, email: "payer@example.com", full_name: "Payer", role: "admin" },
  { id: id(5003), email: null, full_name: "No address", role: "user" },
)

/** ILIKE as Postgres reads it: `%` any run, `_` one character, `\` escapes. */
function likeToRegExp(pattern: string): RegExp {
  let out = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === "\\") out += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    else if (c === "%") out += ".*"
    else if (c === "_") out += "."
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${out}$`, "is")
}

const calls: Array<{ op: string; arg: unknown }> = []
const reader: UserLookupReader = {
  ilike: async (column, pattern, limit) => {
    calls.push({ op: `ilike:${column}`, arg: pattern })
    const re = likeToRegExp(pattern)
    return ROWS.filter((r) => re.test(r[column] ?? ""))
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""))
      .slice(0, limit)
  },
  byIds: async (ids) => {
    calls.push({ op: "byIds", arg: ids })
    return ROWS.filter((r) => ids.includes(r.id))
  },
  admins: async (offset, pageSize) => {
    calls.push({ op: "admins", arg: offset })
    return ROWS.filter((r) => r.role === "admin" || r.role === "super_admin").slice(offset, offset + pageSize)
  },
}

let app: FastifyInstance

beforeEach(async () => {
  state.payer = null
  calls.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(adminUserLookupRoutes, { reader })
  await app.ready()
})
afterEach(() => app.close())

const get = (query: string, userId = ADMIN, authKind = "jwt") =>
  app.inject({ method: "GET", url: `/v1/admin/user-lookup?${query}`, headers: { "x-user-id": userId, "x-auth-kind": authKind } })
const emails = async (query: string, userId = ADMIN) =>
  ((await get(query, userId)).json().data as Array<{ email: string }>).map((u) => u.email)

describe("GET /v1/admin/user-lookup", () => {
  it("finds an account by part of its address, past the first 1,000 accounts", async () => {
    const res = await get("search=ops.lead")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([
      { id: id(5000), email: "ops.lead@example.com", fullName: "Ops Lead", role: "super_admin" },
    ])
  })

  it("finds an account by its name, case aside", async () => {
    expect(await emails("search=dana%20cohen")).toEqual(["dana_k@example.com"])
  })

  it("matches `_` and `%` as themselves, never as wildcards", async () => {
    expect(await emails("search=dana_k")).toEqual(["dana_k@example.com"])
    expect(calls).toContainEqual({ op: "ilike:email", arg: "%dana\\_k%" })
    expect(await emails("search=%25")).toEqual([])
  })

  it("answers at most `limit` accounts, ordered by address", async () => {
    const found = await emails("search=user1&limit=5")
    expect(found).toHaveLength(5)
    expect([...found].sort((a, b) => a.localeCompare(b))).toEqual(found)
    expect((await get("search=user")).json().data).toHaveLength(20)
    expect((await get("search=user&limit=51")).statusCode).toBe(400)
  })

  it("an address: that one account, case aside, or none", async () => {
    expect(await emails("email=Ops.Lead@Example.com")).toEqual(["ops.lead@example.com"])
    expect(await emails("email=nobody@example.com")).toEqual([])
    expect((await get("email=ops.lead")).statusCode).toBe(400)
  })

  it("ids: those accounts, and at most 200 of them", async () => {
    expect(await emails(`ids=${id(5000)},${id(1063)}`)).toEqual(["ops.lead@example.com", "user1063@example.com"])
    expect((await get("ids=not-an-id")).statusCode).toBe(400)
    const many = Array.from({ length: 201 }, (_, i) => id(i + 1)).join(",")
    expect((await get(`ids=${many}`)).statusCode).toBe(400)
  })

  it("admins: every admin and super admin, read page by page", async () => {
    expect(await emails("admins=1")).toEqual(["dana_k@example.com", "ops.lead@example.com", "payer@example.com"])
    expect(calls.filter((c) => c.op === "admins")).toEqual([{ op: "admins", arg: 0 }])
  })

  it("asks for exactly one of search, email, ids or admins", async () => {
    expect((await get("")).statusCode).toBe(400)
    expect((await get("search=dana&admins=1")).statusCode).toBe(400)
    expect((await get("search=%20%20")).statusCode).toBe(400)
  })

  it("leaves out an account with no address", async () => {
    expect(await emails("search=no%20address")).toEqual([])
  })

  it("is not offered to a non-admin", async () => {
    expect((await get("search=dana", "00000000-0000-4000-8000-0000000000aa")).statusCode).toBe(403)
  })

  it.each(["api_token", "app_token"])("not to an admin's %s — only to the admin in the app", async (kind) => {
    const res = await get("search=dana", ADMIN, kind)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("in_app_only")
  })

  it("the deployment's payer is found by itself only", async () => {
    state.payer = PAYER
    expect(await emails("search=payer")).toEqual([])
    expect(await emails("admins=1")).not.toContain("payer@example.com")
    expect(await emails("search=payer", PAYER)).toEqual(["payer@example.com"])
  })
})

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape itself", () => {
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d")
  })
})
