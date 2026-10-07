/**
 * A server run of a json producer writes exactly what a canvas run of the same
 * node writes (decided 2026-10-05): the canvas run's write is the single
 * source of truth for the fields a result lands in.
 *
 * For every type in `JSON_RUN_RESULT_TYPES`, the node's REAL canvas executor
 * (`executeNode`) runs on the same job row (job-backed nodes) or the same
 * upstream data (inline nodes) the server run went through, and every field it
 * writes is recorded. The server's node output for that run (pinned by the
 * backend test `json-producer-run-outputs.test.ts`) is then painted through the
 * three lanes that land a server run on the canvas. A lane that writes a field
 * the canvas run never writes fails here — a text history in
 * `generatedResults`, a URL list added to it, `generatedText`, list counters.
 *
 * A new json producer fails until it has a canvas scenario below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

/** The job a job-backed node starts, and the row its poll then reads. */
const job = vi.hoisted(() => ({ row: undefined as unknown }))
const startJob = vi.hoisted(() => () => Promise.resolve({ jobId: "c0ffee00-0000-4000-8000-0000000000bb" }))
const describeResult = vi.hoisted(() => ({ value: undefined as unknown }))
/** What the feed's route answers a canvas run (the posts, their digest, the position). */
const feedRun = vi.hoisted(() => {
  const post = (id: number) => ({ id, channel: "acme", postUrl: `https://t.me/acme/${id}`, text: `post ${id}`, media: [] })
  const posts = [post(10), post(11)]
  const text = "post 10\n\n---\n\npost 11"
  return { jobId: "c0ffee00-0000-4000-8000-0000000000fe", posts, latestId: 11, text, generatedText: text, count: 2, cursor: { lastSeenId: 11, advanced: true, mode: "poll" as const, stateful: true } }
})
/** What the collection routes answer a canvas run: the records read / the record saved, beside the collection. */
const collectionRecord = vi.hoisted(() => (id: string) => ({
  id, collectionId: "c1", userId: "u1", dedupeKey: `https://news.example.test/${id}`, idempotencyKey: null,
  title: `Story ${id}`, text: `Body ${id}`, url: `https://news.example.test/${id}`, media: [], fields: {}, source: { via: "node" as const }, createdAt: "2026-10-06T08:00:00.000Z",
}))
const collectionReadRun = vi.hoisted(() => ({
  jobId: "c0ffee00-0000-4000-8000-0000000000c1", records: [collectionRecord("r1"), collectionRecord("r2")], text: "- Story r1\n- Story r2", count: 2, since: "2026-10-05T08:00:00.000Z", collection: { id: "c1", name: "articles" },
}))
/** What a post reader's route answers: the posts (the Social Search shape), their digest, the range read. */
const readerRun = vi.hoisted(() => {
  const post = (id: string) => ({ id, url: `https://media.example.test/post/${id}`, text: `post ${id}`, platform: "tiktok", author: { handle: `@${id}`, name: `Author ${id}` }, metrics: { likes: 1 }, media: {}, hashtags: [], extra: {} })
  return { jobId: "c0ffee00-0000-4000-8000-0000000000c3", posts: [post("p1"), post("p2")], text: "post p1\n\npost p2", count: 2, from: "2026-09-30T09:00:00.000Z", to: "2026-10-07T09:00:00.000Z" }
})
const collectionWriteRun = vi.hoisted(() => ({
  jobId: "c0ffee00-0000-4000-8000-0000000000c2", record: collectionRecord("r1"), outcome: "inserted" as const, evicted: 0, collection: { id: "c1", name: "articles" },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  describeToPickerApi: vi.fn(() => Promise.resolve(describeResult.value)),
  startVideoAnalysis: vi.fn(startJob),
  runVideoAudit: vi.fn(startJob),
  transcribeApi: vi.fn(startJob),
  textToDialogueApi: vi.fn(startJob),
  // The generic poll (pollJobWithNodeUpdate, Text to Dialogue) reads the row
  // through poll-job's OWN import of getJobStatusLean — the poll-job mock below
  // only reaches executors that import getJobStatusLeanForNode themselves — and
  // fetches a progress estimate before its first tick. Neither is under test.
  getJobStatusLean: vi.fn(() => Promise.resolve({ status: "completed", output_data: job.row })),
  getExecutionEstimate: vi.fn(() => Promise.resolve({ estimatedMs: 1_000 })),
  editPlan: vi.fn(startJob),
  silenceDetectApi: vi.fn(startJob),
  audioSyncApi: vi.fn(startJob),
  telegramChannelFetchApi: vi.fn(() => Promise.resolve(feedRun)),
  collectionReadApi: vi.fn(() => Promise.resolve(collectionReadRun)),
  collectionWriteApi: vi.fn(() => Promise.resolve(collectionWriteRun)),
  inspirationReadApi: vi.fn(() => Promise.resolve(readerRun)),
  competitorReadApi: vi.fn(() => Promise.resolve(readerRun)),
}))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  getJobStatusLeanForNode: vi.fn(() => Promise.resolve({ status: "completed", output_data: job.row })),
}))
/** What the node's wires hand it (the resolver is not what is under test). */
const wired = vi.hoisted(() => ({ inputs: {} as Record<string, unknown> }))
vi.mock("../node-input-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../node-input-resolver")>()),
  resolveNodeInputs: vi.fn(() => ({ ...wired.inputs })),
}))

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults } from "@/hooks/use-workflow-persistence"
import { JSON_RUN_RESULT_TYPES } from "@/lib/json-run-result"
import { executeNode } from "../execute-node"
import { paintRunStates } from "../run-handlers"
import { RESULTS_RUN_ENDED_AT_KEY, RESULTS_RUN_ID_KEY } from "../triggered-run-follow"
import serverOutputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/json-producer-run-outputs.json"
import jobRows from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/json-producer-job-rows.json"

type Data = Record<string, unknown>

const SERVER = serverOutputs as Record<string, Data>
const ROWS = jobRows as Record<string, Data>
const NODE = "n"
const MEDIA = "https://media.example.test/clip.mp4"
const PAGES = [
  { url: "https://site.example.test/a", title: "Page A", meta: { lang: "en" } },
  { url: "https://site.example.test/b", title: "Page B", meta: { lang: "fr" } },
]

/**
 * The bookkeeping a lane writes beside a result, none of it a result field:
 * the status (a canvas run writes it too, at its start and its end) and the
 * mark of the run a lane landed (a server run only, which names the run).
 */
const BOOKKEEPING: ReadonlySet<string> = new Set(["executionStatus", "jobAwaitingReview", RESULTS_RUN_ID_KEY, RESULTS_RUN_ENDED_AT_KEY])
const RUN = { runId: "run-1", runEndedAt: "2026-10-05T10:00:30.000Z" }

interface Scenario {
  /** The node's own settings (same on the canvas and on the server). */
  readonly data?: Data
  /** What its wires hand it on the canvas. */
  readonly inputs?: Data
  /** Inline nodes read their upstream node off the canvas. */
  readonly upstream?: boolean
  /** Describe to Picker returns its result from the request itself. */
  readonly describe?: unknown
  /** Downstream nodes (Describe to Picker needs a picker to fill). */
  readonly downstream?: ReadonlyArray<{ readonly type: string; readonly sourceHandle: string }>
}

/** One canvas run per case the server fixture pins. Key: `type` or `type:case`. */
const SCENARIOS: Record<string, Scenario> = {
  "describe-to-picker": {
    inputs: { imageUrl: "https://media.example.test/still.png" },
    describe: { pickerJson: (ROWS["describe-to-picker"] as Data).json, gaps: [] },
    downstream: [{ type: "person", sourceHandle: "picker-json" }],
  },
  "edit-plan": {
    data: { mode: "tighten" },
    inputs: {
      transcript: JSON.stringify((ROWS.transcribe as Data).json),
      editPlanSources: [{ nodeId: "rec", url: "https://media.example.test/rec.m4a", kind: "audio", label: "Recording" }],
    },
  },
  transcribe: { inputs: { audioUrl: "https://media.example.test/rec.m4a" } },
  // Text to Dialogue: its lines are its own data; the job row carries the audio and the model's timings.
  "text-to-dialogue": { data: { dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }, { id: "2", text: "Hello.", voice: "George" }], stability: 0.5, languageCode: "" } },
  "silence-detect": { inputs: { audioUrl: "https://media.example.test/rec.m4a" } },
  "audio-sync": {
    inputs: { audioSyncSources: [{ nodeId: "cam-a", url: MEDIA }, { nodeId: "cam-b", url: "https://media.example.test/b.mp4" }] },
  },
  "video-analysis": { inputs: { videoUrl: MEDIA } },
  "video-audit": { inputs: { videoUrl: MEDIA } },
  "extract-field:text": { data: { field: "title" }, upstream: true },
  "extract-field:list": { data: { field: "title", outputType: "list" }, upstream: true },
  "extract-field:url-list": { data: { field: "url", outputType: "list" }, upstream: true },
  "extract-field:json": { data: { field: "meta", outputType: "json" }, upstream: true },
  "json-process": { data: { mode: "visual", inputPath: "", filters: [], projections: ["title"] }, upstream: true },
  // The feed answers from its route directly (no job to poll); its posts land on generatedJson, the digest on generatedText.
  "telegram-channel-feed": { data: { channel: "acme", limit: 5 } },
  // Both collection nodes answer from their route directly: the records / the record on generatedJson, the digest / headline on generatedText.
  "collection-read": { data: { collectionId: "c1", windowAmount: 24, windowUnit: "hours", limit: 50, order: "newest", textFormat: "headlines" } },
  "collection-write": { data: { collectionId: "c1" }, inputs: { prompt: JSON.stringify({ title: "Story r1", url: "https://news.example.test/r1" }) } },
  // The post readers answer from their route directly: the posts on generatedJson, the digest on generatedText.
  "inspiration-read": { data: { platform: "all", tag: "", period: "window", windowAmount: 7, windowUnit: "days", limit: 20, order: "newest" } },
  "competitor-read": { data: { competitorId: "b1", platform: "all", role: "all", period: "window", windowAmount: 7, windowUnit: "days", limit: 20, order: "newest" } },
}

const typeOf = (key: string) => key.split(":")[0]!

const nodeOf = (type: string, data: Data = {}): WorkflowNode =>
  ({ id: NODE, type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode

function makeCtx() {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: unknown) => i,
    untrackInterval: (i: unknown) => clearInterval(i as ReturnType<typeof setInterval>),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
  } as never
}

/** Every field a canvas run of the scenario writes onto the node. */
async function canvasRunFields(key: string): Promise<Set<string>> {
  const s = SCENARIOS[key]!
  const type = typeOf(key)
  const node = nodeOf(type, s.data)
  const nodes: WorkflowNode[] = [node]
  const edges: WorkflowEdge[] = []
  if (s.upstream) {
    nodes.unshift({ id: "src", type: "web-scrape", position: { x: 0, y: 0 }, data: { label: "Scrape", generatedJson: PAGES } } as unknown as WorkflowNode)
    edges.push({ id: "e-in", source: "src", target: NODE, sourceHandle: "json", targetHandle: "in" } as WorkflowEdge)
  }
  for (const [i, d] of (s.downstream ?? []).entries()) {
    nodes.push({ id: `d${i}`, type: d.type, position: { x: 0, y: 0 }, data: { label: d.type } } as unknown as WorkflowNode)
    edges.push({ id: `e-out${i}`, source: NODE, target: `d${i}`, sourceHandle: d.sourceHandle, targetHandle: "in" } as WorkflowEdge)
  }
  wired.inputs = { ...(s.inputs ?? {}) }
  job.row = ROWS[type]
  describeResult.value = s.describe

  const fields = new Set<string>()
  const write = useWorkflowStore.getState().updateNodeData
  act(() =>
    useWorkflowStore.setState({
      nodes,
      edges,
      updateNodeData: (id: string, patch: Partial<Data>) => {
        if (id === NODE) for (const k of Object.keys(patch)) fields.add(k)
        write(id, patch as never)
      },
    } as never),
  )
  const run = executeNode(useWorkflowStore.getState().nodes.find((n) => n.id === NODE)!, makeCtx())
  await vi.advanceTimersByTimeAsync(2_100)
  await run
  act(() => useWorkflowStore.setState({ updateNodeData: write } as never))
  expect(useWorkflowStore.getState().nodes.find((n) => n.id === NODE)!.data.executionStatus, `${key}: the canvas run completed`).toBe("completed")
  return fields
}

const ran = (output: Data): Data => ({
  status: "completed",
  startedAt: "2026-10-05T10:00:00.000Z",
  completedAt: "2026-10-05T10:00:20.000Z",
  jobId: "c0ffee00-0000-4000-8000-0000000000aa",
  output,
})

const LANES: ReadonlyArray<readonly [string, (node: WorkflowNode, state: Data) => Data]> = [
  [
    "the live run",
    (node, state) => {
      act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
      act(() => paintRunStates({ [node.id]: state } as never, { runId: RUN.runId }))
      return useWorkflowStore.getState().nodes[0]!.data as Data
    },
  ],
  ["a reopen while it runs", (node, state) => applyBackendExecutionState([node], { [node.id]: state } as never, RUN)[0]!.data as Data],
  ["a reopen after it ended", (node, state) => applyCompletedExecutionResults([node], { [node.id]: state } as never, "2026-10-05T10:00:30.000Z")[0]!.data as Data],
]

/** The fields a lane wrote: added, or changed from what the node held. */
function writtenBy(before: Data, after: Data): string[] {
  return Object.keys(after).filter((k) => !(k in before) || after[k] !== before[k])
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("every json producer has a canvas run to hold its server runs to", () => {
  it.each([...JSON_RUN_RESULT_TYPES])("%s", (type) => {
    expect(Object.keys(SCENARIOS).map(typeOf), `add a canvas scenario for ${type}`).toContain(type)
    for (const key of Object.keys(SCENARIOS).filter((k) => typeOf(k) === type)) {
      expect(SERVER[key], `pin the server output for ${key} in json-producer-run-outputs.json`).toBeDefined()
    }
  })
})

describe.each(Object.keys(SCENARIOS))("%s: a server run writes no field its canvas run does not", (key) => {
  it.each(LANES)("through %s", async (_lane, paint) => {
    const canvas = await canvasRunFields(key)
    const node = nodeOf(typeOf(key), SCENARIOS[key]!.data)
    const before = node.data as Data
    const after = paint(node, ran(SERVER[key]!))
    const extra = writtenBy(before, after).filter((k) => !canvas.has(k) && !BOOKKEEPING.has(k))
    expect(extra, `${key}: written by the server lane, never by a canvas run (canvas writes: ${[...canvas].sort().join(", ")})`).toEqual([])
  })
})
