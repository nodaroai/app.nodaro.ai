// POST /v1/templates/publish — which slug a new template gets.
//
// A publisher who asks for `slug: "ugc-website-video"` used to get
// "ugc-website-video-w6rmls" even though no row held the plain slug, because
// every slug went through generateSlug (which always appends a random suffix).
// Now a requested slug is used EXACTLY when it is free (the column is UNIQUE
// across active and inactive rows alike, so the insert itself is the check, and
// a race between two publishers is the same unique violation), and only a taken
// one falls back to the suffixed form. A publish with no slug is unchanged, and
// a re-publish keeps the slug the template already has.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => false,
  hasOrganizations: () => false,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

// The real sanitiser; the suffix is fixed so a test can tell "suffixed" from "exact".
vi.mock("@/lib/marketplace-helpers.js", () => ({
  sanitizeSlugBase: (s: string, max = 40) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max),
  generateSlug: (name: string) =>
    `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-sfx123`,
  getCreatorDisplayName: vi.fn().mockResolvedValue("Test Creator"),
}))

vi.mock("@/lib/storage.js", () => ({ copyToTemplatePreview: vi.fn() }))

import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { resetPerMinuteColumnsForTest } from "../../lib/listing-per-minute-columns.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW = "00000000-0000-4000-8000-000000000020"
const TEMPLATE = "00000000-0000-4000-8000-000000000040"

function workflowRow() {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: WORKFLOW, user_id: USER, workspace_id: null, visibility: "private",
      nodes: [{ id: "n1", type: "generate-script", data: {} }], edges: [], settings: {}, thumbnail_url: null,
    },
    error: null,
  })
  return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }) } as never
}

function existingLookup(data: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq3 = vi.fn().mockReturnValue({ maybeSingle })
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  return { select: vi.fn().mockReturnValue({ eq: eq1 }) } as never
}

/** Inserts: each call takes the next outcome (an error, or success) and records the slug it carried. */
function insertSequence(outcomes: Array<{ code: string } | null>, slugs: string[]) {
  let call = 0
  return {
    insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
      slugs.push(row.slug as string)
      const outcome = outcomes[Math.min(call++, outcomes.length - 1)]
      const single = vi.fn().mockResolvedValue(
        outcome ? { data: null, error: { ...outcome, message: "duplicate key" } } : { data: { ...row }, error: null },
      )
      return { select: vi.fn().mockReturnValue({ single }) }
    }),
  } as never
}

function updateCapture(capture: { value: Record<string, unknown> | null }) {
  return {
    update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capture.value = payload
      const single = vi.fn().mockResolvedValue({ data: { id: TEMPLATE, slug: "kept-slug", ...payload }, error: null })
      return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }) }
    }),
  } as never
}

/** Wire supabase: `existing` drives the lookup (null = INSERT path), `write` answers the write that follows. */
function wire(existing: Record<string, unknown> | null, write: unknown) {
  let tmplCall = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") return workflowRow()
    if (table === "workflow_templates") return (++tmplCall === 1 ? existingLookup(existing) : write) as never
    return {} as never
  })
}

async function publish(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/v1/templates/publish",
    headers: { "x-user-id": USER },
    payload: { workflowId: WORKFLOW, name: "UGC Website Video", ...payload },
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  resetPerMinuteColumnsForTest()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await workflowTemplatesRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/templates/publish — slug of a new template", () => {
  it("uses a requested slug EXACTLY when it is free", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([null], slugs))
    const res = await publish({ slug: "ugc-website-video" })
    expect(res.statusCode).toBe(200)
    expect(slugs).toEqual(["ugc-website-video"])
    expect(res.json().slug).toBe("ugc-website-video")
  })

  it("normalises the requested slug the way the suffixed form always did (case, spaces), without adding a suffix", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([null], slugs))
    const res = await publish({ slug: "UGC Website Video" })
    expect(res.statusCode).toBe(200)
    expect(slugs).toEqual(["ugc-website-video"])
  })

  it("falls back to the suffixed form of the REQUESTED slug when it is taken", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([{ code: "23505" }, null], slugs))
    const res = await publish({ slug: "ugc-website-video" })
    expect(res.statusCode).toBe(200)
    expect(slugs).toEqual(["ugc-website-video", "ugc-website-video-sfx123"])
    expect(res.json().slug).toBe("ugc-website-video-sfx123")
  })

  it("a race (the free slug is taken between check and insert) is the same unique violation: retries once, suffixed", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([{ code: "23505" }, null], slugs))
    const res = await publish({ slug: "race-slug" })
    expect(res.statusCode).toBe(200)
    expect(slugs).toHaveLength(2)
    expect(slugs[0]).toBe("race-slug")
    expect(slugs[1]).toBe("race-slug-sfx123")
  })

  it("does not swallow a non-unique error", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([{ code: "42P01" }], slugs))
    const res = await publish({ slug: "ugc-website-video" })
    expect(res.statusCode).toBe(500)
    expect(slugs).toHaveLength(1)
  })

  it("keeps the name-derived, suffixed slug when no slug is requested", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([null], slugs))
    const res = await publish({})
    expect(res.statusCode).toBe(200)
    expect(slugs).toEqual(["ugc-website-video-sfx123"])
  })

  it("never hands out a slug a static /v1/templates/<word> route owns: those get the suffix", async () => {
    for (const word of ["browse", "publish", "keep-check", "mine", "favorite", "favorites"]) {
      const slugs: string[] = []
      wire(null, insertSequence([null], slugs))
      const res = await publish({ slug: word })
      expect(res.statusCode).toBe(200)
      expect(slugs).toEqual([`${word}-sfx123`])
    }
  })

  it("a requested slug that sanitises to nothing falls back to the name", async () => {
    const slugs: string[] = []
    wire(null, insertSequence([null], slugs))
    const res = await publish({ slug: "!!!" })
    expect(res.statusCode).toBe(200)
    expect(slugs).toEqual(["ugc-website-video-sfx123"])
  })
})

describe("POST /v1/templates/publish — re-publish keeps the slug", () => {
  it("an UPDATE never writes a slug: same name or renamed, requested slug or not", async () => {
    for (const body of [{}, { slug: "something-else" }, { name: "Renamed" }, { name: "Renamed", slug: "another-slug" }]) {
      const capture: { value: Record<string, unknown> | null } = { value: null }
      wire(
        { id: TEMPLATE, slug: "kept-slug", name: "UGC Website Video", listed_in: ["marketplace"] },
        updateCapture(capture),
      )
      const res = await publish(body)
      expect(res.statusCode).toBe(200)
      expect(capture.value).not.toBeNull()
      expect(capture.value).not.toHaveProperty("slug")
      expect(res.json().slug).toBe("kept-slug")
    }
  })
})
