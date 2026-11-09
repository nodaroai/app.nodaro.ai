import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { settle } from "../../heygen/__tests__/catalog-test-helpers.js"
import { toLibraryVoiceRecord, verifiedLanguageCodes, verifiedModelIds } from "../shared-voices.js"

// ---------------------------------------------------------------------------
// The platform's copy of the shared Voice Library: walked page by page
// through the listing, published to Redis, adopted by the next process with
// no provider call. The fill/cache machine itself is covered by the HeyGen
// catalog tests (lib/progressive-catalog); these pin what THIS catalog adds —
// the page cursor, the record shape, its own Redis namespace, and that a
// request never costs a provider call once the list is whole.
// ---------------------------------------------------------------------------

const cfg = vi.hoisted(() => ({ key: "test-speech-key", hours: 6 }))
vi.mock("@/lib/config.js", () => ({
  config: {
    get ELEVENLABS_API_KEY() {
      return cfg.key
    },
    ELEVENLABS_BASE_URL: "https://speech.test",
    get VOICE_LIBRARY_REFRESH_HOURS() {
      return cfg.hours
    },
  },
}))

// Hoisted so every `vi.resetModules()` + re-import keeps talking to the SAME
// fake Redis — how "the next deploy adopts the snapshot" is modelled.
const redisFake = vi.hoisted(async () => {
  const { makeFakeRedis } = await import("../../heygen/__tests__/fake-redis.js")
  return makeFakeRedis()
})
vi.mock("@/lib/queue.js", async () => ({ redis: await redisFake }))
const fake = await redisFake

function page(voices: unknown[], hasMore: boolean): Response {
  return new Response(JSON.stringify({ voices, has_more: hasMore }), { status: 200, headers: { "Content-Type": "application/json" } })
}

const RAW = [
  {
    voice_id: "v-1",
    name: "Leon - Calm",
    gender: "male",
    age: "middle_aged",
    accent: "american",
    descriptive: "calm",
    use_case: "narrative_story",
    category: "professional",
    language: "en",
    locale: "en-US",
    featured: true,
    description: "x".repeat(300),
    verified_languages: [
      { language: "en", locale: "en-US", model_id: "eleven_v4" },
      { language: "es", locale: "es-ES", model_id: "eleven_multilingual_v2" },
      { language: "en", locale: "en-GB", model_id: "eleven_v3" },
    ],
  },
  { voice_id: "v-2", name: "Tamar", gender: "female", language: "he", verified_languages: [{ language: "he", model_id: "eleven_v4" }] },
  { voice_id: "v-3", name: "Bare" },
]

/** Serve the walk: page 0 → two voices + has_more, page 1 → one voice, done. */
function routePages(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = new URL(String(input))
    if (url.pathname !== "/v1/shared-voices") throw new Error("unexpected fetch: " + url)
    const p = Number(url.searchParams.get("page"))
    if (p === 0) return page(RAW.slice(0, 2), true)
    if (p === 1) return page(RAW.slice(2), false)
    throw new Error("walked past the end: page " + p)
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  fake.reset()
  cfg.key = "test-speech-key"
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function whole() {
  const mod = await import("../voice-library-catalog.js")
  let snap = await mod.snapshotVoiceLibrary()
  for (let i = 0; i < 20 && !snap.complete; i++) {
    await settle()
    snap = await mod.snapshotVoiceLibrary()
  }
  return { mod, snap }
}

describe("the library records", () => {
  it("verifiedLanguageCodes: the primary language first, then every verified one, de-duplicated", () => {
    expect(verifiedLanguageCodes(RAW[0] as never)).toEqual(["en", "es"])
    expect(verifiedLanguageCodes({ language: "de", verified_languages: [{ language: "en" }] })).toEqual(["de", "en"])
    expect(verifiedLanguageCodes({})).toEqual([])
    expect(verifiedModelIds(RAW[0] as never)).toEqual(["eleven_v4", "eleven_multilingual_v2", "eleven_v3"])
  })

  it("toLibraryVoiceRecord keeps what the counts read, normalizes the rest to empty, and cuts the description", () => {
    const rec = toLibraryVoiceRecord(RAW[0] as never)
    expect(rec).toMatchObject({
      id: "v-1",
      name: "Leon - Calm",
      gender: "male",
      age: "middle_aged",
      accent: "american",
      descriptive: "calm",
      useCase: "narrative_story",
      category: "professional",
      language: "en",
      locale: "en-US",
      featured: true,
      languages: ["en", "es"],
    })
    expect(rec.description).toHaveLength(240)
    expect(toLibraryVoiceRecord(RAW[2] as never)).toEqual({
      id: "v-3",
      name: "Bare",
      gender: "",
      age: "",
      accent: "",
      descriptive: "",
      useCase: "",
      category: "",
      language: "",
      locale: "",
      featured: false,
      languages: [],
      description: "",
    })
  })
})

describe("snapshotVoiceLibrary", () => {
  it("walks the listing at 100 a page by page number until has_more is false, then answers the whole list with the time it was walked", async () => {
    routePages(fetchMock)
    const before = Date.now()
    const { snap } = await whole()
    expect(snap.complete).toBe(true)
    expect(snap.items.map((v) => v.id)).toEqual(["v-1", "v-2", "v-3"])
    expect(snap.filledAt).toBeGreaterThanOrEqual(before)
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0])))
    expect(urls.map((u) => u.searchParams.get("page"))).toEqual(["0", "1"])
    expect(urls.every((u) => u.searchParams.get("page_size") === "100")).toBe(true)
    expect(urls[0].origin).toBe("https://speech.test")
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers["xi-api-key"]).toBe("test-speech-key")
  })

  it("once whole, every further request is answered from memory — no provider call", async () => {
    routePages(fetchMock)
    const { mod } = await whole()
    const calls = fetchMock.mock.calls.length
    for (let i = 0; i < 5; i++) expect((await mod.snapshotVoiceLibrary()).complete).toBe(true)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it("publishes the whole list to its own Redis namespace, and a fresh process adopts it with zero provider calls", async () => {
    routePages(fetchMock)
    const { snap } = await whole()
    await settle()
    const stored = JSON.parse(fake.store.get("voice-library:catalog:v1:voices") ?? "null")
    expect(stored).toMatchObject({ generation: snap.generation, filledAt: snap.filledAt })
    expect(stored.items).toHaveLength(3)
    expect(fake.store.has("heygen:catalog:v1:voices")).toBe(false)

    vi.resetModules()
    const calls = fetchMock.mock.calls.length
    const next = await import("../voice-library-catalog.js")
    const adopted = await next.snapshotVoiceLibrary()
    expect(adopted.complete).toBe(true)
    expect(adopted.items.map((v) => v.id)).toEqual(["v-1", "v-2", "v-3"])
    expect(adopted.filledAt).toBe(snap.filledAt)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it("a cold process answers the pages so far as incomplete, with no time stamp, rather than waiting for the walk", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    fetchMock.mockImplementation(async (input: unknown) => {
      const p = Number(new URL(String(input)).searchParams.get("page"))
      if (p === 0) return page(RAW.slice(0, 2), true)
      await gate
      return page(RAW.slice(2), false)
    })
    const mod = await import("../voice-library-catalog.js")
    const partial = await mod.snapshotVoiceLibrary()
    expect(partial.complete).toBe(false)
    expect(partial.filledAt).toBe(0)
    expect(partial.items.map((v) => v.id)).toEqual(["v-1", "v-2"])
    release()
    const { snap } = await whole()
    expect(snap.complete).toBe(true)
    expect(snap.items).toHaveLength(3)
  })

  it("without a speech key there is nothing to walk: an empty, complete list and no fetch", async () => {
    cfg.key = ""
    const mod = await import("../voice-library-catalog.js")
    expect(mod.voiceLibraryConfigured()).toBe(false)
    const snap = await mod.snapshotVoiceLibrary()
    expect(snap).toMatchObject({ complete: true, items: [], filledAt: 0 })
    mod.warmVoiceLibraryCatalog()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a page the provider refuses fails the walk for now and is retried later — the pages so far are kept", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const p = Number(new URL(String(input)).searchParams.get("page"))
      if (p === 0) return page(RAW.slice(0, 2), true)
      return new Response("busy", { status: 429 })
    })
    const mod = await import("../voice-library-catalog.js")
    const snap = await mod.snapshotVoiceLibrary()
    await settle()
    expect(snap.complete).toBe(false)
    expect((await mod.snapshotVoiceLibrary()).items.map((v) => v.id)).toEqual(["v-1", "v-2"])
    expect(fake.store.has("voice-library:catalog:v1:voices")).toBe(false) // a partial list is never published
  })
})
