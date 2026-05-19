import type Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { TransitionTypeSchema } from "@nodaro/shared"
import { z } from "zod"
import { pipelineEvents } from "../events.js"
import { callLLM } from "./call-llm.js"

/**
 * Phase 1C.2 sub-step 7h — Editor LLM.
 *
 * A Sonnet vision call that takes per-shot context (keyframe URL, planned
 * duration, actual audio duration, dialogue_no_cut_zone, has_dialogue,
 * emotional_beat), the beat grid from the music-timeline sub-step, the
 * Showrunner's emotional arc, and returns a `cut_decision` per shot.
 *
 * The Editor uses keyframes (not full clips — clips would explode context)
 * as visual proxies for each shot. The LLM reasons about transitions
 * between adjacent keyframe pairs + beat-grid snap targets + dialogue zones.
 *
 * Output shape mirrors the `editor_decisions` table (migration 135):
 *   { shot_id, in_offset_sec, out_offset_sec, transition_to_next,
 *     transition_duration_sec, beat_snap_seconds, reasoning }
 *
 * Persistence: each decision is inserted into `editor_decisions` for audit
 * + queryable analytics. The caller (Stage 7 in Section H) is responsible
 * for patching each decision into the corresponding `scene_node_data.shots[N]
 * .cut_decision` field so sub-step 7j (final merge) can read them.
 *
 * Emits `pipeline:editor_decisions_ready` SSE on success.
 */

/* ─── Schemas ────────────────────────────────────────────────────────────── */

export const EditorCutDecisionSchema = z.object({
  shot_id: z.string(),
  in_offset_sec: z.number().min(0).max(2).default(0),
  out_offset_sec: z.number().min(0).max(2).default(0),
  transition_to_next: TransitionTypeSchema,
  transition_duration_sec: z.number().min(0).max(2).optional(),
  beat_snap_seconds: z.number().nullable().optional(),
  reasoning: z.string().max(300),
})
export type EditorCutDecision = z.infer<typeof EditorCutDecisionSchema>

export const EditorLLMResultSchema = z.object({
  cut_decisions: z.array(EditorCutDecisionSchema),
})
export type EditorLLMResult = z.infer<typeof EditorLLMResultSchema>

/* ─── System prompt ──────────────────────────────────────────────────────── */

const _REDACTED_PROMPT_4 = `[REDACTED — moved to private plugin, S9 extraction]`

/* ─── Public API ─────────────────────────────────────────────────────────── */

export interface EditorShotInput {
  shot_id: string
  scene_id: string
  duration_seconds: number
  actual_audio_duration_sec: number | null
  dialogue_no_cut_zone: { start: number; end: number } | null
  has_dialogue: boolean
  /** R2 URL of the per-shot keyframe (Stage 6 output). When null we still
   *  emit a context block but no image; the LLM degrades to prompt-only. */
  keyframe_url: string | null
  /** Echoed from the Showrunner plan. Helps the LLM tune pacing. */
  emotional_beat?: string
}

export interface RunEditorArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  shots: ReadonlyArray<EditorShotInput>
  /** Beat onset markers (seconds, absolute timeline). Empty array when
   *  music_enabled=false OR beat-grid extract failed. */
  beatGrid: ReadonlyArray<number>
  /** Target total duration (Showrunner + Stage 5 plan). */
  targetDurationSec: number
  /** Optional global style hints from the Showrunner plan (visual style,
   *  color palette, etc.). Stringified into the user prompt verbatim. */
  globalStyle?: Record<string, unknown>
}

export async function runEditor(args: RunEditorArgs): Promise<EditorLLMResult> {
  const { supabase, pipelineId, stageId, userId, shots } = args

  const userPrompt = buildEditorUserPrompt(args)

  const llm = await callLLM({
    supabase,
    pipelineId,
    stageId,
    sceneId: null,
    userId,
    role: "specialist",
    task: "editor_llm",
    modelId: "claude-sonnet-4-6",
    temperature: 0.4,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: EditorLLMResultSchema,
    maxRetries: 1,
  })

  // Persist every decision to editor_decisions for audit + analytics via a
  // single batched INSERT (one round-trip vs N — the LLM typically emits
  // 10-40 decisions per pipeline). The table is FK'd to pipelines (CASCADE)
  // + nullable pipeline_entity_id + nullable shot_id. We don't have
  // pipeline_entity_id here (scene id ≠ entity id without a lookup); leave
  // it null. The caller (Stage 7) is responsible for patching the decision
  // onto scene_node_data.shots[N]. Audit-row write failure is non-fatal —
  // the LLM result is still usable; we just lose the audit rows.
  const llmCallId = llm.llmCallId === "unrecorded" ? null : llm.llmCallId
  if (llm.output.cut_decisions.length > 0) {
    const rows = llm.output.cut_decisions.map((decision) => {
      const shot = shots.find((s) => s.shot_id === decision.shot_id)
      const dialogueZoneRespected = computeDialogueZoneRespected(decision, shot)
      return {
        pipeline_id: pipelineId,
        pipeline_entity_id: null, // Caller patches this onto scene metadata
        shot_id: decision.shot_id,
        transition_type: decision.transition_to_next,
        in_offset_sec: decision.in_offset_sec,
        out_offset_sec: decision.out_offset_sec,
        transition_duration_sec: decision.transition_duration_sec ?? null,
        beat_snap_seconds: decision.beat_snap_seconds ?? null,
        dialogue_zone_respected: dialogueZoneRespected,
        llm_call_id: llmCallId,
      }
    })
    const { error } = await supabase.from("editor_decisions").insert(rows)
    if (error) {
      console.error(
        `[runEditor] failed to persist ${rows.length} editor_decision row(s):`,
        error.message,
      )
    }
  }

  pipelineEvents.publish({
    type: "pipeline:editor_decisions_ready",
    pipelineId,
  })

  return llm.output
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Returns true when the decision's trim window leaves the dialogue zone
 * intact (in_offset ≤ zone.start AND in_offset + playback ≥ zone.end).
 * Returns null when there's no zone to respect (no dialogue, or no shot
 * match in the input list — defensive null rather than `false` which would
 * pollute the audit-row queryability).
 */
function computeDialogueZoneRespected(
  decision: EditorCutDecision,
  shot: EditorShotInput | undefined,
): boolean | null {
  if (!shot || !shot.dialogue_no_cut_zone) return null
  const zone = shot.dialogue_no_cut_zone
  if (decision.in_offset_sec > zone.start) return false
  const remaining =
    shot.duration_seconds - decision.in_offset_sec - decision.out_offset_sec
  if (decision.in_offset_sec + remaining < zone.end) return false
  return true
}

/**
 * Builds the user prompt as an alternating sequence of text + image blocks.
 * Exported for unit testing.
 */
export function buildEditorUserPrompt(
  args: Pick<
    RunEditorArgs,
    "shots" | "beatGrid" | "targetDurationSec" | "globalStyle"
  >,
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = []

  // 1. Header
  blocks.push({
    type: "text",
    text:
      `<editor_brief>\n` +
      `target_duration_sec: ${args.targetDurationSec.toFixed(2)}\n` +
      `beat_grid_seconds: [${args.beatGrid.map((b) => b.toFixed(3)).join(", ")}]\n` +
      (args.globalStyle
        ? `global_style: ${JSON.stringify(args.globalStyle)}\n`
        : "") +
      `shot_count: ${args.shots.length}\n` +
      `</editor_brief>\n\n` +
      `Below: one block per shot in playback order. After every shot we list ` +
      `the keyframe image (when available). Emit one cut_decision per shot.`,
  })

  // 2. Per-shot context + keyframe.
  for (let i = 0; i < args.shots.length; i++) {
    const s = args.shots[i]!
    const zone = s.dialogue_no_cut_zone
      ? `[${s.dialogue_no_cut_zone.start.toFixed(3)}s — ${s.dialogue_no_cut_zone.end.toFixed(3)}s]`
      : "none"
    const audioDur =
      s.actual_audio_duration_sec != null
        ? `${s.actual_audio_duration_sec.toFixed(3)}s`
        : "n/a"
    blocks.push({
      type: "text",
      text:
        `\n<shot index="${i}" id="${s.shot_id}" scene="${s.scene_id}">\n` +
        `intended_duration_sec: ${s.duration_seconds.toFixed(3)}\n` +
        `has_dialogue: ${s.has_dialogue}\n` +
        `actual_audio_duration_sec: ${audioDur}\n` +
        `dialogue_no_cut_zone: ${zone}\n` +
        (s.emotional_beat ? `emotional_beat: ${s.emotional_beat}\n` : "") +
        `</shot>`,
    })
    if (s.keyframe_url) {
      blocks.push({
        type: "image",
        source: { type: "url", url: s.keyframe_url },
      })
    }
  }

  // 3. Closing instruction.
  blocks.push({
    type: "text",
    text:
      "\nEmit your full cut_decisions array via the emit tool. Honor every " +
      "dialogue_no_cut_zone; snap to beats within ±0.2s.",
  })

  return blocks
}
