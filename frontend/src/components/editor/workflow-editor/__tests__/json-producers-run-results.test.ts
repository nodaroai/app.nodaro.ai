/**
 * The json producers A5.0 left unmapped (decided 2026-10-05): a server run's
 * result reaches each one's node — the fields its card and its output handles
 * read — through every lane that paints a run onto the canvas, and stays there
 * on reopen.
 *
 * The outputs are the server's own: `json-producer-run-outputs.json` is
 * computed by a backend test from the code a run goes through (the job-row
 * reader for the job-backed nodes, the inline executors for Extract Field and
 * JSON Process). Each test paints that output onto an empty node and checks
 * what the node reads, as the node's own canvas run writes it
 * (execute-node.ts / the scrapers' run-state modules).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults } from "@/hooks/use-workflow-persistence"
import { deriveWebScrapeCardState } from "@/components/nodes/web-scrape-run-state"
import { deriveMetaAdsScrapeCardState } from "@/components/nodes/meta-ads-scrape-run-state"
import { deriveInstagramScrapeCardState } from "@/components/nodes/instagram-scrape-run-state"
import { deriveSocialSearchCardState, socialSearchServerRunPatch } from "@/components/nodes/social-search-run-state"
import { paintRunStates } from "../run-handlers"
import { extractNodeOutput } from "../execution-graph"
import outputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/json-producer-run-outputs.json"

type Data = Record<string, unknown>
type Lane = (node: WorkflowNode, state: Data) => Data

const SERVER = outputs as Record<string, Data>
const JOB = "c0ffee00-0000-4000-8000-0000000000aa"
const ENDED = "2026-10-05T10:00:30.000Z"

/** A node that ran in the run. Job-backed nodes name their job; an inline node never has one. */
const ran = (output: Data, jobId: string | undefined = JOB): Data => ({
  status: "completed",
  startedAt: "2026-10-05T10:00:00.000Z",
  completedAt: "2026-10-05T10:00:20.000Z",
  ...(jobId ? { jobId } : {}),
  output,
})

const LANES: ReadonlyArray<readonly [string, Lane]> = [
  [
    "the live run",
    (node, state) => {
      act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
      act(() => paintRunStates({ [node.id]: state } as never))
      return useWorkflowStore.getState().nodes[0]!.data as Data
    },
  ],
  ["a reopen while it runs", (node, state) => applyBackendExecutionState([node], { [node.id]: state } as never)[0]!.data as Data],
  ["a reopen after it ended", (node, state) => applyCompletedExecutionResults([node], { [node.id]: state } as never, ENDED)[0]!.data as Data],
]

const nodeOf = (type: string, data: Data = {}): WorkflowNode =>
  ({ id: "n", type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe.each(LANES)("a server run's result, through %s", (_lane, paint) => {
  it("Web Scrape shows the pages it scraped", () => {
    const data = paint(nodeOf("web-scrape"), ran(SERVER["web-scrape"]!))
    expect(data.generatedJson).toEqual(SERVER["web-scrape"]!.json)
    expect(deriveWebScrapeCardState(data as never)).toMatchObject({ kind: "success", count: 2 })
    expect(data.lastAppliedJobId).toBe(JOB)
  })

  it("Meta Ads Scrape shows the ads, the first one featured", () => {
    const data = paint(nodeOf("meta-ads-scrape"), ran(SERVER["meta-ads-scrape"]!))
    expect(data.generatedJson).toEqual(SERVER["meta-ads-scrape"]!.json)
    expect(data.featuredIndex).toBe(0)
    expect(deriveMetaAdsScrapeCardState(data as never)).toMatchObject({ kind: "success", count: 2 })
  })

  it("Instagram Scrape shows the posts, the first one featured", () => {
    const data = paint(nodeOf("instagram-scrape"), ran(SERVER["instagram-scrape"]!))
    expect(data.generatedJson).toEqual(SERVER["instagram-scrape"]!.json)
    expect(data.featuredIndex).toBe(0)
    expect(deriveInstagramScrapeCardState(data as never)).toMatchObject({ kind: "success", count: 1 })
  })

  it("Social Search shows every post found and passes on the chosen ones", () => {
    const out = SERVER["social-search"]!
    const data = paint(nodeOf("social-search", { pickTop: 2 }), ran(out))
    expect(data.searchResults).toEqual(out.searchResults)
    expect(data.generatedJson).toEqual(out.json)
    expect(data.generatedText).toBe(out.text)
    expect(deriveSocialSearchCardState(data as never)).toMatchObject({ kind: "success", count: 3 })
    expect(data.lastAppliedJobId).toBe(JOB)
    // Its posts are never a text history the list readers would hand on instead.
    expect(data.generatedResults).toBeUndefined()
  })

  it("Describe to Picker holds the picker json it emitted", () => {
    const out = SERVER["describe-to-picker"]!
    const data = paint(nodeOf("describe-to-picker"), ran(out))
    expect(data.generatedPickerJson).toEqual(out.json)
    expect(extractNodeOutput(nodeOf("describe-to-picker", data), "picker-json")).toBe(JSON.stringify(out.json))
  })

  it("Extract Field (Text) holds the extracted text, and no list", () => {
    const out = SERVER["extract-field:text"]!
    const data = paint(nodeOf("extract-field", { field: "title" }), ran(out, undefined))
    expect(data.extractedText).toBe(out.extractedText)
    expect(data.generatedJson).toBeUndefined()
    expect(data.__listResults).toBeUndefined()
    expect(extractNodeOutput(nodeOf("extract-field", data))).toBe(out.extractedText)
  })

  it("Extract Field (List) holds the list its card counts and the next node runs on", () => {
    const out = SERVER["extract-field:list"]!
    const data = paint(nodeOf("extract-field", { field: "title", outputType: "list" }), ran(out, undefined))
    expect(data.extractedText).toBe(out.extractedText)
    expect(data.__listResults).toEqual(out.listResults)
    expect(data.__alignedListResults).toEqual(out.alignedListResults)
  })

  it("Extract Field (JSON) holds the structured value", () => {
    const out = SERVER["extract-field:json"]!
    const data = paint(nodeOf("extract-field", { field: "meta", outputType: "json" }), ran(out, undefined))
    expect(data.generatedJson).toEqual(out.json)
    expect(data.extractedText).toBe(out.extractedText)
  })

  it("JSON Process holds its processed result", () => {
    const out = SERVER["json-process"]!
    const data = paint(nodeOf("json-process"), ran(out, undefined))
    expect(data.processedResult).toEqual(out.processedResult)
    expect(data.__listResults).toEqual(out.listResults)
    expect(extractNodeOutput(nodeOf("json-process", data))).toBe(out.text)
  })
})

describe("on reopen", () => {
  it("a Social Search already showing the run keeps the person's picks (a reopen while it runs)", () => {
    const out = SERVER["social-search"]!
    const first = applyBackendExecutionState([nodeOf("social-search", { pickTop: 2 })], { n: ran(out) } as never)[0]!
    const picked = { ...(first.data as Data), pickedIds: ["p3"], generatedJson: [(out.searchResults as Data[])[2]] }
    const again = applyBackendExecutionState([{ ...first, data: picked } as WorkflowNode], { n: ran(out) } as never)[0]!.data as Data
    expect(again.pickedIds).toEqual(["p3"])
    expect(again.generatedJson).toEqual([(out.searchResults as Data[])[2]])
  })

  describe("a Social Search an older build painted live (no job stamp) keeps the picks made since", () => {
    // The old live lane painted the node with the browser's clock when the node
    // finished; the run settled minutes later (a video step after it), so the
    // timing guard alone reads the run as newer than the node's result.
    const SETTLED_LATE = "2026-10-05T10:05:00.000Z"
    const out = SERVER["social-search"]!
    const posts = out.searchResults as Data[]
    const paintedByOldBuild = (searchResults: Data[] = posts): WorkflowNode =>
      nodeOf("social-search", {
        pickTop: 2,
        ...socialSearchServerRunPatch({ pickTop: 2 } as never, { ...out, searchResults }),
        lastRunAt: Date.parse("2026-10-05T10:00:20.000Z"),
        pickedIds: ["p3"],
        generatedJson: [posts[2]],
      })
    const REOPENS: ReadonlyArray<readonly [string, (node: WorkflowNode) => Data]> = [
      ["a reopen after it ended", (node) => applyCompletedExecutionResults([node], { n: ran(out) } as never, SETTLED_LATE)[0]!.data as Data],
      ["a reopen on a canvas with a render", (node) => applyBackendExecutionState([node], { n: ran(out) } as never, { runId: "run-1", runEndedAt: SETTLED_LATE })[0]!.data as Data],
    ]

    it.each(REOPENS)("%s", (_lane, reopen) => {
      const data = reopen(paintedByOldBuild())
      expect(data.pickedIds).toEqual(["p3"])
      expect(data.generatedJson).toEqual([posts[2]])
      expect(data.searchResults).toEqual(posts)
      // Stamped now, so every later reopen short-circuits on the job.
      expect(data.lastAppliedJobId).toBe(JOB)
    })

    it.each(REOPENS)("%s: a node showing OTHER posts is still repainted with the run's", (_lane, reopen) => {
      const other = [{ ...posts[0], id: "zz" }] as Data[]
      const data = reopen(paintedByOldBuild(other))
      expect(data.searchResults).toEqual(posts)
      expect(data.pickedIds).toBeUndefined()
    })

    it("the live run still repaints a node already showing the same posts (a genuine rerun)", () => {
      const before = { ...(paintedByOldBuild().data as Data), lastRunOutcome: "failed" }
      const data = LANES[0]![1](nodeOf("social-search", before), ran(out))
      expect(data.lastRunOutcome).toBe("success")
      expect(data.lastAppliedJobId).toBe(JOB)
    })
  })

  it("a run that ended fills an empty node only: JSON Process and Describe to Picker keep what they hold", () => {
    const process = applyCompletedExecutionResults([nodeOf("json-process", { processedResult: { mine: true } })], { n: ran(SERVER["json-process"]!, undefined) } as never, ENDED)[0]!.data as Data
    expect(process.processedResult).toEqual({ mine: true })
    const describe = applyCompletedExecutionResults([nodeOf("describe-to-picker", { generatedPickerJson: { mine: true } })], { n: ran(SERVER["describe-to-picker"]!) } as never, ENDED)[0]!.data as Data
    expect(describe.generatedPickerJson).toEqual({ mine: true })
    const extract = applyCompletedExecutionResults([nodeOf("extract-field", { extractedText: "mine" })], { n: ran(SERVER["extract-field:text"]!, undefined) } as never, ENDED)[0]!.data as Data
    expect(extract.extractedText).toBe("mine")
  })

  it("a node the run only passed its saved data through writes nothing", () => {
    const seeded = { status: "completed", fromSavedData: true, output: SERVER["json-process"] }
    for (const [, paint] of LANES) {
      const data = paint(nodeOf("json-process", { processedResult: { mine: true } }), seeded)
      expect(data.processedResult).toEqual({ mine: true })
    }
  })
})
