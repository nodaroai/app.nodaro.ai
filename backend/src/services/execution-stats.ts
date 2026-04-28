/**
 * Execution stats service — tracks actual job durations and provides
 * EMA-smoothed estimates for smart progress bars.
 *
 * Data is stored in the `model_execution_stats` table keyed by
 * (model_identifier, aspect_ratio, quality, duration_seconds).
 */

import { supabase } from "../lib/supabase.js"
import { CATEGORY_DURATION_DEFAULTS } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Node categories that should NOT be tracked (no meaningful duration signal)
// ---------------------------------------------------------------------------

/**
 * Node types whose execution time is not worth tracking:
 * - FFmpeg processing nodes (fast, deterministic, not model-dependent)
 * - Inline nodes (pure in-process computation)
 * - Source nodes (no external calls)
 */
export const SKIP_CATEGORIES = new Set([
  // FFmpeg processing
  "combine-videos",
  "merge-video-audio",
  "add-captions",
  "resize-video",
  "trim-video",
  "trim-audio",
  "mix-audio",
  "adjust-volume",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "transcode-video",
  "extract-audio",
  "audio-isolation",
  // Inline / pure-logic
  "combine-text",
  "split-text",
  "composite",
  "preview",
  // Source nodes
  "text-prompt",
  "upload-image",
  "upload-video",
  "upload-audio",
  "youtube-video",
  "reference-audio",
  "list",
  "loop",
  "webhook-trigger",
  "schedule-trigger",
  "sub-workflow-input",
  "sub-workflow-output",
  "manual-edit",
])

// ---------------------------------------------------------------------------
// StatsKey — canonical descriptor for a model execution variant
// ---------------------------------------------------------------------------

export interface StatsKey {
  model_identifier: string
  aspect_ratio: string   // '' when N/A (DB column is NOT NULL DEFAULT '')
  quality: string         // '' when N/A (DB column is NOT NULL DEFAULT '')
  duration_seconds: number // 0 when N/A (DB column is NOT NULL DEFAULT 0)
}

// ---------------------------------------------------------------------------
// Input data shape (loosely typed — we read optional fields from job payloads)
// ---------------------------------------------------------------------------

type InputData = Record<string, unknown>

function str(v: unknown): string {
  if (v === undefined || v === null || v === "") return ""
  return String(v)
}

function num(v: unknown): number {
  if (v === undefined || v === null) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/**
 * Build a canonical StatsKey from a node type + its input data (job payload).
 * Returns `null` if the node type is in SKIP_CATEGORIES.
 */
export function buildStatsKey(nodeType: string, inputData: InputData): StatsKey | null {
  if (SKIP_CATEGORIES.has(nodeType)) return null

  switch (nodeType) {
    // -----------------------------------------------------------------------
    // Image generation nodes
    // -----------------------------------------------------------------------
    case "generate-image":
    case "image-to-image":
    case "edit-image": {
      const provider = str(inputData.provider)
      if (!provider) return null
      // Nano Banana uses image_size, others use aspect_ratio
      const aspectRatio = str(inputData.aspect_ratio) || str(inputData.image_size)
      // resolution (nano-banana-pro 4K, flux 2K, etc.) or quality (gpt-image)
      const quality = str(inputData.resolution) || str(inputData.quality)
      return {
        model_identifier: provider,
        aspect_ratio: aspectRatio,
        quality,
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Video generation nodes
    // -----------------------------------------------------------------------
    case "image-to-video":
    case "text-to-video":
    case "video-to-video":
    case "motion-transfer":
    case "speech-to-video":
    case "extend-video": {
      const provider = str(inputData.provider) || str(inputData.model)
      if (!provider) return null
      return {
        model_identifier: provider,
        aspect_ratio: str(inputData.aspect_ratio),
        quality: "",
        duration_seconds: num(inputData.duration) || num(inputData.durationSeconds),
      }
    }

    // -----------------------------------------------------------------------
    // Text-to-speech / voice nodes
    // -----------------------------------------------------------------------
    case "text-to-speech": {
      const model =
        str(inputData.ttsModel) ||
        str(inputData.provider) ||
        "elevenlabs"
      return {
        model_identifier: model,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "text-to-audio": {
      const model = str(inputData.provider) || "elevenlabs-sfx"
      return {
        model_identifier: model,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "text-to-dialogue": {
      return {
        model_identifier: "elevenlabs-dialogue",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "voice-changer": {
      return {
        model_identifier: "elevenlabs-voice-changer",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "dubbing": {
      return {
        model_identifier: "elevenlabs-dubbing",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "voice-remix": {
      return {
        model_identifier: "elevenlabs-voice-remix",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "voice-design": {
      return {
        model_identifier: "elevenlabs-voice-design",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "forced-alignment": {
      return {
        model_identifier: "elevenlabs-forced-alignment",
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    case "transcribe": {
      const provider = str(inputData.provider) || "elevenlabs-stt"
      return {
        model_identifier: provider,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Music generation nodes
    // -----------------------------------------------------------------------
    case "generate-music":
    case "suno-generate":
    case "suno-cover":
    case "suno-extend":
    case "suno-separate":
    case "suno-mashup":
    case "suno-replace-section":
    case "suno-style-boost":
    case "suno-add-instrumental":
    case "suno-add-vocals":
    case "suno-convert-wav":
    case "suno-upload-extend":
    case "suno-lyrics":
    case "suno-music-video": {
      const model =
        str(inputData.model) ||
        str(inputData.version) ||
        "suno"
      return {
        model_identifier: model,
        aspect_ratio: "",
        quality: "",
        duration_seconds: num(inputData.duration),
      }
    }

    // -----------------------------------------------------------------------
    // LLM / AI writer nodes
    // -----------------------------------------------------------------------
    case "ai-writer":
    case "image-to-text":
    case "generate-script":
    case "translate":
    case "qa-check": {
      const model =
        str(inputData.llmModel) ||
        str(inputData.model) ||
        "gemini-3-flash"
      return {
        model_identifier: model,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Video composition / rendering
    // -----------------------------------------------------------------------
    case "video-composer":
    case "after-effects":
    case "lottie-overlay":
    case "three-d-title":
    case "motion-graphics":
    case "render-video": {
      const planType =
        str(inputData.planType) ||
        str(inputData.compositionType) ||
        nodeType
      return {
        model_identifier: planType,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Video upscale
    // -----------------------------------------------------------------------
    case "video-upscale": {
      const provider = str(inputData.provider) || "topaz"
      const scale = str(inputData.scale) || str(inputData.quality)
      return {
        model_identifier: provider,
        aspect_ratio: "",
        quality: scale,
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Lip-sync
    // -----------------------------------------------------------------------
    case "lip-sync": {
      const provider =
        str(inputData.provider) ||
        str(inputData.model) ||
        "kling-avatar"
      return {
        model_identifier: provider,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Social media publishing
    // -----------------------------------------------------------------------
    case "social-media-post": {
      const platform = str(inputData.platform) || "social"
      return {
        model_identifier: `social-${platform}`,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }

    // -----------------------------------------------------------------------
    // Default: use node type as identifier, no dimensional params
    // -----------------------------------------------------------------------
    default: {
      return {
        model_identifier: nodeType,
        aspect_ratio: "",
        quality: "",
        duration_seconds: 0,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// EMA upsert
// ---------------------------------------------------------------------------
// EMA_ALPHA=0.3, outlier guard (≥5 samples, >3× avg) live in the RPC —
// keep migrations 078 + 088 in sync if you change them.

/**
 * Upsert an execution duration into the stats table.
 *
 * Atomic via the `upsert_execution_stats` RPC so concurrent completions for the
 * same key don't lose samples under read-modify-write races. The RPC applies
 * EMA smoothing, updates min/max, increments sample_count, and enforces the
 * same outlier guard (skip if duration > 3× avg when sample_count ≥ 5).
 */
export async function upsertExecutionStats(
  key: StatsKey,
  actualDurationMs: number,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("upsert_execution_stats", {
      p_model_identifier: key.model_identifier,
      p_aspect_ratio: key.aspect_ratio,
      p_quality: key.quality,
      p_duration_seconds: key.duration_seconds,
      p_duration_ms: actualDurationMs,
    })
    if (error) {
      console.error("[execution-stats] rpc error:", error.message)
    }
  } catch (err) {
    // Never throw — stats collection must not break job completion
    console.error("[execution-stats] unexpected error:", err)
  }
}

// ---------------------------------------------------------------------------
// Estimate lookup
// ---------------------------------------------------------------------------

export interface ExecutionEstimate {
  estimatedMs: number
  confidence: "exact" | "partial" | "model" | "default"
  sampleCount: number
}

type StatRow = {
  avg_duration_ms: number
  sample_count: number
  duration_seconds: number
}

/**
 * Map a model identifier to a category key for CATEGORY_DURATION_DEFAULTS fallback.
 */
export function getNodeCategory(model: string): string {
  // Video generation models
  if (
    /^(minimax|veo3|veo3\.1|kling|kling-turbo|kling-3\.0|kling-master|grok-i2v|seedance|wan-i2v|wan-turbo|hailuo|bytedance|runway|pika|luma|extend-video)/.test(model)
  ) {
    return "video"
  }
  // Image generation models
  if (
    /^(nano-banana|flux|grok|gpt-image|ideogram|qwen|imagen4|seedream|recraft)/.test(model)
  ) {
    return "image"
  }
  // Audio / TTS
  if (
    /^(elevenlabs|eleven_v3|eleven_turbo|eleven_multilingual|tts)/.test(model)
  ) {
    return "audio-tts"
  }
  // Music / Suno
  if (/^(suno|chirp)/.test(model)) {
    return "music"
  }
  // LLM
  if (/^(gemini|claude|gpt|anthropic|openai)/.test(model)) {
    return "llm"
  }
  // Upscale
  if (/^(topaz|video-upscale|upscale)/.test(model)) {
    return "upscale"
  }
  // Node types that are composition/rendering
  if (
    /^(after-effects|lottie-overlay|three-d-title|motion-graphics|render-video|video-composer|scene-graph)/.test(model)
  ) {
    return "video"
  }
  // Social
  if (/^social-/.test(model)) {
    return "inline"
  }
  return "llm" // safest default — LLM is short
}

/**
 * Get an execution time estimate for a given model + params.
 *
 * Fallback chain:
 * 1. Exact match (model + aspect_ratio + quality + duration_seconds)
 * 2. Model + quality + duration (ignore aspect_ratio)
 * 3. Extrapolate from different duration_seconds linearly (cap 5×)
 * 4. Model-only weighted average across all matching rows
 * 5. Category default from CATEGORY_DURATION_DEFAULTS
 */
export async function getEstimate(
  model: string,
  aspectRatio: string = "",
  quality: string = "",
  durationSeconds: number = 0,
): Promise<ExecutionEstimate> {
  const categoryDefault = (): ExecutionEstimate => ({
    estimatedMs: CATEGORY_DURATION_DEFAULTS[getNodeCategory(model)] ?? 30_000,
    confidence: "default",
    sampleCount: 0,
  })

  try {
    // Fetch all rows for this model
    const { data: rows, error } = await supabase
      .from("model_execution_stats")
      .select("avg_duration_ms, sample_count, duration_seconds, aspect_ratio, quality")
      .eq("model_identifier", model)

    if (error || !rows || rows.length === 0) {
      return categoryDefault()
    }

    type FullStatRow = StatRow & { aspect_ratio: string; quality: string }
    const fullRows = rows as FullStatRow[]

    // Step 1: Exact match
    const exact = fullRows.find(
      (r) =>
        r.aspect_ratio === aspectRatio &&
        r.quality === quality &&
        r.duration_seconds === durationSeconds,
    )
    if (exact) {
      return {
        estimatedMs: exact.avg_duration_ms,
        confidence: "exact",
        sampleCount: exact.sample_count,
      }
    }

    // Step 2: Ignore aspect_ratio (model + quality + duration)
    const partial = fullRows.find(
      (r) =>
        r.quality === quality &&
        r.duration_seconds === durationSeconds,
    )
    if (partial) {
      return {
        estimatedMs: partial.avg_duration_ms,
        confidence: "partial",
        sampleCount: partial.sample_count,
      }
    }

    // Step 3: Extrapolate duration linearly from nearest duration_seconds
    if (durationSeconds > 0) {
      // Find rows with a known duration_seconds to scale from
      const durationRows = fullRows.filter(
        (r) => r.duration_seconds > 0,
      )
      if (durationRows.length > 0) {
        // Pick the closest reference duration
        const sorted = [...durationRows].sort(
          (a, b) =>
            Math.abs((a.duration_seconds ?? 0) - durationSeconds) -
            Math.abs((b.duration_seconds ?? 0) - durationSeconds),
        )
        const ref = sorted[0]
        const ratio = durationSeconds / (ref.duration_seconds || 1)
        const cappedRatio = Math.min(ratio, 5)
        return {
          estimatedMs: Math.round(ref.avg_duration_ms * cappedRatio),
          confidence: "partial",
          sampleCount: ref.sample_count,
        }
      }
    }

    // Step 4: Model-only weighted average across all rows
    if (fullRows.length > 0) {
      const totalSamples = fullRows.reduce((sum, r) => sum + r.sample_count, 0)
      if (totalSamples > 0) {
        const weightedAvg = fullRows.reduce(
          (sum, r) => sum + r.avg_duration_ms * r.sample_count,
          0,
        ) / totalSamples
        return {
          estimatedMs: Math.round(weightedAvg),
          confidence: "model",
          sampleCount: totalSamples,
        }
      }
    }

    // Step 5: Category default
    return categoryDefault()
  } catch (err) {
    console.error("[execution-stats] getEstimate error:", err)
    return categoryDefault()
  }
}

// ---------------------------------------------------------------------------
// Batch estimate
// ---------------------------------------------------------------------------

export interface BatchEstimateInput {
  nodeId: string
  model: string
  aspectRatio?: string
  quality?: string
  durationSeconds?: number
}

/**
 * Fetch estimates for multiple nodes in parallel.
 * Returns a plain object of nodeId → ExecutionEstimate (JSON-serializable).
 */
export async function batchEstimate(
  nodes: BatchEstimateInput[],
): Promise<Record<string, ExecutionEstimate>> {
  const results: Record<string, ExecutionEstimate> = {}
  await Promise.all(
    nodes.map(async (n) => {
      results[n.nodeId] = await getEstimate(
        n.model,
        n.aspectRatio ?? "",
        n.quality ?? "",
        n.durationSeconds ?? 0,
      )
    }),
  )
  return results
}
