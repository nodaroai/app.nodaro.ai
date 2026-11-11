/**
 * The writes that read another person's job by its id first — adding a
 * favorite (REST `POST /v1/gallery/favorite` through `toggleGalleryFavorite`,
 * MCP `favorite_asset`) and a Suno follow-up on someone else's track
 * (`suno_extend` through `resolveSunoIds`) — on a deployment that does not
 * allow public outputs (`outputs.allowPublic: false`). There no job is public
 * to anyone but its owner (`lib/public-job-read.ts`): someone else's job marked
 * public reads as not found, nothing is written and nothing is dispatched.
 * Removing a favorite always works. With the switch on, both behave as before.
 *
 * The job read is answered the way PostgREST would answer the `or()` filter
 * the code sends, so what is tested is the filter itself, not a stub's say-so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const CALLER = "u1"
const OTHER = "00000000-0000-4000-8000-0000000000bb"
const JOB = "00000000-0000-4000-8000-0000000000aa"

const db = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  favorites: [] as Array<{ user_id: string; job_id: string }>,
  inserts: [] as unknown[],
  deletes: 0,
}))

/** Whether `row` passes a PostgREST `or()` filter of the two shapes the code sends. */
function passes(row: Record<string, unknown>, filter: string): boolean {
  return filter.split(/,(?![^()]*\))/).some((clause) => {
    const own = /^user_id\.eq\.(.+)$/.exec(clause)
    if (own) return row.user_id === own[1]
    if (clause === "and(is_public.eq.true,status.eq.completed)") return row.is_public === true && row.status === "completed"
    throw new Error(`unexpected filter clause: ${clause}`)
  })
}

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const state: { filter?: string; jobId?: string } = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.is = () => chain
      chain.limit = () => chain
      chain.order = () => chain
      chain.eq = (col: string, value: string) => {
        if (col === "id" || col === "job_id") state.jobId = value
        return chain
      }
      chain.or = (filter: string) => {
        state.filter = filter
        return chain
      }
      chain.maybeSingle = async () => {
        if (table !== "jobs" || !db.job || state.jobId !== db.job.id) return { data: null, error: null }
        if (state.filter && !passes(db.job, state.filter)) return { data: null, error: null }
        return { data: db.job, error: null }
      }
      chain.single = async () => ({ data: { mcp_preferences: {} }, error: null })
      chain.insert = async (row: unknown) => {
        db.inserts.push(row)
        return { error: null }
      }
      chain.delete = () => {
        db.deletes += 1
        const del: Record<string, unknown> = { eq: () => del, then: (resolve: (v: unknown) => void) => resolve({ error: null }) }
        return del
      }
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === "gallery_favorites" ? db.favorites.filter((f) => f.job_id === state.jobId).map(() => ({ id: "fav-1" })) : [], error: null })
      return chain
    },
  },
}))

const { toggleGalleryFavorite } = await import("../../../gallery-favorites.js")
const { registerGallery } = await import("../gallery.js")
const { registerVerbs } = await import("../verbs.js")

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

const othersPublicTrack = () => ({
  id: JOB,
  user_id: OTHER,
  is_public: true,
  status: "completed",
  output_data: { sunoTaskId: "task-1", sunoTrackId: "track-1", audioUrl: "https://cdn.example/track.mp3" },
})

beforeEach(() => {
  _resetRegistry()
  db.job = othersPublicTrack()
  db.favorites = []
  db.inserts = []
  db.deletes = 0
})

afterEach(() => setProfile(null))

const favoriteAsset = async (favorited: boolean) => {
  const server = buildServer()
  registerGallery({ server, session: newSession({ userId: CALLER, scopes: ["assets:write"] as Scope[], clientName: "Claude" }), fastify: Fastify() })
  return callTool(server, "favorite_asset", { job_id: JOB, favorited })
}

const sunoExtend = async () => {
  const route = stubRoute("POST", "/v1/suno/extend", { jobId: "j-extend" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify: route.fastify })
  const result = await callTool(server, "suno_extend", { audio_asset_id: JOB })
  return { result, received: route.received }
}

describe("with outputs.allowPublic false", () => {
  beforeEach(() => setProfile({ outputs: { allowPublic: false } }))

  it("the REST toggle answers another person's public job as not found, and stores nothing", async () => {
    expect(await toggleGalleryFavorite(CALLER, JOB)).toEqual({ kind: "not_found" })
    expect(db.inserts).toEqual([])
  })

  it("the REST toggle still favorites the caller's own job", async () => {
    db.job = { ...othersPublicTrack(), user_id: CALLER, is_public: false }
    expect(await toggleGalleryFavorite(CALLER, JOB)).toEqual({ kind: "toggled", favorited: true })
    expect(db.inserts).toHaveLength(1)
  })

  it("removing a favorite always works, even of a job that is no longer readable", async () => {
    db.favorites = [{ user_id: CALLER, job_id: JOB }]
    expect(await toggleGalleryFavorite(CALLER, JOB)).toEqual({ kind: "toggled", favorited: false })
    expect(db.deletes).toBe(1)
  })

  it("MCP favorite_asset refuses another person's public job, and stores nothing", async () => {
    const result = await favoriteAsset(true)
    expect(result.isError).toBe(true)
    expect(db.inserts).toEqual([])
  })

  it("MCP favorite_asset still unfavorites", async () => {
    const result = await favoriteAsset(false)
    expect(result.isError).toBeFalsy()
    expect(db.deletes).toBe(1)
  })

  it("suno_extend on another person's public track finds no track, and dispatches nothing", async () => {
    const { result, received } = await sunoExtend()
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("Could not find Suno taskId/audioId")
    expect(received.url).toBeUndefined()
  })

  it("suno_extend on the caller's own track goes on as before", async () => {
    db.job = { ...othersPublicTrack(), user_id: CALLER, is_public: false }
    const { result, received } = await sunoExtend()
    expect(result.isError).toBeFalsy()
    expect(received.body).toMatchObject({ audioId: "track-1", taskId: "task-1" })
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  it("the REST toggle favorites another person's public job, as before", async () => {
    expect(await toggleGalleryFavorite(CALLER, JOB)).toEqual({ kind: "toggled", favorited: true })
    expect(db.inserts).toEqual([{ user_id: CALLER, job_id: JOB }])
  })

  it("the REST toggle still refuses another person's private job", async () => {
    db.job = { ...othersPublicTrack(), is_public: false }
    expect(await toggleGalleryFavorite(CALLER, JOB)).toEqual({ kind: "not_found" })
  })

  it("MCP favorite_asset favorites another person's public job, as before", async () => {
    const result = await favoriteAsset(true)
    expect(result.isError).toBeFalsy()
    expect(db.inserts).toEqual([{ user_id: CALLER, job_id: JOB }])
  })

  it("suno_extend extends another person's public track, as before", async () => {
    const { result, received } = await sunoExtend()
    expect(result.isError).toBeFalsy()
    expect(received.body).toMatchObject({ audioId: "track-1", taskId: "task-1" })
  })
})
