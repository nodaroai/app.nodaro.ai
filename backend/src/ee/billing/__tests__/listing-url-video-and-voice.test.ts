/**
 * Two follow-ups to the length rule of every video producer (decided
 * 2026-10-07):
 *
 *  1. A Video URL (YouTube or any link) the user replaces is the EPISODE: the
 *     per-minute part, including when it is wired to Transcribe or Edit Plan.
 *  2. A generated voice (Text to Speech, Text to Dialogue) is listed at the
 *     length its script text is expected to take, at most 300 seconds, not at
 *     the Lip Sync provider's own audio cap.
 */
import { describe, it, expect } from "vitest"
import { estimateScriptDurationSec } from "@nodaro/shared"
import { CreditsService } from "../credits.js"
import { videoUtilityBaseCredits } from "../../../lib/video-utility-credits.js"
import { exposedMediaNodeIds } from "../../../lib/exposed-text-caps.js"
import { GENERATED_VOICE_MAX_SEC, SLOW_SCRIPT_CHARS_PER_SEC, SLOWEST_VOICE_SPEED, generatedVoiceLength } from "../../../lib/video-output-length.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

const combine: N = { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }
const combineCharge = (durations: Array<number | undefined>) =>
  videoUtilityBaseCredits("combine-videos", { transition: "cut", transitionDuration: 0.5, trimStartFrames: 0, trimEndFrames: 0, videoUrls: durations.map(() => ""), upstreamDurations: durations })!
const MINUTES = [1, 7, 45, 180]

const yt: N = { id: "yt", type: "youtube-video", data: { youtubeUrl: "https://www.youtube.com/watch?v=abc", videoId: "abc", duration: 95 } }
const rec: N = { id: "yt", type: "upload-video", data: { duration: 95 } }

const listingOf = (nodes: N[], edges: E[], replaced: string[], extra: Record<string, unknown> = {}) =>
  CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", { replaceableMediaNodeIds: new Set(replaced), ...extra })
const at = (l: { preview: number; previewPerMinute: number }, minutes: number) => l.preview + l.previewPerMinute * minutes

describe("a Video URL the user replaces is an input the listing knows is replaced", () => {
  it("a template's cloner replaces it, as every upload node", () => {
    expect(exposedMediaNodeIds(null, [yt]).has("yt")).toBe(true)
  })

  it("an app that exposes its link replaces it", () => {
    const settings = { presentationSettings: { inputItems: [{ type: "field", nodeId: "yt", field: "youtubeUrl" }] } }
    expect(exposedMediaNodeIds(settings, [yt]).has("yt")).toBe(true)
  })

  it("an app that exposes something else of it does not", () => {
    const settings = { presentationSettings: { inputItems: [{ type: "field", nodeId: "yt", field: "title" }] } }
    expect(exposedMediaNodeIds(settings, [yt]).has("yt")).toBe(false)
  })
})

describe("a replaced Video URL is the episode", () => {
  const stepDelta = (source: N, replaced: string[]) => {
    const withOp = listingOf([source, combine], [{ source: source.id, target: "op", targetHandle: "in" }], replaced)
    const without = listingOf([source], [], replaced)
    return { fixed: withOp.preview - without.preview, perMinute: withOp.previewPerMinute - without.previewPerMinute, at: (m: number) => at(withOp, m) - at(without, m) }
  }

  it("Combine Videos after it lists per minute of it, never below the charge", () => {
    const d = stepDelta(yt, ["yt"])
    expect(d.perMinute).toBeGreaterThan(0)
    for (const m of MINUTES) expect(d.at(m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([m * 60]))
  })

  it("and lists exactly as the same step after an uploaded recording does", () => {
    expect(stepDelta(yt, ["yt"])).toMatchObject({ fixed: stepDelta(rec, ["yt"]).fixed, perMinute: stepDelta(rec, ["yt"]).perMinute })
  })

  it("a link the user cannot replace keeps its own length", () => {
    const d = stepDelta(yt, [])
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([95]))
  })

  it("wired to Transcribe it is the episode, and a second replaced recording is not", () => {
    const card: N = { id: "card", type: "upload-video", data: { duration: 8 } }
    const stt: N = { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } }
    const base = [yt, card, stt]
    const edges: E[] = [{ source: "yt", target: "stt", targetHandle: "audio" }]
    const per = (from: string) => {
      const withOp = listingOf([...base, combine], [...edges, { source: from, target: "op", targetHandle: "in" }], ["yt", "card"])
      const without = listingOf(base, edges, ["yt", "card"])
      return { fixed: withOp.preview - without.preview, perMinute: withOp.previewPerMinute - without.previewPerMinute }
    }
    expect(per("yt").perMinute).toBeGreaterThan(0)
    // The card has no unit for its length: the fallback, fixed (the documented exception).
    expect(per("card")).toEqual({ fixed: combineCharge([undefined]), perMinute: 0 })
  })

  it("wired to Edit Plan it is the episode: the plan lists per minute as it does on an uploaded recording", () => {
    const build = (source: N) => {
      const nodes: N[] = [
        source,
        { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
        { id: "plan", type: "edit-plan", data: { planTier: "standard", mode: "tighten" } },
        { id: "render", type: "apply-edl", data: { quality: "final" } },
      ]
      const edges: E[] = [
        { source: "yt", target: "stt", sourceHandle: "video", targetHandle: "audio" },
        { source: "yt", target: "plan", sourceHandle: "video", targetHandle: "sources" },
        { source: "stt", target: "plan", sourceHandle: "json", targetHandle: "transcript" },
        { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
      ]
      return listingOf(nodes, edges, ["yt"])
    }
    const link = build(yt)
    expect(link.previewPerMinute).toBeGreaterThan(0)
    expect(link).toEqual(build(rec))
  })
})

describe("a reference link beside an upload does not take the episode away from it", () => {
  const up: N = { id: "up", type: "upload-video", data: { duration: 95 } }
  const link: N = { id: "ref", type: "youtube-video", data: { youtubeUrl: "https://www.youtube.com/watch?v=abc", videoId: "abc", duration: 95 } }
  const analysis: N = { id: "va", type: "video-analysis", data: {} }
  const figures = (publishType: "template" | "app") => {
    const ofGraph = (nodes: N[], edges: E[]) =>
      CreditsService.estimateWorkflowBaseListing(nodes, edges, publishType, publishType === "app" ? { replaceableMediaNodeIds: new Set(nodes.filter((n) => n.type === "upload-video").map((n) => n.id)) } : {})
    const chain: E[] = [{ source: "up", target: "op", targetHandle: "in" }]
    const alone = ofGraph([up, combine], chain)
    const withLink = ofGraph([up, combine, link, analysis], [...chain, { source: "ref", target: "va", targetHandle: "video" }])
    const linkOnly = ofGraph([link, analysis], [{ source: "ref", target: "va", targetHandle: "video" }])
    return { alone, withLink, linkOnly }
  }

  for (const publishType of ["template", "app"] as const) {
    it(`${publishType}: upload -> Combine lists the same per-minute figure with an unrelated Video URL beside it`, () => {
      const { alone, withLink, linkOnly } = figures(publishType)
      expect(alone.previewPerMinute).toBeGreaterThan(0)
      // The link's own steps are priced on their own: what the Combine adds is unchanged.
      expect(withLink.previewPerMinute - linkOnly.previewPerMinute).toBe(alone.previewPerMinute)
    })
  }
})

describe("a generated voice is listed at its script's expected length", () => {
  const lipSync: N = { id: "step", type: "lip-sync", data: { provider: "kling-avatar" } }
  const voiceTo = (voice: N, extra: N[] = [], wires: E[] = [], caps?: Record<string, number | null>) => {
    const nodes = [voice, ...extra, lipSync]
    const edges: E[] = [...wires, { source: "voice", target: "step", targetHandle: "audio" }]
    const withOp = listingOf([...nodes, combine], [...edges, { source: "step", target: "op", targetHandle: "in" }], [], caps ? { speechTextCaps: caps } : {})
    const without = listingOf(nodes, edges, [], caps ? { speechTextCaps: caps } : {})
    return { fixed: withOp.preview - without.preview, perMinute: withOp.previewPerMinute - without.previewPerMinute }
  }
  const speech = (text: string, extra: Record<string, unknown> = {}): N => ({ id: "voice", type: "text-to-speech", data: { textSource: "direct", directText: text, provider: "elevenlabs-turbo", ...extra } })

  it("Text to Speech with a literal script: the seconds that script takes, not the provider's cap", () => {
    const script = "x".repeat(240)
    const d = voiceTo(speech(script))
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec(script)]))
    expect(d.fixed).toBeLessThan(combineCharge([300]))
  })

  it("a script that runs past 300 seconds lists at 300", () => {
    const d = voiceTo(speech("x".repeat(9000)))
    expect(d.fixed).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
  })

  it("a slower voice runs longer: the listing follows the node's speed", () => {
    const script = "x".repeat(1200)
    const d = voiceTo(speech(script, { speed: 0.7 }))
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec(script, 0.7)]))
    expect(d.fixed).toBeGreaterThan(voiceTo(speech(script)).fixed)
  })

  it("a speed mapped to a wire is listed at the slowest the voice speaks", () => {
    const script = "x".repeat(1200)
    const d = voiceTo(speech(script, { fieldMappings: { speed: { source: "n" } } }))
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec(script, SLOWEST_VOICE_SPEED)]))
  })

  it("a Chinese script is listed at the slow-script rate, not the Latin one", () => {
    const script = "你".repeat(600)
    const d = voiceTo(speech(script, { speed: 0.7 }))
    const seconds = Math.ceil(600 / SLOW_SCRIPT_CHARS_PER_SEC / 0.7)
    expect(d.fixed).toBe(combineCharge([seconds]))
    expect(seconds).toBeGreaterThanOrEqual(150)
  })

  it("only the slow-script characters of a mixed text are slowed", () => {
    expect(generatedVoiceLength({ chars: 120, exact: true, cap: 40000, slowChars: 40 })).toEqual({ fixedSec: estimateScriptDurationSec("x".repeat(80 + 120)), perEpisodeSec: 0 })
  })

  it("Text to Dialogue with literal lines: the seconds its lines take", () => {
    const lines = [{ voiceId: "a", text: "x".repeat(120) }, { voiceId: "b", text: "y".repeat(120) }]
    const voice: N = { id: "voice", type: "text-to-dialogue", data: { dialogue: lines } }
    const d = voiceTo(voice)
    expect(d.perMinute).toBe(0)
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec("z".repeat(240))]))
  })

  it("a script fed by a Text node with a literal text is read through the wire", () => {
    const script = "x".repeat(480)
    const voice: N = { id: "voice", type: "text-to-speech", data: { textSource: "connected", provider: "elevenlabs-turbo" } }
    const text: N = { id: "txt", type: "text-prompt", data: { text: script } }
    const d = voiceTo(voice, [text], [{ source: "txt", target: "voice", targetHandle: "prompt" }])
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec(script)]))
  })

  it("an exposed text input with a character limit: the longest script the limit admits", () => {
    const voice: N = { id: "voice", type: "text-to-speech", data: { textSource: "connected", provider: "elevenlabs-turbo" } }
    const text: N = { id: "txt", type: "text-prompt", data: { text: "placeholder" } }
    const d = voiceTo(voice, [text], [{ source: "txt", target: "voice", targetHandle: "prompt" }], { "txt:text": 600 })
    expect(d.fixed).toBe(combineCharge([estimateScriptDurationSec("x".repeat(600))]))
  })

  describe("a script an LLM node writes (decided 2026-10-07): at most maxTokens x 8 characters, read at the same speaking rate", () => {
    const voice = (extra: Record<string, unknown> = {}): N => ({ id: "voice", type: "text-to-speech", data: { textSource: "connected", provider: "elevenlabs-turbo", ...extra } })
    const wire: E = { source: "llm", target: "voice", targetHandle: "prompt" }
    // A model that does not share its output budget with thinking, as Street Interviews' writers pin.
    const llm = (data: Record<string, unknown> = {}, type = "llm-chat"): N => ({ id: "llm", type, data: { llmModel: "claude-sonnet-4.6", ...data } })
    const listed = (v: N, l: N, caps?: Record<string, number | null>) => voiceTo(v, [l], [wire], caps).fixed
    const seconds = (chars: number, speed = 1) => estimateScriptDurationSec("x".repeat(chars), speed)

    it("Prompt (llm-chat) with maxTokens 200: 1600 characters, not the provider's cap", () => {
      expect(listed(voice(), llm({ maxTokens: 200 }))).toBe(combineCharge([seconds(1600)]))
      expect(seconds(1600)).toBe(134)
    })

    it("follows the voice's speed, and a speed mapped to a wire is the slowest the voice speaks", () => {
      expect(listed(voice({ speed: 1.12 }), llm({ maxTokens: 200 }))).toBe(combineCharge([seconds(1600, 1.12)]))
      expect(listed(voice({ fieldMappings: { speed: { source: "n" } } }), llm({ maxTokens: 200 }))).toBe(combineCharge([seconds(1600, SLOWEST_VOICE_SPEED)]))
    })

    it("an unset maxTokens is the node's default, which is past 300 seconds: it lists at 300", () => {
      expect(listed(voice(), llm({}))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
      expect(listed(voice(), llm({}, "ai-writer"))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
    })

    it("a large maxTokens lists at the 300-second cap", () => {
      expect(listed(voice(), llm({ maxTokens: 16384 }))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
    })

    it("AI Writer reads its own maxTokens", () => {
      expect(listed(voice(), llm({ maxTokens: 100 }, "ai-writer"))).toBe(combineCharge([seconds(800)]))
    })

    it("the voice's pre and post text is part of what it reads", () => {
      const padded = voice({ promptPrefix: "p".repeat(120), promptSuffix: "s".repeat(120) })
      expect(listed(padded, llm({ maxTokens: 200 }))).toBeGreaterThan(listed(voice(), llm({ maxTokens: 200 })))
    })

    it("a node that falls back to its own text when the LLM is blank is never listed below that text", () => {
      const own = "x".repeat(3000)
      expect(listed(voice({ directText: own }), llm({ maxTokens: 100 }))).toBe(combineCharge([seconds(3000)]))
    })

    it("a maxTokens mapped to a wire is not bounded: the 300-second stand-in as before", () => {
      expect(listed(voice(), llm({ maxTokens: 200, fieldMappings: { maxTokens: { source: "n" } } }))).toBe(combineCharge([300]))
    })

    it("a maxTokens an app exposes is read at the largest value the app user can pick", () => {
      expect(listed(voice(), llm({ maxTokens: 200 }), { "llm:maxTokens": 16384 })).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
      expect(listed(voice(), llm({ maxTokens: 200 }), { "llm:maxTokens": 256 })).toBe(combineCharge([seconds(2048)]))
    })

    it("a node with no model of its own runs the feature's default, which reasons by default: its 8192-token floor is no bound", () => {
      const bare = (data: Record<string, unknown>): N => ({ id: "llm", type: "llm-chat", data })
      expect(listed(voice(), bare({ maxTokens: 200 }))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
    })

    it("a model that shares its output budget with thinking is read at the floor the request layer raises it to", () => {
      // Opus 5 reasons by default: a 200-token cap is raised to the model's floor, so the cap is no bound.
      expect(listed(voice(), llm({ maxTokens: 200, llmModel: "claude-opus-5" }))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
      expect(listed(voice(), llm({ maxTokens: 200, llmModel: "claude-sonnet-4.6", reasoningEffort: "max" }))).toBe(combineCharge([GENERATED_VOICE_MAX_SEC]))
    })

    it("a voice fed by two wires, or by any other node, is not bounded", () => {
      const other: N = { id: "other", type: "image-to-text", data: { maxTokens: 200 } }
      expect(voiceTo(voice(), [other], [{ source: "other", target: "voice", targetHandle: "prompt" }]).fixed).toBe(combineCharge([300]))
    })

    it("the voice's own price is the same as before: the bound is a length, not a script count", () => {
      const price = (l: N) => CreditsService.estimateWorkflowBaseListing([voice(), l], [wire], "app", {}).preview
      expect(price(llm({ maxTokens: 200 }))).toBe(price(llm({ maxTokens: 16384 })))
    })
  })

  it("Merge Video Audio on a short literal voice keeps the video's length (no 300-second stand-in)", () => {
    const clip: N = { id: "clip", type: "generate-video", data: { provider: "seedance-2", duration: 15 } }
    const merge: N = { id: "merge", type: "merge-video-audio", data: {} }
    const voice = speech("x".repeat(36))
    const nodes = [clip, voice, merge]
    const edges: E[] = [
      { source: "clip", target: "merge", targetHandle: "in" },
      { source: "voice", target: "merge", targetHandle: "in" },
    ]
    const withOp = listingOf([...nodes, combine], [...edges, { source: "merge", target: "op", targetHandle: "in" }], [])
    const without = listingOf(nodes, edges, [])
    expect(withOp.preview - without.preview).toBe(combineCharge([15]))
  })
})

describe("generatedVoiceLength", () => {
  it("reads the characters at the rate the AI Avatar script estimate uses", () => {
    for (const chars of [1, 11, 12, 13, 240, 1000]) {
      const got = generatedVoiceLength({ chars, exact: true, cap: 40000 })
      expect(got, `${chars} chars`).toEqual({ fixedSec: Math.min(GENERATED_VOICE_MAX_SEC, estimateScriptDurationSec("x".repeat(chars))), perEpisodeSec: 0 })
    }
  })

  it("is never past 300 seconds", () => {
    expect(generatedVoiceLength({ chars: 40000, exact: true, cap: 40000 })).toEqual({ fixedSec: 300, perEpisodeSec: 0 })
  })

  it("is unbounded when the text is the model's cap, not a count", () => {
    expect(generatedVoiceLength({ chars: 40000, exact: false, cap: 40000 })).toBeUndefined()
  })

  it("is bounded by a count under the cap, even when it is a limit rather than the text", () => {
    expect(generatedVoiceLength({ chars: 600, exact: false, cap: 40000 })).toEqual({ fixedSec: 50, perEpisodeSec: 0 })
  })
})
