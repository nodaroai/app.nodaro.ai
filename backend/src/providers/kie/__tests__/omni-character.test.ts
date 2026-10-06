/**
 * KIE Gemini Omni character creation (POST /api/v1/omni/character/create) and
 * the id cache in front of it.
 *
 * The create call is synchronous and mints a `characterId` from a portrait; the
 * video call then passes it as `character_ids`. KIE documents no validity
 * period, so ids are cached conservatively (24h) and a stale one is recreated
 * ONCE by the caller (see video.gemini-character.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    NODE_ENV: "test",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
vi.mock("../../../lib/queue.js", () => ({ redis: redisMock }))

import {
  createOmniCharacter,
  resolveOmniCharacterIds,
  omniCharacterCacheKey,
  isInvalidOmniCharacterError,
  isInvalidOmniAudioError,
  createOmniAudio,
  omniAudioCacheKey,
  omniAudioPersonaName,
  forgetOmniCharacters,
  setOmniCharacterStore,
  _resetOmniCharacterMemoryForTests,
  OMNI_CHARACTER_CACHE_TTL_SEC,
  type OmniCharacterStore,
} from "../omni-character.js"
import { setEgressDecorator, clearEgressDecorator, type EgressCall } from "../../egress.js"

let fetchMock: ReturnType<typeof vi.fn>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
const created = (id: string) => jsonResponse({ code: 200, msg: "success", data: { characterId: id, characterName: "n", imageUrl: "u" } })

const ref = (over: Record<string, unknown> = {}) => ({
  imageUrl: "https://cdn.example/portrait.png",
  description: "A woman with short silver hair",
  ...over,
})
const meta = { modelKey: "gemini-omni-video" }
function hermeticStore(): OmniCharacterStore {
  const data = new Map<string, string>()
  return {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { data.set(k, v) },
    del: async (k) => { data.delete(k) },
  }
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  // Hermetic: never touch a real Redis (the default store is lazy-loaded Redis).
  setOmniCharacterStore(hermeticStore())
  _resetOmniCharacterMemoryForTests()
})
afterEach(() => {
  clearEgressDecorator()
  vi.unstubAllGlobals()
})

describe("createOmniCharacter", () => {
  it("POSTs the documented body (descriptions + image_urls, optional character_name) with the bearer key", async () => {
    fetchMock.mockResolvedValueOnce(created("char-1"))
    const id = await createOmniCharacter(ref({ bodyImageUrl: "https://cdn.example/body.png", name: "Jenny" }), meta)
    expect(id).toBe("char-1")
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.kie.ai/api/v1/omni/character/create")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-kie-key")
    expect(JSON.parse(init.body as string)).toEqual({
      descriptions: "A woman with short silver hair",
      image_urls: ["https://cdn.example/portrait.png", "https://cdn.example/body.png"],
      character_name: "Jenny",
    })
  })

  it("omits the body image and the name when not supplied", async () => {
    fetchMock.mockResolvedValueOnce(created("char-2"))
    await createOmniCharacter(ref(), meta)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.image_urls).toEqual(["https://cdn.example/portrait.png"])
    expect(body).not.toHaveProperty("character_name")
  })

  it("goes through the egress seam with OUR model key threaded (never null) and a stable operation", async () => {
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c) => { seen.push(c); return null } })
    fetchMock.mockResolvedValueOnce(created("char-3"))
    await createOmniCharacter(ref(), { modelKey: "gemini-omni-flash" })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.provider).toBe("kie")
    expect(seen[0]!.operation).toBe("omni.character.create")
    expect(seen[0]!.modelKey).toBe("gemini-omni-flash")
  })

  it("an HTTP error fails with a sanitized error whose internalDetails carries KIE's words", async () => {
    fetchMock.mockResolvedValueOnce(new Response("portrait unreachable", { status: 422 }))
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toMatch(/kie/i)
    expect(err.internalDetails).toContain("422")
    expect(err.internalDetails).toContain("portrait unreachable")
  })

  it("a 200 envelope with a non-success code fails honestly", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 422, msg: "image_urls invalid" }))
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err.internalDetails).toContain("image_urls invalid")
  })

  it("a response with no characterId fails (never returns an empty id)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 200, msg: "success", data: {} }))
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err.internalDetails).toContain("missing characterId")
    expect(err.message).not.toMatch(/kie/i)
  })

  it("a 200 envelope with data:null fails honestly too", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 200, msg: "success", data: null }))
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err.internalDetails).toContain("missing characterId")
  })

  it("a non-JSON 200 body fails with a sanitized error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 200 }))
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err.internalDetails).toContain("not valid JSON")
    expect(err.message).not.toMatch(/kie/i)
  })

  it("a network failure / timeout propagates (the job fails) and is not read as a stale id", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
    fetchMock.mockRejectedValueOnce(timeout)
    const err = await createOmniCharacter(ref(), meta).catch((e) => e)
    expect(err).toBe(timeout)
    expect(isInvalidOmniCharacterError(err)).toBe(false)
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))
    await expect(resolveOmniCharacterIds([ref()], meta)).rejects.toThrow("ECONNRESET")
  })
})

describe("resolveOmniCharacterIds — cache", () => {
  it("creates once, then serves the same reference from the cache (no second create)", async () => {
    fetchMock.mockResolvedValueOnce(created("char-A"))
    const first = await resolveOmniCharacterIds([ref()], meta)
    const second = await resolveOmniCharacterIds([ref()], meta)
    expect(first).toEqual({ ids: ["char-A"], fromCache: [false], audioIds: [] })
    expect(second).toEqual({ ids: ["char-A"], fromCache: [true], audioIds: [] })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("keys on (imageUrl, bodyImageUrl, description, name): any difference mints a new character", async () => {
    fetchMock.mockResolvedValueOnce(created("c1")).mockResolvedValueOnce(created("c2"))
    const a = await resolveOmniCharacterIds([ref()], meta)
    const b = await resolveOmniCharacterIds([ref({ description: "A different woman" })], meta)
    expect(a.ids).toEqual(["c1"])
    expect(b.ids).toEqual(["c2"])
    expect(omniCharacterCacheKey(ref())).not.toBe(omniCharacterCacheKey(ref({ name: "X" })))
    expect(omniCharacterCacheKey(ref())).not.toBe(omniCharacterCacheKey(ref({ bodyImageUrl: "https://cdn.example/b.png" })))
    expect(omniCharacterCacheKey(ref())).toBe(omniCharacterCacheKey(ref()))
  })

  it("preserves order and creates duplicates within one call only once", async () => {
    fetchMock.mockResolvedValueOnce(created("c1")).mockResolvedValueOnce(created("c2"))
    const r = await resolveOmniCharacterIds([ref(), ref({ description: "B" }), ref()], meta)
    expect(r.ids).toEqual(["c1", "c2", "c1"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("force=true skips the cache read and overwrites the entry (the stale-id recreate)", async () => {
    fetchMock.mockResolvedValueOnce(created("old")).mockResolvedValueOnce(created("new"))
    await resolveOmniCharacterIds([ref()], meta)
    const forced = await resolveOmniCharacterIds([ref()], meta, { force: true })
    expect(forced).toEqual({ ids: ["new"], fromCache: [false], audioIds: [] })
    const after = await resolveOmniCharacterIds([ref()], meta)
    expect(after.ids).toEqual(["new"])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("uses an injected store with a conservative TTL (24h)", async () => {
    expect(OMNI_CHARACTER_CACHE_TTL_SEC).toBe(24 * 60 * 60)
    const inner = hermeticStore()
    const store: OmniCharacterStore = {
      get: vi.fn(inner.get),
      set: vi.fn(inner.set),
      del: vi.fn(inner.del),
    }
    setOmniCharacterStore(store)
    fetchMock.mockResolvedValueOnce(created("redis-1"))
    await resolveOmniCharacterIds([ref()], meta)
    expect(store.set).toHaveBeenCalledWith(omniCharacterCacheKey(ref()), "redis-1", OMNI_CHARACTER_CACHE_TTL_SEC)
    const again = await resolveOmniCharacterIds([ref()], meta)
    expect(again.fromCache).toEqual([true])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("a failing store degrades to a create (never fails the job over the cache)", async () => {
    setOmniCharacterStore({
      get: async () => { throw new Error("redis down") },
      set: async () => { throw new Error("redis down") },
      del: async () => { throw new Error("redis down") },
    })
    fetchMock.mockResolvedValueOnce(created("c-ok"))
    const r = await resolveOmniCharacterIds([ref()], meta)
    expect(r.ids).toEqual(["c-ok"])
  })

  it("a create failure fails the whole resolve — nothing falls back silently", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }))
    const err = await resolveOmniCharacterIds([ref()], meta).catch((e) => e)
    expect(err.internalDetails).toContain("500")
    expect(err.internalDetails).toContain("nope")
  })
})

describe("forgetOmniCharacters", () => {
  it("drops the entry from the store AND the in-process map, so the next resolve creates again", async () => {
    fetchMock.mockResolvedValueOnce(created("c1")).mockResolvedValueOnce(created("c2"))
    await resolveOmniCharacterIds([ref()], meta)
    await forgetOmniCharacters([ref()])
    const after = await resolveOmniCharacterIds([ref()], meta)
    expect(after).toEqual({ ids: ["c2"], fromCache: [false], audioIds: [] })
  })

  it("swallows a throwing store (best effort) and still clears the in-process fallback", async () => {
    // Redis down for the whole sequence: ids live in the in-process fallback.
    setOmniCharacterStore({
      get: async () => { throw new Error("redis down") },
      set: async () => { throw new Error("redis down") },
      del: async () => { throw new Error("redis down") },
    })
    fetchMock.mockResolvedValueOnce(created("c1")).mockResolvedValueOnce(created("c2"))
    await resolveOmniCharacterIds([ref()], meta)
    await expect(forgetOmniCharacters([ref()])).resolves.toBeUndefined()
    const after = await resolveOmniCharacterIds([ref()], meta)
    expect(after).toEqual({ ids: ["c2"], fromCache: [false], audioIds: [] })
  })
})

describe("isInvalidOmniCharacterError", () => {
  const kieErr = (internalDetails: string) => Object.assign(new Error("sanitized"), { internalDetails })
  it("recognises KIE's stale/unknown-character wording on internalDetails (not the sanitized message)", () => {
    expect(isInvalidOmniCharacterError(kieErr("createTask error (code 422): character_ids contains an invalid character id"))).toBe(true)
    expect(isInvalidOmniCharacterError(kieErr("Character not found: b09dbf56"))).toBe(true)
    expect(isInvalidOmniCharacterError(kieErr("character has expired"))).toBe(true)
  })
  it("does not match unrelated failures", () => {
    expect(isInvalidOmniCharacterError(kieErr("Aspect ratio only supports [16:9, 9:16]"))).toBe(false)
    expect(isInvalidOmniCharacterError(kieErr("content policy violation: the character resembles a public figure"))).toBe(false)
    // Prompt-text errors that merely contain the word "character(s)" must NOT cost a recreate + resubmit.
    expect(isInvalidOmniCharacterError(kieErr("prompt contains invalid characters"))).toBe(false)
    expect(isInvalidOmniCharacterError(kieErr("unknown character set in prompt"))).toBe(false)
    expect(isInvalidOmniCharacterError(kieErr("invalid character in prompt"))).toBe(false)
    expect(isInvalidOmniCharacterError(kieErr("prompt too long: 5001 characters, expired quota"))).toBe(false)
    expect(isInvalidOmniCharacterError(new Error("character not found"))).toBe(false) // no internalDetails
    expect(isInvalidOmniCharacterError(null)).toBe(false)
  })
})

describe("default Redis store (lazy)", () => {
  it("reads/writes under the kie:omni-character: prefix with EX = 24h, via the queue's shared connection", async () => {
    setOmniCharacterStore(null) // the production default
    redisMock.get.mockResolvedValueOnce(null)
    redisMock.set.mockResolvedValueOnce("OK")
    fetchMock.mockResolvedValueOnce(created("char-r"))
    await resolveOmniCharacterIds([ref()], meta)
    expect(redisMock.get).toHaveBeenCalledWith(omniCharacterCacheKey(ref()))
    expect(redisMock.set).toHaveBeenCalledWith(omniCharacterCacheKey(ref()), "char-r", "EX", 86400)
    expect(omniCharacterCacheKey(ref())).toMatch(/^kie:omni-character:[0-9a-f]{64}$/)

    redisMock.get.mockResolvedValueOnce("char-r")
    const hit = await resolveOmniCharacterIds([ref()], meta)
    expect(hit.fromCache).toEqual([true])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("a Redis outage degrades to the in-process cache — the job never fails over the cache", async () => {
    setOmniCharacterStore(null)
    redisMock.get.mockRejectedValue(new Error("ECONNREFUSED"))
    redisMock.set.mockRejectedValue(new Error("ECONNREFUSED"))
    fetchMock.mockResolvedValueOnce(created("char-m"))
    const first = await resolveOmniCharacterIds([ref()], meta)
    const second = await resolveOmniCharacterIds([ref()], meta)
    expect(first.ids).toEqual(["char-m"])
    expect(second).toEqual({ ids: ["char-m"], fromCache: [true], audioIds: [] }) // served from memory
    expect(fetchMock).toHaveBeenCalledOnce()
    redisMock.get.mockReset()
    redisMock.set.mockReset()
  })
})

// ---------------------------------------------------------------------------
// Voice persona — POST /api/v1/omni/audio/create
// ---------------------------------------------------------------------------

const audioCreated = (id: string, code = 0) => jsonResponse({ code, msg: "success", data: { kieAudioId: id, name: "n" } })
const voice = { preset: "kore", description: "warm, unhurried", exampleLine: "Hello there" } as const
const bodyOf = (call: number) => JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string)
const urlOf = (call: number) => (fetchMock.mock.calls[call] as [string, RequestInit])[0]

describe("createOmniAudio", () => {
  it("POSTs the documented body to /omni/audio/create with the bearer key and returns kieAudioId", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-1"))
    const id = await createOmniAudio({ ...voice }, "Ava", meta)
    expect(id).toBe("aud-1")
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.kie.ai/api/v1/omni/audio/create")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-kie-key")
    expect(JSON.parse(init.body as string)).toEqual({
      audio_id: "kore",
      name: "Ava",
      voice_description: "warm, unhurried",
      example_dialogue: "Hello there",
    })
  })

  it("omits voice_description and example_dialogue when not supplied", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-2"))
    await createOmniAudio({ preset: "puck" }, "puck voice", meta)
    expect(bodyOf(0)).toEqual({ audio_id: "puck", name: "puck voice" })
  })

  it.each([0, 200])("accepts envelope code %s as success (the doc shows 0, the character endpoint 200)", async (code) => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-ok", code))
    await expect(createOmniAudio({ preset: "kore" }, "n", meta)).resolves.toBe("aud-ok")
  })

  it("fails on any other envelope code, with KIE's words only on internalDetails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 422, msg: "audio_id is invalid", data: null }))
    const err = await createOmniAudio({ preset: "kore" }, "n", meta).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toMatch(/kie/i)
    expect(err.message).not.toContain("audio_id is invalid")
    expect(err.internalDetails).toContain("422")
    expect(err.internalDetails).toContain("audio_id is invalid")
  })

  it("an HTTP error maps to a sanitized error carrying the status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("voice service down", { status: 503 }))
    const err = await createOmniAudio({ preset: "kore" }, "n", meta).catch((e) => e)
    expect(err.internalDetails).toContain("503")
    expect(err.internalDetails).toContain("voice service down")
  })

  it("a response with no kieAudioId, data:null, or non-JSON fails (never returns an empty id)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, msg: "success", data: {} }))
    await expect(createOmniAudio({ preset: "kore" }, "n", meta)).rejects.toThrow()
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0, msg: "success", data: null }))
    await expect(createOmniAudio({ preset: "kore" }, "n", meta)).rejects.toThrow()
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }))
    await expect(createOmniAudio({ preset: "kore" }, "n", meta)).rejects.toThrow()
  })

  it("goes through the egress seam with OUR model key (never null) and a stable operation", async () => {
    const seen: EgressCall[] = []
    setEgressDecorator({ decorate: (c) => { seen.push(c); return null } })
    fetchMock.mockResolvedValueOnce(audioCreated("aud-3"))
    await createOmniAudio({ preset: "kore" }, "n", { modelKey: "gemini-omni-flash" })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.provider).toBe("kie")
    expect(seen[0]!.operation).toBe("omni.audio.create")
    expect(seen[0]!.modelKey).toBe("gemini-omni-flash")
  })

  it("a network failure propagates (the job fails) and is not read as a stale id", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"))
    const err = await createOmniAudio({ preset: "kore" }, "n", meta).catch((e) => e)
    expect(err.message).toBeDefined()
    expect(isInvalidOmniAudioError(err)).toBe(false)
  })
})

describe("omniAudioPersonaName", () => {
  it("uses the character name, else '<preset> voice', capped at the documented 210", () => {
    expect(omniAudioPersonaName({ ...ref({ name: "Ava" }), voice: { preset: "kore" } } as never)).toBe("Ava")
    expect(omniAudioPersonaName({ ...ref(), voice: { preset: "kore" } } as never)).toBe("kore voice")
    expect(omniAudioPersonaName({ ...ref({ name: "n".repeat(300) }), voice: { preset: "kore" } } as never)).toHaveLength(210)
  })
})

describe("voiced characters — cache key separation", () => {
  const voiced = (over: Record<string, unknown> = {}) => ref({ voice: { ...voice }, ...over })

  it("a voiced and an unvoiced character NEVER share a character cache key", () => {
    expect(omniCharacterCacheKey(voiced())).not.toBe(omniCharacterCacheKey(ref()))
  })

  it("the unvoiced key is unchanged (voice only ever ADDS a dimension)", () => {
    expect(omniCharacterCacheKey(ref())).toBe(omniCharacterCacheKey(ref({ voice: undefined })))
  })

  it("preset, description and example line each change the character key", () => {
    const k = omniCharacterCacheKey(voiced())
    expect(omniCharacterCacheKey(voiced({ voice: { ...voice, preset: "puck" } }))).not.toBe(k)
    expect(omniCharacterCacheKey(voiced({ voice: { ...voice, description: "cold" } }))).not.toBe(k)
    expect(omniCharacterCacheKey(voiced({ voice: { ...voice, exampleLine: "Bye" } }))).not.toBe(k)
    // absent vs explicitly-undefined optionals are the same voice
    expect(omniCharacterCacheKey(ref({ voice: { preset: "kore" } }))).toBe(
      omniCharacterCacheKey(ref({ voice: { preset: "kore", description: undefined, exampleLine: undefined } })),
    )
  })

  it("the audio key covers (preset, description, exampleLine, name) and has its own prefix", () => {
    const k = omniAudioCacheKey({ ...voice }, "Ava")
    expect(k).toMatch(/^kie:omni-audio:[0-9a-f]{64}$/)
    expect(omniAudioCacheKey({ ...voice }, "Ava")).toBe(k)
    expect(omniAudioCacheKey({ ...voice }, "Bea")).not.toBe(k)
    expect(omniAudioCacheKey({ ...voice, preset: "puck" }, "Ava")).not.toBe(k)
    expect(omniAudioCacheKey({ ...voice, description: "x" }, "Ava")).not.toBe(k)
    expect(omniAudioCacheKey({ ...voice, exampleLine: "x" }, "Ava")).not.toBe(k)
  })
})

describe("resolveOmniCharacterIds — voiced characters", () => {
  const voiced = (over: Record<string, unknown> = {}) => ref({ name: "Ava", voice: { ...voice }, ...over })

  it("creates the audio persona FIRST, then the character with audio_ids, and returns the audio id", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-A")).mockResolvedValueOnce(created("char-A"))
    const r = await resolveOmniCharacterIds([voiced()], meta)
    expect(r).toEqual({ ids: ["char-A"], fromCache: [false], audioIds: ["aud-A"] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlOf(0)).toBe("https://api.kie.ai/api/v1/omni/audio/create")
    expect(urlOf(1)).toBe("https://api.kie.ai/api/v1/omni/character/create")
    expect(bodyOf(0)).toEqual({ audio_id: "kore", name: "Ava", voice_description: "warm, unhurried", example_dialogue: "Hello there" })
    expect(bodyOf(1).audio_ids).toEqual(["aud-A"])
  })

  it("an unvoiced character's create body has NO audio_ids and makes no audio call", async () => {
    fetchMock.mockResolvedValueOnce(created("char-U"))
    const r = await resolveOmniCharacterIds([ref()], meta)
    expect(r.audioIds).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(bodyOf(0)).not.toHaveProperty("audio_ids")
  })

  it("a voiced and an unvoiced copy of the same character are two characters (no shared id)", async () => {
    fetchMock
      .mockResolvedValueOnce(created("char-plain"))
      .mockResolvedValueOnce(audioCreated("aud-1"))
      .mockResolvedValueOnce(created("char-voiced"))
    const plain = await resolveOmniCharacterIds([ref({ name: "Ava" })], meta)
    const withVoice = await resolveOmniCharacterIds([voiced()], meta)
    expect(plain.ids).toEqual(["char-plain"])
    expect(withVoice.ids).toEqual(["char-voiced"])
  })

  it("a second resolve serves BOTH the character and the audio from cache (no creates), still returning the audio id", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-A")).mockResolvedValueOnce(created("char-A"))
    await resolveOmniCharacterIds([voiced()], meta)
    const again = await resolveOmniCharacterIds([voiced()], meta)
    expect(again).toEqual({ ids: ["char-A"], fromCache: [true], audioIds: ["aud-A"] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("two characters sharing one voice (same name) share one audio create and one id in audioIds", async () => {
    fetchMock
      .mockResolvedValueOnce(audioCreated("aud-shared"))
      .mockResolvedValueOnce(created("c1"))
      .mockResolvedValueOnce(created("c2"))
    const r = await resolveOmniCharacterIds(
      [voiced({ name: undefined }), voiced({ name: undefined, imageUrl: "https://cdn.example/other.png" })],
      meta,
    )
    expect(r.ids).toEqual(["c1", "c2"])
    expect(r.audioIds).toEqual(["aud-shared"])
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/audio/create"))).toHaveLength(1)
    expect(bodyOf(1).audio_ids).toEqual(["aud-shared"])
    expect(bodyOf(2).audio_ids).toEqual(["aud-shared"])
  })

  it("distinct voices yield distinct audio ids, in request order", async () => {
    fetchMock
      .mockResolvedValueOnce(audioCreated("aud-1")).mockResolvedValueOnce(created("c1"))
      .mockResolvedValueOnce(audioCreated("aud-2")).mockResolvedValueOnce(created("c2"))
    const r = await resolveOmniCharacterIds(
      [voiced(), voiced({ name: "Bo", imageUrl: "https://cdn.example/bo.png", voice: { preset: "puck" } })],
      meta,
    )
    expect(r.audioIds).toEqual(["aud-1", "aud-2"])
  })

  it("a cached character whose audio entry vanished re-creates the audio (the video request still needs its id)", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-old")).mockResolvedValueOnce(created("char-A"))
    await resolveOmniCharacterIds([voiced()], meta)
    // lose ONLY the audio entry
    const store = hermeticStore()
    const key = omniAudioCacheKey({ ...voice }, "Ava")
    const charKey = omniCharacterCacheKey(voiced())
    await store.set(charKey, "char-A", 60)
    setOmniCharacterStore(store)
    _resetOmniCharacterMemoryForTests()
    fetchMock.mockResolvedValueOnce(audioCreated("aud-new"))
    const r = await resolveOmniCharacterIds([voiced()], meta)
    expect(await store.get(key)).toBe("aud-new")
    expect(r.ids).toEqual(["char-A"])
    expect(r.audioIds).toEqual(["aud-new"])
  })

  it("force=true re-creates the audio AND the character", async () => {
    fetchMock
      .mockResolvedValueOnce(audioCreated("aud-1")).mockResolvedValueOnce(created("c1"))
      .mockResolvedValueOnce(audioCreated("aud-2")).mockResolvedValueOnce(created("c2"))
    await resolveOmniCharacterIds([voiced()], meta)
    const forced = await resolveOmniCharacterIds([voiced()], meta, { force: true })
    expect(forced).toEqual({ ids: ["c2"], fromCache: [false], audioIds: ["aud-2"] })
    expect(bodyOf(3).audio_ids).toEqual(["aud-2"])
  })

  it("an audio create failure fails the resolve before any character is created", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }))
    await expect(resolveOmniCharacterIds([voiced()], meta)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce() // no character create, no silent fallback to an unvoiced character
  })

  it("forgetOmniCharacters drops the audio entry too, so a stale voice id is re-minted", async () => {
    fetchMock
      .mockResolvedValueOnce(audioCreated("aud-1")).mockResolvedValueOnce(created("c1"))
      .mockResolvedValueOnce(audioCreated("aud-2")).mockResolvedValueOnce(created("c2"))
    await resolveOmniCharacterIds([voiced()], meta)
    await forgetOmniCharacters([voiced()])
    const after = await resolveOmniCharacterIds([voiced()], meta)
    expect(after).toEqual({ ids: ["c2"], fromCache: [false], audioIds: ["aud-2"] })
  })

  it("a voiced reference served partly from cache is flagged fromCache (so a stale-id retry recreates it)", async () => {
    fetchMock.mockResolvedValueOnce(audioCreated("aud-A")).mockResolvedValueOnce(created("char-A"))
    await resolveOmniCharacterIds([voiced()], meta)
    // character entry lost, audio entry kept
    const store = hermeticStore()
    await store.set(omniAudioCacheKey({ ...voice }, "Ava"), "aud-A", 60)
    setOmniCharacterStore(store)
    _resetOmniCharacterMemoryForTests()
    fetchMock.mockResolvedValueOnce(created("char-B"))
    const r = await resolveOmniCharacterIds([voiced()], meta)
    expect(r.ids).toEqual(["char-B"])
    expect(r.fromCache).toEqual([true])
    expect(bodyOf(2).audio_ids).toEqual(["aud-A"])
  })
})

describe("isInvalidOmniAudioError", () => {
  const kieErr = (internalDetails: string) => Object.assign(new Error("sanitized"), { internalDetails })
  it("recognises an unknown/expired audio id on internalDetails", () => {
    expect(isInvalidOmniAudioError(kieErr("createTask error (code 422): audio_ids contains an invalid audio id"))).toBe(true)
    expect(isInvalidOmniAudioError(kieErr("audioId not found"))).toBe(true)
    expect(isInvalidOmniAudioError(kieErr("audio id has expired"))).toBe(true)
  })
  it("does not match unrelated failures", () => {
    expect(isInvalidOmniAudioError(kieErr("Aspect ratio only supports [16:9, 9:16]"))).toBe(false)
    expect(isInvalidOmniAudioError(kieErr("audio track too long"))).toBe(false)
    expect(isInvalidOmniAudioError(kieErr("invalid audio format"))).toBe(false)
    expect(isInvalidOmniAudioError(new Error("audio_ids invalid"))).toBe(false) // no internalDetails
    expect(isInvalidOmniAudioError(null)).toBe(false)
  })
})
