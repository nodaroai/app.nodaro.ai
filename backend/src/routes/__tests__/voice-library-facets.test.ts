import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { LibraryVoiceRecord } from "../../providers/elevenlabs/shared-voices.js"

// ---------------------------------------------------------------------------
// GET /v1/voices/library/facets — the counts a picker shows. The catalog is
// mocked (its walk is covered in providers/elevenlabs/__tests__); these pin
// the route: a guest gets counts, a keyless install is told so, a library
// not yet walked is a 503 rather than half-counts, the lock narrows what is
// counted, and identical requests are answered from the memo.
// ---------------------------------------------------------------------------

const cfgState = vi.hoisted(() => ({ key: "test-speech-key" as string, business: false }))
vi.mock("@/lib/config.js", () => ({
  config: {
    get ELEVENLABS_API_KEY() {
      return cfgState.key
    },
    ELEVENLABS_BASE_URL: "https://speech.test",
  },
  isBusiness: () => cfgState.business,
  isCloud: () => false,
}))

vi.mock("@/providers/provider-keys.js", () => ({
  describeLimitedVoices: () => "Add a speech key to search the library.",
}))

const catalog = vi.hoisted(() => ({
  snapshot: { items: [] as LibraryVoiceRecord[], offset: 0, total: 0, complete: true, generation: "g1", filledAt: Date.UTC(2026, 10, 9, 6, 0, 0) },
  calls: 0,
}))
vi.mock("@/providers/elevenlabs/voice-library-catalog.js", () => ({
  snapshotVoiceLibrary: async () => {
    catalog.calls++
    return catalog.snapshot
  },
}))

const compute = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@/lib/voice-library-facets.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/voice-library-facets.js")>()
  return {
    ...original,
    computeVoiceLibraryFacets: (...args: Parameters<typeof original.computeVoiceLibraryFacets>) => {
      compute.calls++
      return original.computeVoiceLibraryFacets(...args)
    },
  }
})

function voice(overrides: Partial<LibraryVoiceRecord> & { id: string }): LibraryVoiceRecord {
  return {
    name: overrides.id,
    gender: "male",
    age: "young",
    accent: "american",
    descriptive: "calm",
    useCase: "advertisement",
    category: "professional",
    language: "en",
    locale: "en-US",
    featured: false,
    languages: ["en"],
    description: "",
    ...overrides,
  }
}

const LIBRARY = [
  voice({ id: "m-calm-ad" }),
  voice({ id: "f-deep-ad", gender: "female", descriptive: "deep" }),
  voice({ id: "m-calm-social", useCase: "social_media", languages: ["en", "he"] }),
  voice({ id: "x-unknown", gender: "", descriptive: "" }),
]

let app: FastifyInstance

// The surface profile (the voice lock's source) is read when its module first
// loads, so each test starts from a fresh module registry — the same way the
// listing's tests do — and sets the lock BEFORE the route is imported.
async function boot() {
  const { voiceLibraryFacetRoutes } = await import("../voice-library-facets.js")
  app = Fastify({ logger: false })
  await app.register(voiceLibraryFacetRoutes)
  await app.ready()
}

beforeEach(async () => {
  vi.resetModules()
  compute.calls = 0
  catalog.calls = 0
  cfgState.key = "test-speech-key"
  cfgState.business = false
  delete process.env.NODARO_SURFACE_PROFILE
  catalog.snapshot = { items: LIBRARY, offset: 0, total: LIBRARY.length, complete: true, generation: "g1", filledAt: Date.UTC(2026, 10, 9, 6, 0, 0) }
  await boot()
})

afterEach(async () => {
  await app.close()
  delete process.env.NODARO_SURFACE_PROFILE
})

type Body = { total: number; approximate: boolean; updatedAt: string | null; keyMissing?: boolean; hint?: string } & Record<
  "use_cases" | "languages" | "descriptives" | "genders" | "ages" | "accents" | "categories",
  Array<{ value: string; count: number }>
>
const counts = (list: Array<{ value: string; count: number }>) => Object.fromEntries(list.map((f) => [f.value, f.count]))

describe("GET /v1/voices/library/facets", () => {
  it("a guest gets the counts for the whole library, with when it was read, cacheable for five minutes", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("public, max-age=300, stale-while-revalidate=3600")
    const body = res.json() as Body
    expect(body.total).toBe(4)
    expect(counts(body.use_cases)).toEqual({ advertisement: 3, social_media: 1 })
    expect(counts(body.descriptives)).toEqual({ calm: 2, deep: 1 })
    expect(counts(body.languages)).toEqual({ en: 4, he: 1 })
    expect(counts(body.genders)).toEqual({ male: 2, female: 1 }) // the unlabelled voice counts in no gender
    expect(body.approximate).toBe(false)
    expect(body.updatedAt).toBe("2026-11-09T06:00:00.000Z")
    expect(body.keyMissing).toBeUndefined()
  })

  it("applies the filters as the listing does: every count but the facet's own", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=advertisement&language=en&featured=false" })
    const body = res.json() as Body
    expect(body.total).toBe(3)
    expect(counts(body.use_cases)).toEqual({ advertisement: 3, social_media: 1 }) // its own filter dropped
    expect(counts(body.descriptives)).toEqual({ calm: 1, deep: 1 }) // within advertisement; the social voice is out
    expect(counts(body.languages)).toEqual({ en: 3 })
  })

  it("`search` marks the counts approximate", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets?search=deep" })
    const body = res.json() as Body
    expect(body.total).toBe(1)
    expect(body.approximate).toBe(true)
  })

  it("refuses a malformed query with 400 rather than guessing", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets?featured=maybe" })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe("validation_error")
    expect(catalog.calls).toBe(0)
  })

  it("without a speech key: nothing to count, and SAYS so — never asking the catalog, never cached", async () => {
    cfgState.key = ""
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=advertisement" })
    expect(res.statusCode).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    const body = res.json() as Body
    expect(body).toMatchObject({ total: 0, use_cases: [], languages: [], descriptives: [], approximate: false, updatedAt: null, keyMissing: true })
    expect(body.hint).toContain("speech key")
    expect(catalog.calls).toBe(0)
  })

  it("a library not yet walked is a 503 with Retry-After, not counts over half a list", async () => {
    catalog.snapshot = { ...catalog.snapshot, items: LIBRARY.slice(0, 1), complete: false, filledAt: 0 }
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets" })
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("30")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect((res.json() as { error: { code: string } }).error.code).toBe("voice_library_warming")
  })

  it("identical requests on the same snapshot are counted once; a new filter or a new snapshot counts again", async () => {
    await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=advertisement" })
    await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=advertisement" })
    expect(compute.calls).toBe(1)
    await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=social_media" })
    expect(compute.calls).toBe(2)
    catalog.snapshot = { ...catalog.snapshot, generation: "g2" }
    await app.inject({ method: "GET", url: "/v1/voices/library/facets?use_cases=advertisement" })
    expect(compute.calls).toBe(3)
  })

  it("under a voice lock, counts only the voices the listing would show, and the gender filter is the lock's", async () => {
    await app.close()
    vi.resetModules()
    cfgState.business = true
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["female"] } })
    await boot()
    // The client asks for male voices; the lock forces female — and a voice
    // of unknown gender is not listed under a lock, so it is not counted.
    const res = await app.inject({ method: "GET", url: "/v1/voices/library/facets?gender=male" })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Body
    expect(body.total).toBe(1)
    expect(counts(body.genders)).toEqual({ female: 1 })
    expect(counts(body.descriptives)).toEqual({ deep: 1 })
  })
})
