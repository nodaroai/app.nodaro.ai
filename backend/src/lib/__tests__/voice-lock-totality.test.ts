// @test-watches backend/src/**/*.ts
/**
 * Voice-lock totality (B4c). A deployment's voice lock (`voice.allowedGenders`)
 * is only as wide as the places that ask it. This guard pins three things:
 *
 *   (a) the SEAMS that judge a voice through the lock's resolver
 *       (lib/voice-gender.ts) — the speech routes, the workflow engine
 *       (pre-resolution + the builder's backstop), the plugin toolkit;
 *   (b) EXHAUSTIVENESS: every file that sends a voice to a speech provider
 *       (text-to-speech, dialogue, speech-to-speech) is classified below,
 *       either as judged upstream or as a lane the lock does not reach yet,
 *       with the reason — so a new lane cannot ship unclassified;
 *   (c) the Voice Library is LISTED in exactly one place, and that place
 *       records what it served: the library has no lookup by voice id, so the
 *       lock can place a library voice only through that record.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8")

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/** Comments blanked with byte offsets kept, so a comment naming a call is not a call. */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

const files = tsFiles(SRC).map((abs) => ({ rel: relative(SRC, abs).split("\\").join("/"), src: blankComments(readFileSync(abs, "utf8")) }))

/** The speech provider functions: each sends a voice to the provider. */
const SPEECH_CALL = /\b(directElevenLabsTTS|directElevenLabsTTSWithTimestamps|directElevenLabsDialogue|directVoiceChanger|voiceChangerFromUrl)\s*\(/

/** Every file that reaches a speech provider, and why the lock does or does not judge its voices. */
const SPEECH_LANES: Readonly<Record<string, string>> = {
  "providers/elevenlabs/direct-tts.ts": "the provider funnel itself (definitions); its callers are classified here",
  "providers/elevenlabs/direct-dialogue.ts": "the provider funnel itself (definitions)",
  "providers/elevenlabs/voice-changer.ts": "the provider funnel itself (definitions)",
  "workers/handlers/audio-ai.ts":
    "the speech worker. Its text-to-speech and text-to-dialogue jobs are judged where they are created " +
    "(the two routes and the workflow engine, pinned in (a)); NOT yet judged: its voice-changer jobs " +
    "(the core Voice Changer node's target voice) and speech jobs a film-studio pipeline enqueues without the route",
  "workers/handlers/video-ai.ts": "voiced-video / speech-to-video: NOT yet judged (character voices revoiced or spoken inside a video job)",
  "lib/private-plugins/toolkit.ts":
    "plugin lanes (tk.providers): judged when the plugin calls tk.voices.assertAllowed for every voice it sends — " +
    "adoption is the plugin package's own totality test to enforce",
  "lib/private-plugins/types.ts": "the plugin contract's declaration of those tk.providers speech members (a signature, not a call)",
}

describe("the voice lock — every speech lane is classified, the seams judge, the library is listed once", () => {
  it("(a) the speech routes judge every voice through the resolver", () => {
    expect(read("routes/text-to-speech.ts")).toMatch(/await judgeVoice\(parsed\.data\.voice, \{ userId \}\)/)
    expect(read("routes/text-to-dialogue.ts")).toMatch(/await judgeVoices\(dialogue\.map\(\(line\) => line\.voice\), \{ userId \}\)/)
  })

  it("(a) the workflow engine resolves ahead of the build, and both speech cases judge what they send", () => {
    expect(read("services/workflow-engine/node-executor.ts")).toMatch(/resolveVoiceGenders\(voicesTheBuildDispatches\(node, resolvedInputs, edges\), \{ userId: ctx\.userId \}\)/)
    const pb = read("services/workflow-engine/payload-builder.ts")
    for (const type of ["text-to-speech", "text-to-dialogue"]) {
      const start = pb.indexOf(`case "${type}": {`)
      expect(start, `payload-builder has no ${type} case`).toBeGreaterThan(0)
      const next = pb.indexOf("\n    case \"", start + 1)
      expect(pb.slice(start, next), `the ${type} case no longer runs the voice lock's backstop`).toContain("refuseVoicesTheLockRefuses(")
    }
  })

  it("(a) the plugin toolkit's voice member asks the same resolver", () => {
    expect(read("lib/private-plugins/toolkit.ts")).toMatch(/assertAllowed: async \(voiceId, opts\) => \{\s*const verdict = await judgeVoice\(voiceId, \{ userId: opts\.userId \}\)/)
  })

  it("(b) every file that sends a voice to a speech provider is classified", () => {
    const reaching = files.filter((f) => SPEECH_CALL.test(f.src)).map((f) => f.rel).sort()
    expect(reaching.length, "found no speech provider call — the scan is wired to nothing").toBeGreaterThan(3)
    const unclassified = reaching.filter((f) => !(f in SPEECH_LANES))
    expect(
      unclassified,
      `These files send a voice to a speech provider but are not classified in SPEECH_LANES: judge the voice ` +
        `through lib/voice-gender.ts where the job is created (and say where), or record why the lock does not ` +
        `reach it yet.`,
    ).toEqual([])
    const stale = Object.keys(SPEECH_LANES).filter((f) => !reaching.includes(f))
    expect(stale, "SPEECH_LANES lists files that no longer reach a speech provider — remove them").toEqual([])
  })

  it("(c) the Voice Library is listed in one place, and it records what it served", () => {
    const listing = files.filter((f) => f.src.includes("/v1/shared-voices")).map((f) => f.rel)
    expect(listing, "a second place lists the Voice Library without recording what it served").toEqual(["routes/voices.ts"])
    expect(read("routes/voices.ts")).toContain("recordLibraryVoiceGenders(voices)")
  })
})
