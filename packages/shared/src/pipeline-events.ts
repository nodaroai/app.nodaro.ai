import { z } from "zod"

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
