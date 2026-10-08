/**
 * THE PRE-RUN VIDEO URL FETCH — REAL orchestrator path (decided 2026-10-08).
 *
 * A run whose request points a Video URL node at a post link (an MCP / SDK / API
 * caller, an app input) reaches the nodes after it as a web page unless the
 * server fetches what they read first. These tests drive the REAL
 * `processWorkflowExecution` (real seeding, real executable filter, the real
 * resolver feeding `executeNode`) with only the downloader's leaves mocked, and
 * assert BEHAVIOR: the node after the link was handed the FILE made from the
 * link, a link that cannot be fetched fails the execution before any node
 * dispatches, and the files are pinned so a continued run does not fetch again.
 *
 * Harness mirrors transcribe-preflight-orchestrator.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { Job } from "bullmq"
import type { WorkflowExecutionJob } from "../../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Mocks — leaf I/O only.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const executeNodeCalls: string[] = []
  const executeNode = vi.fn(async (node: { id: string }, _resolved?: Record<string, unknown>, _edges?: unknown, _all?: unknown) => {
    executeNodeCalls.push(node.id)
    return { output: { text: "x" }, creditsUsed: 0 }
  })
  const fetchDeps = {
    probe: vi.fn(),
    downloadVideo: vi.fn(),
    downloadAudio: vi.fn(),
  }
  const pin = vi.fn().mockResolvedValue(undefined)
  // The files a run fetched, kept on its execution (decided 2026-10-08): one record per execution id.
  const recordedFiles: Record<string, Record<string, unknown>> = {}
  const loadFiles = vi.fn(async (executionId: string, _userId: string) => recordedFiles[executionId] ?? {})
  const saveFiles = vi.fn().mockResolvedValue(undefined)
  const continuationSource: { current: Record<string, unknown> | null } = { current: null }

  const updateExecutionWithRetry = vi.fn().mockResolvedValue({ ok: true, cancelledRace: false, attempts: 1 })

  let workflowRow: Record<string, unknown> | null = null
  const control = { status: "running" as string }
  const execSelectRow: { status: string; node_states: Record<string, unknown> } = { status: "queued", node_states: {} }

  function makeChain(table: string, columns?: string) {
    const result = (() => {
      if (table === "workflows") return { data: workflowRow, error: workflowRow ? null : { message: "nf" } }
      if (table === "profiles") return { data: { prompt_templates: null, tier: "pro" }, error: null }
      if (table === "workflow_executions" && columns === "status") return { data: { status: control.status }, error: null }
      if (table === "workflow_executions" && columns === "status, node_states")
        return { data: execSelectRow, error: null }
      return { data: null, error: null }
    })()
    const single = vi.fn().mockResolvedValue(result)
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqInner = { single, maybeSingle, eq: vi.fn() }
    eqInner.eq = vi.fn().mockReturnValue(eqInner)
    const eq = vi.fn().mockReturnValue(eqInner)
    return {
      select: vi.fn().mockReturnValue({ eq, single, maybeSingle, is: vi.fn().mockReturnValue({ single, eq }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) }),
    }
  }

  const from = vi.fn((table: string) => ({
    select: (columns?: string) => makeChain(table, columns).select(columns),
    update: () => makeChain(table).update(),
    insert: () => makeChain(table).insert(),
  }))

  return {
    executeNode,
    fetchDeps,
    pin,
    recordedFiles,
    loadFiles,
    saveFiles,
    continuationSource,
    executeNodeCalls,
    updateExecutionWithRetry,
    control,
    execSelectRow,
    from,
    setWorkflowRow: (row: Record<string, unknown>) => {
      workflowRow = row
    },
  }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    REDIS_URL: "redis://localhost:6379",
    ORCHESTRATOR_CONCURRENCY: 2,
    MAX_CONCURRENT_NODES_PER_EXECUTION: 12,
  },
  hasCredits: () => false,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/services/workflow-engine/node-executor.js", () => ({
  executeNode: mocks.executeNode,
  loadCompletedFanOutIterations: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("@/lib/reconcile/node-states.js", () => ({
  reconcileNodeStatesFromJobs: vi.fn(async (states: unknown) => ({ next: states, changed: false })),
}))

vi.mock("@/lib/reconcile/cancel-inflight-jobs.js", () => ({
  cancelInFlightChildJobs: vi.fn().mockResolvedValue({ cancelled: 0, adoptable: new Map() }),
}))

vi.mock("@/lib/execution-writes.js", () => ({
  updateExecutionWithRetry: mocks.updateExecutionWithRetry,
}))

vi.mock("@/services/execution-stats.js", () => ({
  buildStatsKey: vi.fn().mockReturnValue(null),
  upsertExecutionStats: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/execution-input-overrides.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/execution-input-overrides.js")>()),
  pinExecutionInputOverrides: mocks.pin,
}))

vi.mock("@/lib/execution-video-link-files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/execution-video-link-files.js")>()),
  loadExecutionVideoLinkFiles: mocks.loadFiles,
  saveExecutionVideoLinkFiles: mocks.saveFiles,
}))

vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/workflow-engine/run-continuation.js")>()),
  loadContinuationSource: vi.fn(async () => mocks.continuationSource.current),
}))

vi.mock("@/services/workflow-engine/video-link-fetch-deps.js", () => ({ realVideoLinkFetchDeps: mocks.fetchDeps }))

import { processWorkflowExecution } from "../orchestrator-worker.js"
import { DrainAbortError, beginWorkerDrain, _resetWorkerDrainForTests } from "../../lib/worker-drain.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const CREATOR_YT = "https://youtu.be/AAAAAAAAAAA"
const CREATOR_FILE = "https://cdn.nodaro.ai/videos/creator-sample.mp4"
const FILE = "https://cdn.nodaro.ai/videos/yt-1.mp4"
const AUDIO = "https://cdn.nodaro.ai/audios/cover-src-1.mp3"

/** src (Video URL, the creator's sample downloaded) --video--> consumer. */
function makeJob(opts: {
  consumer?: string
  overrides?: Record<string, Record<string, unknown>>
  appVersionId?: string
  continueFromExecutionId?: string
  nodeIds?: string[]
  /** Replaces the Video URL node's saved data (the workflow as its creator saved it). */
  savedData?: Record<string, unknown>
  /** Adds `done1`, a second consumer (unlinked), for a persisted state to carry forward. */
  withDoneNode?: boolean
} = {}): Job<WorkflowExecutionJob> {
  mocks.setWorkflowRow({
    nodes: [
      {
        id: "src",
        type: "youtube-video",
        data: opts.savedData ?? { label: "Episode", youtubeUrl: CREATOR_YT, downloadedVideoUrl: CREATOR_FILE, downloadedFromUrl: CREATOR_YT, downloadedAudioUrl: "https://cdn.nodaro.ai/audios/creator.mp3" },
      },
      { id: "c1", type: opts.consumer ?? "video-analysis", data: {} },
      ...(opts.withDoneNode ? [{ id: "done1", type: "video-analysis", data: {} }] : []),
    ],
    edges: [{ id: "e1", source: "src", target: "c1", sourceHandle: "video", targetHandle: "video" }],
    settings: {},
    user_id: "owner-1",
  })
  return {
    data: {
      executionId: "exec-1",
      workflowId: "wf-1",
      userId: "runner-1",
      triggerType: "manual",
      ...(opts.overrides ? { inputOverrides: opts.overrides } : {}),
      ...(opts.appVersionId ? { appVersionId: opts.appVersionId } : {}),
      ...(opts.continueFromExecutionId ? { continueFromExecutionId: opts.continueFromExecutionId } : {}),
      ...(opts.nodeIds ? { nodeIds: opts.nodeIds } : {}),
    },
  } as unknown as Job<WorkflowExecutionJob>
}

function failedWrite(): { error_message?: string } | undefined {
  const call = mocks.updateExecutionWithRetry.mock.calls.find(
    ([, updates]) => (updates as { status?: string })?.status === "failed",
  )
  return call?.[1] as { error_message?: string } | undefined
}

const handedTo = (id: string) => mocks.executeNode.mock.calls.find(([node]) => node.id === id)?.[1] as Record<string, unknown> | undefined

beforeEach(() => {
  mocks.control.status = "running"
  mocks.execSelectRow.node_states = {}
  _resetWorkerDrainForTests()
  mocks.executeNode.mockClear()
  mocks.executeNodeCalls.length = 0
  mocks.updateExecutionWithRetry.mockClear()
  mocks.pin.mockClear()
  mocks.saveFiles.mockClear()
  mocks.loadFiles.mockClear()
  for (const key of Object.keys(mocks.recordedFiles)) delete mocks.recordedFiles[key]
  mocks.continuationSource.current = null
  mocks.fetchDeps.probe.mockReset().mockResolvedValue({ durationSec: 120, title: "T", isLive: false })
  mocks.fetchDeps.downloadVideo.mockReset().mockResolvedValue({ videoUrl: FILE })
  mocks.fetchDeps.downloadAudio.mockReset().mockResolvedValue(AUDIO)
})

describe("orchestrator pre-run fetch — a post link the run's request set on a Video URL node", () => {
  it("downloads the video under the card's rules, and the node after the link is handed the FILE, not the page", async () => {
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: YT, userId: "runner-1", maxHeight: 1080 }))
    expect(failedWrite()).toBeUndefined()
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  it("pins the file with the rest of the overrides, so a continued run reads the same file and does not fetch again", async () => {
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))

    const pinned = mocks.pin.mock.calls.at(-1)?.[1] as Record<string, Record<string, unknown>>
    expect(pinned.src).toEqual({ youtubeUrl: YT, downloadedVideoUrl: FILE, downloadedFromUrl: YT })
  })

  it("a long YouTube video with no part named fails the execution BEFORE any node dispatches", async () => {
    mocks.fetchDeps.probe.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message).toMatch(/sectionStartSec/)
  })

  it("the part the request names is the part downloaded, exactly", async () => {
    mocks.fetchDeps.probe.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT, sectionStartSec: 600, sectionEndSec: 1200 } } }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledWith(
      expect.objectContaining({ url: YT, section: { startSec: 600, endSec: 1200, exact: true } }),
    )
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  it("a download that fails fails the execution with the reason, before any node dispatches", async () => {
    mocks.fetchDeps.downloadVideo.mockRejectedValue(new Error("Video unavailable: this video is private"))
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toMatch(/this video is private/)
  })

  it("only Transcribe after the link: just the sound is fetched, and that is what Transcribe reads", async () => {
    await processWorkflowExecution(makeJob({ consumer: "transcribe", overrides: { src: { youtubeUrl: YT } } }))

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(mocks.fetchDeps.probe).not.toHaveBeenCalled()
    expect(mocks.fetchDeps.downloadAudio).toHaveBeenCalledWith(YT, expect.objectContaining({ userId: "runner-1" }))
    expect(failedWrite()).toBeUndefined()
    // …onto the node Transcribe reads it from (not the creator's old track under the caller's link).
    const allNodes = mocks.executeNode.mock.calls.find(([node]) => node.id === "c1")?.[3] as Array<{ id: string; data: Record<string, unknown> }>
    expect(allNodes.find((n) => n.id === "src")?.data.downloadedAudioUrl).toBe(AUDIO)
  })

  it("a direct or any other web link is passed through untouched — nothing is fetched", async () => {
    await processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: "https://cdn.example.com/stream/ep-12" } } }))

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(handedTo("c1")?.videoUrl).toBe("https://cdn.example.com/stream/ep-12")
  })

  it("a run whose request set no link, on a node whose saved file belongs to its saved link, fetches nothing (the creator's file stands)", async () => {
    await processWorkflowExecution(makeJob({ overrides: { c1: { label: "x" } } }))

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(mocks.fetchDeps.probe).not.toHaveBeenCalled()
    expect(handedTo("c1")?.videoUrl).toBe(CREATOR_FILE)
  })

  it("a request that carries the file the runner's card made (its own download) is not fetched again", async () => {
    await processWorkflowExecution(
      makeJob({ overrides: { src: { youtubeUrl: YT, downloadedVideoUrl: "https://cdn.nodaro.ai/videos/runner.mp4", downloadedFromUrl: YT } } }),
    )

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(handedTo("c1")?.videoUrl).toBe("https://cdn.nodaro.ai/videos/runner.mp4")
  })
})

describe("orchestrator pre-run fetch — a post link SAVED in the workflow (decided 2026-10-08)", () => {
  const saved = { label: "Episode", youtubeUrl: YT }

  it("is downloaded under the run's account when the run needs the file — an owner's API run with no overrides at all", async () => {
    await processWorkflowExecution(makeJob({ savedData: saved }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: YT, userId: "runner-1", maxHeight: 1080 }))
    expect(failedWrite()).toBeUndefined()
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  it("is not pinned: the Render final lock refuses a downloaded-file field on a node the request did not name", async () => {
    await processWorkflowExecution(makeJob({ savedData: saved }))

    const pinned = (mocks.pin.mock.calls.at(-1)?.[1] ?? {}) as Record<string, Record<string, unknown>>
    expect(pinned.src).toBeUndefined()
  })

  it("a long saved YouTube video with no saved part fails the execution BEFORE any node dispatches, naming the part and saying nothing was charged", async () => {
    mocks.fetchDeps.probe.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })
    await processWorkflowExecution(makeJob({ savedData: saved }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(failedWrite()?.error_message).toMatch(/sectionStartSec/)
    expect(failedWrite()?.error_message).toMatch(/sectionEndSec/)
    expect(failedWrite()?.error_message).toMatch(/nothing was charged/i)
  })

  it("a saved part is the part downloaded", async () => {
    mocks.fetchDeps.probe.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })
    await processWorkflowExecution(makeJob({ savedData: { ...saved, sectionStartSec: 600, sectionEndSec: 1200 } }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ section: { startSec: 600, endSec: 1200, exact: true } }))
  })

  it("only Transcribe after a saved link: just the sound", async () => {
    await processWorkflowExecution(makeJob({ consumer: "transcribe", savedData: saved }))

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(mocks.fetchDeps.downloadAudio).toHaveBeenCalledWith(YT, expect.objectContaining({ userId: "runner-1" }))
  })
})

/** A download that only ends when the run's signal aborts it; `onStart` fires once it is in flight. */
function hangUntilAborted(onStart: () => void) {
  return ({ signal }: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      onStart()
    })
}

const writtenStatuses = () => mocks.updateExecutionWithRetry.mock.calls.map(([, updates]) => (updates as { status?: string }).status)

describe("orchestrator pre-run fetch — a stop that reaches the download", () => {
  it("a deploy drain mid-fetch parks the job (DrainAbortError) and writes NOTHING to the execution", async () => {
    mocks.fetchDeps.downloadVideo.mockImplementation(hangUntilAborted(() => beginWorkerDrain()))

    await expect(processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))).rejects.toBeInstanceOf(DrainAbortError)

    expect(writtenStatuses().filter((st) => st === "failed" || st === "cancelled" || st === "discarded")).toEqual([])
    expect(mocks.executeNodeCalls).toEqual([])
    expect(mocks.pin).toHaveBeenCalledTimes(1) // the overrides' own pin, before the fetch — not a pin of any file
  })

  it("a Discard Run mid-fetch keeps the discarded status, not cancelled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    try {
      mocks.fetchDeps.downloadVideo.mockImplementation(hangUntilAborted(() => { mocks.control.status = "discarded" }))
      const run = processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))
      await vi.advanceTimersByTimeAsync(3100)
      await run
    } finally {
      vi.useRealTimers()
    }

    expect(writtenStatuses()).toContain("discarded")
    expect(writtenStatuses()).not.toContain("cancelled")
    expect(mocks.executeNodeCalls).toEqual([])
  })

  it("a cancelled run mid-fetch still ends cancelled", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    try {
      mocks.fetchDeps.downloadVideo.mockImplementation(hangUntilAborted(() => { mocks.control.status = "cancelled" }))
      const run = processWorkflowExecution(makeJob({ overrides: { src: { youtubeUrl: YT } } }))
      await vi.advanceTimersByTimeAsync(3100)
      await run
    } finally {
      vi.useRealTimers()
    }

    expect(writtenStatuses()).toContain("cancelled")
    expect(writtenStatuses()).not.toContain("discarded")
  })
})

// ---------------------------------------------------------------------------
// The fetched files are KEPT ON THE EXECUTION (decided 2026-10-08)
// ---------------------------------------------------------------------------

const SAVED = { label: "Episode", youtubeUrl: YT }
const recordedVideo = { link: YT, data: { downloadedVideoUrl: FILE, downloadedFromUrl: YT, downloadStatus: "completed", downloadedSection: null } }
const finishedSource = (over: Record<string, unknown> = {}) => ({
  id: "exec-0",
  userId: "runner-1",
  workflowId: "wf-1",
  status: "completed",
  appVersionId: null,
  inputOverrides: null,
  nodeStates: {},
  ...over,
})

describe("a link saved in the workflow and fetched by the server is kept on the execution", () => {
  it("a run that fetched the video writes what it fetched, with the link it was fetched for, on ITS execution", async () => {
    await processWorkflowExecution(makeJob({ savedData: SAVED }))

    expect(mocks.saveFiles).toHaveBeenCalledTimes(1)
    const [executionId, files] = mocks.saveFiles.mock.calls[0]! as [string, Record<string, { link: string; data: Record<string, unknown> }>]
    expect(executionId).toBe("exec-1")
    expect(files.src!.link).toBe(YT)
    expect(files.src!.data).toMatchObject({ downloadedVideoUrl: FILE, downloadedFromUrl: YT })
  })

  it("the sound a request-set link needed is kept too — the run lock admits no audio field, so the pin could not hold it", async () => {
    await processWorkflowExecution(makeJob({ consumer: "transcribe", overrides: { src: { youtubeUrl: YT } } }))

    const files = mocks.saveFiles.mock.calls[0]![1] as Record<string, { link: string; data: Record<string, unknown> }>
    expect(files.src).toMatchObject({ link: YT, data: { downloadedAudioUrl: AUDIO } })
  })

  it("a run that fetched nothing saves nothing", async () => {
    await processWorkflowExecution(makeJob({ overrides: { c1: { label: "x" } } }))

    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(mocks.saveFiles).not.toHaveBeenCalled()
  })

  it("a run with no post link in its graph does not even read a record", async () => {
    await processWorkflowExecution(makeJob({ savedData: { label: "Episode", youtubeUrl: CREATOR_FILE } }))

    expect(mocks.loadFiles).not.toHaveBeenCalled()
    expect(mocks.saveFiles).not.toHaveBeenCalled()
  })

  it("is NOT pinned in the overrides: the pin stays what the run lock admits", async () => {
    await processWorkflowExecution(makeJob({ savedData: SAVED }))

    const pinned = (mocks.pin.mock.calls.at(-1)?.[1] ?? {}) as Record<string, Record<string, unknown>>
    expect(pinned.src).toBeUndefined()
  })

  it("a repeated run is a new execution with no record: it fetches fresh", async () => {
    await processWorkflowExecution(makeJob({ savedData: SAVED }))
    await processWorkflowExecution(makeJob({ savedData: SAVED }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledTimes(2)
  })
})

describe("a continuation (Render final) reuses what the run it continues fetched", () => {
  const continued = (over: Parameters<typeof makeJob>[0] = {}) =>
    makeJob({ savedData: SAVED, continueFromExecutionId: "exec-0", nodeIds: ["c1"], ...over })

  it("does not fetch again, and the node after the link is handed the SAME file", async () => {
    mocks.continuationSource.current = finishedSource()
    mocks.recordedFiles["exec-0"] = { src: recordedVideo }

    await processWorkflowExecution(continued())

    expect(mocks.fetchDeps.probe).not.toHaveBeenCalled()
    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(failedWrite()).toBeUndefined()
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  it("reads the record of the execution it continues from, as the user who runs it (ownership-checked like the other execution reads)", async () => {
    mocks.continuationSource.current = finishedSource()
    mocks.recordedFiles["exec-0"] = { src: recordedVideo }

    await processWorkflowExecution(continued())

    expect(mocks.loadFiles).toHaveBeenCalledWith("exec-0", "runner-1")
  })

  it("never reads the record of an execution the continuation is refused for (another user's reads as not found)", async () => {
    mocks.continuationSource.current = finishedSource({ userId: "someone-else" })
    mocks.recordedFiles["exec-0"] = { src: recordedVideo }

    await processWorkflowExecution(continued())

    expect(mocks.loadFiles).not.toHaveBeenCalledWith("exec-0", expect.anything())
    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(mocks.executeNodeCalls).toEqual([])
  })

  it("keeps the record on the continuation's own execution, so a further continuation or a re-pick still finds it", async () => {
    mocks.continuationSource.current = finishedSource()
    mocks.recordedFiles["exec-0"] = { src: recordedVideo }

    await processWorkflowExecution(continued())

    expect(mocks.saveFiles).toHaveBeenCalledWith("exec-1", { src: recordedVideo })
  })

  it("a record made for another link is not used: the continuation's request pointed the node somewhere else", async () => {
    mocks.continuationSource.current = finishedSource()
    mocks.recordedFiles["exec-0"] = { src: recordedVideo }

    await processWorkflowExecution(continued({ overrides: { src: { youtubeUrl: "https://www.tiktok.com/@someone/video/7676964064458738952" } } }))

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ url: "https://www.tiktok.com/@someone/video/7676964064458738952" }))
  })

  it("no record on the earlier execution (made before the column, or it fetched nothing): fetches like a run would", async () => {
    mocks.continuationSource.current = finishedSource()

    await processWorkflowExecution(continued())

    expect(mocks.fetchDeps.downloadVideo).toHaveBeenCalledTimes(1)
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  it("when the fetch is refused in a continuation, the message does not say nothing was charged — the preview was", async () => {
    mocks.continuationSource.current = finishedSource()
    mocks.fetchDeps.probe.mockResolvedValue({ durationSec: 5530, title: null, isLive: false })

    await processWorkflowExecution(continued())

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toMatch(/sectionStartSec/)
    expect(failedWrite()?.error_message).not.toMatch(/nothing was charged/i)
    expect(failedWrite()?.error_message).toMatch(/nothing more was charged/i)
  })
})

describe("a re-pick of the same execution (a deploy drain, a crash) reuses what its earlier attempt fetched", () => {
  it("reads the execution's own record and does not fetch again", async () => {
    mocks.recordedFiles["exec-1"] = { src: recordedVideo }

    await processWorkflowExecution(makeJob({ savedData: SAVED }))

    expect(mocks.loadFiles).toHaveBeenCalledWith("exec-1", "runner-1")
    expect(mocks.fetchDeps.downloadVideo).not.toHaveBeenCalled()
    expect(handedTo("c1")?.videoUrl).toBe(FILE)
  })

  // A re-pick is not a continuation, but it can carry forward nodes the earlier attempt ran and charged
  // (decided 2026-10-08): a refusal on it must not claim nothing was charged.
  const unreadableLength = () => mocks.fetchDeps.probe.mockResolvedValue({ durationSec: null, title: null, isLive: false })

  it("a refusal on a re-pick that carried charged nodes forward does not claim nothing ran or was charged", async () => {
    mocks.execSelectRow.node_states = { done1: { status: "completed", output: { text: "x" } } }
    unreadableLength()

    await processWorkflowExecution(makeJob({ savedData: SAVED, withDoneNode: true }))

    expect(mocks.executeNodeCalls).toEqual([])
    expect(failedWrite()?.error_message).toMatch(/length couldn't be read/)
    expect(failedWrite()?.error_message).not.toMatch(/nothing ran/i)
    expect(failedWrite()?.error_message).not.toMatch(/nothing was charged/i)
    expect(failedWrite()?.error_message).toMatch(/This step did not run/)
  })

  it("a first run (nothing carried forward) keeps the first-run wording", async () => {
    unreadableLength()

    await processWorkflowExecution(makeJob({ savedData: SAVED, withDoneNode: true }))

    expect(failedWrite()?.error_message).toMatch(/Nothing ran and nothing was charged/)
  })
})
