import { z } from "zod"
import type { EntityStatus, EntityType } from "./entity-approval-types.js"
import type {
  EntityStateChangeEvent,
  EntityStaleEvent,
  PipelineForkedEvent,
  PipelineDriftSummary,
  PipelineCompletedEvent,
  StageAwaitingSubGateEvent,
  PipelineMusicReadyEvent,
  PipelineEditorDecisionsReadyEvent,
} from "./pipeline-state-types.js"
// Phase 1D.2b — Guided-mode chat. Type-only import to keep this file at the
// root of the import graph (pipeline-chat.ts imports PipelineStageName from
// here, so a value import would be circular).
import type { ProposedChange } from "./pipeline-chat.js"

/**
 * Canonical pipeline stage order — Phase 1A→1C topology. The engine's
 * `runPipeline` walks this list in sequence; tests, the SSE event router,
 * and the admin-side stage timeline all consume this same tuple as the
 * source of truth for "which stages exist + in what order".
 */
export const PIPELINE_STAGE_NAMES = [
  "script",
  "characters",
  "objects",
  "locations",
  "shot_list",
  "scene_images",
  "animate_audio_edit",
  "post_merge",
] as const
export const PipelineStageNameSchema = z.enum(PIPELINE_STAGE_NAMES)
export type PipelineStageName = (typeof PIPELINE_STAGE_NAMES)[number]

export const PipelineStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "forked",
])
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>

export const PipelineStageStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "approved",
  "rejected",
  "failed",
  "cancelled",
])
export type PipelineStageStatus = z.infer<typeof PipelineStageStatusSchema>

export type PipelineEvent =
  | { type: "pipeline:status"; pipelineId: string; status: PipelineStatus }
  | {
      type: "stage:status"
      pipelineId: string
      stageName: PipelineStageName
      status: PipelineStageStatus
      output?: unknown
      criticFeedback?: unknown
    }
  | {
      type: "pipeline:warning"
      pipelineId: string
      code: string
      message: string
    }
  | { type: "pipeline:done"; pipelineId: string }
  | {
      type: "entity:status"
      pipelineId: string
      entityId: string
      entityType: EntityType
      entityKey: string
      status: EntityStatus
      mainAssetUrl?: string
    }
  | {
      type: "entity:variant:added"
      pipelineId: string
      entityId: string
      variantKey: string
      assetUrl: string
    }
  | {
      type: "scene:status"
      pipelineId: string
      sceneEntityId: string
      sceneIndex: number
      status: EntityStatus
      shotCount?: number
    }
  // Phase 1B.4 lifecycle events — see pipeline-state-types.ts for full JSDoc
  // on when each fires. SSE forwarders in routes/pipelines.ts are
  // event-type-agnostic and pass all of these through unchanged.
  | EntityStateChangeEvent
  | EntityStaleEvent
  | PipelineForkedEvent
  | PipelineDriftSummary
  // Phase 1C.1 — final-MP4 ready event carries the merged asset id + URL.
  | PipelineCompletedEvent
  // Phase 1C.2 — Stage 7 sub-gate pause, music ready, editor decisions ready.
  | StageAwaitingSubGateEvent
  | PipelineMusicReadyEvent
  | PipelineEditorDecisionsReadyEvent
  // Phase 1D.2b — Guided-mode chat. `chat:turn` fires after each LLM round-
  // trip (user prompt → assistant reply with optional proposed_change). The
  // event carries the full turn record so the frontend chat history can
  // render it without an extra GET /chat roundtrip. `chat:proposal_applied`
  // fires when the user accepts a proposed_change — the turnId + attemptId
  // let the UI mark the source turn as applied and link to the resulting
  // stage attempt (re-run output) it produced.
  | {
      type: "chat:turn"
      pipelineId: string
      stageName: PipelineStageName
      turn: {
        id: string
        turn_n: number
        role: "user" | "assistant"
        content: string
        proposed_change: ProposedChange | null
      }
    }
  | {
      type: "chat:proposal_applied"
      pipelineId: string
      stageName: PipelineStageName
      turnId: string
      attemptId: string
    }
