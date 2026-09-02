"use client"

import { useMemo, useState } from "react"
import type { GenerativePipelineNodeData } from "@/types/nodes"
import { PIPELINE_FORMATS, PIPELINE_MODES, PIPELINE_OUTPUT_RESOLUTIONS, PIPELINE_PINNABLE_IMAGE_MODELS, PIPELINE_PINNABLE_SCRIPT_LLMS, PIPELINE_PINNABLE_VIDEO_MODELS, VIDEO_CRITIC_FRAME_MODES, validateDurationForFormat, type PipelineFormat, type PipelineMode, type VideoCriticFrameMode } from "@nodaro/shared"
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
import { ModelSearchSelect } from "./model-search-select"
import { useT, tx } from "@/lib/i18n"
import type { ConfigProps } from "./types"

function MODE_LABELS(): Record<PipelineMode, string> {
  return {
    manual: tx("audiocfg.manual"),
    auto: tx("pipe.styleAuto"),
    guided: tx("cfgext.genModeGuided"),
  }
}

/** Display names for the pipeline format enum (was `format.replace("_", " ")`). */
function FORMAT_LABELS(): Record<PipelineFormat, string> {
  return {
    trailer: tx("cfgext.genFormatTrailer"),
    short_film: tx("cfgext.genFormatShortFilm"),
    music_video: tx("cfgext.genFormatMusicVideo"),
    reel: tx("cfgext.genFormatReel"),
    commercial: tx("cfgext.genFormatCommercial"),
  }
}

function MODE_DESCRIPTIONS(): Record<PipelineMode, string> {
  return {
    manual: tx("cfgext.genModeManualDesc"),
    auto: tx("cfgext.genModeAutoDesc"),
    guided: tx("cfgext.genModeGuidedDesc"),
  }
}

function VIDEO_CRITIC_FRAME_LABELS(): Record<VideoCriticFrameMode, string> {
  return {
    first_last: tx("cfgext.genFramesFirstLast"),
    first_middle_last: tx("cfgext.genFramesFirstMiddleLast"),
    five_evenly: tx("cfgext.genFramesFiveEvenly"),
  }
}

function VIDEO_CRITIC_FRAME_DESCRIPTIONS(): Record<VideoCriticFrameMode, string> {
  return {
    first_last: tx("cfgext.genFramesFirstLastDesc"),
    first_middle_last: tx("cfgext.genFramesFirstMiddleLastDesc"),
    five_evenly: tx("cfgext.genFramesFiveEvenlyDesc"),
  }
}

// Labels for each pinnable model. The model id list lives in
// `@nodaro/shared::PIPELINE_PINNABLE_*` so the Zod schema and these dropdowns
// can't drift. Labels intentionally match the credit-table identifier — e.g.
// `veo3` is VEO 3.1 Quality (~125cr/shot), `veo3.1` is VEO 3.1 Fast
// (~30-40cr/shot) per backend/CLAUDE.md.
function IMAGE_MODEL_LABELS(): Record<string, string> {
  return {
    "nano-banana": tx("cfgext.genImgNanoBanana"),
    "nano-banana-pro": tx("cfgext.genImgNanoBananaPro"),
    "nano-banana-2": tx("cfgext.genImgNanoBanana2"),
    flux: "Flux Pro",
    "gpt-image": "GPT Image",
    "gpt-image-2": "GPT Image 2",
  }
}

function VIDEO_MODEL_LABELS(): Record<string, string> {
  return {
    "kling-turbo": tx("cfgext.genVidKlingTurbo"),
    kling: "Kling",
    "kling-3.0": "Kling 3.0",
    seedance: "Seedance",
    "seedance-2": "Seedance 2",
    "seedance-2-fast": "Seedance 2 Fast",
    "seedance-2-mini": "Seedance 2 Mini",
    "seedance-2-5": "Seedance 2.5",
    veo3: tx("cfgext.genVidVeo3Quality"),
    "veo3.1": tx("cfgext.genVidVeo3Fast"),
    veo3_lite: tx("cfgext.genVidVeo3Lite"),
    minimax: "MiniMax",
    "hailuo-standard": "Hailuo Standard",
    "wan-turbo": "Wan Turbo",
    "bytedance-lite": "Bytedance Lite",
    "bytedance-pro": "Bytedance Pro",
  }
}

function SCRIPT_LLM_LABELS(): Record<string, string> {
  return {
    "claude-haiku-4-5": tx("cfgext.genLlmHaiku45"),
    "claude-sonnet-4-6": tx("cfgext.genLlmSonnet46"),
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-opus-5": tx("cfgext.genLlmOpus5"),
  }
}

// Build dropdown options from the shared allowlist + an "Auto" sentinel.
// `"" ` is mapped to `"auto"` in the Radix Select (empty string is reserved
// by Radix for "no selection"). The onValueChange normalizes back to
// undefined so the API receives an absent key, NOT an empty string (which the
// Zod enum would reject).
function buildOptions(
  ids: readonly string[],
  labels: Record<string, string>,
  autoLabel: string,
): readonly { value: string; label: string }[] {
  return [
    { value: "auto", label: autoLabel },
    ...ids.map((id) => ({ value: id, label: labels[id] ?? id })),
  ]
}

export function GenerativePipelineConfig({ data, onUpdate }: ConfigProps<GenerativePipelineNodeData>) {
  const t = useT()
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const format: PipelineFormat = data.format ?? "short_film"
  const duration = data.target_duration_seconds ?? 35
  const validation = validateDurationForFormat(format, duration)

  // Built per-locale (not at module load) so the "Auto" sentinel and the model
  // labels follow a language switch; memoized on `t` so the child select does
  // not see a fresh array identity on every render.
  const imageModelOptions = useMemo(
    () => buildOptions(PIPELINE_PINNABLE_IMAGE_MODELS, IMAGE_MODEL_LABELS(), t("cfgext.genAutoDirectorPicks")),
    [t],
  )
  const videoModelOptions = useMemo(
    () => buildOptions(PIPELINE_PINNABLE_VIDEO_MODELS, VIDEO_MODEL_LABELS(), t("cfgext.genAutoDirectorPicks")),
    [t],
  )
  const scriptLlmOptions = useMemo(
    () => buildOptions(PIPELINE_PINNABLE_SCRIPT_LLMS, SCRIPT_LLM_LABELS(), t("cfgext.genAutoSonnet")),
    [t],
  )

  async function handleRun() {
    if (!selectedNodeId) {
      setErr(tx("cfgext.genErrNoNode"))
      return
    }
    if (!validation.ok) {
      setErr(validation.reason)
      return
    }
    if (!data.story_prompt || data.story_prompt.length < 1) {
      setErr(tx("cfgext.genErrStoryPromptRequired"))
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
      setErr(e instanceof Error ? e.message : tx("cfgext.genErrFailedStart"))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="story_prompt">{t("cfgext.genStoryPrompt")}</Label>
        <Textarea
          id="story_prompt"
          value={data.story_prompt ?? ""}
          onChange={(e) => onUpdate({ story_prompt: e.target.value })}
          rows={6}
          maxLength={4000}
          placeholder={t("cfgext.genStoryPromptPh")}
        />
      </div>
      <div>
        <Label htmlFor="target_duration_seconds">{t("cfgext.genTargetDuration")}</Label>
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
        <Label>{t("utilcfg.format")}</Label>
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
                {FORMAT_LABELS()[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("cfgext.genOutputResolution")}</Label>
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
        <Label>{t("field.mode")}</Label>
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
                {MODE_LABELS()[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {MODE_DESCRIPTIONS()[data.mode ?? "manual"]}
        </div>
      </div>
      <div>
        <Label>{t("cfgext.genVideoCriticFrames")}</Label>
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
                {VIDEO_CRITIC_FRAME_LABELS()[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {VIDEO_CRITIC_FRAME_DESCRIPTIONS()[
            data.video_critic_frame_count ?? "first_last"
          ]}
        </div>
      </div>
      <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t("cfgext.genModelsOptional")}
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="image_model">{t("pipe.imageModel")}</Label>
            <ModelSearchSelect
              value={data.image_model || "auto"}
              onChange={(v) => onUpdate({ image_model: v === "auto" ? undefined : v })}
              options={imageModelOptions}
              ariaLabel={t("pipe.imageModel")}
            />
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("cfgext.genImageModelHint")}
            </div>
          </div>
          <div>
            <Label htmlFor="video_model">{t("pipe.videoModel")}</Label>
            <ModelSearchSelect
              value={data.video_model || "auto"}
              onChange={(v) => onUpdate({ video_model: v === "auto" ? undefined : v })}
              options={videoModelOptions}
              ariaLabel={t("pipe.videoModel")}
            />
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("cfgext.genVideoModelHint")}
            </div>
          </div>
          <div>
            <Label htmlFor="script_llm">{t("cfgext.genScriptLlm")}</Label>
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
                {scriptLlmOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("cfgext.genScriptLlmHint")}
            </div>
          </div>
        </div>
      </div>
      <Button onClick={handleRun} disabled={running || !validation.ok}>
        {running ? t("cfgext.genStarting") : data.pipeline_id ? t("cfgext.genRerun") : t("cfgext.genRunPipeline")}
      </Button>
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
    </div>
  )
}
