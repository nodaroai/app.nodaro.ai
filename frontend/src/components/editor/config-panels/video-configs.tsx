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
import { prefetchModelCredits } from "@/hooks/use-model-credits"
import {
  getModels,
  getFirstModel,
  type ProviderCategory,
} from "@/lib/providers-config"
import type {
  ImageToVideoData,
  VideoToVideoData,
  TextToVideoData,
  MotionTransferData,
  VideoUpscaleData,
  ExtendVideoData,
} from "@/types/nodes"
import { VIDEO_I2V_MODELS, VIDEO_T2V_MODELS, VIDEO_V2V_MODELS, KIE_VIDEO_DURATIONS, KIE_T2V_DURATIONS, PROVIDERS_WITH_END_FRAME, KLING3_DURATIONS } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { MappableField } from "./mappable-field"
import { Kling3StudioConfig } from "./kling3-studio-config"
import { getConnectedProviderModel } from "./helpers"
import { ConnectedMediaList } from "./connected-media-list"
import type { ConfigProps } from "./types"


export function ImageToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, onUpdateNode }: ConfigProps<ImageToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const allowedDurations = KIE_VIDEO_DURATIONS[data.provider || "minimax"] || null
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
        const activeIndex = (nodeData.activeResultIndex as number) ?? 0
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
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Prompt
          </Label>
          <Textarea
            value={data.prompt || ""}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="Describe the motion or animation you want..."
            rows={3}
            className="text-xs bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Tip: Connect a Text Prompt node for reusable prompts
          </p>
        </div>
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
      {(data.provider === "veo3" || data.provider === "veo3.1") && (
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
          <p className="text-xs text-muted-foreground px-1">VEO 3/3.1 creates AI audio from the prompt. Disable for silent video, then use Add Audio node.</p>
        </div>
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
            value={data.duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3" || data.provider === "veo3.1"
            ? "VEO 3 produces ~8 second videos (not configurable)."
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
      <MappableField field="motion" label="Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.motion}
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
      <MappableField field="cameraMotion" label="Camera Motion" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.cameraMotion}
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
        <div>
          <Label className="text-xs">Negative Prompt</Label>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </div>
      )}

      {(data.provider === "kling-turbo" || data.provider === "kling-master") && (
        <div>
          <Label className="text-xs">CFG Scale ({String((data as Record<string, unknown>).cfgScale ?? 0.5)})</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={(data as Record<string, unknown>).cfgScale as number ?? 0.5}
            onChange={(e) => onUpdate({ cfgScale: parseFloat(e.target.value) || 0.5 })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      {data.provider === "kling-master" && (
        <div>
          <Label className="text-xs">Negative Prompt</Label>
          <Textarea
            rows={2}
            value={(data as Record<string, unknown>).negativePrompt as string || ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder="Things to avoid..."
          />
        </div>
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
            <Select
              value={data.aspectRatio || "16:9"}
              onValueChange={(v) => onUpdate({ aspectRatio: v as ImageToVideoData["aspectRatio"] })}
            >
              <SelectTrigger aria-label="Aspect Ratio"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                <SelectItem value="21:9">21:9 (Ultra-wide)</SelectItem>
              </SelectContent>
            </Select>
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
            onValueChange={(v) => onUpdate({ resolution: v })}
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
                  <SelectItem value="1080P">1080P</SelectItem>
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

export function VideoToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<VideoToVideoData>) {
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

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe what to change or continue..."
          rows={3}
        />
      </MappableField>
    </div>
  )
}

export function MotionTransferConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<MotionTransferData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt (Optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value.slice(0, 2500) })}
          placeholder="Optional: Describe the motion transfer..."
          rows={2}
        />
        <span className="text-xs text-muted-foreground">{data.prompt?.length || 0}/2500</span>
      </MappableField>
      <MappableField field="characterOrientation" label="Character Orientation" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.characterOrientation || "video"}
          onValueChange={(v) => onUpdate({ characterOrientation: v as MotionTransferData["characterOrientation"] })}
        >
          <SelectTrigger aria-label="Character Orientation"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image (same as picture, max 10s)</SelectItem>
            <SelectItem value="video">Video (consistent with video, max 30s)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.resolution || "720p"}
          onValueChange={(v) => onUpdate({ resolution: v as MotionTransferData["resolution"] })}
        >
          <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="720p">720p</SelectItem>
            <SelectItem value="1080p">1080p</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <p className="text-xs text-muted-foreground px-1">
        Uses Kling 2.6 Motion Control via KIE.ai. Connect image and video inputs.
      </p>
    </div>
  )
}

export function VideoUpscaleConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<VideoUpscaleData>) {
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
            <SelectItem value="veo-1080p">VEO 1080p (25 CR)</SelectItem>
            <SelectItem value="veo-4k">VEO 4K (79 CR)</SelectItem>
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
          ? "Uses Topaz Video Upscaler via KIE.ai. Max 50MB input video."
          : "Upscales a VEO video to higher resolution. Connect an upstream VEO video node."}
      </p>
    </div>
  )
}

export function TextToVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes }: ConfigProps<TextToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_T2V_MODELS.map((m) => m.value)) }, [])
  const category: ProviderCategory = "video"
  const models = getModels(category, data.provider)
  const connectedModel = getConnectedProviderModel(fieldMappings, sources, nodes)
  const allowedDurations = KIE_T2V_DURATIONS[data.provider || "minimax"] || null

  if (data.provider === "kling-3.0") {
    return <Kling3StudioConfig data={data as unknown as ImageToVideoData} onUpdate={onUpdate} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} nodes={nodes} />
  }

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe the video to generate..."
        />
      </MappableField>
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
            value={data.duration}
            onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
          />
        )}
      </MappableField>
      {allowedDurations && allowedDurations.length === 1 && (
        <p className="text-xs text-muted-foreground px-1">
          {data.provider === "veo3"
            ? "VEO 3 produces ~8 second videos (not configurable)."
            : `${data.provider || "This provider"} produces ~${allowedDurations[0]} second videos.`}
        </p>
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
            value={(data as Record<string, unknown>).cfgScale as number ?? 0.5}
            onChange={(e) => onUpdate({ cfgScale: parseFloat(e.target.value) || 0.5 })}
          />
          <p className="text-[10px] text-muted-foreground mt-1">0 = creative, 1 = strict prompt adherence</p>
        </div>
      )}

      <MappableField field="aspectRatio" label="Aspect Ratio" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as TextToVideoData["aspectRatio"] })}
        >
          <SelectTrigger aria-label="Aspect Ratio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="negativePrompt" label="Negative Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
      </MappableField>
    </div>
  )
}

export function ExtendVideoConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<ExtendVideoData>) {
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

      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          value={data.prompt || ""}
          onChange={(e) => onUpdate({ prompt: e.target.value })}
          placeholder="Describe how the video should continue..."
          rows={3}
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
