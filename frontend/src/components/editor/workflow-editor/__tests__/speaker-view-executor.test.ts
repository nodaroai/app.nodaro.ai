/**
 * The canvas's own run of a Speaker View node (C3.2): the checks the server's
 * payload builder makes, before anything is sent. While Speaker View has no
 * price the answer is always "not priced yet" — in the plugin's own words — and
 * nothing is sent. With the price flag let through (as C4 will), the body is
 * the one both engines send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { toastError, polls, flag } = vi.hoisted(() => ({ toastError: vi.fn(), polls: [] as Array<{ call: () => Promise<unknown>; resultFields?: unknown }>, flag: { priced: false } }))

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), info: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@nodaro/render-rules", async (orig) => {
  const actual = await orig<typeof import("@nodaro/render-rules")>()
  return { ...actual, get SPEAKER_VIEW_PRICED() { return flag.priced } }
})
const speakerViewApi = vi.fn(async (_p: unknown) => ({ jobId: "job-1" }))
vi.mock("@/lib/api", () => ({ speakerView: (p: unknown) => speakerViewApi(p) }))
vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: (_id: string, call: () => Promise<unknown>, _key: unknown, _label: string, _ctx: unknown, _extra: unknown, _est: unknown, opts: { resultFields?: unknown }) => {
    polls.push({ call, resultFields: opts?.resultFields })
    return Promise.resolve("done")
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState: () => ({ nodes: [], edges: [] }) } }))

import { executeSpeakerView } from "../speaker-view-executor"
import { translate } from "@/lib/i18n"
import type { WorkflowNode } from "@/types/nodes"

const src = (id: string) => ({ id, url: `https://x/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, speaker })
const EDL = { version: 1, clock: "master", sources: [src("a"), src("b")], segments: [seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest")] }
const node = (data: Record<string, unknown> = {}) => ({ id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View", ...data } }) as unknown as WorkflowNode
const ctx = { userId: "user-1" } as never

beforeEach(() => {
  vi.clearAllMocks()
  polls.length = 0
  flag.priced = false
})

describe("executeSpeakerView", () => {
  it("refuses a run with no edit, naming the input", async () => {
    await expect(executeSpeakerView(node(), {}, ctx, undefined)).rejects.toThrow("speaker-view requires an EDL")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining(translate("en", "nodeRun.speakerViewConnectEdl")))
    expect(polls).toHaveLength(0)
  })

  it("refuses an edit the plugin would refuse, in the rule's words, before anything is sent", async () => {
    const unnamed = { ...EDL, segments: EDL.segments.map(({ speaker: _s, ...rest }) => rest) }
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(unnamed) }, ctx, undefined)).rejects.toThrow(/Wire Camera Switch/)
    expect(polls).toHaveLength(0)
  })

  it("says it is not priced yet — the plugin's own words — and sends nothing", async () => {
    await expect(executeSpeakerView(node(), { edl: JSON.stringify(EDL) }, ctx, undefined)).rejects.toThrow("Speaker View is not priced yet")
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining(translate("en", "nodeRun.speakerViewNotPriced")))
    expect(polls).toHaveLength(0)
    expect(speakerViewApi).not.toHaveBeenCalled()
  })

  it("with a price, sends the normalized settings, the stamps and the quality — one body for both engines", async () => {
    flag.priced = true
    await executeSpeakerView(node({ layout: "side-by-side", targetAspect: "9:16", switchType: "pan", switchDurationMs: 600, quality: "proxy" }), { edl: JSON.stringify(EDL) }, ctx, undefined)
    expect(polls).toHaveLength(1)
    await polls[0]!.call()
    const body = speakerViewApi.mock.calls[0]![0] as Record<string, unknown>
    expect(body).toMatchObject({ quality: "proxy", userId: "user-1", settings: { layout: "stacked", targetAspect: "9:16", switch: { type: "pan", durationMs: 600 } } })
    expect(body.edl).toEqual(EDL)
    expect(body.renderBasis).toMatch(/^[0-9a-f]{16}$/)
  })

  it("keeps the take's identity on the result only", async () => {
    flag.priced = true
    await executeSpeakerView(node(), { edl: JSON.stringify(EDL) }, ctx, undefined)
    const fields = (polls[0]!.resultFields as (od: Record<string, unknown>) => Record<string, unknown>)({ quality: "proxy", clipKey: "0-10000", renderBasis: "0123456789abcdef", thumbnailUrl: "t.jpg" })
    expect(fields).toMatchObject({ quality: "proxy", clipKey: "0-10000", renderBasis: "0123456789abcdef", thumbnailUrl: "t.jpg" })
  })
})
