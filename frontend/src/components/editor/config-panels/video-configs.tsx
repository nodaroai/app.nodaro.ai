"use client"

import { useMemo, useState, useCallback, useEffect, lazy, Suspense } from "react"
import { ImageIcon, FileText } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CachedImage } from "@/components/ui/cached-image"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { getCachedCredits, prefetchModelCredits } from "@/hooks/use-model-credits"
import {
  getModels,
  getFirstModel,
  type ProviderCategory,
} from "@/lib/providers-config"
import { Button } from "@/components/ui/button"
import { X, Plus, Wand2 } from "lucide-react"
import { toast } from "sonner"
import type {
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  MotionTransferData,
  VideoUpscaleData,
  ExtendVideoData,
  SpeechToVideoData,
  SoraStoryboardData,
  GeneratedScript,
  GeneratedScriptResult,
} from "@/types/nodes"
import { VIDEO_I2V_MODELS, VIDEO_T2V_MODELS, VIDEO_V2V_MODELS, KIE_VIDEO_DURATIONS, KIE_T2V_DURATIONS, PROVIDERS_WITH_END_FRAME, KLING3_DURATIONS, VIDEO_RATIOS } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { MappableField } from "./mappable-field"
import { TagTextarea } from "./tag-textarea"
import { Kling3StudioConfig } from "./kling3-studio-config"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { getConnectedProviderModel } from "./helpers"
import { ConnectedMediaList } from "./connected-media-list"
import type { ConfigProps } from "./types"
import { PromptHelperButton } from "./prompt-helper-button"
import { buildEnrichedScenePrompt, type EnrichableScene } from "@nodaro-shared/prompt-builder"


export function ImageToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, onUpdateNode, nodeRefs, refMap, variableDisplayMode }: ConfigProps<ImageToVideoData>) {
  useEffect(() => { prefetchModelCredits([...VIDEO_I2V_MODELS.map((m) => m.value), "sora-watermark-remove"]) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const baseDurations = KIE_VIDEO_DURATIONS[data.provider || "minimax"] || null
  // Hailuo 2.3 Pro/Standard: 1080P only supports 6s duration
  const allowedDurations = baseDurations && (data.provider === "hailuo-2.3-pro" || data.provider === "hailuo-2.3") && data.resolution === "1080P"
    ? baseDurations.filter((d) => d <= 6)
    : baseDurations
  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(data.provider || "minimax")

  const connectedTextPrompts = useMemo(() => {
    return sources.filter((s) => s.type === "text-prompt").map((s) => ({
      id: s.id,
      label: s.label,
      text: (s.nodeData?.text as string) || "",
      targetHandle: s.targetHandle,
    }))
  }, [sources])

  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type)).map((s) => {
      let imageUrl: string | undefined
      const nodeData = s.nodeData || {}

      if (s.type === "upload-image") {
        imageUrl = (nodeData.url as string) || undefined
      } else if (s.type === "generate-image" || s.type === "edit-image" || s.type === "image-to-image" || s.type === "scene") {
        const results = nodeData.generatedResults as Array<{ url?: string }> | undefined
        // Edge output mode: "item:N" overrides activeResultIndex
        let activeIndex = (nodeData.activeResultIndex as number) ?? 0
        if (s.edgeOutputMode?.startsWith("item:")) {
          activeIndex = parseInt(s.edgeOutputMode.split(":")[1], 10)
        } else if (s.edgeOutputMode === "last" && results && results.length > 0) {
          activeIndex = results.length - 1
        }
        if (results && results.length > 0) {
          imageUrl = results[activeIndex]?.url || results[0]?.url
        }
        if (!imageUrl) {
          imageUrl = (nodeData.generatedImageUrl as string) || undefined
        }
      } else if (s.type === "character" || s.type === "object" || s.type === "location") {
        imageUrl = (nodeData.sourceImageUrl as string) || undefined
      }

      let displayLabel = s.label
      if (s.targetHandle === "startFrame") {
        displayLabel = `Start: ${s.label}`
      } else if (s.targetHandle === "endFrame") {
        displayLabel = `End: ${s.label}`
      }

      return {
        id: s.id,
        type: s.type,
        label: displayLabel,
        imageUrl,
        targetHandle: s.targetHandle,
      }
    })
  }, [sources])

  const handleTextPromptChange = useCallback((nodeId: string, newText: string) => {
    if (onUpdateNode) {
      onUpdateNode(nodeId, { text: newText })
    }
  }, [onUpdateNode])

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} onUpdateNode={onUpdateNode} />
  }

  return (
    <div className="flex flex-col gap-3">
      {connectedImages.length > 0 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.connectedImageOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ connectedImageOrder: order })}
          acceptedTypes={new Set(["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"])}
          mediaType="image"
          primaryLabel="Start Frame"
        />
      )}

      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_I2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>

      {connectedTextPrompts.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Prompt (from connected node)
          </Label>
          {connectedTextPrompts.map((prompt, idx) => (
            <div key={`${prompt.id}-${idx}`} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3 h-3 text-[#ff0073]" />
                <span className="text-[10px] text-[#ff0073] font-medium">{prompt.label}</span>
              </div>
              <Textarea
                value={prompt.text}
                onChange={(e) => handleTextPromptChange(prompt.id, e.target.value)}
                placeholder="Enter prompt..."
                rows={3}
                className="text-xs bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          ))}
        </div>
      )}

      {connectedTextPrompts.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm">
          <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="image-to-video" currentPrompt={data.prompt || ""} provider={data.provider} duration={data.duration} onAccept={(v) => onUpdate({ prompt: v })} />}>
            <Textarea
              value={data.prompt || ""}
              onChange={(e) => onUpdate({ prompt: e.target.value })}
              placeholder="Describe the motion or animation you want..."
              rows={3}
              className="text-xs bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
            />
          </MappableField>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Tip: Connect a Text Prompt node for reusable prompts
          </p>
        </div>
      )}

      {(data.provider === "veo3" || data.provider === "veo3.1") && (
        <>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "Auto", label: "Auto (from image)" },
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div>
            <Label className="text-xs">Seed (optional)</Label>
            <Input
              type="number"
              min={10000}
              max={99999}
              placeholder="10000–99999"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 px-1">
              <input
                type="checkbox"
                id="generateAudio"
                checked={data.generateAudio !== false}
                onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
                className="rounded border-muted-foreground/40"
              />
              <label htmlFor="generateAudio" className="text-xs">Generate Audio</label>
            </div>
            <p className="text-xs text-muted-foreground px-1">VEO 3.1 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
          </div>
        </>
      )}
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger aria-label="Duration (seconds)"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3" || data.provider === "veo3.1"
            ? "VEO 3.1 produces ~8 second videos (not configurable)."
            : `${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {supportsEndFrame && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">End Frame (optional)</Label>
          <p className="text-xs text-muted-foreground px-1">
            Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame video generation.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="motionEnabled"
            checked={!!data.motionEnabled}
            onChange={(e) => onUpdate({ motionEnabled: e.target.checked, ...(!e.target.checked ? { motion: undefined } : {}) })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="motionEnabled" className="text-xs">Motion hint (injected into prompt)</label>
        </div>
        {data.motionEnabled && (
          <MappableField field="motion" label="Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.motion || "moderate"}
              onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
            >
              <SelectTrigger aria-label="Motion"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="subtle">Subtle</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="dynamic">Dynamic</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="cameraMotionEnabled"
            checked={!!data.cameraMotionEnabled}
            onChange={(e) => onUpdate({ cameraMotionEnabled: e.target.checked, ...(!e.target.checked ? { cameraMotion: undefined } : {}) })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="cameraMotionEnabled" className="text-xs">Camera motion hint (injected into prompt)</label>
        </div>
        {data.cameraMotionEnabled && (
          <MappableField field="cameraMotion" label="Camera Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Select
              value={data.cameraMotion || "static"}
              onValueChange={(v) => onUpdate({ cameraMotion: v as ImageToVideoData["cameraMotion"] })}
            >
              <SelectTrigger aria-label="Camera Motion"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static</SelectItem>
                <SelectItem value="pan-left">Pan Left</SelectItem>
                <SelectItem value="pan-right">Pan Right</SelectItem>
                <SelectItem value="zoom-in">Zoom In</SelectItem>
                <SelectItem value="zoom-out">Zoom Out</SelectItem>
              </SelectContent>
            </Select>
          </MappableField>
        )}
      </div>

      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="klingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="klingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {data.provider === "kling-turbo" && (
        <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </MappableField>
      )}

      {(data.provider === "kling-turbo" || data.provider === "kling-master") && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={((data as Record<string, unknown>).cfgScale as number) ?? ""}
            onChange={(e) => onUpdate({ cfgScale: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {data.provider === "kling-master" && (
        <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </MappableField>
      )}

      {data.provider === "grok-i2v" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select
              value={data.grokMode || "normal"}
              onValueChange={(v) => onUpdate({ grokMode: v as "fun" | "normal" | "spicy" })}
            >
              <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="fun">Fun</SelectItem>
                <SelectItem value="spicy">Spicy</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {data.provider === "sora2-pro" && (
        <div>
          <Label className="text-xs">Quality</Label>
          <Select
            value={data.videoSize || "standard"}
            onValueChange={(v) => onUpdate({ videoSize: v as "standard" | "high" })}
          >
            <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard (720p)</SelectItem>
              <SelectItem value="high">High (1080p)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.provider === "sora2" || data.provider === "sora2-pro") && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="i2vRemoveWatermark"
              checked={data.removeWatermark || false}
              onChange={(e) => onUpdate({ removeWatermark: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="i2vRemoveWatermark" className="text-xs">{`Remove Watermark (+${getCachedCredits("sora-watermark-remove") ?? 4} CR)`}</label>
          </div>
          <p className="text-[10px] text-muted-foreground px-1">Runs a post-processing step to remove the Sora watermark.</p>
        </div>
      )}

      {data.provider === "seedance" && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "720p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <AspectRatioSelector
              options={[
                { value: "16:9", label: "16:9 (Landscape)" },
                { value: "9:16", label: "9:16 (Portrait)" },
                { value: "1:1", label: "1:1 (Square)" },
                { value: "21:9", label: "21:9 (Ultra-wide)" },
              ]}
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            />
          </MappableField>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedanceFixedLens"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedanceFixedLens" className="text-xs">Fixed Lens (no camera movement)</label>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="seedanceAudio"
              checked={data.generateAudio || false}
              onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="seedanceAudio" className="text-xs">Generate Audio</label>
          </div>
        </>
      )}

      {(data.provider === "wan-i2v" || data.provider === "wan-turbo") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || (data.provider === "wan-turbo" ? "480p" : "720p")}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.provider === "wan-turbo" ? (
                <>
                  <SelectItem value="480p">480p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.provider === "hailuo-2.3-pro" || data.provider === "hailuo-2.3" || data.provider === "hailuo-standard") && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || "768P"}
            onValueChange={(v) => {
              const updates: Record<string, unknown> = { resolution: v }
              // 1080P only supports 6s — snap duration if needed
              if (v === "1080P" && data.duration && data.duration > 6) {
                updates.duration = 6
              }
              onUpdate(updates)
            }}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {data.provider === "hailuo-standard" ? (
                <>
                  <SelectItem value="512P">512P</SelectItem>
                  <SelectItem value="768P">768P</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="768P">768P</SelectItem>
                  <SelectItem value="1080P">1080P (6s max)</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(data.provider === "bytedance-lite" || data.provider === "bytedance-pro") && (
        <>
          <div>
            <Label className="text-xs">Resolution</Label>
            <Select
              value={data.resolution || "480p"}
              onValueChange={(v) => onUpdate({ resolution: v })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="bytedanceCameraFixed"
              checked={data.cameraFixed || false}
              onChange={(e) => onUpdate({ cameraFixed: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="bytedanceCameraFixed" className="text-xs">Camera Fixed</label>
          </div>
          <div>
            <Label className="text-xs">Seed (-1 for random)</Label>
            <Input
              type="number"
              min={-1}
              max={2147483647}
              value={data.seed ?? -1}
              onChange={(e) => onUpdate({ seed: parseInt(e.target.value, 10) })}
            />
          </div>
        </>
      )}

      {data.provider === "bytedance-pro-fast" && (
        <div>
          <Label className="text-xs">Resolution</Label>
          <Select
            value={data.resolution || "720p"}
            onValueChange={(v) => onUpdate({ resolution: v })}
          >
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}

export function VideoToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<VideoToVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "wan"}
          onValueChange={(v) => onUpdate({ provider: v as VideoToVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_V2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="video-to-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(v) => onUpdate({ prompt: v })} />}>
        <TagTextarea
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe what to change or continue..."
          rows={3}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
    </div>
  )
}

const MOTION_VIDEO_NODE_TYPES = new Set(["image-to-video", "text-to-video", "video-to-video", "upload-video", "motion-transfer", "extend-video", "speech-to-video", "sora-storyboard"])

export function MotionTransferConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<MotionTransferData>) {
  const provider = data.provider || "kling"

  // Detect video duration from connected upstream video node's metadata or URL
  const connectedVideoInfo = useMemo(() => {
    for (const s of sources) {
      if (MOTION_VIDEO_NODE_TYPES.has(s.type)) {
        // Try metadata duration first (instant, no network)
        const meta = s.nodeData?.metadata as { durationSeconds?: number } | undefined
        if (meta?.durationSeconds && meta.durationSeconds > 0) {
          return { durationSeconds: meta.durationSeconds }
        }
        const url = (s.nodeData?.generatedVideoUrl as string) || (s.nodeData?.videoUrl as string) || (s.nodeData?.url as string)
        if (url) return { url }
      }
    }
    return undefined
  }, [sources])

  useEffect(() => {
    if (!connectedVideoInfo) {
      if (data.videoDuration != null) onUpdate({ videoDuration: undefined })
      return
    }
    // If we already have duration from metadata, use it directly
    if ("durationSeconds" in connectedVideoInfo) {
      const dur = Math.floor(connectedVideoInfo.durationSeconds!)
      if (dur !== data.videoDuration) onUpdate({ videoDuration: dur })
      return
    }
    // Fallback: load video metadata from URL
    const video = document.createElement("video")
    video.preload = "metadata"
    video.src = connectedVideoInfo.url!
    video.onloadedmetadata = () => {
      if (video.duration && video.duration !== Infinity && isFinite(video.duration)) {
        const dur = Math.floor(video.duration)
        if (dur !== data.videoDuration) onUpdate({ videoDuration: dur })
      }
    }
    return () => { video.onloadedmetadata = null; video.src = "" }
  }, [connectedVideoInfo])

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: v as MotionTransferData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="kling">Kling 2.6</SelectItem>
            <SelectItem value="kling-3.0">Kling 3.0</SelectItem>
            <SelectItem value="wan-animate-move">Wan Animate Move</SelectItem>
            <SelectItem value="wan-animate-replace">Wan Animate Replace</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="motion-transfer" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(v) => onUpdate({ prompt: v })} />}>
        <TagTextarea
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v.slice(0, 2500) })}
          placeholder="Optional: Describe the motion transfer..."
          rows={2}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <span className="text-xs text-muted-foreground">{data.prompt?.length || 0}/2500</span>
      </MappableField>
      {provider !== "wan-animate-move" && provider !== "wan-animate-replace" && (
        <MappableField field="characterOrientation" label="Character Orientation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.characterOrientation || "video"}
            onValueChange={(v) => onUpdate({ characterOrientation: v as MotionTransferData["characterOrientation"] })}
          >
            <SelectTrigger aria-label="Character Orientation"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image (same as picture{provider === "kling" ? ", max 10s" : ""})</SelectItem>
              <SelectItem value="video">Video (consistent with video{provider === "kling" ? ", max 30s" : ""})</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}
      {provider === "kling-3.0" && (
        <MappableField field="backgroundSource" label="Background Source" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.backgroundSource || "input_video"}
            onValueChange={(v) => onUpdate({ backgroundSource: v as MotionTransferData["backgroundSource"] })}
          >
            <SelectTrigger aria-label="Background Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="input_video">Input Video</SelectItem>
              <SelectItem value="input_image">Input Image</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.resolution || (provider === "wan-animate-move" || provider === "wan-animate-replace" ? "480p" : "720p")}
          onValueChange={(v) => onUpdate({ resolution: v as MotionTransferData["resolution"] })}
        >
          <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
          <SelectContent>
            {provider === "wan-animate-move" || provider === "wan-animate-replace" ? (
              <>
                <SelectItem value="480p">480p</SelectItem>
                <SelectItem value="580p">580p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </>
            ) : (
              <>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </MappableField>
      {data.videoDuration != null && (
        <p className="text-xs text-muted-foreground px-1">
          ~{data.videoDuration}s video detected. Cost scales with duration.
        </p>
      )}
      <p className="text-xs text-muted-foreground px-1">
        {({ "kling-3.0": "Uses Kling 3.0 Motion Control. Connect image and video inputs.",
           "wan-animate-move": "Moves character from image within the video scene (~1s output).",
           "wan-animate-replace": "Replaces character in video with character from image (~1s output).",
        } as Record<string, string>)[provider] ?? "Uses Kling 2.6 Motion Control. Connect image and video inputs."}
      </p>
    </div>
  )
}

export function VideoUpscaleConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<VideoUpscaleData>) {
  useEffect(() => { prefetchModelCredits(["veo-1080p", "veo-4k"]) }, [])
  const provider = data.provider || "topaz"
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={provider}
          onValueChange={(v) => onUpdate({ provider: v as VideoUpscaleData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="topaz">Topaz (factor-based)</SelectItem>
            <SelectItem value="veo-1080p">{`VEO 1080p (${getCachedCredits("veo-1080p") ?? 2} CR)`}</SelectItem>
            <SelectItem value="veo-4k">{`VEO 4K (${getCachedCredits("veo-4k") ?? 38} CR)`}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      {provider === "topaz" && (
        <MappableField field="upscaleFactor" label="Upscale Factor" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.upscaleFactor || "2"}
            onValueChange={(v) => onUpdate({ upscaleFactor: v as VideoUpscaleData["upscaleFactor"] })}
          >
            <SelectTrigger aria-label="Upscale Factor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x (no upscale, AI enhance only)</SelectItem>
              <SelectItem value="2">2x (recommended)</SelectItem>
              <SelectItem value="4">4x (maximum)</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}

      <p className="text-xs text-muted-foreground px-1">
        {provider === "topaz"
          ? "Uses Topaz Video Upscaler. Max 50MB input video."
          : "Upscales a VEO video to higher resolution. Connect an upstream VEO video node."}
      </p>
    </div>
  )
}

export function TextToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextToVideoData>) {
  useEffect(() => { prefetchModelCredits([...VIDEO_T2V_MODELS.map((m) => m.value), "sora-watermark-remove"]) }, [])
  const category: ProviderCategory = "video"
  const models = getModels(category, data.provider)
  const connectedModel = getConnectedProviderModel(fieldMappings, sources, nodes)
  const allowedDurations = KIE_T2V_DURATIONS[data.provider || "minimax"] || null

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} />
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "minimax"}
          onValueChange={(v) => {
            const firstModel = getFirstModel(category, v)
            onUpdate({ provider: v, model: firstModel })
          }}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VIDEO_T2V_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="text-to-video" currentPrompt={data.prompt || ""} provider={data.provider} duration={data.duration} onAccept={(v) => onUpdate({ prompt: v })} />}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the video to generate..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <div>
        <Label className="text-xs">Model</Label>
        {connectedModel ? (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 truncate">
            {connectedModel}
          </p>
        ) : (
          <Select
            value={data.model}
            onValueChange={(v) => onUpdate({ model: v })}
          >
            <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        {allowedDurations ? (
          <Select
            value={String(allowedDurations.includes(data.duration) ? data.duration : allowedDurations[0])}
            onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
          >
            <SelectTrigger aria-label="Duration (seconds)"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedDurations.map((d) => (
                <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            type="number"
            min={1}
            max={30}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3" || data.provider === "veo3.1"
            ? "VEO 3.1 produces ~8 second videos (not configurable)."
            : `${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
      )}
      {(data.provider === "veo3" || data.provider === "veo3.1") && (
        <div>
          <Label className="text-xs">Seed (optional)</Label>
          <Input
            type="number"
            min={10000}
            max={99999}
            placeholder="10000–99999"
            value={data.seed ?? ""}
            onChange={(e) => onUpdate({ seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
        </div>
      )}
      {data.provider === "kling" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="t2vKlingSound"
            checked={(data as Record<string, unknown>).kling3Sound !== false}
            onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="t2vKlingSound" className="text-xs">Enable Sound</label>
        </div>
      )}

      {data.provider === "kling-turbo" && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={((data as Record<string, unknown>).cfgScale as number) ?? ""}
            onChange={(e) => onUpdate({ cfgScale: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {(data.provider === "sora2" || data.provider === "sora2-pro") && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="t2vRemoveWatermark"
              checked={data.removeWatermark || false}
              onChange={(e) => onUpdate({ removeWatermark: e.target.checked })}
              className="rounded border-muted-foreground/40"
            />
            <label htmlFor="t2vRemoveWatermark" className="text-xs">{`Remove Watermark (+${getCachedCredits("sora-watermark-remove") ?? 4} CR)`}</label>
          </div>
          <p className="text-[10px] text-muted-foreground px-1">Runs a post-processing step to remove the Sora watermark.</p>
        </div>
      )}

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <AspectRatioSelector
          options={VIDEO_RATIOS}
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as TextToVideoData["aspectRatio"] })}
        />
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativePrompt}
          onChange={(v) => onUpdate({ negativePrompt: v })}
          placeholder="Things to avoid..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
    </div>
  )
}

export function ExtendVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<ExtendVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
        <Select
          value={data.provider || "veo-extend"}
          onValueChange={(v) => onUpdate({ provider: v as ExtendVideoData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="veo-extend">VEO Extend</SelectItem>
            <SelectItem value="runway-extend">Runway Extend</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="extend-video" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(v) => onUpdate({ prompt: v })} />}>
        <TagTextarea
          value={data.prompt || ""}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe how the video should continue..."
          rows={3}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>

      {data.provider === "veo-extend" && (
        <div>
          <Label className="text-xs">Model</Label>
          <Select
            value={data.model || "fast"}
            onValueChange={(v) => onUpdate({ model: v as "fast" | "quality" })}
          >
            <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast</SelectItem>
              <SelectItem value="quality">Quality</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {data.provider === "veo-extend" && (
        <div>
          <Label className="text-xs">Seed (optional)</Label>
          <Input
            type="number"
            min={10000}
            max={99999}
            placeholder="10000–99999"
            value={(data.seeds as number | undefined) ?? ""}
            onChange={(e) => onUpdate({ seeds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Same seed produces similar results. Leave empty for random.</p>
        </div>
      )}

      {data.provider === "runway-extend" && (
        <div>
          <Label className="text-xs">Quality</Label>
          <Select
            value={data.quality || "720p"}
            onValueChange={(v) => onUpdate({ quality: v as "720p" | "1080p" })}
          >
            <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <p className="text-xs text-muted-foreground px-1">
        Extends a VEO or Runway video with a new prompt. Connect an upstream Image to Video or Text to Video node that produces a kieTaskId.
      </p>
    </div>
  )
}


export function SpeechToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SpeechToVideoData>) {
  useEffect(() => { prefetchModelCredits(["speech-to-video", "speech-to-video:580p", "speech-to-video:720p"]) }, [])
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      {/* Resolution */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Resolution</Label>
        <Select
          value={data.resolution || "480p"}
          onValueChange={(v) => onUpdate({ resolution: v as "480p" | "580p" | "720p" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="480p">{`480p (${getCachedCredits("speech-to-video") ?? 4} credits)`}</SelectItem>
            <SelectItem value="580p">{`580p (${getCachedCredits("speech-to-video:580p") ?? 6} credits)`}</SelectItem>
            <SelectItem value="720p">{`720p (${getCachedCredits("speech-to-video:720p") ?? 8} credits)`}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Prompt</Label>
        <Textarea
          value={data.prompt || ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the speaking scene..."
          className="min-h-[80px] text-sm"
        />
      </div>

      {/* Negative Prompt */}
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.negativePrompt || ""}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value || undefined })}
          placeholder="What to avoid..."
          className="min-h-[60px] text-sm"
        />
      </MappableField>

      {/* Advanced Settings */}
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "Hide" : "Show"} Advanced Settings
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 border-t pt-3 border-muted-foreground/10">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Seed (optional)</Label>
            <Input
              type="number"
              value={data.seed ?? ""}
              onChange={(e) => onUpdate({ seed: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Random"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Num Frames (16-81)</Label>
            <Input
              type="number"
              value={data.numFrames ?? ""}
              onChange={(e) => onUpdate({ numFrames: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={16}
              max={81}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">FPS (8-24)</Label>
            <Input
              type="number"
              value={data.fps ?? ""}
              onChange={(e) => onUpdate({ fps: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={8}
              max={24}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Inference Steps (1-50)</Label>
            <Input
              type="number"
              value={data.inferenceSteps ?? ""}
              onChange={(e) => onUpdate({ inferenceSteps: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={1}
              max={50}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Guidance Scale (0-20)</Label>
            <Input
              type="number"
              step="0.1"
              value={data.guidanceScale ?? ""}
              onChange={(e) => onUpdate({ guidanceScale: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={0}
              max={20}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Shift (0-20)</Label>
            <Input
              type="number"
              step="0.1"
              value={data.shift ?? ""}
              onChange={(e) => onUpdate({ shift: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="Default"
              min={0}
              max={20}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground px-1">
        Generates a talking video from an image and audio using Wan 2.2 Speech-to-Video. Connect a portrait image, speech audio, and prompt.
      </p>
    </div>
  )
}


export function SoraStoryboardConfig({ data, onUpdate, sources }: ConfigProps<SoraStoryboardData>) {
  useEffect(() => { prefetchModelCredits(["sora-storyboard", "sora-storyboard:15", "sora-storyboard:25"]) }, [])
  const shots = data.shots ?? [{ scene: "", duration: 5 }]

  // Find connected generate-script source for "Fill from Script" button
  const scriptSource = sources.find((s) => s.type === "generate-script")
  const connectedScript = useMemo(() => {
    if (!scriptSource?.nodeData) return undefined
    const sd = scriptSource.nodeData as Record<string, unknown>
    const results = sd.generatedResults as GeneratedScriptResult[] | undefined
    const activeIndex = (sd.activeResultIndex as number | undefined) ?? 0
    return results?.[activeIndex]?.script ?? (sd.generatedScript as GeneratedScript | undefined)
  }, [scriptSource?.nodeData])

  const fillFromScript = useCallback(() => {
    if (!connectedScript?.scenes?.length) return
    const newShots = connectedScript.scenes.slice(0, 10).map((scene) => ({
      scene: buildEnrichedScenePrompt(scene as EnrichableScene),
      duration: Math.max(1, Math.min(10, scene.durationHint ?? 5)),
    }))
    onUpdate({ shots: newShots })
    toast.success(`Filled ${newShots.length} shots from script`)
  }, [connectedScript, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      {/* Connected Reference Images */}
      <ConnectedMediaList
        sources={sources}
        mediaOrder={data.imageOrder ?? []}
        onUpdateOrder={(order) => onUpdate({ imageOrder: order })}
        mediaType="image"
        emptyMessage="Connect image nodes for reference images"
      />

      {/* Fill from Script */}
      {connectedScript && connectedScript.scenes.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs gap-1.5"
          onClick={fillFromScript}
        >
          <Wand2 className="w-3.5 h-3.5" />
          Fill {Math.min(connectedScript.scenes.length, 10)} Shots from Script
        </Button>
      )}

      {/* Frames / Duration */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Duration (n_frames)</Label>
        <Select
          value={data.nFrames || "10"}
          onValueChange={(v) => onUpdate({ nFrames: v as "10" | "15" | "25" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="10">{`10 frames (~5s) - ${getCachedCredits("sora-storyboard") ?? 47} credits`}</SelectItem>
            <SelectItem value="15">{`15 frames (~10s) - ${getCachedCredits("sora-storyboard:15") ?? 85} credits`}</SelectItem>
            <SelectItem value="25">{`25 frames (~15s) - ${getCachedCredits("sora-storyboard:25") ?? 85} credits`}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Aspect Ratio */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Aspect Ratio</Label>
        <AspectRatioSelector
          options={[
            { value: "landscape", label: "Landscape (16:9)" },
            { value: "portrait", label: "Portrait (9:16)" },
          ]}
          value={data.aspectRatio || "landscape"}
          onValueChange={(v) => onUpdate({ aspectRatio: v as "portrait" | "landscape" })}
        />
      </div>

      {/* Shots Editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Shots ({shots.length}/10)</Label>
          {shots.length < 10 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => {
                onUpdate({ shots: [...shots, { scene: "", duration: 5 }] })
              }}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Shot
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {shots.map((shot, i) => (
            <div key={i} className="flex flex-col gap-1.5 p-2 rounded-lg border border-muted-foreground/10 bg-muted/5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground">Shot {i + 1}</span>
                {shots.length > 1 && (
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted-foreground/10 text-muted-foreground/60 hover:text-red-400 transition-colors"
                    onClick={() => {
                      const newShots = shots.filter((_, idx) => idx !== i)
                      onUpdate({ shots: newShots })
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <Textarea
                placeholder="Describe the scene..."
                value={shot.scene}
                onChange={(e) => {
                  const newShots = [...shots]
                  newShots[i] = { ...shot, scene: e.target.value }
                  onUpdate({ shots: newShots })
                }}
                className="min-h-[60px] text-sm"
                rows={2}
              />
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Duration (s)</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={shot.duration || ""}
                  onChange={(e) => {
                    const newShots = [...shots]
                    newShots[i] = { ...shot, duration: e.target.value === "" ? 0 : Number(e.target.value) }
                    onUpdate({ shots: newShots })
                  }}
                  className="w-16 h-7 text-xs"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground px-1">
        Generates a multi-shot video from scene descriptions using Sora 2 Pro Storyboard. Each shot has its own scene description and duration. Optionally connect reference images.
      </p>
    </div>
  )
}
