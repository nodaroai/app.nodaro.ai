"use client"

import { useState } from "react"
import type { GenerativePipelineNodeData } from "@/types/nodes"
import {
  PIPELINE_FORMATS,
  PIPELINE_MODES,
  PIPELINE_OUTPUT_RESOLUTIONS,
  VIDEO_CRITIC_FRAME_MODES,
  validateDurationForFormat,
  type PipelineFormat,
  type PipelineMode,
  type VideoCriticFrameMode,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pipelinesApi } from "@/lib/pipelines-api"
import type { ConfigProps } from "./types"

const MODE_LABELS: Record<PipelineMode, string> = {
  manual: "Manual",
  auto: "Auto",
  guided: "Guided",
}

const MODE_DESCRIPTIONS: Record<PipelineMode, string> = {
  manual: "Approve every stage. Full control.",
  auto: "Generate the whole film unattended. Critics gate each stage.",
  guided: "Approve every stage AND chat with the Showrunner Refinement Director at the Script stage to refine in natural language.",
}

const VIDEO_CRITIC_FRAME_LABELS: Record<VideoCriticFrameMode, string> = {
  first_last: "First + Last (default, cheapest)",
  first_middle_last: "First + Middle + Last (3 frames)",
  five_evenly: "5 Evenly Spaced (highest coverage)",
}

const VIDEO_CRITIC_FRAME_DESCRIPTIONS: Record<VideoCriticFrameMode, string> = {
  first_last:
    "2 frames per shot. Reuses input keyframe + existing last-frame extraction. ~2 credits per shot.",
  first_middle_last:
    "3 frames per shot. Adds midpoint extract. ~3 credits per shot.",
  five_evenly:
    "5 frames per shot at 0%/25%/50%/75%/100%. Best motion-glitch coverage. ~4 credits per shot.",
}

// Empty string = "Auto" sentinel. The backend resolver treats absent /
// empty-string keys as "not set" and falls back to its own default (Scene
// Director picks per-shot, or hardcoded sonnet-4-6 for scripts). Keep this in
// sync with what's in `STATIC_CREDIT_COSTS` + `model_pricing` — pinning a
// model that isn't priced will fail the hard-fail guard at generate-time.
const IMAGE_MODEL_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Auto (Director picks per shot)" },
  { value: "nano-banana", label: "Nano Banana — fast" },
  { value: "nano-banana-pro", label: "Nano Banana Pro — higher fidelity" },
  { value: "nano-banana-2", label: "Nano Banana 2 — latest" },
  { value: "flux", label: "Flux Pro" },
  { value: "gpt-image", label: "GPT Image" },
  { value: "gpt-image-2", label: "GPT Image 2" },
]

const VIDEO_MODEL_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Auto (Director picks per shot)" },
  { value: "kling-turbo", label: "Kling Turbo — cheapest" },
  { value: "kling", label: "Kling" },
  { value: "seedance-2-fast", label: "Seedance 2 Fast" },
  { value: "seedance-2", label: "Seedance 2" },
  { value: "veo3.1", label: "VEO 3.1 Fast" },
  { value: "veo3", label: "VEO 3.1 Quality" },
  { value: "minimax", label: "MiniMax" },
]

const SCRIPT_LLM_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Auto (Claude Sonnet 4.6)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — default" },
  { value: "claude-opus-4-6", label: "Claude Opus 4.6 — deepest" },
  { value: "gpt-5.2", label: "GPT-5.2" },
]

export function GenerativePipelineConfig({ data, onUpdate }: ConfigProps<GenerativePipelineNodeData>) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const format: PipelineFormat = data.format ?? "short_film"
  const duration = data.target_duration_seconds ?? 35
  const validation = validateDurationForFormat(format, duration)

  async function handleRun() {
    if (!selectedNodeId) {
      setErr("No node selected")
      return
    }
    if (!validation.ok) {
      setErr(validation.reason)
      return
    }
    if (!data.story_prompt || data.story_prompt.length < 1) {
      setErr("Story prompt required")
      return
    }
    setRunning(true)
    setErr(null)
    try {
      // Build the `config` payload only with model fields the user actually
      // set — empty-string sentinels (the "Auto" option) become absent keys so
      // the backend resolver falls through to its own defaults. Empty
      // `stage_models` is also omitted to keep the row clean.
      const modelConfig: Record<string, unknown> = {}
      if (data.image_model) modelConfig.image_model = data.image_model
      if (data.video_model) modelConfig.video_model = data.video_model
      if (data.script_llm) modelConfig.script_llm = data.script_llm
      if (data.stage_models && Object.values(data.stage_models).some(Boolean)) {
        modelConfig.stage_models = Object.fromEntries(
          Object.entries(data.stage_models).filter(([, v]) => Boolean(v)),
        )
      }

      const { id } = await pipelinesApi.create({
        pipeline_type: "story_to_video",
        root_node_id: selectedNodeId,
        story_prompt: data.story_prompt,
        target_duration_seconds: duration,
        format,
        output_resolution: data.output_resolution ?? "720p",
        language: "en",
        mode: data.mode ?? "manual",
        video_critic_frame_count: data.video_critic_frame_count ?? "first_last",
        ...(Object.keys(modelConfig).length > 0 ? { config: modelConfig } : {}),
      })
      onUpdate({ pipeline_id: id, status: "queued" })
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start pipeline")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="story_prompt">Story prompt</Label>
        <Textarea
          id="story_prompt"
          value={data.story_prompt ?? ""}
          onChange={(e) => onUpdate({ story_prompt: e.target.value })}
          rows={6}
          maxLength={4000}
          placeholder="A fighter pilot's final mission over the desert..."
        />
      </div>
      <div>
        <Label htmlFor="target_duration_seconds">Target duration (seconds)</Label>
        <Input
          id="target_duration_seconds"
          type="number"
          value={duration}
          min={5}
          max={600}
          onChange={(e) => onUpdate({ target_duration_seconds: Number(e.target.value) })}
        />
        {!validation.ok && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">{validation.reason}</div>
        )}
      </div>
      <div>
        <Label>Format</Label>
        <Select
          value={format}
          onValueChange={(v) => onUpdate({ format: v as PipelineFormat })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {f.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Output resolution</Label>
        <Select
          value={data.output_resolution ?? "720p"}
          onValueChange={(v) => onUpdate({ output_resolution: v as "480p" | "720p" | "1080p" | "4K" })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_OUTPUT_RESOLUTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Mode</Label>
        <Select
          value={data.mode ?? "manual"}
          onValueChange={(v) => onUpdate({ mode: v as PipelineMode })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PIPELINE_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {MODE_DESCRIPTIONS[data.mode ?? "manual"]}
        </div>
      </div>
      <div>
        <Label>Video Critic Frames</Label>
        <Select
          value={data.video_critic_frame_count ?? "first_last"}
          onValueChange={(v) =>
            onUpdate({ video_critic_frame_count: v as VideoCriticFrameMode })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIDEO_CRITIC_FRAME_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {VIDEO_CRITIC_FRAME_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {VIDEO_CRITIC_FRAME_DESCRIPTIONS[
            data.video_critic_frame_count ?? "first_last"
          ]}
        </div>
      </div>
      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Models (optional)
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="image_model">Image model</Label>
            <Select
              value={data.image_model || "auto"}
              onValueChange={(v) =>
                onUpdate({ image_model: v === "auto" ? undefined : v })
              }
            >
              <SelectTrigger id="image_model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "auto"} value={o.value || "auto"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Applies to character/location/object portraits + scene keyframes.
            </div>
          </div>
          <div>
            <Label htmlFor="video_model">Video model</Label>
            <Select
              value={data.video_model || "auto"}
              onValueChange={(v) =>
                onUpdate({ video_model: v === "auto" ? undefined : v })
              }
            >
              <SelectTrigger id="video_model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_MODEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "auto"} value={o.value || "auto"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Used for every shot. Must be compatible with your shot input mode — incompatible picks silently fall back to Auto.
            </div>
          </div>
          <div>
            <Label htmlFor="script_llm">Script LLM</Label>
            <Select
              value={data.script_llm || "auto"}
              onValueChange={(v) =>
                onUpdate({ script_llm: v === "auto" ? undefined : v })
              }
            >
              <SelectTrigger id="script_llm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCRIPT_LLM_OPTIONS.map((o) => (
                  <SelectItem key={o.value || "auto"} value={o.value || "auto"}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Drives the Showrunner (script + scene plan). Critics still use the default.
            </div>
          </div>
        </div>
      </div>
      <Button onClick={handleRun} disabled={running || !validation.ok}>
        {running ? "Starting..." : data.pipeline_id ? "Re-run" : "Run pipeline"}
      </Button>
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
    </div>
  )
}
