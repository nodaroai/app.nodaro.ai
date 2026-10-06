/**
 * Totality: every exit that puts Text to Speech voice settings on a wire normalises them.
 *
 * The text-to-speech worker (workers/handlers/audio-ai.ts) hands an exit the job's stability / similarityBoost /
 * style / speed exactly as its enqueuer wrote them, and only one enqueuer validates them: the REST route's Zod.
 * A workflow or published-app run copies node data (payload-builder), which an app's inputOverrides, an MCP
 * `run_app` or SDK flat input (typed `text`) or an imported workflow may have written as a string or out of range;
 * the pipelines pass their arguments through. So the exits are the one place every lane passes, and each runs the
 * four values through `normalizeTtsVoiceSettings` (providers/elevenlabs/voice-settings.ts): a numeric string
 * becomes its number, an out-of-range number is clamped, anything else is absent.
 *
 * The guard finds the exits itself (any TextToSpeechProvider implementation, any direct call to ElevenLabs'
 * text-to-speech endpoint), so a new one fails here until it is listed below, and every listed one is driven
 * with the same inputs to prove what reaches its wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
  runKieTask: vi.fn(),
}))

// The relay reaches the cloud only through nodaroCloudFetch.
vi.mock("@/lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: mocks.cloudFetch,
  isNodaroConnected: vi.fn(async () => true),
}))
// KIE's proxy runs through runKieTask.
vi.mock("@/providers/kie/client.js", () => ({
  runKieTask: mocks.runKieTask,
  createSanitizedError: (msg: string) => new Error(msg),
  MAX_POLL_ATTEMPTS_VIDEO: 90,
}))

import { config } from "../../lib/config.js"
import { directElevenLabsTTS } from "../elevenlabs/direct-tts.js"
import { NodaroCloudAudioProvider } from "../nodaro/audio.js"
import { KieAudioProvider } from "../kie/audio.js"

const SRC = path.resolve(__dirname, "../..")

/** Every exit, by file (relative to backend/src), with what it reaches. */
const EXITS: Readonly<Record<string, string>> = {
  "providers/elevenlabs/direct-tts.ts": "directElevenLabsTTS: ElevenLabs itself, on every install with a key",
  "providers/nodaro/audio.ts": "NodaroCloudAudioProvider: a keyless self-host relaying to the cloud's REST route",
  "providers/kie/audio.ts": "KieAudioProvider: KIE's ElevenLabs proxy (no live caller; kept for the router)",
}

const EXIT_SHAPES: readonly RegExp[] = [
  /\bimplements\s[^{]*\bTextToSpeechProvider\b/, // a text-to-speech provider
  /\/v1\/text-to-speech\/\$\{/, // a direct call to ElevenLabs' text-to-speech endpoint (voice id in the path)
]

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : sourceFiles(full)
    return /\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name) ? [full] : []
  })
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8")

describe("every Text to Speech exit is known and normalises the voice settings", () => {
  const discovered = sourceFiles(SRC)
    .filter((file) => EXIT_SHAPES.some((re) => re.test(fs.readFileSync(file, "utf8"))))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort()

  it("floor: the scan still finds the exits (a moved tree must not pass for free)", () => {
    expect(discovered.length).toBeGreaterThanOrEqual(3)
  })

  it("the scan finds exactly the listed exits — list a new one here and drive it below", () => {
    expect(discovered).toEqual(Object.keys(EXITS).sort())
  })

  it.each(Object.keys(EXITS))("%s runs the settings through normalizeTtsVoiceSettings", (rel) => {
    expect(read(rel)).toMatch(/\bnormalizeTtsVoiceSettings\(/)
  })
})

// ---------------------------------------------------------------------------
// What reaches each wire, from the same inputs
// ---------------------------------------------------------------------------

type Levers = { stability?: unknown; similarityBoost?: unknown; style?: unknown; speed?: unknown; previousText?: unknown; nextText?: unknown }

/** A string with spaces, a number far out of range, an empty string, a word. */
const MIXED: Levers = { stability: " 0.4 ", similarityBoost: 7, style: "", speed: "fast" }
/** Every lever outside its range, one of them spelled as a string. */
const OUT_OF_RANGE: Levers = { stability: -1, similarityBoost: "1.5", style: 2, speed: 0.1 }
/** Nothing usable at all. */
const UNUSABLE: Levers = { stability: "", similarityBoost: null, style: {}, speed: NaN }

let voiceCounter = 0
/** A fresh voice per call: the stored-settings lookup is cached per voice. */
const freshVoice = () => `ExitsTestVoice${String(++voiceCounter).padStart(6, "0")}`

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

/** directElevenLabsTTS on turbo (every lever honoured), the voice's stored settings unavailable. */
async function directWire(levers: Levers): Promise<Record<string, unknown> | undefined> {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/settings")) return new Response("unavailable", { status: 500 })
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new ArrayBuffer(4), { status: 200 })
    }),
  )
  await directElevenLabsTTS("hello", freshVoice(), "elevenlabs-turbo", levers as never)
  expect(bodies).toHaveLength(1)
  return bodies[0]!.voice_settings as Record<string, unknown> | undefined
}

/** directElevenLabsTTS on v4 (a model that stitches): the WHOLE body, so the neighbour-text keys can be read. */
async function directWireV4(levers: Levers): Promise<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/settings")) return new Response("unavailable", { status: 500 })
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new ArrayBuffer(4), { status: 200 })
    }),
  )
  await directElevenLabsTTS("hello", freshVoice(), "elevenlabs-v4", levers as never)
  expect(bodies).toHaveLength(1)
  return bodies[0]!
}

/** The relay's POST body to the cloud's /v1/text-to-speech. */
async function relayWire(levers: Levers): Promise<Record<string, unknown>> {
  mocks.cloudFetch
    .mockResolvedValueOnce(jsonResponse(200, { jobId: "cloud-tts-1" }))
    .mockResolvedValueOnce(
      jsonResponse(200, { data: { id: "cloud-tts-1", status: "completed", progress: 100, output_data: { audioUrl: "https://c/a.mp3" } } }),
    )
  await new NodaroCloudAudioProvider().textToSpeech("hello", "Rachel", "elevenlabs-turbo", levers as never)
  const [postPath, init] = mocks.cloudFetch.mock.calls[0]!
  expect(postPath).toBe("/v1/text-to-speech")
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

/** KIE's task input. */
async function kieWire(levers: Levers): Promise<Record<string, unknown>> {
  mocks.runKieTask.mockResolvedValueOnce({ resultJson: { resultUrls: ["https://kie/a.mp3"] } })
  await new KieAudioProvider().textToSpeech("hello", "Rachel", "elevenlabs-turbo", levers as never)
  return mocks.runKieTask.mock.calls[0]![1] as Record<string, unknown>
}

describe("what each exit puts on its wire", () => {
  const originalKey = config.ELEVENLABS_API_KEY
  beforeEach(() => {
    config.ELEVENLABS_API_KEY = "test-key"
    mocks.cloudFetch.mockReset()
    mocks.runKieTask.mockReset()
  })
  afterEach(() => {
    config.ELEVENLABS_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  describe("directElevenLabsTTS", () => {
    it("a numeric string becomes its number, an out-of-range number is clamped, an unusable lever falls back", async () => {
      // style and speed were unusable: the API default style, and no speed at all (none stored).
      expect(await directWire(MIXED)).toEqual({ stability: 0.4, similarity_boost: 1, style: 0, use_speaker_boost: true })
    })

    it("every lever out of range is clamped into it", async () => {
      expect(await directWire(OUT_OF_RANGE)).toEqual({ stability: 0, similarity_boost: 1, style: 1, use_speaker_boost: true, speed: 0.7 })
    })

    it("nothing usable sends no voice_settings: the voice's own stored settings apply", async () => {
      expect(await directWire(UNUSABLE)).toBeUndefined()
    })
  })

  describe("NodaroCloudAudioProvider (the self-host relay)", () => {
    it("sends normalised numbers, and leaves an unusable lever out", async () => {
      const body = await relayWire(MIXED)
      expect(body).toMatchObject({ stability: 0.4, similarityBoost: 1 })
      expect(body).not.toHaveProperty("style")
      expect(body).not.toHaveProperty("speed")
    })

    it("clamps every lever, so the cloud's route never rejects what a keyed install would accept", async () => {
      expect(await relayWire(OUT_OF_RANGE)).toMatchObject({ stability: 0, similarityBoost: 1, style: 1, speed: 0.7 })
    })

    it("nothing usable sends no lever", async () => {
      const body = await relayWire(UNUSABLE)
      for (const key of ["stability", "similarityBoost", "style", "speed"]) expect(body, key).not.toHaveProperty(key)
    })
  })

  describe("KieAudioProvider", () => {
    it("sends normalised numbers, and leaves an unusable lever out", async () => {
      const input = await kieWire(MIXED)
      expect(input).toMatchObject({ stability: 0.4, similarity_boost: 1 })
      expect(input).not.toHaveProperty("style")
      expect(input).not.toHaveProperty("speed")
    })

    it("clamps every lever", async () => {
      expect(await kieWire(OUT_OF_RANGE)).toMatchObject({ stability: 0, similarity_boost: 1, style: 1, speed: 0.7 })
    })

    it("nothing usable sends no lever", async () => {
      const input = await kieWire(UNUSABLE)
      for (const key of ["stability", "similarity_boost", "style", "speed"]) expect(input, key).not.toHaveProperty(key)
    })
  })

  describe("neighbour text", () => {
    const LONG = "p".repeat(2_500)

    it("directElevenLabsTTS (v4): a usable pair is sent, trimmed to the cap; garbage is absent", async () => {
      const body = await directWireV4({ previousText: ` ${LONG} `, nextText: ["x"] })
      expect(body.previous_text).toBe("p".repeat(1000))
      expect(body.next_text).toBeUndefined()
    })

    it("the relay sends the pair to the cloud route under the node's spelling, trimmed to the cap so the cloud's Zod never 400s", async () => {
      const body = await relayWire({ previousText: LONG, nextText: " After. " })
      expect(body.previousText).toBe("p".repeat(1000))
      expect(body.nextText).toBe("After.")
    })

    it("the relay sends no neighbour key when none is usable", async () => {
      const body = await relayWire({ previousText: "", nextText: 7 })
      expect(body).not.toHaveProperty("previousText")
      expect(body).not.toHaveProperty("nextText")
    })

    it("KIE's proxy (no live caller) does not carry them — the exit is listed, the pair is not part of its wire", async () => {
      const input = await kieWire({ previousText: "Before." })
      expect(input).not.toHaveProperty("previousText")
      expect(input).not.toHaveProperty("previous_text")
    })
  })
})
