/**
 * Content rights (lib/content-rights.ts) over an in-memory store: a link is
 * normalized so the same video with different decoration matches and another
 * never does; a confirmation records the current declaration and is good for
 * one download of its link by its account within an hour; without one the
 * download passes while `content_rights_required` is off and is refused once
 * it is on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mem = vi.hoisted(() => ({
  required: false,
  declarations: [{ version: 1, text: "I confirm that I hold the rights to this content.", text_hash: "h1" }],
  confirmations: new Map<string, Record<string, unknown>>(),
  authorizations: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  profiles: new Map<string, string>([["u1", "one@example.com"]]),
  seq: 0,
}))

vi.mock("../app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ content_rights_required: mem.required })) }))

vi.mock("../supabase.js", () => {
  const table = (name: string) => {
    const q: Record<string, unknown> & { _eq?: [string, unknown]; _eqs: Array<[string, unknown]>; _nulls: string[]; _patch?: Record<string, unknown> } = { _eqs: [], _nulls: [] }
    const matches = (row: Record<string, unknown>) => q._eqs.every(([col, value]) => row[col] === value) && q._nulls.every((col) => row[col] === null || row[col] === undefined)
    const authorizationRows = () => [...mem.authorizations].filter(matches).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const chain = {
      select: () => {
        if (q._patch) {
          // An UPDATE … SELECT: apply the patch to every matching row, answer them.
          const patched = mem.authorizations.filter(matches).map((row) => {
            Object.assign(row, q._patch)
            return { id: row.id }
          })
          return Promise.resolve({ data: patched, error: null })
        }
        return chain
      },
      order: () => chain,
      limit: () => chain,
      is: (col: string, value: unknown) => {
        if (value === null) q._nulls = [...q._nulls, col]
        return chain
      },
      update: (patch: Record<string, unknown>) => {
        q._patch = patch
        return chain
      },
      eq: (col: string, value: unknown) => {
        q._eq = [col, value]
        q._eqs = [...q._eqs, [col, value]]
        return chain
      },
      maybeSingle: async () => {
        if (name === "rights_events") {
          const byConfirmation = q._eqs.find(([col]) => col === "confirmation_id")?.[1]
          if (byConfirmation !== undefined) {
            const consumed = mem.events.find((e) => e.confirmation_id === byConfirmation && e.kind === "consumed")
            return { data: consumed ? { request_id: consumed.request_id ?? null } : null, error: null }
          }
          const byRequest = q._eqs.find(([col]) => col === "request_id")?.[1]
          const spent = mem.events.find((e) => e.request_id === byRequest && e.kind === "consumed")
          return { data: spent ? { confirmation_id: spent.confirmation_id } : null, error: null }
        }
        if (name === "rights_declarations") {
          const top = [...mem.declarations].sort((a, b) => b.version - a.version)[0] ?? null
          return { data: top, error: null }
        }
        if (name === "content_rights_confirmations") return { data: mem.confirmations.get(String(q._eq?.[1])) ?? null, error: null }
        if (name === "content_rights_authorizations") return { data: authorizationRows()[0] ?? null, error: null }
        if (name === "profiles") return { data: { email: mem.profiles.get(String(q._eq?.[1])) ?? null }, error: null }
        return { data: null, error: null }
      },
      insert: (row: Record<string, unknown>) => {
        if (name === "rights_events") {
          const dup = row.kind === "consumed" && mem.events.some((e) => e.confirmation_id === row.confirmation_id && e.kind === "consumed")
          if (dup) return Promise.resolve({ error: { code: "23505", message: "duplicate" } })
          mem.events.push(row)
          return Promise.resolve({ error: null })
        }
        if (name === "content_rights_confirmations") {
          const id = `00000000-0000-4000-8000-00000000000${++mem.seq}`
          const stored = { id, created_at: new Date().toISOString(), ...row }
          mem.confirmations.set(id, stored)
          return {
            select: () => ({ single: async () => ({ data: { id, created_at: stored.created_at }, error: null }) }),
          }
        }
        if (name === "content_rights_authorizations") {
          // The partial unique index: one unrevoked row per account.
          if (mem.authorizations.some((a) => a.user_id === row.user_id && a.revoked_at === null)) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) }
          }
          const id = `00000000-0000-4000-8000-0000000000a${++mem.seq}`
          const stored = { id, created_at: new Date(Date.now() + mem.seq).toISOString(), revoked_at: null, ...row }
          mem.authorizations.push(stored)
          return {
            select: () => ({ single: async () => ({ data: { id, created_at: stored.created_at }, error: null }) }),
          }
        }
        return Promise.resolve({ error: null })
      },
    }
    return chain
  }
  return { supabase: { from: table } }
})

import {
  ContentRightsError,
  checkRightsConfirmation,
  consumeRightsConfirmation,
  createConfirmation,
  createStandingAuthorization,
  currentStandingAuthorization,
  deriveAndConsumeConfirmation,
  forgetDeclarationCache,
  identifySource,
  normalizeSourceUrl,
  revokeStandingAuthorization,
} from "../content-rights.js"

/** The route's and the run's order: check (a read), then consume (the write). */
async function requireRightsConfirmation(input: Parameters<typeof checkRightsConfirmation>[0]) {
  const row = await checkRightsConfirmation(input)
  if (row) await consumeRightsConfirmation({ confirmationId: row.id, url: input.url, lane: input.lane })
  return row
}

beforeEach(() => {
  mem.required = false
  mem.declarations = [{ version: 1, text: "I confirm that I hold the rights to this content.", text_hash: "h1" }]
  mem.confirmations = new Map()
  mem.authorizations = []
  mem.events = []
  mem.seq = 0
  forgetDeclarationCache()
})

/** A new declaration version is published. */
function publishDeclaration(version: number) {
  mem.declarations = [...mem.declarations, { version, text: `I confirm that I hold the rights to this content, version ${version}.`, text_hash: `h${version}` }]
  forgetDeclarationCache()
}

describe("normalizeSourceUrl", () => {
  it("drops the www/m prefix, the fragment, tracking parameters and a trailing slash; sorts the rest", () => {
    expect(normalizeSourceUrl("https://www.youtube.com/watch?v=abc&utm_source=x&si=zz&t=10#top")).toBe("https://youtube.com/watch?v=abc")
    expect(normalizeSourceUrl("https://m.tiktok.com/@a/video/123/?fbclid=1")).toBe("https://tiktok.com/@a/video/123")
    expect(normalizeSourceUrl("https://a.test/x?b=2&a=1")).toBe("https://a.test/x?a=1&b=2")
  })
  it("keeps two different videos apart", () => {
    expect(normalizeSourceUrl("https://youtu.be/abc")).not.toBe(normalizeSourceUrl("https://youtu.be/abd"))
  })
  it("keeps a port, and every parameter of a direct file link (a signature is not decoration)", () => {
    expect(normalizeSourceUrl("https://cdn.x:8443/a.mp4?t=1&s=sig")).toBe("https://cdn.x:8443/a.mp4?s=sig&t=1")
    expect(normalizeSourceUrl("https://cdn.x:8443/a.mp4")).not.toBe(normalizeSourceUrl("https://cdn.x/a.mp4"))
    expect(normalizeSourceUrl("https://m.example.com/a.mp4")).toBe("https://m.example.com/a.mp4")
  })
})

describe("identifySource", () => {
  it("names the platform and the video id where the link's shape says them", () => {
    expect(identifySource("https://youtu.be/dQw4w9WgXcQ")).toEqual({ platform: "youtube", videoId: "dQw4w9WgXcQ" })
    expect(identifySource("https://www.youtube.com/shorts/abcdefghijk")).toEqual({ platform: "youtube", videoId: "abcdefghijk" })
    expect(identifySource("https://www.tiktok.com/@a/video/7300000000000000001")).toEqual({ platform: "tiktok", videoId: "7300000000000000001" })
    expect(identifySource("https://www.instagram.com/reel/CxyZ_12/")).toEqual({ platform: "instagram", videoId: "CxyZ_12" })
    expect(identifySource("https://cdn.example.com/clip.mp4").videoId).toBeNull()
    expect(identifySource("https://notyoutube.com/watch?v=abc").videoId).toBeNull()
  })
})

describe("createConfirmation", () => {
  it("records the current declaration, the normalized link, the platform and the account's email, with a confirmed event", async () => {
    const made = await createConfirmation({ userId: "u1", url: "https://www.youtube.com/watch?v=abc&si=1", declarationVersion: 1, lane: "editor", clientAddress: "203.0.113.7", userAgent: "ua" })
    expect(made.declarationVersion).toBe(1)
    const row = mem.confirmations.get(made.id)!
    expect(row).toMatchObject({ user_id: "u1", declaration_version: 1, declaration_hash: "h1", normalized_url: "https://youtube.com/watch?v=abc", platform: "youtube", platform_video_id: "abc", email: "one@example.com", lane: "editor", kind: "checkbox" })
    expect(mem.events).toEqual([expect.objectContaining({ confirmation_id: made.id, kind: "confirmed" })])
  })

  it("refuses a stale declaration version", async () => {
    await expect(createConfirmation({ userId: "u1", url: "https://youtu.be/abc", declarationVersion: 0, lane: "editor" })).rejects.toMatchObject({ code: "rights_confirmation_stale" })
  })
})

describe("requireRightsConfirmation", () => {
  const url = "https://www.youtube.com/watch?v=abc"

  it("passes without a confirmation while the setting is off, and refuses once it is on", async () => {
    await expect(requireRightsConfirmation({ url, userId: "u1", lane: "route" })).resolves.toBeNull()
    mem.required = true
    await expect(requireRightsConfirmation({ url, userId: "u1", lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
  })

  it("consumes a matching confirmation once; the second use, another account, another link, a changed declaration and an old one are refused", async () => {
    const made = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    const first = await requireRightsConfirmation({ url: "https://youtube.com/watch?v=abc&utm_source=mail", userId: "u1", confirmationId: made.id, lane: "route" })
    expect(first?.id).toBe(made.id)
    expect(mem.events.filter((e) => e.kind === "consumed")).toHaveLength(1)
    await expect(requireRightsConfirmation({ url, userId: "u1", confirmationId: made.id, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_used" })

    const other = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    await expect(requireRightsConfirmation({ url, userId: "u2", confirmationId: other.id, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_mismatch" })
    await expect(requireRightsConfirmation({ url: "https://youtu.be/zzz", userId: "u1", confirmationId: other.id, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_mismatch" })
    await expect(requireRightsConfirmation({ url, userId: "u1", confirmationId: "not-a-uuid", lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_not_found" })
    await expect(requireRightsConfirmation({ url, userId: "u1", confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01", lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_not_found" })

    mem.confirmations.get(other.id)!.created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    await expect(requireRightsConfirmation({ url, userId: "u1", confirmationId: other.id, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_expired" })

    const fresh = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    mem.declarations = [...mem.declarations, { version: 2, text: "I confirm that I hold the rights to this content, version two.", text_hash: "h2" }]
    forgetDeclarationCache()
    await expect(requireRightsConfirmation({ url, userId: "u1", confirmationId: fresh.id, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_stale" })
    // Nothing above consumed what was refused.
    expect(mem.events.filter((e) => e.kind === "consumed")).toHaveLength(1)
  })

  it("a runner named on the confirmation may use it", async () => {
    const made = await createConfirmation({ userId: "owner", url, declarationVersion: 1, lane: "app", runnerUserId: "runner" })
    await expect(requireRightsConfirmation({ url, userId: "runner", confirmationId: made.id, lane: "run" })).resolves.toMatchObject({ id: made.id })
  })

  it("the check writes nothing: a refused import keeps its confirmation for the next try", async () => {
    const made = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    await checkRightsConfirmation({ url, userId: "u1", confirmationId: made.id, lane: "route" })
    await checkRightsConfirmation({ url, userId: "u1", confirmationId: made.id, lane: "route" })
    expect(mem.events.filter((e) => e.kind === "consumed")).toHaveLength(0)
    await consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route" })
    await expect(consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_used" })
  })

  it("a spend is idempotent per request: the same job's retry passes, another request or none is refused", async () => {
    const made = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    await consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route", requestId: "job-1" })
    await expect(consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route", requestId: "job-1" })).resolves.toBeUndefined()
    expect(mem.events.filter((e) => e.kind === "consumed")).toHaveLength(1)
    await expect(consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route", requestId: "job-2" })).rejects.toMatchObject({ code: "rights_confirmation_used" })
    await expect(consumeRightsConfirmation({ confirmationId: made.id, url, lane: "route" })).rejects.toMatchObject({ code: "rights_confirmation_used" })
    // A spend recorded with no request id is nobody's retry.
    const other = await createConfirmation({ userId: "u1", url, declarationVersion: 1, lane: "editor" })
    await consumeRightsConfirmation({ confirmationId: other.id, url, lane: "route" })
    await expect(consumeRightsConfirmation({ confirmationId: other.id, url, lane: "route", requestId: "job-1" })).rejects.toMatchObject({ code: "rights_confirmation_used" })
  })

  it("a refusal is final for a worker: it is a deterministic job error", async () => {
    const { isDeterministicJobError } = await import("../deterministic-job-error.js")
    expect(isDeterministicJobError(new ContentRightsError("rights_confirmation_required", "x"))).toBe(true)
    expect(isDeterministicJobError(new Error("yt-dlp failed", { cause: new ContentRightsError("rights_confirmation_used", "x") }))).toBe(true)
  })

  it("the error is a ContentRightsError with its code", async () => {
    mem.required = true
    try {
      await requireRightsConfirmation({ url, userId: "u1", lane: "route" })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ContentRightsError)
      expect((e as ContentRightsError).code).toBe("rights_confirmation_required")
    }
  })
})

describe("the standing authorization", () => {
  const url = "https://www.youtube.com/watch?v=abc"

  it("is recorded under the current declaration with the caller's address, agent and email; a stale version is refused", async () => {
    await expect(currentStandingAuthorization("u1")).resolves.toBeNull()
    await expect(createStandingAuthorization({ userId: "u1", declarationVersion: 2 })).rejects.toMatchObject({ code: "rights_confirmation_stale" })
    const made = await createStandingAuthorization({ userId: "u1", declarationVersion: 1, clientAddress: "203.0.113.7", userAgent: "ua" })
    expect(made).toMatchObject({ userId: "u1", declarationVersion: 1 })
    expect(mem.authorizations).toEqual([expect.objectContaining({ id: made.id, user_id: "u1", declaration_version: 1, declaration_hash: "h1", ip: "203.0.113.7", user_agent: "ua", email: "one@example.com", revoked_at: null })])
    await expect(currentStandingAuthorization("u1")).resolves.toMatchObject({ id: made.id, declarationVersion: 1 })
    await expect(currentStandingAuthorization("u2")).resolves.toBeNull()
  })

  it("one current authorization per account: a new one revokes the earlier; a revoke keeps the record and ends the cover", async () => {
    const first = await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    const second = await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    expect(mem.authorizations.find((a) => a.id === first.id)!.revoked_at).not.toBeNull()
    await expect(currentStandingAuthorization("u1")).resolves.toMatchObject({ id: second.id })
    await expect(revokeStandingAuthorization("u1")).resolves.toBe(1)
    await expect(currentStandingAuthorization("u1")).resolves.toBeNull()
    expect(mem.authorizations).toHaveLength(2)
    await expect(revokeStandingAuthorization("u1")).resolves.toBe(0)
  })

  it("two requests racing to authorize leave one current row: the loser's insert is refused by the index, and it records its own once more", async () => {
    await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    // Another request slipped its row in between this one's revoke and insert.
    const stale = mem.authorizations
    let slipped = false
    mem.authorizations = new Proxy(stale, {
      get(target, prop, receiver) {
        if (prop === "some" && !slipped) {
          slipped = true
          target.push({ id: "racer", user_id: "u1", declaration_version: 1, revoked_at: null, created_at: new Date().toISOString() })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const made = await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    expect(stale.filter((a) => a.revoked_at === null)).toEqual([expect.objectContaining({ id: made.id })])
  })

  it("a new declaration version ends the cover until the person authorizes the new text", async () => {
    await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    publishDeclaration(2)
    await expect(currentStandingAuthorization("u1")).resolves.toBeNull()
    mem.required = true
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "api" })).rejects.toMatchObject({ code: "rights_authorization_required" })
    await createStandingAuthorization({ userId: "u1", declarationVersion: 2 })
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "api" })).resolves.toBeNull()
  })

  it("the read half: a key's, an app's or an agent's import with no confirmation passes on the authorization; without one it is refused once required, with the code naming the remedy", async () => {
    mem.required = true
    for (const via of ["api", "app", "mcp"] as const) {
      await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via })).rejects.toMatchObject({ code: "rights_authorization_required" })
    }
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "session" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "run" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
    await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    for (const via of ["api", "app", "mcp"] as const) {
      await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via })).resolves.toBeNull()
    }
    // The authorization covers the keys and agents only: the person's own session still ticks.
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "session" })).rejects.toMatchObject({ code: "rights_confirmation_required" })
    // And another account's keys are not covered by it.
    await expect(checkRightsConfirmation({ url, userId: "u2", lane: "route", via: "api" })).rejects.toMatchObject({ code: "rights_authorization_required" })
    // Nothing above wrote a confirmation.
    expect(mem.confirmations.size).toBe(0)
  })

  it("while the setting is off a key's import passes with or without an authorization, and a confirmation sent is still checked", async () => {
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "api" })).resolves.toBeNull()
    await expect(checkRightsConfirmation({ url, userId: "u1", lane: "route", via: "api", confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01" })).rejects.toMatchObject({ code: "rights_confirmation_not_found" })
  })

  it("the write half derives a confirmation from the authorization, in the way in's lane, and spends it at once", async () => {
    const standing = await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    const id = await deriveAndConsumeConfirmation({ userId: "u1", url: "https://www.youtube.com/watch?v=abc&si=1", via: "mcp", requestId: "job-1", appId: null, authorizationId: null })
    expect(id).not.toBeNull()
    expect(mem.confirmations.get(id!)).toMatchObject({ user_id: "u1", kind: "derived", standing_authorization_id: standing.id, lane: "mcp", declaration_version: 1, normalized_url: "https://youtube.com/watch?v=abc", platform: "youtube" })
    expect(mem.events.filter((e) => e.confirmation_id === id).map((e) => e.kind)).toEqual(["confirmed", "consumed"])
    expect(mem.events.find((e) => e.confirmation_id === id && e.kind === "consumed")).toMatchObject({ request_id: "job-1", lane: "mcp" })

    const viaApp = await deriveAndConsumeConfirmation({ userId: "u1", url, via: "app", requestId: "job-2", appId: "app-1", authorizationId: "grant-1" })
    expect(mem.confirmations.get(viaApp!)).toMatchObject({ lane: "app", app_id: "app-1", authorization_id: "grant-1", standing_authorization_id: standing.id })
  })

  it("the same request tried again finds the confirmation it spent instead of recording a second; another request records its own", async () => {
    await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    const first = await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api", requestId: "job-1" })
    const again = await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api", requestId: "job-1" })
    expect(again).toBe(first)
    expect(mem.confirmations.size).toBe(1)
    const other = await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api", requestId: "job-2" })
    expect(other).not.toBe(first)
    expect(mem.confirmations.size).toBe(2)
    // No request id: every call is its own import.
    await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api" })
    await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api" })
    expect(mem.confirmations.size).toBe(4)
  })

  it("a request id that spent another account's or another link's confirmation is nobody's retry: a new one is recorded", async () => {
    await createStandingAuthorization({ userId: "u1", declarationVersion: 1 })
    mem.profiles.set("u2", "two@example.com")
    await createStandingAuthorization({ userId: "u2", declarationVersion: 1 })
    const first = await deriveAndConsumeConfirmation({ userId: "u1", url, via: "api", requestId: "req-7" })
    // Another account, the same request id (a per-process counter on another replica).
    const other = await deriveAndConsumeConfirmation({ userId: "u2", url, via: "api", requestId: "req-7" })
    expect(other).not.toBe(first)
    expect(mem.confirmations.get(other!)).toMatchObject({ user_id: "u2" })
    // The same account, another link, the same request id.
    const otherLink = await deriveAndConsumeConfirmation({ userId: "u1", url: "https://youtu.be/zzz", via: "api", requestId: "req-7" })
    expect(otherLink).not.toBe(first)
    expect(mem.confirmations.size).toBe(3)
  })

  it("with no authorization nothing is derived and nothing is written", async () => {
    await expect(deriveAndConsumeConfirmation({ userId: "u1", url, via: "api", requestId: "job-1" })).resolves.toBeNull()
    expect(mem.confirmations.size).toBe(0)
    expect(mem.events).toEqual([])
  })
})
