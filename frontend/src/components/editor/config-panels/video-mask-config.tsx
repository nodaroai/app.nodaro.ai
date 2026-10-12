"use client"

import { VIDEO_MASK_LIMITS, VIDEO_MASK_PROVIDERS, resolveVideoMaskProvider, type VideoMaskProvider } from "@nodaro/shared"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
        <p className="text-[10px] text-muted-foreground">{t("imgcfg.matchHint")}</p>
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
        <p className="text-[10px] text-muted-foreground">{t("vidcfg.videoMaskPricingHint")}</p>
      </div>
    </div>
  )
}
