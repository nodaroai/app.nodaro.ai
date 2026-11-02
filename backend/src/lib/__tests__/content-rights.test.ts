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
  events: [] as Array<Record<string, unknown>>,
  profiles: new Map<string, string>([["u1", "one@example.com"]]),
  seq: 0,
}))

vi.mock("../app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ content_rights_required: mem.required })) }))

vi.mock("../supabase.js", () => {
  const table = (name: string) => {
    const q: Record<string, unknown> & { _eq?: [string, unknown]; _eqs: Array<[string, unknown]>; _order?: string } = { _eqs: [] }
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (col: string, value: unknown) => {
        q._eq = [col, value]
        q._eqs = [...q._eqs, [col, value]]
        return chain
      },
      maybeSingle: async () => {
        if (name === "rights_events") {
          const wanted = q._eqs.find(([col]) => col === "confirmation_id")?.[1]
          const consumed = mem.events.find((e) => e.confirmation_id === wanted && e.kind === "consumed")
          return { data: consumed ? { request_id: consumed.request_id ?? null } : null, error: null }
        }
        if (name === "rights_declarations") {
          const top = [...mem.declarations].sort((a, b) => b.version - a.version)[0] ?? null
          return { data: top, error: null }
        }
        if (name === "content_rights_confirmations") return { data: mem.confirmations.get(String(q._eq?.[1])) ?? null, error: null }
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
  forgetDeclarationCache,
  identifySource,
  normalizeSourceUrl,
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
  mem.events = []
  mem.seq = 0
  forgetDeclarationCache()
})

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
