import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The LIVE lane of the three that paint an orchestrator's output onto a node
// (the other two are the load-time restores in use-workflow-persistence.ts).
// All three go through `namedRunOutputFields`; this pins the live one, so a
// future "just set it inline here" cannot make a result right while the tab is
// open and lost after a reload — which is what #1547 was, the other way round.

const mockStreamWorkflowExecution = vi.fn()
const mockGetWorkflowExecution = vi.fn()
let mockNodes: Array<{ id: string; type?: string; data: Record<string, unknown> }> = []

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ nodes: mockNodes, edges: [], updateNodeData: vi.fn() }),
    setState: (updater: unknown) => {
      const next =
        typeof updater === "function"
          ? (updater as (s: { nodes: typeof mockNodes }) => { nodes?: typeof mockNodes })({ nodes: mockNodes })
          : (updater as { nodes?: typeof mockNodes })
      if (next?.nodes) mockNodes = next.nodes
    },
  },
}))

vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  getUserCredits: vi.fn(),
  getWorkflowExecution: (...args: unknown[]) => mockGetWorkflowExecution(...args),
  streamWorkflowExecution: (...args: unknown[]) => mockStreamWorkflowExecution(...args),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}))
vi.mock("@/hooks/use-auth", () => ({ getCachedUserId: () => "u1" }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("@/lib/query-client", () => ({ queryClient: { fetchQuery: vi.fn() } }))
vi.mock("@/lib/query-keys", () => ({
  queryKeys: { credits: { balance: (id: string) => ["credits", "balance", id] } },
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn() }))
vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {},
  MAX_CONSECUTIVE_POLL_FAILURES: 20,
  NODE_CREDIT_COSTS: {} as Record<string, number>,
  isExecutableNode: () => true,
}))
vi.mock("../execution-graph", () => ({
  buildExecutionLevels: vi.fn().mockReturnValue([]),
  getEffectivelySkippedIds: vi.fn().mockReturnValue(new Set()),
  collapseExpandedClones: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}))
vi.mock("../node-input-resolver", () => ({
  getListInputForNode: vi.fn().mockReturnValue(null),
  getListFanOutForNode: vi.fn().mockReturnValue(undefined),
}))
vi.mock("../execute-node", () => ({ executeNode: vi.fn().mockResolvedValue(undefined), rejectAllManualEdits: vi.fn() }))
vi.mock("../list-execution", () => ({ executeNodeForList: vi.fn().mockResolvedValue(undefined), expandLoopResults: vi.fn() }))
// The clear module pulls the Preview collector (and through it the real
// execution graph); this lane needs neither.
vi.mock("../clear-run-results", () => ({ clearedConnectedListRows: () => null }))

import { streamBackendExecution, teardownActiveWorkflowStream } from "../run-handlers"
import { namedRunOutputFields } from "@/lib/named-run-outputs"
import { videoOverlayResultFresh } from "@/lib/video-overlay-composition"
import { contentRunResultPatch } from "@/lib/content-run-output"
import type { ExecutionContext } from "../types"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/apply-edl-picked-take.json"

const ctx = {
  userId: "u1",
  projectId: "p1",
  trackInterval: (i: unknown) => i,
  untrackInterval: vi.fn(),
  save: vi.fn(),
  setIsRunning: vi.fn(),
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: vi.fn(),
  setStorageExceededData: vi.fn(),
  setShowInsufficientCredits: vi.fn(),
  setInsufficientCreditsData: vi.fn(),
} as unknown as ExecutionContext

function sync(states: Record<string, unknown>) {
  const calls = mockStreamWorkflowExecution.mock.calls
  const callbacks = calls[calls.length - 1]?.[1] as { onNodeStatesChanged?: (s: Record<string, unknown>) => void }
  callbacks.onNodeStatesChanged?.(states)
  return Object.fromEntries(mockNodes.map((n) => [n.id, n.data]))
}

describe("syncNodeStatesToStore — a finished node's named side outputs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("lands every one of them under the name its reader uses — the same mapping the reload lanes apply", () => {
    const outputs = {
      sep: { vocalUrl: "https://cdn.test/vocals.mp3", instrumentalUrl: "https://cdn.test/inst.mp3" },
      align: { alignment: [{ word: "hi", start: 0, end: 1 }] },
      combine: { combinedText: "a b" },
      split: { splitResults: ["a", "b"] },
      voice: { generatedVoiceId: "voice-1" },
    }
    mockNodes = [
      { id: "sep", type: "suno-separate", data: { executionStatus: "running" } },
      { id: "align", type: "forced-alignment", data: { executionStatus: "running" } },
      { id: "combine", type: "combine-text", data: { executionStatus: "running" } },
      { id: "split", type: "split-text", data: { executionStatus: "running" } },
      { id: "voice", type: "voice-design", data: { executionStatus: "running" } },
    ]
    streamBackendExecution("exec-1", ctx, vi.fn(), vi.fn())
    const byId = sync(Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { status: "completed", output }])))

    for (const [id, output] of Object.entries(outputs)) {
      expect(byId[id], id).toMatchObject(namedRunOutputFields(output))
    }
    expect(byId.sep.vocalUrl).toBe("https://cdn.test/vocals.mp3")
    expect(byId.align.alignmentResults).toEqual([{ word: "hi", start: 0, end: 1 }])
    expect(byId.combine.combinedText).toBe("a b")
    expect(byId.split.splitResults).toEqual(["a", "b"])
  })
})

// Video Overlay on a BACKEND run (Execute All, Run from here, schedule, webhook,
// app): the worker's warnings, canvas and length must reach the node exactly as
// the single-node Run writes them — the panel's "Last run" line reads the field
// whichever path ran — and a run without warnings must clear an earlier line.
describe("syncNodeStatesToStore — Video Overlay run facts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  const skipped = { layer: 1, slot: 2, code: "skipped", detail: "starts at 9 s, after the video ends (5.00 s)" }

  it("a backend-completed node carries the skipped warning, the canvas and the length — on the node and on the new result", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-1", ctx, vi.fn(), vi.fn())
    const byId = sync({
      vo: {
        status: "completed",
        jobId: "job-9",
        output: { videoUrl: "https://cdn.test/o.mp4", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 },
      },
    })
    expect(byId.vo).toMatchObject({ executionStatus: "completed", generatedVideoUrl: "https://cdn.test/o.mp4", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 })
    const [first] = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(first).toMatchObject({ url: "https://cdn.test/o.mp4", jobId: "job-9", warnings: [skipped], width: 1080, height: 1920, durationSec: 5 })
  })

  it("a backend run stamps the freshness key on the node and on the new result; an unstamped output leaves the result reading old", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-4", ctx, vi.fn(), vi.fn())
    const byId = sync({ vo: { status: "completed", jobId: "job-4", output: { videoUrl: "https://cdn.test/k.mp4", resultCompositionKey: "K1" } } })
    expect(byId.vo.resultCompositionKey).toBe("K1")
    const [first] = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(first).toMatchObject({ url: "https://cdn.test/k.mp4", resultCompositionKey: "K1" })

    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running", resultCompositionKey: "K0" } }]
    streamBackendExecution("exec-5", ctx, vi.fn(), vi.fn())
    const unstamped = sync({ vo: { status: "completed", jobId: "job-5", output: { videoUrl: "https://cdn.test/u.mp4" } } })
    expect(unstamped.vo.resultCompositionKey).toBeUndefined()
    const [plain] = unstamped.vo.generatedResults as Array<Record<string, unknown>>
    expect(videoOverlayResultFresh("K1", plain)).toBe(false)
  })

  it("a list fan-out stamps each row with the key of the composition that produced it, not the node's", () => {
    mockNodes = [{ id: "vo", type: "video-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-6", ctx, vi.fn(), vi.fn())
    const byId = sync({
      vo: {
        status: "completed",
        jobId: "job-c",
        jobIds: ["job-a", "job-c"],
        output: {
          videoUrl: "https://cdn.test/a.mp4",
          resultCompositionKey: "KA",
          listResults: ["https://cdn.test/a.mp4", "", "https://cdn.test/c.mp4"],
          listResultCompositionKeys: ["KA", "", "KC"],
        },
      },
    })
    const rows = byId.vo.generatedResults as Array<Record<string, unknown>>
    expect(rows.find((r) => r.url === "https://cdn.test/a.mp4")).toMatchObject({ resultCompositionKey: "KA" })
    expect(rows.find((r) => r.url === "https://cdn.test/c.mp4")).toMatchObject({ resultCompositionKey: "KC" })
  })

  it("a later run with no warnings clears the line an earlier single-node run left", () => {
    mockNodes = [
      { id: "vo", type: "video-overlay", data: { executionStatus: "running", warnings: [skipped], width: 720, height: 1280, durationSec: 9 } },
    ]
    streamBackendExecution("exec-2", ctx, vi.fn(), vi.fn())
    const byId = sync({ vo: { status: "completed", output: { videoUrl: "https://cdn.test/o2.mp4", width: 1080, height: 1920, durationSec: 5 } } })
    expect(byId.vo.warnings).toEqual([])
    expect(byId.vo).toMatchObject({ width: 1080, height: 1920, durationSec: 5 })
  })

  it("another node type is untouched by the mapping", () => {
    mockNodes = [{ id: "img", type: "image-overlay", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-3", ctx, vi.fn(), vi.fn())
    const byId = sync({ img: { status: "completed", output: { imageUrl: "https://cdn.test/i.png" } } })
    expect("warnings" in byId.img).toBe(false)
  })
})

// Content Recipe / Content Ideas on a BACKEND run (the editor's Execute and
// Run from here go through the orchestrator): the node gets the live run's own
// mapping — never the generic writes, which would put the briefs on
// __listResults (cloning the node on the canvas) and the digest into a
// generatedResults text history (read downstream as a list).
describe("syncNodeStatesToStore — Content Recipe / Content Ideas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  const ideasOutput = {
    json: [{ title: "one" }, { title: "two" }],
    text: "CONTENT IDEAS (2)",
    listResults: ["IDEA 1 of 2: one", "IDEA 2 of 2: two"],
  }

  it("content-ideas: the briefs land on ideaBriefs, never __listResults or generatedResults", () => {
    mockNodes = [{ id: "ideas", type: "content-ideas", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-c1", ctx, vi.fn(), vi.fn())
    const byId = sync({ ideas: { status: "completed", jobId: "job-i", output: ideasOutput } })
    expect(byId.ideas).toMatchObject(contentRunResultPatch("content-ideas", ideasOutput)!)
    expect(byId.ideas.ideaBriefs).toEqual(ideasOutput.listResults)
    expect(byId.ideas.__listResults).toBeUndefined()
    expect(byId.ideas.generatedResults).toBeUndefined()
  })

  it("content-ideas: a later tick on the completed node writes nothing again", () => {
    mockNodes = [{ id: "ideas", type: "content-ideas", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-c2", ctx, vi.fn(), vi.fn())
    sync({ ideas: { status: "completed", output: ideasOutput } })
    const before = mockNodes[0]!.data
    sync({ ideas: { status: "completed", output: ideasOutput } })
    expect(mockNodes[0]!.data).toBe(before)
  })

  it("content-recipe: the recipe object and its text, no text history", () => {
    const output = { json: { version: 1, topic: "t" }, text: "CONTENT RECIPE: t" }
    mockNodes = [{ id: "recipe", type: "content-recipe", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-c3", ctx, vi.fn(), vi.fn())
    const byId = sync({ recipe: { status: "completed", output } })
    expect(byId.recipe).toMatchObject({ executionStatus: "completed", generatedJson: output.json, generatedText: output.text })
    expect(byId.recipe.generatedResults).toBeUndefined()
  })
})

// Apply EDL on a BACKEND run (Execute All, Run from here, schedule, webhook,
// app): a run that renders audio on a node still holding an earlier VIDEO
// render's URL (rendered as video, then Output switched to audio) must leave the
// node holding the new take only. Both engines read the node as video whenever
// `generatedVideoUrl` is set, so a stale one hands the OLD video downstream on
// the server and routes the NEW audio as video on the canvas — with nobody
// picking anything. The fixture's `runs.audio.after` is also what the server
// test (backend apply-edl-picked-take.test.ts) and the browser-engine test
// (config-panels apply-edl-picked-take.test.tsx) read.
describe("syncNodeStatesToStore — an Apply EDL run leaves the node holding one cut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  const run = fixture.runs.audio as unknown as {
    state: Record<string, unknown>
    before: { id: string; type: string; data: Record<string, unknown> }
    after: { id: string; type: string; data: Record<string, unknown> }
  }

  it("an audio render clears the earlier video render's URL: the saved node is the fixture's `after`", () => {
    mockNodes = [{ id: run.before.id, type: run.before.type, data: structuredClone(run.before.data) }]
    streamBackendExecution("exec-edl-1", ctx, vi.fn(), vi.fn())
    const byId = sync({ [run.before.id]: run.state })
    expect(byId[run.before.id].generatedVideoUrl).toBeUndefined()
    // What the editor saves: the JSON round trip drops the cleared field.
    expect(JSON.parse(JSON.stringify(byId[run.before.id]))).toEqual(run.after.data)
  })

  it("a video render clears an earlier audio render's URL", () => {
    mockNodes = [{
      id: "cut",
      type: "apply-edl",
      data: { output: "video", executionStatus: "running", generatedAudioUrl: "https://media.test/a.m4a", generatedResults: [{ url: "https://media.test/a.m4a", timestamp: "t0", jobId: "j0" }] },
    }]
    streamBackendExecution("exec-edl-2", ctx, vi.fn(), vi.fn())
    const byId = sync({ cut: { status: "completed", jobId: "j1", output: { videoUrl: "https://media.test/v.mp4" } } })
    expect(byId.cut.generatedVideoUrl).toBe("https://media.test/v.mp4")
    expect(byId.cut.generatedAudioUrl).toBeUndefined()
  })

  it("only Apply EDL: a dual-mode node that delivers video PLUS its audio keeps both", () => {
    mockNodes = [{ id: "vc", type: "voice-changer", data: { executionStatus: "running" } }]
    streamBackendExecution("exec-edl-3", ctx, vi.fn(), vi.fn())
    const byId = sync({ vc: { status: "completed", jobId: "j2", output: { videoUrl: "https://media.test/vc.mp4", audioUrl: "https://media.test/vc.mp3" } } })
    expect(byId.vc.generatedVideoUrl).toBe("https://media.test/vc.mp4")
    expect(byId.vc.generatedAudioUrl).toBe("https://media.test/vc.mp3")
  })

  // The Transcript output moves with the cut. A run that lands a new take must
  // leave the node's Transcript output as THAT take's — the one its render was
  // cut with, or none — never the one an earlier take (or a pick's late job
  // read) left: captions downstream are timed by it, on both engines.
  const transcriptRun = (name: "video" | "untranscribed") => fixture.runs[name] as unknown as typeof run

  it("a render cut with a transcript: the node's Transcript output and the new take's are that render's — the saved node is the fixture's `after`", () => {
    const r = transcriptRun("video")
    mockNodes = [{ id: r.before.id, type: r.before.type, data: structuredClone(r.before.data) }]
    streamBackendExecution("exec-edl-4", ctx, vi.fn(), vi.fn())
    const byId = sync({ [r.before.id]: r.state })
    const transcript = (r.state.output as { json: unknown }).json
    expect(byId[r.before.id].generatedJson).toEqual(transcript)
    expect((byId[r.before.id].generatedResults as Array<{ generatedJson?: unknown }>)[0].generatedJson).toEqual(transcript)
    expect(JSON.parse(JSON.stringify(byId[r.before.id]))).toEqual(r.after.data)
  })

  it("a render cut with NO transcript clears the earlier take's, and its take keeps none — the saved node is the fixture's `after`", () => {
    const r = transcriptRun("untranscribed")
    expect(r.before.data.generatedJson).toBeDefined()
    mockNodes = [{ id: r.before.id, type: r.before.type, data: structuredClone(r.before.data) }]
    streamBackendExecution("exec-edl-5", ctx, vi.fn(), vi.fn())
    const byId = sync({ [r.before.id]: r.state })
    expect(byId[r.before.id]).toHaveProperty("generatedJson", undefined)
    // Kept as "none", so a later pick of it clears with no job read.
    expect((byId[r.before.id].generatedResults as Array<Record<string, unknown>>)[0]).toHaveProperty("generatedJson", undefined)
    expect(JSON.parse(JSON.stringify(byId[r.before.id]))).toEqual(r.after.data)
  })

  it("a list run: only the take that IS the render the output describes keeps its Transcript; the others keep none, never its", () => {
    // The server's fan-out output spreads its FIRST render's output beside
    // every render's URL, so its `json` is that render's alone.
    const first = { version: 1, words: [{ text: "one", startMs: 0, endMs: 300 }] }
    mockNodes = [{ id: "cut", type: "apply-edl", data: { output: "video", executionStatus: "running", generatedJson: { version: 1, words: [] } } }]
    streamBackendExecution("exec-edl-6", ctx, vi.fn(), vi.fn())
    const byId = sync({
      cut: {
        status: "completed",
        jobId: "j-b",
        jobIds: ["j-a", "j-b"],
        output: { videoUrl: "https://media.test/clip-a.mp4", json: first, listResults: ["https://media.test/clip-a.mp4", "https://media.test/clip-b.mp4"] },
      },
    })
    const takes = byId.cut.generatedResults as Array<Record<string, unknown>>
    expect(takes.map((t) => t.url)).toEqual(["https://media.test/clip-a.mp4", "https://media.test/clip-b.mp4"])
    expect(takes[0].generatedJson).toEqual(first)
    expect(takes[1]).not.toHaveProperty("generatedJson")
    expect(byId.cut.activeResultIndex).toBe(0)
    expect(byId.cut.generatedJson).toEqual(first)
  })

  it("only Apply EDL: another node's run leaves generatedJson alone", () => {
    mockNodes = [{ id: "tc", type: "trim-video", data: { executionStatus: "running", generatedJson: { kept: true } } }]
    streamBackendExecution("exec-edl-7", ctx, vi.fn(), vi.fn())
    const byId = sync({ tc: { status: "completed", jobId: "j3", output: { videoUrl: "https://media.test/t.mp4" } } })
    expect(byId.tc.generatedJson).toEqual({ kept: true })
    expect((byId.tc.generatedResults as Array<Record<string, unknown>>)[0]).not.toHaveProperty("generatedJson")
  })
})

// A scraper on a BACKEND run: the card reads generatedJson + the run outcome,
// so the live lane must write the single-node Run's own patch — the generic
// media writes put the featured image in generatedResults and left the card on
// "Not run yet" while every node after it ran on its posts.
describe("syncNodeStatesToStore — a scraper's posts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    teardownActiveWorkflowStream()
    mockStreamWorkflowExecution.mockReturnValue(new Promise(() => {}))
    mockGetWorkflowExecution.mockResolvedValue({ status: "running", nodeStates: {} })
  })
  afterEach(() => {
    teardownActiveWorkflowStream()
    vi.useRealTimers()
  })

  it("lands the posts and the outcome on an Instagram node, never its featured image as a result", () => {
    const posts = [{ postId: "p1", caption: "hi", images: ["https://cdn.test/i.jpg"], videos: [], videoPreviews: [] }]
    mockNodes = [{ id: "ig", type: "instagram-scrape", data: { executionStatus: "running", mode: "post" } }]
    streamBackendExecution("exec-ig", ctx, vi.fn(), vi.fn())
    const byId = sync({ ig: { status: "completed", jobId: "job-ig", output: { json: posts, text: "hi", imageUrl: "https://cdn.test/i.jpg" } } })
    expect(byId.ig).toMatchObject({ executionStatus: "completed", generatedJson: posts, lastRunOutcome: "success", lastRunCount: 1, featuredIndex: 0, lastAppliedJobId: "job-ig" })
    expect(byId.ig.generatedResults).toBeUndefined()
    expect(byId.ig.generatedImageUrl).toBeUndefined()
  })

  it("a passed-through scraper (saved data, no job) keeps the post the person picked", () => {
    const posts = [{ postId: "p1" }, { postId: "p2" }, { postId: "p3" }, { postId: "p4" }]
    mockNodes = [{ id: "ig", type: "instagram-scrape", data: { generatedJson: posts, featuredIndex: 3, viewFormat: "square" } }]
    streamBackendExecution("exec-pass", ctx, vi.fn(), vi.fn())
    const byId = sync({ ig: { status: "completed", output: { json: posts } } })
    expect(byId.ig).toMatchObject({ executionStatus: "completed", featuredIndex: 3, viewFormat: "square" })
    expect(byId.ig.lastAppliedJobId).toBeUndefined()
    expect(byId.ig.generatedResults).toBeUndefined()
  })

  it("a failed scraper keeps its last good posts; Meta Ads gets the same patch as Instagram", () => {
    const kept = [{ postId: "old" }]
    const ads = [{ adId: "a1" }]
    mockNodes = [
      { id: "ig", type: "instagram-scrape", data: { executionStatus: "running", generatedJson: kept } },
      { id: "meta", type: "meta-ads-scrape", data: { executionStatus: "running" } },
    ]
    streamBackendExecution("exec-mix", ctx, vi.fn(), vi.fn())
    const byId = sync({
      ig: { status: "failed", error: "blocked" },
      meta: { status: "completed", jobId: "job-m", output: { json: ads, imageUrl: "https://cdn.test/ad.jpg" } },
    })
    expect(byId.ig).toMatchObject({ executionStatus: "failed", generatedJson: kept })
    expect(byId.meta).toMatchObject({ executionStatus: "completed", generatedJson: ads, lastRunOutcome: "success", lastAppliedJobId: "job-m" })
    expect(byId.meta.generatedResults).toBeUndefined()
  })
})
