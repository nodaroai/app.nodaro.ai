/**
 * The body the canvas's own run of a use-case node sends its route, end to
 * end: node data → executor → API client → fetch. Tighten Episode's bodies are
 * pinned byte for byte (key order included) to the ones its P1 client sent,
 * captured from that code before the client served every use-case node.
 *
 * Two deliberate differences:
 * - a setting the person set to None (`framing: null`) now reaches the route
 *   as `null` instead of being left out (decided 2026-10-16) — a later node's
 *   None is not its default. For Tighten Episode both mean "no framing" (its
 *   settings resolver reads null and absent alike);
 * - an empty free-text setting (`instructions: ""`) is now sent, as the
 *   server's engine sends it (decided 2026-10-19: both engines send an empty
 *   string only where the body takes one). The route reads an empty
 *   instruction as none.
 */
import { describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({ nodes: [] as unknown[], updateNodeData: vi.fn(), multicam: false }))
// The viewer's answer: may they use Speaker Map (several recordings, decided 2026-10-19)?
vi.mock("@/lib/use-case-multicam-viewer", () => ({ usecaseMulticamOffered: () => store.multicam }))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ nodes: store.nodes, updateNodeData: store.updateNodeData }) },
}))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: async (_nodeId: string, apiCall: () => Promise<{ jobId: string }>) => {
    await apiCall()
    return "https://r2/out.mp4"
  },
}))

import { executeUseCase } from "../use-case-executor"

const USER = "00000000-0000-4000-8000-000000000001"
const REC = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }

async function bodyOf(data: Record<string, unknown>, inputs: Record<string, unknown> = REC, multicam = false): Promise<string> {
  store.multicam = multicam
  const f = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ jobId: "job-1" }) })
  vi.stubGlobal("fetch", f)
  try {
    const node = { id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", fieldMappings: {}, ...data } }
    store.nodes = [node]
    await executeUseCase(node as never, inputs as never, { userId: USER, isWorkflowStale: () => false } as never)
    return (f.mock.calls[0]![1] as RequestInit).body as string
  } finally {
    vi.unstubAllGlobals()
  }
}

/** The node's default settings (NODE_DEFINITIONS' default data). */
const DEFAULTS = { output: "video", captions: true, captionStyle: "word-highlight", reviewBeforeRender: false, planTier: "standard", instructions: "" }

describe("Tighten Episode's run body is P1's, byte for byte", () => {
  it("every setting, a framing and a music bed", async () => {
    const data = {
      output: "video", framing: { aspect: "9:16", layout: "stacked" }, captions: false, captionStyle: "karaoke", reviewBeforeRender: true,
      planTier: "premium", instructions: "cut ums", styleGuide: "tight", musicDuckAmount: 40,
    }
    expect(await bodyOf(data, { ...REC, useCaseMusic: "https://r2/bed.mp3" })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"musicUrl":"https://r2/bed.mp3","output":"video","framing":{"aspect":"9:16","layout":"stacked"},"captions":false,"captionStyle":"karaoke","reviewBeforeRender":true,"planTier":"premium","instructions":"cut ums","styleGuide":"tight","musicDuckAmount":40,"userId":"${USER}"}`,
    )
  })

  it("the default settings (an empty instruction is sent, as the server's engine sends it)", async () => {
    expect(await bodyOf(DEFAULTS)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"","userId":"${USER}"}`,
    )
  })

  it("an audio episode with only its output set", async () => {
    expect(await bodyOf({ output: "audio", instructions: "" })).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio","instructions":"","userId":"${USER}"}`)
  })
})

describe("a setting set to None", () => {
  it("reaches the route as null, in its own place (P1 left it out; Tighten reads both as no framing)", async () => {
    expect(await bodyOf({ ...DEFAULTS, framing: null })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","framing":null,"captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","instructions":"","userId":"${USER}"}`,
    )
  })
})

describe("a stored null on a setting whose body takes no null", () => {
  it("is not sent — the engine's rule (an agent's or an import's write); a None the body takes still is", async () => {
    expect(await bodyOf({ ...DEFAULTS, framing: null, captions: null, captionStyle: null, reviewBeforeRender: null })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","framing":null,"planTier":"standard","instructions":"","userId":"${USER}"}`,
    )
  })
})

describe("recordings and Master audio (decided 2026-10-19: several only for a viewer who may use Speaker Map)", () => {
  const TWO = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }, { nodeId: "b", url: "https://r2/b.mp4" }] }
  const FIRST = { useCaseMedia: [{ nodeId: "a", url: "https://r2/a.mp4" }] }
  const MIC = { useCaseMasterAudio: "https://r2/m.wav", useCaseMasterAudioNodeId: "mic" }

  it("a viewer who may not use Speaker Map: the first recording in mediaOrder alone, its master and Cameras settings ignored — the server's engine's rule", async () => {
    expect(JSON.parse(await bodyOf({ mediaOrder: ["b"] }, TWO)).mediaUrls).toEqual(["https://r2/b.mp4"])
    expect(await bodyOf({ ...DEFAULTS, cameras: "not cameras" }, { ...TWO, ...MIC })).toBe(await bodyOf(DEFAULTS, FIRST))
  })

  it("a viewer who may use Speaker Map: every recording in mediaOrder, then the rest in wire order, with the Cameras settings", async () => {
    expect(JSON.parse(await bodyOf({ mediaOrder: ["b"] }, TWO, true)).mediaUrls).toEqual(["https://r2/b.mp4", "https://r2/a.mp4"])
    expect(JSON.parse(await bodyOf({ cameras: { wide: 2 } }, TWO, true))).toMatchObject({ mediaUrls: ["https://r2/a.mp4", "https://r2/b.mp4"], cameras: { wide: 2 } })
  })

  it("Tighten takes Master audio and sends it, for such a viewer, after the other optional inputs, before the settings", async () => {
    expect(await bodyOf({ output: "audio" }, { ...REC, useCaseMusic: "https://r2/bed.mp3", ...MIC }, true)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"musicUrl":"https://r2/bed.mp3","masterAudioUrl":"https://r2/m.wav","output":"audio","userId":"${USER}"}`,
    )
  })

  it("a Master audio from the node a recording comes from is not sent (decided 2026-10-19, compared by NODE): the run is built as with none", async () => {
    expect(await bodyOf({ output: "video" }, { ...REC, useCaseMasterAudio: "https://r2/ep.mp4", useCaseMasterAudioNodeId: "rec" }, true)).toBe(await bodyOf({ output: "video" }, REC, true))
    expect(await bodyOf({ output: "video" }, { ...TWO, useCaseMasterAudio: "https://r2/b.mp4", useCaseMasterAudioNodeId: "b" }, true)).toBe(await bodyOf({ output: "video" }, TWO, true))
  })

  it("a Split Media's audio into Master audio beside its own video into Recordings is that camera's track: no master, the one-recording body", async () => {
    const split = { useCaseMedia: [{ nodeId: "split", url: "https://r2/split-video.mp4" }], useCaseMasterAudio: "https://r2/split-audio.m4a", useCaseMasterAudioNodeId: "split" }
    expect(await bodyOf({ ...DEFAULTS, cameras: { synced: true } }, split, true)).toBe(await bodyOf(DEFAULTS, { useCaseMedia: split.useCaseMedia }, true))
  })
})
