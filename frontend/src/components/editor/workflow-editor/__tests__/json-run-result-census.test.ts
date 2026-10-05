/**
 * The editor half of the json census (A5.0).
 *
 * `saved-json-producers.json` is COMPUTED by a backend test
 * (`saved-json-producers.test.ts`): every node type whose saved json the engine
 * hands downstream, and the field it reads it from. For each one, a server run's
 * json must reach that field through every lane that paints a run onto the
 * canvas — or the next Run from here seeds a stale value. This holds the three
 * node-state lanes to the whole list:
 *   - the live run (`syncNodeStatesToStore`, via `paintRunStates`),
 *   - a reopen while the run is still going (`applyBackendExecutionState`),
 *   - a reopen after it ended (`applyCompletedExecutionResults`, onto an empty node).
 *
 * A type the census finds that a lane does not map yet is listed in NOT_YET
 * with why. That list only shrinks: an entry whose lane now lands the json
 * fails here until it is removed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults } from "@/hooks/use-workflow-persistence"
import { JSON_RUN_RESULT_TYPES } from "@/lib/json-run-result"
import { paintRunStates } from "../run-handlers"
import census from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/saved-json-producers.json"

type Data = Record<string, unknown>
type Lane = "live" | "reopen-running" | "reopen-ended"

const MARK = "editor-json-census"
const JSON_OBJECT = { version: 1, marker: MARK, words: [{ text: MARK, startMs: 0, endMs: 1 }] }
const POST = { id: MARK, url: `https://media.example.test/${MARK}`, text: MARK, platform: "tiktok", author: { handle: MARK, name: MARK }, metrics: {}, media: {}, hashtags: [], extra: {} }

/**
 * What a server run of the type hands the editor (the backend's node output for
 * it), when the bare `{ json }` is not enough for its mapping to recognise a
 * result. Every other type gets `{ json: JSON_OBJECT }`.
 */
const RUN_OUTPUT: Record<string, Data> = {
  // A render names exactly one medium; its json is the transcript remapped through the cut.
  "apply-edl": { audioUrl: "https://media.example.test/cut.m4a", json: JSON_OBJECT },
  // The plain transcript rides beside the json.
  transcribe: { text: MARK, json: JSON_OBJECT },
  "content-recipe": { json: JSON_OBJECT, text: MARK },
  "content-ideas": { json: [JSON_OBJECT], text: MARK, listResults: [MARK] },
  // Every post found, and the ones passed on (json).
  "social-search": { json: [POST], searchResults: [POST], text: MARK, listResults: [JSON.stringify(POST)] },
}
const outputOf = (type: string): Data => RUN_OUTPUT[type] ?? { json: JSON_OBJECT }

/** Found by the census, not landed by that lane yet — and why. Shrink only. */
const NOT_YET: Record<string, { readonly lanes: readonly Lane[]; readonly why: string }> = {
  "web-scrape": { lanes: ["live", "reopen-running", "reopen-ended"], why: "scrapes land through scrapeResultPatch (kept-last-good, lastAppliedJobId), which only the job lanes call" },
  "meta-ads-scrape": { lanes: ["live", "reopen-running", "reopen-ended"], why: "as web-scrape" },
  "instagram-scrape": { lanes: ["live", "reopen-running", "reopen-ended"], why: "as web-scrape" },
  "social-search": { lanes: ["reopen-running", "reopen-ended"], why: "socialSearchServerRunPatch is wired into the live lane only" },
  "extract-field": { lanes: ["live", "reopen-running", "reopen-ended"], why: "an inline node: its extractedText and json are not mapped by any server-run lane" },
  "json-process": { lanes: ["live", "reopen-running", "reopen-ended"], why: "its result is processedResult, which no server-run lane maps" },
  "describe-to-picker": { lanes: ["live", "reopen-running", "reopen-ended"], why: "its result is generatedPickerJson, which no server-run lane maps" },
}

const LANES: Record<Lane, (node: WorkflowNode, state: Data) => Data> = {
  live: (node, state) => {
    act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
    act(() => paintRunStates({ [node.id]: state } as never))
    return useWorkflowStore.getState().nodes[0]!.data as Data
  },
  "reopen-running": (node, state) => applyBackendExecutionState([node], { [node.id]: state } as never)[0]!.data as Data,
  "reopen-ended": (node, state) => applyCompletedExecutionResults([node], { [node.id]: state } as never, "2026-10-04T21:28:46.834Z")[0]!.data as Data,
}

/** Did the run's json reach the field the engine reads it back from? */
function landed(type: string, field: string, data: Data): boolean {
  const saved = JSON.stringify(data[field] ?? null)
  if (!saved.includes(MARK)) return false
  // Transcribe: the engines read the ACTIVE take's transcript first.
  if (type === "transcribe") {
    const takes = (data.generatedResults as Data[] | undefined) ?? []
    return JSON.stringify(takes[(data.activeResultIndex as number | undefined) ?? 0]?.transcript ?? null).includes(MARK)
  }
  return true
}

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("every node type whose saved json the engine hands on (the backend census)", () => {
  const entries = Object.entries(census as Record<string, string>)

  it("includes every type the shared json mapping covers", () => {
    expect([...JSON_RUN_RESULT_TYPES].filter((type) => !(type in census))).toEqual([])
  })

  it("names only census types in NOT_YET", () => {
    expect(Object.keys(NOT_YET).filter((type) => !(type in census))).toEqual([])
  })

  for (const [type, field] of entries) {
    for (const lane of Object.keys(LANES) as Lane[]) {
      const pending = NOT_YET[type]?.lanes.includes(lane)
      it(`${type} → ${field}, through ${lane}${pending ? " (NOT YET: " + NOT_YET[type]!.why + ")" : ""}`, () => {
        const node = { id: "n", type, position: { x: 0, y: 0 }, data: { label: type } } as unknown as WorkflowNode
        const state = { status: "completed", startedAt: "2026-10-04T21:28:13.932Z", completedAt: "2026-10-04T21:28:26.196Z", jobId: "c0ffee00-0000-4000-8000-000000000001", output: outputOf(type) }
        const data = LANES[lane](node, state)
        if (pending) expect(landed(type, field, data), "this lane lands it now: remove it from NOT_YET").toBe(false)
        else expect(landed(type, field, data), `a server run's json never reaches ${field}`).toBe(true)
      })
    }
  }
})
