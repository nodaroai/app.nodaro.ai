import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { pipelineEvents } from "../events.js"
import { rebalanceScene, runDialogueRecheck } from "../sub-steps/dialogue-recheck.js"

beforeEach(() => vi.clearAllMocks())

/* ─── Fixture builders ───────────────────────────────────────────────────── */

function makeShot(overrides: Partial<ShotSpec>): ShotSpec {
  const base: ShotSpec = {
    shot_id: "shot_01",
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "action_shot",
    action: "x",
    dialogue_line: null,
    duration_seconds: 4,
    motion_prompt: "x",
    start_state: "x",
    end_state: "x",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: false,
    },
    visual_keyframe_prompt: "x",
    has_dialogue: false,
  }
  return { ...base, ...overrides }
}

function makeSceneNodeData(shots: ShotSpec[]): SceneNodeData {
  return {
    scene_index: 1,
    description: "x",
    emotional_beat: "x",
    duration_seconds: shots.reduce((s, x) => s + x.duration_seconds, 0),
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "loc1",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana",
    video_model: "minimax",
    shots,
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  }
}

function makeSupabaseMock(scenes: Array<{ id: string; entity_key: string; sceneNodeData: SceneNodeData }>) {
  const updates: Array<{ id: string; metadata: Record<string, unknown> }> = []
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: scenes.map((s) => ({
                    id: s.id,
                    entity_key: s.entity_key,
                    metadata: { scene_node_data: s.sceneNodeData },
                  })),
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              updates.push({ id: val, metadata: patch.metadata as Record<string, unknown> })
              return { data: null, error: null }
            },
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never, updates }
}

/* ─── rebalanceScene unit tests ──────────────────────────────────────────── */

describe("rebalanceScene", () => {
  it("returns no-op when no shot has dialogue overflow", () => {
    const s = makeSceneNodeData([
      makeShot({ shot_id: "shot_01", duration_seconds: 4 }),
      makeShot({
        shot_id: "shot_02",
        duration_seconds: 4,
        dialogue_line: "Hello",
        has_dialogue: true,
        actual_audio_duration_sec: 3.5, // under intended
      }),
    ])
    const r = rebalanceScene(s)
    expect(r.rebalances).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.exceedsTolerance).toBe(false)
  })

  it("rebalances single-shot overflow within budget", () => {
    const s = makeSceneNodeData([
      makeShot({ shot_id: "shot_01", duration_seconds: 4 }), // non-dialogue donor
      makeShot({
        shot_id: "shot_02",
        duration_seconds: 4,
        dialogue_line: "Long line of dialogue here",
        has_dialogue: true,
        actual_audio_duration_sec: 5.5, // 1.5s overflow
      }),
      makeShot({ shot_id: "shot_03", duration_seconds: 4 }), // non-dialogue donor
    ])
    const r = rebalanceScene(s)
    expect(r.rebalances).toHaveLength(1)
    expect(r.rebalances[0]?.shot_id).toBe("shot_02")
    expect(r.rebalances[0]?.delta_sec).toBeCloseTo(1.5, 1)
    expect(r.rebalances[0]?.new_intended_duration_sec).toBeCloseTo(5.5, 1)
    // Original scene total = 12s; ±10% tolerance = ±1.2s. New total is still 12s (rebalance is delta-neutral)
    expect(r.exceedsTolerance).toBe(false)
    // Updated shot has dialogue_no_cut_zone set
    const dialogueShot = r.updatedShots.find((sh) => sh.shot_id === "shot_02")
    expect(dialogueShot?.dialogue_no_cut_zone).toEqual({ start: 0, end: 5.5 })
    // Donors got trimmed
    const donor1 = r.updatedShots.find((sh) => sh.shot_id === "shot_01")
    const donor3 = r.updatedShots.find((sh) => sh.shot_id === "shot_03")
    expect(donor1?.duration_seconds).toBeLessThan(4)
    expect(donor3?.duration_seconds).toBeLessThan(4)
  })

  it("caps shot duration at 8s hard max", () => {
    const s = makeSceneNodeData([
      makeShot({ shot_id: "shot_01", duration_seconds: 6 }),
      makeShot({
        shot_id: "shot_02",
        duration_seconds: 4,
        dialogue_line: "x",
        has_dialogue: true,
        actual_audio_duration_sec: 12, // way over 8s
      }),
    ])
    const r = rebalanceScene(s)
    const dialogueShot = r.updatedShots.find((sh) => sh.shot_id === "shot_02")
    expect(dialogueShot?.duration_seconds).toBe(8)
    // dialogue_no_cut_zone uses the actual (12s), not the capped (8s) — the zone
    // tracks the audio length; the duration tracks the playback clip.
    expect(dialogueShot?.dialogue_no_cut_zone).toEqual({ start: 0, end: 12 })
  })

  it("flags exceedsTolerance when scene total drifts beyond ±10%", () => {
    // All dialogue shots overflow → no donors → no rebalance → total grows.
    const s = makeSceneNodeData([
      makeShot({
        shot_id: "shot_01",
        duration_seconds: 4,
        dialogue_line: "x",
        has_dialogue: true,
        actual_audio_duration_sec: 7,
      }),
      makeShot({
        shot_id: "shot_02",
        duration_seconds: 4,
        dialogue_line: "y",
        has_dialogue: true,
        actual_audio_duration_sec: 6,
      }),
    ])
    const r = rebalanceScene(s)
    expect(r.exceedsTolerance).toBe(true)
    expect(r.warnings.some((w) => w.includes("scene_total_drift"))).toBe(true)
    expect(r.warnings.some((w) => w.includes("no_non_dialogue_shots"))).toBe(true)
  })
})

/* ─── runDialogueRecheck integration tests ───────────────────────────────── */

describe("runDialogueRecheck", () => {
  it("returns no rebalance, no warnings, awaitingUserDecision=false when nothing overflows", async () => {
    const { supabase, updates } = makeSupabaseMock([
      {
        id: "scene-1",
        entity_key: "scene_01",
        sceneNodeData: makeSceneNodeData([
          makeShot({
            shot_id: "shot_01",
            duration_seconds: 4,
            dialogue_line: "x",
            has_dialogue: true,
            actual_audio_duration_sec: 3.5,
          }),
        ]),
      },
    ])
    const result = await runDialogueRecheck({
      supabase,
      pipelineId: "p1",
      mode: "manual",
    })
    expect(result.ok).toBe(true)
    expect(result.rebalances).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.awaitingUserDecision).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it("single-shot overflow rebalanced within budget, no user gate", async () => {
    const { supabase, updates } = makeSupabaseMock([
      {
        id: "scene-1",
        entity_key: "scene_01",
        sceneNodeData: makeSceneNodeData([
          makeShot({ shot_id: "shot_01", duration_seconds: 4 }),
          makeShot({
            shot_id: "shot_02",
            duration_seconds: 4,
            dialogue_line: "x",
            has_dialogue: true,
            actual_audio_duration_sec: 5,
          }),
          makeShot({ shot_id: "shot_03", duration_seconds: 4 }),
        ]),
      },
    ])
    const result = await runDialogueRecheck({
      supabase,
      pipelineId: "p1",
      mode: "manual",
    })
    expect(result.ok).toBe(true)
    expect(result.rebalances).toHaveLength(1)
    expect(result.rebalances[0]?.scene_entity_id).toBe("scene-1")
    expect(result.rebalances[0]?.shot_id).toBe("shot_02")
    expect(result.awaitingUserDecision).toBe(false)
    expect(updates).toHaveLength(1)
    // Updated metadata carries the recomputed shots with dialogue_no_cut_zone.
    const persistedShots = (updates[0]?.metadata as { scene_node_data?: SceneNodeData })
      ?.scene_node_data?.shots
    expect(persistedShots?.[1]?.dialogue_no_cut_zone).toEqual({ start: 0, end: 5 })
  })

  it("multi-scene drift exceeding ±10%: manual → awaitingUserDecision=true; auto → warnings only", async () => {
    // Two scenes, second one all-dialogue (can't rebalance).
    const sceneFixtures = () => [
      {
        id: "scene-1",
        entity_key: "scene_01",
        sceneNodeData: makeSceneNodeData([
          makeShot({ shot_id: "shot_01", duration_seconds: 4 }),
          makeShot({
            shot_id: "shot_02",
            duration_seconds: 4,
            dialogue_line: "x",
            has_dialogue: true,
            actual_audio_duration_sec: 4.5,
          }),
        ]),
      },
      {
        id: "scene-2",
        entity_key: "scene_02",
        sceneNodeData: makeSceneNodeData([
          makeShot({
            shot_id: "shot_01",
            duration_seconds: 4,
            dialogue_line: "x",
            has_dialogue: true,
            actual_audio_duration_sec: 7,
          }),
          makeShot({
            shot_id: "shot_02",
            duration_seconds: 4,
            dialogue_line: "y",
            has_dialogue: true,
            actual_audio_duration_sec: 6,
          }),
        ]),
      },
    ]

    // Manual mode: scene-2 should flip awaitingUserDecision=true.
    const m1 = makeSupabaseMock(sceneFixtures())
    const r1 = await runDialogueRecheck({
      supabase: m1.supabase,
      pipelineId: "p1",
      mode: "manual",
    })
    expect(r1.awaitingUserDecision).toBe(true)
    expect(r1.warnings.some((w) => w.includes("scene[scene_02]"))).toBe(true)
    expect((pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)

    // Auto mode: same fixtures, no pause, warnings emitted via pipeline:warning.
    vi.clearAllMocks()
    const m2 = makeSupabaseMock(sceneFixtures())
    const r2 = await runDialogueRecheck({
      supabase: m2.supabase,
      pipelineId: "p1",
      mode: "auto",
    })
    expect(r2.awaitingUserDecision).toBe(false)
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(publishCalls.length).toBeGreaterThan(0)
    expect(publishCalls[0]?.[0]).toMatchObject({
      type: "pipeline:warning",
      pipelineId: "p1",
      code: "dialogue_recheck_rebalance",
    })
  })

  it("honors 8s cap when audio duration far exceeds it", async () => {
    const { supabase, updates } = makeSupabaseMock([
      {
        id: "scene-1",
        entity_key: "scene_01",
        sceneNodeData: makeSceneNodeData([
          makeShot({ shot_id: "shot_01", duration_seconds: 4 }),
          makeShot({
            shot_id: "shot_02",
            duration_seconds: 4,
            dialogue_line: "x",
            has_dialogue: true,
            actual_audio_duration_sec: 20, // huge overflow
          }),
        ]),
      },
    ])
    const result = await runDialogueRecheck({
      supabase,
      pipelineId: "p1",
      mode: "guided",
    })
    expect(result.rebalances[0]?.new_intended_duration_sec).toBe(8)
    const persistedShot = (
      updates[0]?.metadata as { scene_node_data?: SceneNodeData }
    )?.scene_node_data?.shots.find((s) => s.shot_id === "shot_02")
    expect(persistedShot?.duration_seconds).toBe(8)
    expect(persistedShot?.dialogue_no_cut_zone?.end).toBe(20)
  })
})
