import { z } from "zod"
import type { EntityStatus, EntityType } from "./entity-approval-types.js"
import type {
  EntityStateChangeEvent,
  EntityStaleEvent,
  PipelineForkedEvent,
  PipelineDriftSummary,
} from "./pipeline-state-types.js"

export const PipelineStageNameSchema = z.enum([
  "script",
  "characters",
  "objects",
  "locations",
  "shot_list",
  "scene_images",
  "animate_audio_edit",
  "post_merge",
])
export type PipelineStageName = z.infer<typeof PipelineStageNameSchema>

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
