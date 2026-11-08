// @test-watches backend/src/**/*.ts
/**
 * Voice-lock totality (B4c). A deployment's voice lock (`voice.allowedGenders`)
 * is only as wide as the places that ask it. This guard pins five things:
 *
 *   (a) the SEAMS that judge a voice through the lock's resolver
 *       (lib/voice-gender.ts) — the workflow engine (pre-resolution + the
 *       builder's backstop) and the plugin toolkit;
 *   (b) the PROVIDER census: every file that sends a voice to a speech provider
 *       (text-to-speech, dialogue, speech-to-speech, dubbing) is classified
 *       below — a funnel, a worker, or a plugin lane — with the reason, so a new
 *       lane cannot ship unclassified;
 *   (c) the WORKER backstop: in every worker file of (b), each registered
 *       handler that reaches a speech provider (directly or through a helper in
 *       its file) judges its job's voices (lib/voice-lock.ts) before its first
 *       call that reaches the provider, and no speech call sits outside a
 *       handler — so a queued job fails closed even when its creator forgot;
 *   (d) the JOB census: every place that creates a speech job (text-to-speech,
 *       text-to-dialogue, voice-changer, voiced-video, dubbing) judges its voices
 *       before the job row, and is classified below with how;
 *   (e) the Voice Library is LISTED in exactly one place, and that place
 *       records what it served: the library has no lookup by voice id, so the
 *       lock can place a library voice only through that record.
 *
 * Not in either census, by design: lanes that play a PROVIDED audio track and
 * select no voice (speech-to-video, lip-sync) — there is no voice id to judge,
 * and speech the platform generated was judged where it was made.
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
const srcOf = (rel: string) => files.find((f) => f.rel === rel)?.src ?? ""

/** The speech provider functions: each sends a voice (or a dub) to the provider. */
const SPEECH_CALL = /\b(directElevenLabsTTS|directElevenLabsTTSWithTimestamps|directElevenLabsDialogue|directVoiceChanger|voiceChangerFromUrl|startDubbing)\s*\(/
const SPEECH_CALL_G = new RegExp(SPEECH_CALL.source, "g")

/** The worker backstop: the job's voices judged (or, for a dub, refused) under a lock. */
const BACKSTOP_CALL = /\bassert(?:Unnamed)?VoicesAllowed\s*\(/

interface SpeechLane {
  readonly kind: "funnel" | "worker" | "plugin"
  readonly why: string
}

/** Every file that reaches a speech provider, and why the lock does or does not judge its voices. */
const SPEECH_LANES: Readonly<Record<string, SpeechLane>> = {
  "providers/elevenlabs/direct-tts.ts": {
    kind: "funnel",
    why: "the provider funnel itself (definitions); an unnamed voice becomes the policy's default voice here (resolveDirectVoiceId), the one every funnel resolves through",
  },
  "providers/elevenlabs/direct-dialogue.ts": { kind: "funnel", why: "the provider funnel itself (definitions)" },
  "providers/elevenlabs/voice-changer.ts": { kind: "funnel", why: "the provider funnel itself (definitions)" },
  "providers/elevenlabs/dubbing.ts": { kind: "funnel", why: "the dubbing service's funnel itself (definitions); a dub names no voice" },
  "workers/handlers/audio-ai.ts": {
    kind: "worker",
    why: "the speech worker: its text-to-speech, text-to-dialogue, voice-changer and dubbing jobs are judged where they are created (d) and again by each handler's backstop (c)",
  },
  "workers/handlers/video-ai.ts": {
    kind: "worker",
    why: "voiced-video: the cast's voices, judged at /v1/generate-video (d) and again by the handler's backstop (c). Its other handlers select no voice (speech-to-video and lip-sync play a provided audio track)",
  },
  "lib/private-plugins/toolkit.ts": {
    kind: "plugin",
    why: "plugin lanes (tk.providers): judged when the plugin calls tk.voices.assertAllowed for every voice it sends — " +
      "adoption is the plugin package's own totality test to enforce. A plugin job that runs on a core job name is judged by that handler's backstop (c)",
  },
  "lib/private-plugins/types.ts": { kind: "plugin", why: "the plugin contract's declaration of those tk.providers speech members (a signature, not a call)" },
}

/** The job types that send a voice to a speech provider when a worker runs them. */
const SPEECH_JOB_TYPES = ["text-to-speech", "text-to-dialogue", "voice-changer", "voiced-video", "dubbing"] as const
const SPEECH_JOB_LITERAL = new RegExp(`"(${SPEECH_JOB_TYPES.join("|")})"`)

/**
 * Every file that creates a speech job, and the judgment it makes before the
 * job row (`judges`, which must come before `row`, the first write of the row).
 * The workflow builder is per case, below: the engine writes a placeholder row
 * before the build and deletes it when the build refuses.
 */
const JOB_CREATORS: Readonly<Record<string, { readonly judges: RegExp; readonly row?: RegExp }>> = {
  "routes/text-to-speech.ts": { judges: /await judgeVoice\(parsed\.data\.voice, \{ userId \}\)/, row: /insertJob\(/ },
  "routes/text-to-dialogue.ts": { judges: /await judgeVoices\(dialogue\.map\(\(line\) => line\.voice\), \{ userId \}\)/, row: /insertJob\(/ },
  "routes/voice-changer.ts": { judges: /await judgeVoice\(voiceId, \{ userId \}\)/, row: /insertJob\(/ },
  "routes/generate-video.ts": {
    judges: /if \(dispatchesVoicedVideo\(parsed\.data\)\) \{\s*const voiceVerdict = await judgeVoicesUnderLock\(\s*voicesTheVoicedVideoSends\(\{ prompt, dialogue, characterVoices, dialogueProvider: voicedDialogueProvider\(characterVoices\) \}, provider\),\s*\{ userId \},?\s*\)/,
    row: /insertJobIdempotent</,
  },
  // A preHandler, the route's first: it runs before the handler that writes the row.
  "routes/dubbing.ts": { judges: /preHandler: \[\s*refuseDubbingUnderVoiceLock,/ },
  "ee/pipelines/services/pipeline-generate-speech.ts": { judges: /await assertVoicesAllowed\(\[voice\], \{ userId \}\)/, row: /runPipelineWorkerJob\(/ },
  "ee/pipelines/services/pipeline-generate-narration.ts": { judges: /await assertVoicesAllowed\(\[voiceId\], \{ userId \}\)/, row: /runPipelineWorkerJob\(/ },
  "ee/pipelines/services/pipeline-voice-change.ts": { judges: /await assertVoicesAllowed\(\[voiceId\], \{ userId \}\)/, row: /runPipelineWorkerJob\(/ },
  "services/workflow-engine/payload-builder.ts": { judges: /refuseVoicesTheLockRefuses\(/ },
}

/** The workflow builder's speech cases, and the backstop each must run. */
const BUILDER_CASES: Readonly<Record<string, RegExp>> = {
  "text-to-speech": /refuseVoicesTheLockRefuses\(/,
  "text-to-dialogue": /refuseVoicesTheLockRefuses\(/,
  "voice-changer": /refuseVoicesTheLockRefuses\(/,
  dubbing: /refuseUnnamedVoicesTheLockRefuses\(/,
}

/** A place in a file that creates a job of a speech type: an enqueue, or a builder's dispatch. */
function createsSpeechJob(src: string): boolean {
  for (const m of src.matchAll(/\.add\(\s*([^,()]*?),/g)) if (SPEECH_JOB_LITERAL.test(m[1]!)) return true
  return new RegExp(`(?:jobName:\\s*|simpleResult\\(\\s*)"(?:${SPEECH_JOB_TYPES.join("|")})"`).test(src)
}

/** A file's top-level functions (declarations and `const x = function`/arrow), each with its body. */
function topLevelBlocks(src: string): Array<{ name: string; start: number; body: string }> {
  const starts: Array<{ name: string; start: number }> = []
  const decl = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\b/gm
  for (const m of src.matchAll(decl)) starts.push({ name: (m[1] ?? m[2])!, start: m.index! })
  return starts.map((s, i) => ({ ...s, body: src.slice(s.start, starts[i + 1]?.start ?? src.length) }))
}

/** The handlers a worker file registers: `export const xHandlers: Record<string, HandlerFn> = { "job": handleX, … }`. */
function registeredHandlers(src: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const map of src.matchAll(/export const \w+: Record<string, HandlerFn> = \{([\s\S]*?)\n\}/g)) {
    for (const entry of map[1]!.matchAll(/"([\w-]+)":\s*(\w+)/g)) out.set(entry[1]!, entry[2]!)
  }
  return out
}

describe("the voice lock — every speech lane is classified, every seam judges, the library is listed once", () => {
  it("(a) the workflow engine resolves ahead of the build, and every speech case judges what it sends", () => {
    expect(read("services/workflow-engine/node-executor.ts")).toMatch(/resolveVoiceGenders\(voicesTheBuildDispatches\(node, resolvedInputs, edges\), \{ userId: ctx\.userId \}\)/)
    const dispatched = read("services/workflow-engine/dispatched-voices.ts")
    for (const type of ["text-to-speech", "text-to-dialogue", "voice-changer"]) {
      expect(dispatched, `the engine's pre-resolution does not read the voices a ${type} node sends`).toContain(`if (type === "${type}") return voicesToJudge(`)
    }
    const pb = srcOf("services/workflow-engine/payload-builder.ts")
    for (const [type, backstop] of Object.entries(BUILDER_CASES)) {
      const start = pb.indexOf(`case "${type}": {`)
      expect(start, `payload-builder has no ${type} case with a block`).toBeGreaterThan(0)
      const next = pb.indexOf("\n    case \"", start + 1)
      expect(pb.slice(start, next), `the ${type} case no longer runs the voice lock's backstop`).toMatch(backstop)
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

  it("(c) every worker handler that reaches a speech provider judges its job's voices before it reaches it", () => {
    const workers = Object.entries(SPEECH_LANES).filter(([, lane]) => lane.kind === "worker").map(([rel]) => rel)
    const guarded: string[] = []
    for (const rel of workers) {
      const src = srcOf(rel)
      const blocks = topLevelBlocks(src)
      const names = new Set(blocks.map((b) => b.name))
      const calls = (body: string) => [...body.matchAll(/\b(\w+)\s*\(/g)].map((m) => m[1]!).filter((n) => names.has(n))
      // Which top-level functions reach a speech provider, directly or through another one in this file.
      const reaches = new Set(blocks.filter((b) => SPEECH_CALL.test(b.body)).map((b) => b.name))
      for (let grew = true; grew;) {
        grew = false
        for (const b of blocks) {
          if (!reaches.has(b.name) && calls(b.body).some((n) => n !== b.name && reaches.has(n))) {
            reaches.add(b.name)
            grew = true
          }
        }
      }
      const handlers = registeredHandlers(src)
      expect(handlers.size, `${rel}: found no registered handlers — the scan is wired to nothing`).toBeGreaterThan(3)
      const handlerFns = new Set(handlers.values())
      const reachedFromHandlers = new Set<string>()
      for (const [job, fn] of handlers) {
        if (!reaches.has(fn)) continue
        const body = blocks.find((b) => b.name === fn)!.body
        const firstSpeech = Math.min(
          ...[...body.matchAll(SPEECH_CALL_G)].map((m) => m.index!),
          ...[...body.matchAll(/\b(\w+)\s*\(/g)].filter((m) => m[1] !== fn && reaches.has(m[1]!)).map((m) => m.index!),
        )
        const backstop = body.search(BACKSTOP_CALL)
        expect(backstop, `${rel}: the "${job}" handler (${fn}) reaches a speech provider without the voice lock's backstop (lib/voice-lock.ts)`).toBeGreaterThan(0)
        expect(backstop, `${rel}: the "${job}" handler (${fn}) judges its voices only after it has reached the speech provider`).toBeLessThan(firstSpeech)
        guarded.push(job)
        // Everything this handler reaches is behind its backstop.
        const stack = [fn]
        while (stack.length) {
          const n = stack.pop()!
          if (reachedFromHandlers.has(n)) continue
          reachedFromHandlers.add(n)
          stack.push(...calls(blocks.find((b) => b.name === n)!.body))
        }
      }
      const outside = [...reaches].filter((n) => !handlerFns.has(n) && !reachedFromHandlers.has(n))
      expect(outside, `${rel}: functions that reach a speech provider outside every registered handler (so behind no backstop)`).toEqual([])
    }
    expect(guarded.sort()).toEqual([...SPEECH_JOB_TYPES].sort())
  })

  it("(d) every place that creates a speech job judges its voices first, and is classified", () => {
    const creators = files.filter((f) => createsSpeechJob(f.src)).map((f) => f.rel).sort()
    expect(creators.length, "found no speech job creator — the scan is wired to nothing").toBeGreaterThan(5)
    const unclassified = creators.filter((f) => !(f in JOB_CREATORS))
    expect(
      unclassified,
      `These files create a speech job but are not classified in JOB_CREATORS: judge its voices through ` +
        `lib/voice-gender.ts (a route) or lib/voice-lock.ts (no reply to send) before the job row, and say how.`,
    ).toEqual([])
    const stale = Object.keys(JOB_CREATORS).filter((f) => !creators.includes(f))
    expect(stale, "JOB_CREATORS lists files that no longer create a speech job — remove them").toEqual([])
    for (const [rel, { judges, row }] of Object.entries(JOB_CREATORS)) {
      const src = srcOf(rel)
      const at = src.search(judges)
      expect(at, `${rel} no longer judges its voices the way JOB_CREATORS says`).toBeGreaterThan(0)
      if (row) {
        const rowAt = src.search(row)
        expect(rowAt, `${rel}: the job row JOB_CREATORS names is not there`).toBeGreaterThan(0)
        expect(at, `${rel} judges its voices only after it writes the job row`).toBeLessThan(rowAt)
      }
    }
  })

  it("(e) the Voice Library is listed in one place, and it records what it served", () => {
    const listing = files.filter((f) => f.src.includes("/v1/shared-voices")).map((f) => f.rel)
    expect(listing, "a second place lists the Voice Library without recording what it served").toEqual(["routes/voices.ts"])
    expect(read("routes/voices.ts")).toContain("recordLibraryVoiceGenders(voices)")
  })
})
