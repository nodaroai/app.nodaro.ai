import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))
vi.mock("../../events.js", () => ({ pipelineEvents: { publish: vi.fn() } }))

import { callLLM } from "../call-llm.js"
import { pipelineEvents } from "../../events.js"
import {
  buildEditorUserPrompt,
  EditorLLMResultSchema,
  runEditor,
  type EditorShotInput,
} from "../editor.js"

beforeEach(() => vi.clearAllMocks())

function makeSupabaseMock() {
  const editorDecisions: Array<Record<string, unknown>> = []
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "editor_decisions") {
        return {
          // runEditor batches every cut_decision into a single INSERT — accept
          // both array and single-object shapes so older single-row callers
          // (if any reappear) don't silently no-op.
          insert: async (
            payload: Record<string, unknown> | Array<Record<string, unknown>>,
          ) => {
            if (Array.isArray(payload)) editorDecisions.push(...payload)
            else editorDecisions.push(payload)
            return { data: null, error: null }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never, editorDecisions }
}

function makeShot(overrides: Partial<EditorShotInput>): EditorShotInput {
  return {
    shot_id: "shot_01",
    scene_id: "scene_01",
    duration_seconds: 4,
    actual_audio_duration_sec: null,
    dialogue_no_cut_zone: null,
    has_dialogue: false,
    keyframe_url: "https://r2/kf-1.png",
    ...overrides,
  }
}

describe("buildEditorUserPrompt", () => {
  it("includes target_duration, beat_grid, and a context block per shot + keyframe", () => {
    const blocks = buildEditorUserPrompt({
      shots: [
        makeShot({ shot_id: "shot_01", scene_id: "scene_01" }),
        makeShot({
          shot_id: "shot_02",
          scene_id: "scene_01",
          has_dialogue: true,
          dialogue_no_cut_zone: { start: 0.5, end: 3.5 },
        }),
      ],
      beatGrid: [0.5, 1.0, 1.5, 2.0],
      targetDurationSec: 30,
    })
    // header + (text + image) + (text + image) + closing = 6 blocks
    expect(blocks.length).toBe(6)
    expect(blocks[0]).toMatchObject({ type: "text" })
    expect((blocks[0] as { text: string }).text).toContain("target_duration_sec: 30.00")
    expect((blocks[0] as { text: string }).text).toContain("beat_grid_seconds")
    expect((blocks[0] as { text: string }).text).toContain("shot_count: 2")
    expect(blocks[1]).toMatchObject({ type: "text" })
    expect((blocks[1] as { text: string }).text).toContain('id="shot_01"')
    expect(blocks[2]).toMatchObject({
      type: "image",
      source: { type: "url", url: "https://r2/kf-1.png" },
    })
    expect((blocks[3] as { text: string }).text).toContain("dialogue_no_cut_zone: [0.500s — 3.500s]")
  })

  it("omits image block when keyframe_url is null", () => {
    const blocks = buildEditorUserPrompt({
      shots: [makeShot({ keyframe_url: null })],
      beatGrid: [],
      targetDurationSec: 10,
    })
    // header + shot context (no image) + closing = 3 blocks
    expect(blocks.length).toBe(3)
    expect(blocks.some((b) => b.type === "image")).toBe(false)
  })
})

describe("EditorLLMResultSchema", () => {
  it("accepts canonical happy shape", () => {
    const parsed = EditorLLMResultSchema.safeParse({
      cut_decisions: [
        {
          shot_id: "shot_01",
          in_offset_sec: 0.0,
          out_offset_sec: 0.0,
          transition_to_next: "hard_cut",
          reasoning: "open on action",
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects unknown transition type", () => {
    const parsed = EditorLLMResultSchema.safeParse({
      cut_decisions: [
        {
          shot_id: "shot_01",
          transition_to_next: "swipe",
          reasoning: "x",
        },
      ],
    })
    expect(parsed.success).toBe(false)
  })

  it("rejects in_offset > 2s", () => {
    const parsed = EditorLLMResultSchema.safeParse({
      cut_decisions: [
        {
          shot_id: "shot_01",
          in_offset_sec: 3,
          transition_to_next: "hard_cut",
          reasoning: "x",
        },
      ],
    })
    expect(parsed.success).toBe(false)
  })
})

describe("runEditor", () => {
  it("happy path: returns decisions, persists rows, emits SSE", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        cut_decisions: [
          {
            shot_id: "shot_01",
            in_offset_sec: 0.1,
            out_offset_sec: 0.0,
            transition_to_next: "hard_cut",
            beat_snap_seconds: 0.5,
            reasoning: "snap to beat 1",
          },
          {
            shot_id: "shot_02",
            in_offset_sec: 0.0,
            out_offset_sec: 0.2,
            transition_to_next: "dissolve",
            transition_duration_sec: 0.5,
            reasoning: "ease into reflective beat",
          },
          {
            shot_id: "shot_03",
            in_offset_sec: 0.0,
            out_offset_sec: 0.0,
            transition_to_next: "match_cut",
            reasoning: "shape match on hero's hand",
          },
          {
            shot_id: "shot_04",
            in_offset_sec: 0.0,
            out_offset_sec: 0.0,
            transition_to_next: "overlap",
            reasoning: "J-cut into scene 2 dialogue",
          },
        ],
      },
      llmCallId: "llm-1",
      costUsd: 0.02,
      inputTokens: 1500,
      outputTokens: 200,
    })

    const { supabase, editorDecisions } = makeSupabaseMock()
    const result = await runEditor({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      shots: [
        makeShot({ shot_id: "shot_01" }),
        makeShot({ shot_id: "shot_02" }),
        makeShot({ shot_id: "shot_03" }),
        makeShot({ shot_id: "shot_04" }),
      ],
      beatGrid: [0.5, 1.0, 1.5, 2.0],
      targetDurationSec: 30,
    })

    expect(result.cut_decisions).toHaveLength(4)

    // Verify Sonnet vision shape
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.role).toBe("specialist")
    expect(call.task).toBe("editor_llm")
    expect(call.temperature).toBe(0.4)
    expect(Array.isArray(call.userPrompt)).toBe(true)

    // Verify all 4 transition types persisted with the right shape.
    expect(editorDecisions).toHaveLength(4)
    expect(editorDecisions[0]).toMatchObject({
      pipeline_id: "p1",
      shot_id: "shot_01",
      transition_type: "hard_cut",
      in_offset_sec: 0.1,
      beat_snap_seconds: 0.5,
      llm_call_id: "llm-1",
    })
    const transitionTypes = editorDecisions.map((d) => d.transition_type)
    expect(transitionTypes).toEqual(["hard_cut", "dissolve", "match_cut", "overlap"])
    expect(editorDecisions[1]?.transition_duration_sec).toBe(0.5)

    // Verify SSE emit.
    expect(pipelineEvents.publish).toHaveBeenCalledWith({
      type: "pipeline:editor_decisions_ready",
      pipelineId: "p1",
    })
  })

  it("preserves beat_snap_seconds passthrough", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        cut_decisions: [
          {
            shot_id: "shot_01",
            in_offset_sec: 0,
            out_offset_sec: 0,
            transition_to_next: "hard_cut",
            beat_snap_seconds: 1.234,
            reasoning: "x",
          },
          {
            shot_id: "shot_02",
            in_offset_sec: 0,
            out_offset_sec: 0,
            transition_to_next: "hard_cut",
            beat_snap_seconds: null,
            reasoning: "x",
          },
        ],
      },
      llmCallId: "llm-2",
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 50,
    })

    const { supabase, editorDecisions } = makeSupabaseMock()
    await runEditor({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      shots: [makeShot({ shot_id: "shot_01" }), makeShot({ shot_id: "shot_02" })],
      beatGrid: [1.234, 2.468],
      targetDurationSec: 10,
    })

    expect(editorDecisions[0]?.beat_snap_seconds).toBe(1.234)
    expect(editorDecisions[1]?.beat_snap_seconds).toBeNull()
  })

  it("marks dialogue_zone_respected when in_offset stays outside the zone", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        cut_decisions: [
          {
            shot_id: "shot_01",
            in_offset_sec: 0.0, // inside zone bounds OK
            out_offset_sec: 0.0,
            transition_to_next: "hard_cut",
            reasoning: "preserve dialogue",
          },
          {
            shot_id: "shot_02",
            in_offset_sec: 1.0, // INSIDE zone — should be flagged false
            out_offset_sec: 0.0,
            transition_to_next: "hard_cut",
            reasoning: "x",
          },
        ],
      },
      llmCallId: "llm-3",
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 50,
    })

    const { supabase, editorDecisions } = makeSupabaseMock()
    await runEditor({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      shots: [
        makeShot({
          shot_id: "shot_01",
          has_dialogue: true,
          dialogue_no_cut_zone: { start: 0.5, end: 3.5 },
          duration_seconds: 5,
        }),
        makeShot({
          shot_id: "shot_02",
          has_dialogue: true,
          dialogue_no_cut_zone: { start: 0.5, end: 3.5 },
          duration_seconds: 5,
        }),
      ],
      beatGrid: [],
      targetDurationSec: 10,
    })

    expect(editorDecisions[0]?.dialogue_zone_respected).toBe(true)
    expect(editorDecisions[1]?.dialogue_zone_respected).toBe(false)
  })

  it("persists null dialogue_zone_respected when shot has no dialogue zone", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        cut_decisions: [
          {
            shot_id: "shot_01",
            in_offset_sec: 0.0,
            out_offset_sec: 0.0,
            transition_to_next: "hard_cut",
            reasoning: "x",
          },
        ],
      },
      llmCallId: "llm-4",
      costUsd: 0.001,
      inputTokens: 80,
      outputTokens: 30,
    })

    const { supabase, editorDecisions } = makeSupabaseMock()
    await runEditor({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      shots: [makeShot({ shot_id: "shot_01" })], // no dialogue
      beatGrid: [],
      targetDurationSec: 4,
    })

    expect(editorDecisions[0]?.dialogue_zone_respected).toBeNull()
  })

  it("audit row insert failure is non-fatal — result still returned", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        cut_decisions: [
          {
            shot_id: "shot_01",
            in_offset_sec: 0,
            out_offset_sec: 0,
            transition_to_next: "hard_cut",
            reasoning: "x",
          },
        ],
      },
      llmCallId: "llm-5",
      costUsd: 0.001,
      inputTokens: 50,
      outputTokens: 20,
    })

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "editor_decisions") {
          return {
            insert: async () => ({
              data: null,
              error: { message: "audit insert failed" },
            }),
          }
        }
        throw new Error(`Unmocked table: ${table}`)
      }),
    } as never

    const result = await runEditor({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      shots: [makeShot({ shot_id: "shot_01" })],
      beatGrid: [],
      targetDurationSec: 4,
    })

    expect(result.cut_decisions).toHaveLength(1)
    expect(pipelineEvents.publish).toHaveBeenCalled()
  })
})
