"use client"

import { VIDEO_MASK_LIMITS, VIDEO_MASK_PROVIDERS, resolveVideoMaskProvider, resolveVideoMaskZone, type VideoMaskProvider, type VideoMaskZone } from "@nodaro/shared/media"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { PromptEditor } from "@/lib/picker-ui"
import { usePromptEditorRefs } from "@/components/nodes/inline-node-prompt/use-prompt-editor-refs"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import { useT } from "@/lib/i18n"
import { CompareModelsLink } from "@/components/editor/node-docs/compare-models-link"
import { SnippetMenuButton } from "./snippet-menu-button"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import type { VideoMaskNodeData } from "@/types/nodes"
import type { ConfigProps } from "./types"

/** Display names of the segmentation models (brand names — not translated). */
const VIDEO_MASK_PROVIDER_LABELS: Record<VideoMaskProvider, string> = {
  "sam-3.1": "SAM 3.1",
  "sam-3": "SAM 3",
}

/** The zone's four margins, in the order the panel lays them out (i18n key, field). */
const ZONE_SIDES = [
  ["vidcfg.videoMaskZoneLeft", "leftPct"],
  ["vidcfg.videoMaskZoneRight", "rightPct"],
  ["vidcfg.videoMaskZoneTop", "topPct"],
  ["vidcfg.videoMaskZoneBottom", "bottomPct"],
] as const satisfies ReadonlyArray<readonly [string, keyof VideoMaskZone]>

const NO_ZONE: VideoMaskZone = { leftPct: 0, rightPct: 0, topPct: 0, bottomPct: 0 }

/**
 * Video Mask settings: the subject to track (prompt, with the Edit⇄Final
 * toggle and snippets, like Generate Mask), the detection threshold, and the
 * model. Every bound comes from `VIDEO_MASK_LIMITS` — the same numbers the
 * route's Zod schema and the MCP verb read.
 */
export function VideoMaskConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<VideoMaskNodeData> & { nodeId?: string }) {
  const t = useT()
  const { referenceImages, nodeRefs, refMap, promptSnippets } = usePromptEditorRefs(nodeId ?? "")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  const threshold = data.threshold ?? VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT
  const provider = resolveVideoMaskProvider(data.provider)
  const minSubjectHeightPct = typeof data.minSubjectHeightPct === "number" && Number.isFinite(data.minSubjectHeightPct)
    ? Math.min(VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MAX, Math.max(VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MIN, data.minSubjectHeightPct))
    : VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MIN
  const maxSubjectHeightPct = typeof data.maxSubjectHeightPct === "number" && Number.isFinite(data.maxSubjectHeightPct)
    ? Math.min(VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MAX, Math.max(VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MIN, data.maxSubjectHeightPct))
    : VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MIN
  // Both cuts set with the minimum above the maximum: nothing could be kept (the run is refused).
  const emptyBand = minSubjectHeightPct > 0 && maxSubjectHeightPct > 0 && minSubjectHeightPct > maxSubjectHeightPct
  // The zone as a run reads it (clamped, all 0 = off); a margin edit keeps the others and stores null when all are 0.
  const zone = resolveVideoMaskZone(data.zone) ?? NO_ZONE
  const setZoneMargin = (field: keyof VideoMaskZone, pct: number) => onUpdate({ zone: resolveVideoMaskZone({ ...zone, [field]: pct }) })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground px-1">{t("vidcfg.videoMaskDesc")}</p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">{t("imgcfg.describeWhatToMask")}</label>
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="video" />
          </span>
        </div>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("imgcfg.maskPromptPreviewEmpty")}
            minHeightRem={2 * 1.5}
          />
        ) : (
          <PromptEditor
            rows={2}
            value={data.prompt ?? ""}
            onChange={(v) => onUpdate({ prompt: v })}
            placeholder={t("vidcfg.videoMaskPromptExamples")}
            referenceImages={referenceImages}
            nodeRefs={nodeRefs}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">{t("imgcfg.detectionThreshold")}</label>
          <span className="text-xs text-muted-foreground">{threshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          aria-label={t("imgcfg.detectionThreshold")}
          min={VIDEO_MASK_LIMITS.THRESHOLD_MIN}
          max={VIDEO_MASK_LIMITS.THRESHOLD_MAX}
          step={VIDEO_MASK_LIMITS.THRESHOLD_STEP}
          value={threshold}
          onChange={(e) => onUpdate({ threshold: parseFloat(e.target.value) })}
          className="w-full accent-[#ff0073]"
        />
        <p className="text-[11px] text-muted-foreground">{t("imgcfg.matchHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium text-muted-foreground">{t("field.model")}</label>
          <CompareModelsLink />
        </div>
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: resolveVideoMaskProvider(v) })}
          disabled={VIDEO_MASK_PROVIDERS.length < 2}
        >
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_MASK_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>{VIDEO_MASK_PROVIDER_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskPricingHint")}</p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="video-mask-hold-last"
            checked={data.holdLastMask === true}
            onChange={(e) => onUpdate({ holdLastMask: e.target.checked })}
            className="accent-[#ff0073]"
          />
          <label htmlFor="video-mask-hold-last" className="text-xs font-medium text-muted-foreground">{t("vidcfg.videoMaskHoldLastMask")}</label>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskHoldLastMaskHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="video-mask-min-subject-height" className="text-xs font-medium text-muted-foreground">{t("vidcfg.videoMaskMinSubjectHeight")}</label>
          <span className="text-xs text-muted-foreground shrink-0">{minSubjectHeightPct > 0 ? `${minSubjectHeightPct}%` : t("vidcfg.videoMaskMinSubjectHeightOff")}</span>
        </div>
        <input
          id="video-mask-min-subject-height"
          type="range"
          min={VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MIN}
          max={VIDEO_MASK_LIMITS.MIN_SUBJECT_HEIGHT_PCT_MAX}
          step={1}
          value={minSubjectHeightPct}
          onChange={(e) => onUpdate({ minSubjectHeightPct: parseInt(e.target.value, 10) })}
          className="w-full accent-[#ff0073]"
        />
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskMinSubjectHeightHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="video-mask-max-subject-height" className="text-xs font-medium text-muted-foreground">{t("vidcfg.videoMaskMaxSubjectHeight")}</label>
          <span className="text-xs text-muted-foreground shrink-0">{maxSubjectHeightPct > 0 ? `${maxSubjectHeightPct}%` : t("vidcfg.videoMaskMinSubjectHeightOff")}</span>
        </div>
        <input
          id="video-mask-max-subject-height"
          type="range"
          min={VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MIN}
          max={VIDEO_MASK_LIMITS.MAX_SUBJECT_HEIGHT_PCT_MAX}
          step={1}
          value={maxSubjectHeightPct}
          onChange={(e) => onUpdate({ maxSubjectHeightPct: parseInt(e.target.value, 10) })}
          className="w-full accent-[#ff0073]"
        />
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskMaxSubjectHeightHint")}</p>
        {emptyBand && <p role="alert" className="text-[11px] text-amber-600 dark:text-amber-400">{t("vidcfg.videoMaskSizeBandEmpty")}</p>}
      </div>

      <fieldset className="flex flex-col gap-1.5 min-w-0">
        <legend className="text-xs font-medium text-muted-foreground mb-1.5">{t("vidcfg.videoMaskZone")}</legend>
        <div className="grid grid-cols-2 gap-2">
          {ZONE_SIDES.map(([labelKey, field]) => (
            <div key={field} className="flex flex-col gap-1 min-w-0">
              <label htmlFor={`video-mask-zone-${field}`} className="text-[11px] text-muted-foreground">{t(labelKey)}</label>
              <ClampedNumberInput
                id={`video-mask-zone-${field}`}
                min={VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MIN}
                max={VIDEO_MASK_LIMITS.ZONE_MARGIN_PCT_MAX}
                step={1}
                value={zone[field]}
                onCommit={(v) => setZoneMargin(field, v ?? 0)}
                className="h-11 md:h-8 text-base md:text-xs"
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskZoneHint")}</p>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="video-mask-per-shot" className="flex items-center gap-2 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            id="video-mask-per-shot"
            checked={data.perShot === true}
            onChange={(e) => onUpdate({ perShot: e.target.checked })}
            className="accent-[#ff0073] size-4 shrink-0"
          />
          <span className="text-xs font-medium text-muted-foreground">{t("vidcfg.videoMaskPerShot")}</span>
        </label>
        <p className="text-[11px] text-muted-foreground">{t("vidcfg.videoMaskPerShotHint")}</p>
      </div>
    </div>
  )
}
