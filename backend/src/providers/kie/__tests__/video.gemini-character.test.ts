/**
 * Gemini Omni character references at the provider: `characterReferences` →
 * (create / cached) character ids → `character_ids` on the createTask body.
 *
 * The create endpoint and its cache are covered in omni-character.test.ts; here
 * they are mocked so the assertions are about what runGeminiOmni DOES with them:
 * what it asks for, what it sends, when it retries, and when it fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockRunKieTask: vi.fn(),
  mockResolve: vi.fn(),
  mockForget: vi.fn(),
  mockCreateSanitizedError: vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  ),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))
vi.mock("../kling3-client.js", () => ({ kling3Generate: vi.fn() }))
vi.mock("../omni-character.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../omni-character.js")>()),
  resolveOmniCharacterIds: mocks.mockResolve,
  forgetOmniCharacters: mocks.mockForget,
}))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: vi.fn() }))
vi.mock("sharp", () => {
  const mockSharp = () => ({})
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"

const A = { imageUrl: "https://cdn.example/a.png", description: "A woman with silver hair", name: "Ava" }
const B = { imageUrl: "https://cdn.example/b.png", bodyImageUrl: "https://cdn.example/b-body.png", description: "A tall man" }

const okRun = { resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 }
const staleErr = () => Object.assign(new Error("sanitized"), {
  internalDetails: "createTask error (code 422): character_ids contains an invalid character id",
})

let provider: KieVideoProvider
const sentInput = (call = 0) => mocks.mockRunKieTask.mock.calls[call]![1] as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunKieTask.mockResolvedValue(okRun)
  mocks.mockResolve.mockImplementation(async (refs: unknown[]) => ({
    ids: refs.map((_, i) => `char-${i + 1}`),
    fromCache: refs.map(() => false),
    audioIds: [],
  }))
  provider = new KieVideoProvider()
})

describe("gemini-omni — characterReferences → character_ids", () => {
  it.each(["gemini-omni-video", "gemini-omni-flash"])("%s T2V: creates the characters and sends character_ids", async (model) => {
    await provider.textToVideo("a prompt", model, 8, "16:9", { characterReferences: [A, B] })
    expect(mocks.mockResolve).toHaveBeenCalledOnce()
    // OUR model key is threaded to the create call (the egress seam keys money on it).
    expect(mocks.mockResolve.mock.calls[0]![0]).toEqual([A, B])
    expect(mocks.mockResolve.mock.calls[0]![1]).toEqual({ modelKey: model })
    expect(sentInput().character_ids).toEqual(["char-1", "char-2"])
    expect(sentInput().image_urls).toBeUndefined() // identity rides character_ids, NOT image_urls
  })

  it("i2v route with NO start frame (characters only) takes the same path", async () => {
    await provider.imageToVideo(undefined as unknown as string, "a prompt", "gemini-omni-video", 8, undefined, {
      characterReferences: [A],
    })
    expect(sentInput().character_ids).toEqual(["char-1"])
  })

  it("is byte-identical without characters: no create call, no character_ids key", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", {})
    expect(mocks.mockResolve).not.toHaveBeenCalled()
    expect(sentInput()).not.toHaveProperty("character_ids")
  })

  it("combines with reference images and a source video within the 7-unit budget", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", {
      characterReferences: [A, B], // 1 + 2 = 3
      referenceVideoUrls: ["https://x/v.mp4"], // 2
      referenceImageUrls: ["https://x/r1.png", "https://x/r2.png"], // 2 → 7 total
    })
    expect(sentInput().character_ids).toEqual(["char-1", "char-2"])
    expect(sentInput().image_urls).toEqual(["https://x/r1.png", "https://x/r2.png"])
    expect(sentInput().video_list).toBeDefined()
  })

  it.each([
    ["gemini-omni-video", false],
    ["gemini-omni-flash", true], // its schema REQUIRES duration, even beside a video_list
  ])("%s characters + source video (the face + real-voice probe shape): full body pinned", async (model, sendsDuration) => {
    await provider.textToVideo("a prompt", model, 8, "16:9", {
      characterReferences: [A],
      referenceVideoUrls: ["https://x/black-with-voice.mp4"],
      videoTrimStart: 2,
      videoTrimEnd: 9,
    })
    const input = sentInput()
    expect(input.video_list).toEqual([{ url: "https://x/black-with-voice.mp4", start: 2, ends: 9 }])
    expect(input.character_ids).toEqual(["char-1"])
    expect("duration" in input).toBe(sendsDuration)
    // Mutually exclusive with character_ids / video_list upstream — must never leak in.
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input).not.toHaveProperty("audio_ids")
    expect(input).not.toHaveProperty("image_urls")
  })

  it("sends each distinct id once when two references resolve to the same character", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["same", "other", "same"], fromCache: [false, false, false], audioIds: [] })
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A, B, A] })
    expect(sentInput().character_ids).toEqual(["same", "other"])
  })

  it("reports the identity inputs on the egress dimensions (characterRefs), distinct from TTS `characters`", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A, B] })
    const reconcile = mocks.mockRunKieTask.mock.calls[0]![4] as { dimensions?: Record<string, unknown> }
    expect(reconcile.dimensions?.characterRefs).toBe(2)
    expect(reconcile.dimensions).not.toHaveProperty("characters")
  })

  it("rejects quota overflow (characters count) instead of truncating", async () => {
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", {
        characterReferences: [A, B],
        referenceVideoUrls: ["https://x/v.mp4"],
        referenceImageUrls: ["https://x/r1.png", "https://x/r2.png", "https://x/r3.png"], // 3+2+3 = 8
      }),
    ).rejects.toThrow()
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(mocks.mockResolve).not.toHaveBeenCalled() // no paid create for a request we already know is over budget
  })

  it("other models never read the option (inert there — the ROUTE is the gate that 400s it)", async () => {
    await provider.textToVideo("a prompt", "seedance-2", 8, "16:9", { characterReferences: [A] })
    expect(mocks.mockResolve).not.toHaveBeenCalled()
  })

  it("rejects an end frame combined with characters (it would be dropped silently otherwise)", async () => {
    await expect(
      provider.imageToVideo(undefined as unknown as string, "a prompt", "gemini-omni-video", 8, "https://x/end.png", {
        characterReferences: [A],
      }),
    ).rejects.toThrow(/start or end frame/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(mocks.mockResolve).not.toHaveBeenCalled()
  })

  it("rejects a start frame combined with characters (backstop for non-route callers)", async () => {
    await expect(
      provider.imageToVideo("https://x/start.png", "a prompt", "gemini-omni-video", 8, undefined, {
        characterReferences: [A],
      }),
    ).rejects.toThrow(/start or end frame/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(mocks.mockResolve).not.toHaveBeenCalled()
  })
})

describe("gemini-omni — character failures", () => {
  it("a create failure fails the job: no task is submitted and nothing falls back to image_urls", async () => {
    mocks.mockResolve.mockRejectedValueOnce(new Error("[Character creation] failed"))
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", {
        characterReferences: [A],
        referenceImageUrls: ["https://x/r1.png"],
      }),
    ).rejects.toThrow(/Character creation/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("a CACHED id KIE rejects as invalid is recreated ONCE (forced) and the task resubmitted", async () => {
    mocks.mockResolve
      .mockResolvedValueOnce({ ids: ["stale"], fromCache: [true], audioIds: [] })
      .mockResolvedValueOnce({ ids: ["fresh"], fromCache: [false], audioIds: [] })
    mocks.mockRunKieTask.mockRejectedValueOnce(staleErr()).mockResolvedValueOnce(okRun)

    const res = await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A] })

    expect(res.url).toBe("https://x/out.mp4")
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
    expect(sentInput(0).character_ids).toEqual(["stale"])
    expect(sentInput(1).character_ids).toEqual(["fresh"])
    expect(mocks.mockForget).toHaveBeenCalledWith([A])
  })

  it("a mixed set recreates ONLY the cache-served reference — the freshly minted one is not re-created", async () => {
    // A came from the cache (stale), B was minted fresh in this very run.
    mocks.mockResolve
      .mockResolvedValueOnce({ ids: ["stale-A", "fresh-B"], fromCache: [true, false], audioIds: [] })
      .mockResolvedValueOnce({ ids: ["new-A", "fresh-B"], fromCache: [false, true], audioIds: [] }) // B now served from the cache it was just written to
    mocks.mockRunKieTask.mockRejectedValueOnce(staleErr()).mockResolvedValueOnce(okRun)

    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A, B] })

    expect(mocks.mockForget).toHaveBeenCalledWith([A]) // not [A, B]
    expect(sentInput(1).character_ids).toEqual(["new-A", "fresh-B"])
  })

  it("retries only once: a second invalid-id rejection fails the job", async () => {
    mocks.mockResolve
      .mockResolvedValueOnce({ ids: ["stale"], fromCache: [true], audioIds: [] })
      .mockResolvedValueOnce({ ids: ["fresh"], fromCache: [false], audioIds: [] })
    mocks.mockRunKieTask.mockRejectedValue(staleErr())
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A] }),
    ).rejects.toBeDefined()
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
  })

  it("a FRESH id that KIE rejects is not retried (nothing to refresh)", async () => {
    mocks.mockRunKieTask.mockRejectedValue(staleErr())
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A] }),
    ).rejects.toBeDefined()
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
    expect(mocks.mockResolve).toHaveBeenCalledTimes(1)
  })

  it("an unrelated KIE failure on cached ids is not retried", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["c"], fromCache: [true], audioIds: [] })
    mocks.mockRunKieTask.mockRejectedValue(Object.assign(new Error("x"), { internalDetails: "Aspect ratio only supports [16:9, 9:16]" }))
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A] }),
    ).rejects.toBeDefined()
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
  })
})

describe("gemini-omni — voice personas → audio_ids", () => {
  const V = { ...A, voice: { preset: "kore" as const, description: "warm", exampleLine: "Hello" } }
  const W = { ...B, name: "Bo", voice: { preset: "puck" as const } }

  it("sends the resolved audio persona ids as the task's audio_ids, beside character_ids", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["char-1", "char-2"], fromCache: [false, false], audioIds: ["aud-1", "aud-2"] })
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V, W] })
    expect(mocks.mockResolve.mock.calls[0]![0]).toEqual([V, W]) // the voice reaches the resolver
    expect(sentInput().character_ids).toEqual(["char-1", "char-2"])
    expect(sentInput().audio_ids).toEqual(["aud-1", "aud-2"])
  })

  it("de-duplicates the ids (two characters on one voice send it once)", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["c1", "c2"], fromCache: [false, false], audioIds: ["aud-1", "aud-1"] })
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V, { ...V, imageUrl: "https://cdn.example/x.png" }] })
    expect(sentInput().audio_ids).toEqual(["aud-1"])
  })

  it("without a voice there is NO audio_ids key (byte-identical to before)", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [A, B] })
    expect(sentInput()).not.toHaveProperty("audio_ids")
  })

  it("more than 3 distinct voice ids fails honestly: no task is submitted", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["c1"], fromCache: [false], audioIds: ["a1", "a2", "a3", "a4"] })
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V] }),
    ).rejects.toThrow(/at most 3/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("rejects 4 distinct voices BEFORE any paid create (the shared rule runs first)", async () => {
    const four = ["kore", "puck", "leda", "orus"].map((preset, i) => ({ ...A, imageUrl: `https://cdn.example/${i}.png`, voice: { preset } }))
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: four as never }),
    ).rejects.toThrow()
    expect(mocks.mockResolve).not.toHaveBeenCalled()
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("audio ids do not eat the 7-unit input quota", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["c1", "c2"], fromCache: [false, false], audioIds: ["aud-1", "aud-2"] })
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", {
      characterReferences: [V, W], // 1 + 2 = 3
      referenceVideoUrls: ["https://x/v.mp4"], // 2
      referenceImageUrls: ["https://x/r1.png", "https://x/r2.png"], // 2 → 7: still fine with two audio ids
    })
    expect(sentInput().audio_ids).toEqual(["aud-1", "aud-2"])
  })

  it("a rejected CACHED audio id is recreated once (character AND voice forgotten) and the task resubmitted", async () => {
    mocks.mockResolve
      .mockResolvedValueOnce({ ids: ["c1"], fromCache: [true], audioIds: ["stale-aud"] })
      .mockResolvedValueOnce({ ids: ["c2"], fromCache: [false], audioIds: ["fresh-aud"] })
    mocks.mockRunKieTask
      .mockRejectedValueOnce(Object.assign(new Error("sanitized"), { internalDetails: "createTask error (code 422): audio_ids contains an invalid audio id" }))
      .mockResolvedValueOnce(okRun)
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V] })
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
    expect(sentInput(0).audio_ids).toEqual(["stale-aud"])
    expect(sentInput(1).audio_ids).toEqual(["fresh-aud"])
    expect(sentInput(1).character_ids).toEqual(["c2"])
    expect(mocks.mockForget).toHaveBeenCalledWith([V])
  })

  it("a fresh audio id that KIE rejects is not retried", async () => {
    mocks.mockResolve.mockResolvedValueOnce({ ids: ["c1"], fromCache: [false], audioIds: ["aud"] })
    mocks.mockRunKieTask.mockRejectedValue(Object.assign(new Error("x"), { internalDetails: "audio_ids invalid audio id" }))
    await expect(provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V] })).rejects.toBeDefined()
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
  })

  it("a voice-create failure fails the job: no task, no silent unvoiced fallback", async () => {
    mocks.mockResolve.mockRejectedValueOnce(new Error("[Voice creation] failed"))
    await expect(
      provider.textToVideo("a prompt", "gemini-omni-video", 8, "16:9", { characterReferences: [V] }),
    ).rejects.toThrow(/Voice creation/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })
})
