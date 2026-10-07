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
 * The census is exact: every type it finds must land through every lane, with
 * no list of exceptions (the last seven were mapped, decided 2026-10-05). A new
 * json producer the backend census pins fails here until the editor maps it.
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
const FEED_POST = { id: 1, channel: MARK, postUrl: `https://t.me/${MARK}/1`, text: MARK, media: [] }

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
  // The dialogue's audio beside its timings (the json). A model without timings sends the audio alone.
  "text-to-dialogue": { audioUrl: "https://media.example.test/dialogue.mp3", json: JSON_OBJECT },
  "content-recipe": { json: JSON_OBJECT, text: MARK },
  "content-ideas": { json: [JSON_OBJECT], text: MARK, listResults: [MARK] },
  // Every post found, and the ones passed on (json).
  "social-search": { json: [POST], searchResults: [POST], text: MARK, listResults: [JSON.stringify(POST)] },
  // The feed's posts need a numeric id and a text to count as posts (telegramPostsFrom).
  "telegram-channel-feed": { json: [FEED_POST], text: MARK, listResults: [JSON.stringify(FEED_POST)] },
  // Read Collection's json is the LIST of records (an object is not a result); Save to Collection's is the one record.
  "collection-read": { json: [JSON_OBJECT], text: MARK, listResults: [JSON.stringify(JSON_OBJECT)] },
  "collection-write": { json: JSON_OBJECT, text: MARK },
  // The post readers' json is the LIST of posts (the Social Search shape).
  "inspiration-read": { json: [POST], text: MARK, listResults: [JSON.stringify(POST)] },
  "competitor-read": { json: [POST], text: MARK, listResults: [JSON.stringify(POST)] },
  // A scrape's json is the list of pages / ads / posts; an empty or non-list one is "no results".
  "web-scrape": { json: [JSON_OBJECT] },
  "meta-ads-scrape": { json: [JSON_OBJECT] },
  "instagram-scrape": { json: [JSON_OBJECT] },
  // Extract Field in JSON mode: the text beside the structured value.
  "extract-field": { extractedText: MARK, text: MARK, json: JSON_OBJECT },
  // JSON Process carries its value on processedResult (never json).
  "json-process": { processedResult: JSON_OBJECT, text: MARK, listResults: [JSON.stringify(JSON_OBJECT)] },
}
const outputOf = (type: string): Data => RUN_OUTPUT[type] ?? { json: JSON_OBJECT }

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

  for (const [type, field] of entries) {
    for (const lane of Object.keys(LANES) as Lane[]) {
      it(`${type} → ${field}, through ${lane}`, () => {
        const node = { id: "n", type, position: { x: 0, y: 0 }, data: { label: type } } as unknown as WorkflowNode
        const state = { status: "completed", startedAt: "2026-10-04T21:28:13.932Z", completedAt: "2026-10-04T21:28:26.196Z", jobId: "c0ffee00-0000-4000-8000-000000000001", output: outputOf(type) }
        const data = LANES[lane](node, state)
        expect(landed(type, field, data), `a server run's json never reaches ${field}: map it (lib/json-run-result.ts)`).toBe(true)
      })
    }
  }
})
