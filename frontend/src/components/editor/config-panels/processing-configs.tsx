"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { COMPOSITION_RATIOS } from "./model-options"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type {
  CombineVideosData,
  AddCaptionsData,
  ResizeVideoData,
  TrimAudioData,
  MixAudioData,
  AdjustVolumeData,
  TrimVideoData,
  ExtractFrameData,
  SpeedRampData,
  LoopVideoData,
  FadeVideoData,
  TranscodeVideoData,
  ManualEditData,
  SocialMediaFormatData,
  SplitMediaData,
} from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"
import { ConnectedMediaList, applyMediaOrder } from "./connected-media-list"
import { isVideoUrl } from "@/lib/media-type"
import { PLATFORM_SPECS, CONTENT_TYPES_BY_PLATFORM, PLATFORM_LABELS, type SocialMediaPlatform } from "@/lib/social-media-specs"
import { PlatformPreview } from "@/components/nodes/platform-preview"
import { Textarea } from "@/components/ui/textarea"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"
import { CaptionsStylePreview } from "../captions-style-preview"

const KINETIC_STYLE_FONT_DEFAULT = 64
const STATIC_STYLE_FONT_DEFAULT = 32

export function CombineVideosConfig({ data, onUpdate, sources }: ConfigProps<CombineVideosData>) {
  return (
    <div className="flex flex-col gap-3">
      <ConnectedMediaList
        sources={sources}
        mediaOrder={data.clipOrder ?? []}
        onUpdateOrder={(order) => onUpdate({ clipOrder: order })}
        mediaType="video"
      />

      <div>
        <Label>Transition</Label>
        <Select
          value={data.transition}
          onValueChange={(v) => onUpdate({ transition: v as CombineVideosData["transition"] })}
        >
          <SelectTrigger aria-label="Transition"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cut">Cut</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="dissolve">Dissolve</SelectItem>
            <SelectItem value="dip-to-black">Dip to Black</SelectItem>
            <SelectItem value="dip-to-white">Dip to White</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.transition !== "cut" && (
        <div>
          <Label htmlFor="transition-duration">Duration — {data.transitionDuration ?? 0.5}s</Label>
          <Input
            id="transition-duration"
            type="number"
            min={0.1}
            max={2}
            step={0.1}
            value={data.transitionDuration ?? ""}
            onChange={(e) =>
              onUpdate({ transitionDuration: e.target.value === "" ? undefined : parseFloat(e.target.value) })
            }
          />
        </div>
      )}

      <div>
        <Label>Audio</Label>
        <Select
          value={data.audioMode ?? "crossfade"}
          onValueChange={(v) => onUpdate({ audioMode: v as CombineVideosData["audioMode"] })}
        >
          <SelectTrigger aria-label="Audio"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">Keep original</SelectItem>
            <SelectItem value="crossfade">Crossfade</SelectItem>
            <SelectItem value="remove">Remove audio</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="trim-end-frames">Trim end of each clip (frames) — {data.trimEndFrames ?? 0}</Label>
        <Input
          id="trim-end-frames"
          type="number"
          min={0}
          max={120}
          step={1}
          value={data.trimEndFrames ?? 0}
          onChange={(e) =>
            onUpdate({ trimEndFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
          }
        />
      </div>

      <div>
        <Label htmlFor="trim-start-frames">Trim start of each clip (frames) — {data.trimStartFrames ?? 0}</Label>
        <Input
          id="trim-start-frames"
          type="number"
          min={0}
          max={120}
          step={1}
          value={data.trimStartFrames ?? 0}
          onChange={(e) =>
            onUpdate({ trimStartFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
          }
        />
      </div>
    </div>
  )
}

export function AddCaptionsConfig({ data, onUpdate }: ConfigProps<AddCaptionsData>) {
  function handleStyleChange(next: AddCaptionsData["style"]) {
    const isKineticNext = next !== "subtitle"
    const update: Partial<AddCaptionsData> = { style: next }
    if (isKineticNext && data.fontSize === STATIC_STYLE_FONT_DEFAULT) {
      update.fontSize = KINETIC_STYLE_FONT_DEFAULT
    } else if (!isKineticNext && data.fontSize === KINETIC_STYLE_FONT_DEFAULT) {
      update.fontSize = STATIC_STYLE_FONT_DEFAULT
    }
    onUpdate(update)
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Style</Label>
        <Select
          value={data.style}
          onValueChange={(v) => handleStyleChange(v as AddCaptionsData["style"])}
        >
          <SelectTrigger aria-label="Style"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtitle">Subtitle (static)</SelectItem>
            <SelectItem value="word-highlight">Word Highlight (kinetic)</SelectItem>
            <SelectItem value="karaoke">Karaoke (kinetic)</SelectItem>
            <SelectItem value="tiktok-words">TikTok Words (kinetic)</SelectItem>
            <SelectItem value="word-pop">Word Pop (kinetic)</SelectItem>
            <SelectItem value="bouncy">Bouncy (kinetic)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <CaptionsStylePreview
        style={data.style}
        position={data.position}
        fontSize={data.fontSize}
        color={data.color}
        backgroundColor={data.backgroundColor as string | undefined}
      />

      <div>
        <Label>Position</Label>
        <Select value={data.position} onValueChange={(v) => onUpdate({ position: v as AddCaptionsData["position"] })}>
          <SelectTrigger aria-label="Position"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom">Bottom</SelectItem>
            <SelectItem value="top">Top</SelectItem>
            <SelectItem value="center">Center</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="font-size">Font Size</Label>
        <Input id="font-size" type="number" min={8} max={200}
          value={data.fontSize ?? ""}
          onChange={(e) => onUpdate({ fontSize: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </div>
      <div>
        <Label htmlFor="caption-color">Color</Label>
        <Input id="caption-color" type="color" value={data.color} onChange={(e) => onUpdate({ color: e.target.value })} />
      </div>
      {data.style !== "subtitle" && (
        <div className="text-xs text-muted-foreground">
          Kinetic styles render via Remotion (5 credits). Captions are auto-transcribed from the input video unless you wire a Transcribe node to this node's <code>captions</code> input.
        </div>
      )}
    </div>
  )
}

export function ResizeVideoConfig({ data, onUpdate }: ConfigProps<ResizeVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Target Aspect Ratio</Label>
        <AspectRatioSelector
          options={COMPOSITION_RATIOS}
          value={data.targetAspect}
          onValueChange={(v) => onUpdate({ targetAspect: v as ResizeVideoData["targetAspect"] })}
        />
      </div>
      <div>
        <Label>Method</Label>
        <Select
          value={data.method}
          onValueChange={(v) => onUpdate({ method: v as ResizeVideoData["method"] })}
        >
          <SelectTrigger aria-label="Method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">Crop</SelectItem>
            <SelectItem value="pad">Pad</SelectItem>
            <SelectItem value="stretch">Stretch</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="pad-color">Pad Color</Label>
        <Input
          id="pad-color"
          type="color"
          value={data.padColor}
          onChange={(e) => onUpdate({ padColor: e.target.value })}
        />
      </div>
    </div>
  )
}

export function TrimAudioConfig({ data, onUpdate }: ConfigProps<TrimAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Audio Format</Label>
        <Select
          value={data.audioFormat}
          onValueChange={(v) => onUpdate({ audioFormat: v as TrimAudioData["audioFormat"] })}
        >
          <SelectTrigger aria-label="Audio format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="start-time">Start Time (s) — optional</Label>
        <Input
          id="start-time"
          type="number"
          min={0}
          step={0.1}
          placeholder="0"
          value={(data.startTime as number | undefined) ?? ""}
          onChange={(e) => onUpdate({ startTime: e.target.value ? parseFloat(e.target.value) : undefined })}
        />
      </div>
      <div>
        <Label htmlFor="end-time">End Time (s) — optional</Label>
        <Input
          id="end-time"
          type="number"
          min={0}
          step={0.1}
          placeholder="end of file"
          value={(data.endTime as number | undefined) ?? ""}
          onChange={(e) => onUpdate({ endTime: e.target.value ? parseFloat(e.target.value) : undefined })}
        />
      </div>
    </div>
  )
}

export function SplitMediaConfig({ data, onUpdate }: ConfigProps<SplitMediaData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="chunk-duration">Chunk Duration (seconds)</Label>
        <Input
          id="chunk-duration"
          type="number"
          min={1}
          step={1}
          value={data.chunkDuration ?? 10}
          onChange={(e) => onUpdate({ chunkDuration: Math.max(1, parseInt(e.target.value) || 1) })}
        />
      </div>
      <div>
        <Label>Audio Format</Label>
        <Select
          value={data.audioFormat ?? "mp3"}
          onValueChange={(v) => onUpdate({ audioFormat: v as "mp3" | "wav" | "aac" })}
        >
          <SelectTrigger aria-label="Audio format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(data.generatedAudioUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Output Chunk</label>
          <select
            value={data.outputChunkIndex ?? 0}
            onChange={(e) => {
              const val = Number(e.target.value)
              console.log('[SplitMedia] outputChunkIndex changed to:', val)
              onUpdate({ outputChunkIndex: val })
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {data.generatedAudioUrls!.map((_, i) => (
              <option key={i} value={i}>Chunk {i + 1}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">Select which chunk to output when connected to another node</p>
        </div>
      )}
      {(data.generatedAudioUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Audio Chunks ({data.generatedAudioUrls!.length})
            </label>
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const allSelected = !data.selectedAudioChunks || data.selectedAudioChunks.length === data.generatedAudioUrls!.length
                onUpdate({ selectedAudioChunks: allSelected ? [] : data.generatedAudioUrls!.map((_, idx) => idx) })
              }}
            >
              {!data.selectedAudioChunks || data.selectedAudioChunks.length === data.generatedAudioUrls!.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <div className="flex flex-col gap-3 max-h-64 overflow-y-auto">
            {data.generatedAudioUrls!.map((url, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!data.selectedAudioChunks || data.selectedAudioChunks.includes(i)}
                    onChange={(e) => {
                      const current = data.selectedAudioChunks ?? data.generatedAudioUrls!.map((_, idx) => idx)
                      const next = e.target.checked ? [...current, i] : current.filter(x => x !== i)
                      onUpdate({ selectedAudioChunks: next.sort((a, b) => a - b) })
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-[11px] text-muted-foreground">Chunk {i + 1}</span>
                  <a href={url} download className="text-[10px] text-primary hover:underline ml-auto" onClick={(e) => e.stopPropagation()}>Download</a>
                </div>
                <audio controls src={url} className="w-full" />
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.generatedVideoUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Video Chunks ({data.generatedVideoUrls!.length})
            </label>
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const allSelected = !data.selectedVideoChunks || data.selectedVideoChunks.length === data.generatedVideoUrls!.length
                onUpdate({ selectedVideoChunks: allSelected ? [] : data.generatedVideoUrls!.map((_, idx) => idx) })
              }}
            >
              {!data.selectedVideoChunks || data.selectedVideoChunks.length === data.generatedVideoUrls!.length ? "Deselect All" : "Select All"}
            </button>
          </div>
          <div className="flex flex-col gap-3 max-h-64 overflow-y-auto">
            {data.generatedVideoUrls!.map((url, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!data.selectedVideoChunks || data.selectedVideoChunks.includes(i)}
                    onChange={(e) => {
                      const current = data.selectedVideoChunks ?? data.generatedVideoUrls!.map((_, idx) => idx)
                      const next = e.target.checked ? [...current, i] : current.filter(x => x !== i)
                      onUpdate({ selectedVideoChunks: next.sort((a, b) => a - b) })
                    }}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-[11px] text-muted-foreground">Chunk {i + 1}</span>
                  <a href={url} download className="text-[10px] text-primary hover:underline ml-auto" onClick={(e) => e.stopPropagation()}>Download</a>
                </div>
                <video controls src={url} className="w-full rounded" style={{ maxHeight: '80px' }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MixAudioConfig({ data, onUpdate, nodes, sources }: ConfigProps<MixAudioData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  const connectedNodeIds = edges
    .filter((e) => e.target === selectedNodeId)
    .map((e) => e.source)

  const connectedNodes = connectedNodeIds
    .map((id) => nodes?.find((n) => n.id === id))
    .filter(Boolean) as ReadonlyArray<WorkflowNode>

  // Apply track order
  const orderedNodes = applyMediaOrder(
    connectedNodes.map((n) => ({ ...n })),
    data.trackOrder ?? [],
  )

  const trackVolumes = data.trackVolumes ?? {}

  return (
    <div className="flex flex-col gap-3">
      {connectedNodes.length === 0 && (
        <p className="text-xs text-muted-foreground">Connect audio nodes to set per-track volumes.</p>
      )}
      {connectedNodes.length > 1 && (
        <ConnectedMediaList
          sources={sources}
          mediaOrder={data.trackOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ trackOrder: order })}
          mediaType="audio"
        />
      )}
      <div className="flex flex-col gap-3">
        {orderedNodes.map((node) => {
          const volume = trackVolumes[node.id] ?? 100
          const label = (node.data as Record<string, unknown>)?.label as string ?? node.type ?? node.id
          return (
            <div key={node.id}>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs truncate flex-1">{label}</Label>
                <span className="text-xs text-muted-foreground ml-2 tabular-nums">{volume}%</span>
              </div>
              <Input
                type="range"
                min={0}
                max={200}
                step={1}
                value={volume}
                onChange={(e) => onUpdate({
                  trackVolumes: { ...trackVolumes, [node.id]: parseInt(e.target.value, 10) },
                })}
                className="w-full h-2 accent-[#ff0073]"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AdjustVolumeConfig({ data, onUpdate }: ConfigProps<AdjustVolumeData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="volume">Volume (%)</Label>
        <Input
          id="volume"
          type="number"
          min={0}
          max={200}
          value={data.volume ?? ""}
          onChange={(e) => onUpdate({ volume: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="normalize"
          checked={data.normalize}
          onChange={(e) => onUpdate({ normalize: e.target.checked })}
        />
        <Label htmlFor="normalize">Normalize</Label>
      </div>
      <div>
        <Label htmlFor="fade-in">Fade In (s)</Label>
        <Input
          id="fade-in"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeIn ?? ""}
          onChange={(e) => onUpdate({ fadeIn: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </div>
      <div>
        <Label htmlFor="fade-out">Fade Out (s)</Label>
        <Input
          id="fade-out"
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={data.fadeOut ?? ""}
          onChange={(e) => onUpdate({ fadeOut: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </div>
    </div>
  )
}

export function TrimVideoConfig({ data, onUpdate }: ConfigProps<TrimVideoData>) {
  const mode = data.trimMode ?? "time"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Trim Mode</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ trimMode: v as TrimVideoData["trimMode"] })}>
          <SelectTrigger aria-label="Trim mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="time">By time (seconds)</SelectItem>
            <SelectItem value="frames">By frames</SelectItem>
            <SelectItem value="smart-loop-cut">Smart loop cut</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "time" && (
        <>
          <div>
            <Label htmlFor="start-time">Start Time (s)</Label>
            <Input
              id="start-time"
              type="number"
              min={0}
              step={0.1}
              value={data.startTime ?? ""}
              onChange={(e) => onUpdate({ startTime: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="end-time">End Time (s)</Label>
            <Input
              id="end-time"
              type="number"
              min={0}
              step={0.1}
              value={data.endTime ?? ""}
              onChange={(e) => onUpdate({ endTime: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
        </>
      )}

      {mode === "frames" && (
        <>
          <div>
            <Label htmlFor="trim-start-frames">Trim from start (frames)</Label>
            <Input
              id="trim-start-frames"
              type="number"
              min={0}
              step={1}
              placeholder="0"
              value={data.trimStartFrames ?? ""}
              onChange={(e) => onUpdate({ trimStartFrames: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
          </div>
          <div>
            <Label htmlFor="trim-end-frames">Trim from end (frames)</Label>
            <Input
              id="trim-end-frames"
              type="number"
              min={0}
              step={1}
              placeholder="0"
              value={data.trimEndFrames ?? ""}
              onChange={(e) => onUpdate({ trimEndFrames: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            The worker probes the source&apos;s frame rate and converts. Useful for VEO 3.1 outputs (24fps fixed) and any case where exact frame alignment matters more than time.
          </p>
        </>
      )}

      {mode === "smart-loop-cut" && (
        <>
          <div>
            <Label htmlFor="smart-lookback">Lookback window (frames)</Label>
            <Input
              id="smart-lookback"
              type="number"
              min={2}
              max={64}
              step={1}
              placeholder="16"
              value={data.smartLoopCutLookback ?? ""}
              onChange={(e) => onUpdate({ smartLoopCutLookback: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Picks the trailing frame closest to frame 0 (by PSNR pixel similarity) and trims there. Beats a fixed offset on stochastic outputs — VEO 3.1 first+last-frame mode in particular benefits because the actual cleanest cut isn&apos;t always exactly 8 frames in.
          </p>
        </>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="outputSilentVideo"
          checked={data.outputSilentVideo ?? false}
          onChange={(e) => onUpdate({ outputSilentVideo: e.target.checked })}
          className="w-4 h-4"
        />
        <label htmlFor="outputSilentVideo" className="text-xs text-muted-foreground">Output Silent Video</label>
      </div>
    </div>
  )
}

export function ExtractFrameConfig({ data, onUpdate }: ConfigProps<ExtractFrameData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="extract-mode">Frame Selection</Label>
        <Select value={data.mode || "first"} onValueChange={(v) => onUpdate({ mode: v as ExtractFrameData["mode"] })}>
          <SelectTrigger id="extract-mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">First Frame</SelectItem>
            <SelectItem value="last">Last Frame</SelectItem>
            <SelectItem value="timestamp">At Timestamp</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.mode === "timestamp" && (
        <div>
          <Label htmlFor="extract-timestamp">Timestamp (seconds)</Label>
          <Input
            id="extract-timestamp"
            type="number"
            min={0}
            step={0.1}
            value={data.timestamp ?? 0}
            onChange={(e) => onUpdate({ timestamp: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
          />
        </div>
      )}
    </div>
  )
}

export function SpeedRampConfig({ data, onUpdate }: ConfigProps<SpeedRampData>) {
  const speedLabel = data.speed === 1 ? "1x (Normal)" : data.speed < 1 ? `${data.speed}x (Slow Mo)` : `${data.speed}x (Fast)`
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="speed">Speed: {speedLabel}</Label>
        <input
          id="speed"
          type="range"
          min={0.25}
          max={4.0}
          step={0.05}
          value={data.speed}
          onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>0.25x</span>
          <span>1x</span>
          <span>4x</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="adjust-audio"
          checked={data.adjustAudio}
          onChange={(e) => onUpdate({ adjustAudio: e.target.checked })}
        />
        <Label htmlFor="adjust-audio">Adjust Audio Speed</Label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        When audio adjustment is off, the audio track is removed entirely.
      </p>
    </div>
  )
}

export function LoopVideoConfig({ data, onUpdate }: ConfigProps<LoopVideoData>) {
  const mode = data.mode ?? "repeat"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as LoopVideoData["mode"] })}>
          <SelectTrigger aria-label="Loop mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="repeat">Repeat N times</SelectItem>
            <SelectItem value="duration">Loop to duration</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "repeat" && (
        <div>
          <Label htmlFor="repeat-count">Repeat: {data.repeatCount ?? 2}x</Label>
          <input
            id="repeat-count"
            type="range"
            min={2}
            max={20}
            step={1}
            value={data.repeatCount ?? 2}
            onChange={(e) => onUpdate({ repeatCount: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>2x</span>
            <span>10x</span>
            <span>20x</span>
          </div>
        </div>
      )}

      {mode === "duration" && (
        <div>
          <Label htmlFor="target-duration">Target Duration: {data.targetDuration ?? 10}s</Label>
          <input
            id="target-duration"
            type="range"
            min={1}
            max={300}
            step={1}
            value={data.targetDuration ?? 10}
            onChange={(e) => onUpdate({ targetDuration: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>1s</span>
            <span>150s</span>
            <span>300s</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {mode === "repeat"
          ? "The input video will be repeated the specified number of times."
          : "The input video will loop until the target duration is reached, then trim to exact length."}
      </p>

      <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="loop-video-smart-cut-pre"
            checked={data.smartLoopCutBeforeRepeat ?? false}
            onChange={(e) => onUpdate({ smartLoopCutBeforeRepeat: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="loop-video-smart-cut-pre" className="text-xs">Smart cut before looping</label>
        </div>
        <p className="text-[10px] text-muted-foreground px-1 leading-snug">
          Trims the input clip to its cleanest loop boundary BEFORE concatenating. Eliminates seam discontinuity at every internal repeat boundary, not just the final wrap. Useful for VEO 3.1 outputs and any clip with a stochastic tail.
        </p>
        {data.smartLoopCutBeforeRepeat && (
          <div>
            <Label htmlFor="loop-video-smart-lookback" className="text-xs">Lookback window (frames)</Label>
            <Input
              id="loop-video-smart-lookback"
              type="number"
              min={2}
              max={64}
              step={1}
              placeholder="16"
              value={data.smartLoopCutLookback ?? ""}
              onChange={(e) => onUpdate({ smartLoopCutLookback: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export function FadeVideoConfig({ data, onUpdate }: { data: FadeVideoData; onUpdate: (patch: Partial<FadeVideoData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Fade Color</Label>
        <Select value={data.color ?? "black"} onValueChange={(v) => onUpdate({ color: v as "black" | "white" })}>
          <SelectTrigger aria-label="Fade color"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="black">Black</SelectItem>
            <SelectItem value="white">White</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fade-in-toggle"
          checked={data.fadeIn !== false}
          onChange={(e) => onUpdate({ fadeIn: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <Label htmlFor="fade-in-toggle" className="mb-0">Fade In</Label>
      </div>
      {data.fadeIn !== false && (
        <div>
          <Label htmlFor="fade-in-dur">Duration: {data.fadeInDuration ?? 0.5}s</Label>
          <input
            id="fade-in-dur"
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={data.fadeInDuration ?? 0.5}
            onChange={(e) => onUpdate({ fadeInDuration: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0.1s</span>
            <span>1.5s</span>
            <span>3s</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="fade-out-toggle"
          checked={data.fadeOut !== false}
          onChange={(e) => onUpdate({ fadeOut: e.target.checked })}
          className="accent-[#ff0073]"
        />
        <Label htmlFor="fade-out-toggle" className="mb-0">Fade Out</Label>
      </div>
      {data.fadeOut !== false && (
        <div>
          <Label htmlFor="fade-out-dur">Duration: {data.fadeOutDuration ?? 0.5}s</Label>
          <input
            id="fade-out-dur"
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={data.fadeOutDuration ?? 0.5}
            onChange={(e) => onUpdate({ fadeOutDuration: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0.1s</span>
            <span>1.5s</span>
            <span>3s</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Apply fade in/out transitions to video. Audio fades are applied automatically when the video has an audio track.
      </p>
    </div>
  )
}

export function TranscodeVideoConfig({ data, onUpdate }: ConfigProps<TranscodeVideoData>) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isDefault = data.codec === "h264" && (data.crf ?? 23) === 23 && data.resolution === "original" && data.audioBitrate === "128k"

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Auto-transcodes video to browser/phone-safe H.264 + AAC MP4.
      </p>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced Settings {isDefault && "(using defaults)"}
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 pl-1 border-l-2 border-muted-foreground/10 ml-1">
          <div>
            <Label>Codec</Label>
            <Select
              value={data.codec ?? "h264"}
              onValueChange={(v) => onUpdate({ codec: v as TranscodeVideoData["codec"] })}
            >
              <SelectTrigger aria-label="Codec"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h264">H.264 (recommended)</SelectItem>
                <SelectItem value="h265">H.265 (HEVC)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="transcode-crf">Quality (CRF): {data.crf ?? 23}</Label>
            <input
              id="transcode-crf"
              type="range"
              min={0}
              max={51}
              step={1}
              value={data.crf ?? 23}
              onChange={(e) => onUpdate({ crf: parseInt(e.target.value, 10) })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0 (best)</span>
              <span>23 (default)</span>
              <span>51 (worst)</span>
            </div>
          </div>

          <div>
            <Label>Resolution</Label>
            <Select
              value={data.resolution ?? "original"}
              onValueChange={(v) => onUpdate({ resolution: v as TranscodeVideoData["resolution"] })}
            >
              <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="original">Original</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="480p">480p</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Audio Bitrate</Label>
            <Select
              value={data.audioBitrate ?? "128k"}
              onValueChange={(v) => onUpdate({ audioBitrate: v as TranscodeVideoData["audioBitrate"] })}
            >
              <SelectTrigger aria-label="Audio bitrate"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="128k">128 kbps (default)</SelectItem>
                <SelectItem value="192k">192 kbps</SelectItem>
                <SelectItem value="256k">256 kbps</SelectItem>
                <SelectItem value="320k">320 kbps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}

export function SocialMediaFormatConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SocialMediaFormatData>) {
  const platform = (data.platform ?? "instagram") as SocialMediaPlatform
  const contentTypes = CONTENT_TYPES_BY_PLATFORM[platform] ?? []
  const spec = PLATFORM_SPECS[data.specKey]
  const textLen = (data.formattedText ?? "").length
  const textLimit = spec?.textLimit ?? 2200
  const isOverLimit = textLen > textLimit

  function handlePlatformChange(newPlatform: string) {
    const types = CONTENT_TYPES_BY_PLATFORM[newPlatform as SocialMediaPlatform]
    const firstKey = types?.[0]?.key ?? `${newPlatform}:video`
    const firstSpec = PLATFORM_SPECS[firstKey]
    onUpdate({
      platform: newPlatform,
      specKey: firstKey,
      contentType: firstSpec?.contentType ?? "",
    })
  }

  function handleContentTypeChange(specKey: string) {
    const s = PLATFORM_SPECS[specKey]
    onUpdate({
      specKey,
      contentType: s?.contentType ?? "",
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Platform</Label>
        <Select value={platform} onValueChange={handlePlatformChange}>
          <SelectTrigger aria-label="Platform"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PLATFORM_LABELS) as SocialMediaPlatform[]).map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Content Type</Label>
        <Select value={data.specKey} onValueChange={handleContentTypeChange}>
          <SelectTrigger aria-label="Content type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {contentTypes.map((ct) => (
              <SelectItem key={ct.key} value={ct.key}>{ct.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {spec && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>Dimensions</span><span className="font-medium text-foreground">{spec.width}×{spec.height}</span></div>
          <div className="flex justify-between"><span>Aspect Ratio</span><span className="font-medium text-foreground">{(spec.width / spec.height).toFixed(2)}:1</span></div>
          {spec.maxDurationSeconds && (
            <div className="flex justify-between"><span>Max Duration</span><span className="font-medium text-foreground">{spec.maxDurationSeconds}s</span></div>
          )}
          <div className="flex justify-between"><span>Text Limit</span><span className="font-medium text-foreground">{spec.textLimit.toLocaleString()} chars</span></div>
        </div>
      )}

      <PlatformPreview
        platform={platform}
        specKey={data.specKey}
        mediaUrl={data.generatedVideoUrl ?? data.generatedImageUrl}
        isVideo={data.generatedVideoUrl ? isVideoUrl(data.generatedVideoUrl) : false}
        caption={data.formattedText}
        size="lg"
      />

      <div>
        <Label>Resize Method</Label>
        <Select value={data.method} onValueChange={(v) => onUpdate({ method: v as SocialMediaFormatData["method"] })}>
          <SelectTrigger aria-label="Resize method"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">Crop (fill, cut edges)</SelectItem>
            <SelectItem value="pad">Pad (fit, add bars)</SelectItem>
            <SelectItem value="stretch">Stretch (distort)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.method === "pad" && (
        <div>
          <Label htmlFor="smf-pad-color">Pad Color</Label>
          <Input
            id="smf-pad-color"
            type="color"
            value={data.padColor}
            onChange={(e) => onUpdate({ padColor: e.target.value })}
          />
        </div>
      )}

      <MappableField
        field="formattedText"
        label="Caption / Post Text"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <div className="flex items-center justify-end mb-1">
          <span className={`text-[10px] font-mono ${isOverLimit ? "text-red-500 font-bold" : "text-muted-foreground"}`}>
            {textLen}/{textLimit}
          </span>
        </div>
        <Textarea
          value={data.formattedText ?? ""}
          onChange={(e) => onUpdate({ formattedText: e.target.value })}
          placeholder="Enter post text (optional)..."
          className="min-h-[60px] text-xs"
        />
        {isOverLimit && (
          <p className="text-[10px] text-red-500 mt-1">
            Text exceeds {PLATFORM_LABELS[platform]}'s {textLimit} character limit by {textLen - textLimit} characters.
          </p>
        )}
      </MappableField>

      <p className="text-[10px] text-muted-foreground">
        FFmpeg processing. Reformats media to {PLATFORM_LABELS[platform]} specs.
      </p>
    </div>
  )
}

export function ManualEditConfig({ data, onUpdate }: ConfigProps<ManualEditData>) {
  const status = data.executionStatus ?? "idle"
  const mode = data.mode ?? "bypass"
  const editorLoad = data.editorLoad ?? "first"

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Run Mode</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as "bypass" | "wait" })}>
          <SelectTrigger aria-label="Run Mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bypass">Bypass (pass through)</SelectItem>
            <SelectItem value="wait">Wait for Edit</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {mode === "bypass" ? "Passes input through during workflow run. Open editor manually anytime." : "Pauses workflow until you finish editing in FreeCut."}
        </p>
      </div>

      <div>
        <Label>Editor Load</Label>
        <Select value={editorLoad} onValueChange={(v) => onUpdate({ editorLoad: v as "first" | "all" })}>
          <SelectTrigger aria-label="Editor Load"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">First asset to timeline</SelectItem>
            <SelectItem value="all">All assets to timeline</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {editorLoad === "first" ? "First video on timeline, others in asset library." : "All assets loaded to timeline on open."}
        </p>
      </div>

      {status === "awaiting-user" && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-amber-500">Waiting for your edit</span>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        0 credits — connect videos, images, and audio. Open FreeCut to edit anytime.
      </p>
    </div>
  )
}
