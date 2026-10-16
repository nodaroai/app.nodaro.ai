/**
 * The body the canvas's own run of a use-case node sends its route, end to
 * end: node data → executor → API client → fetch. Tighten Episode's bodies are
 * pinned byte for byte (key order included) to the ones its P1 client sent,
 * captured from that code before the client served every use-case node.
 *
 * One deliberate difference: a setting the person set to None (`framing:
 * null`) now reaches the route as `null` instead of being left out (decided
 * 2026-10-16) — a later node's None is not its default. For Tighten Episode
 * both mean "no framing" (its settings resolver reads null and absent alike).
 */
import { describe, expect, it, vi } from "vitest"

const store = vi.hoisted(() => ({ nodes: [] as unknown[], updateNodeData: vi.fn() }))

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

async function bodyOf(data: Record<string, unknown>, inputs: Record<string, unknown> = REC): Promise<string> {
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

  it("the default settings (an empty instruction is not sent)", async () => {
    expect(await bodyOf(DEFAULTS)).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","userId":"${USER}"}`,
    )
  })

  it("an audio episode with only its output set", async () => {
    expect(await bodyOf({ output: "audio", instructions: "" })).toBe(`{"mediaUrls":["https://r2/ep.mp4"],"output":"audio","userId":"${USER}"}`)
  })
})

describe("a setting set to None", () => {
  it("reaches the route as null, in its own place (P1 left it out; Tighten reads both as no framing)", async () => {
    expect(await bodyOf({ ...DEFAULTS, framing: null })).toBe(
      `{"mediaUrls":["https://r2/ep.mp4"],"output":"video","framing":null,"captions":true,"captionStyle":"word-highlight","reviewBeforeRender":false,"planTier":"standard","userId":"${USER}"}`,
    )
  })
})
