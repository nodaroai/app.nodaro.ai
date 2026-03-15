"use client"

import { useMemo } from "react"
import { Mic, Music, AudioWaveform, Film, Volume2, VolumeX, Play } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { MergeVideoAudioData } from "@/types/nodes"
import type { ConfigProps } from "./types"

const AUDIO_SOURCE_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "upload-audio", "reference-audio", "trim-audio",
  "adjust-volume", "mix-audio",
])

const VIDEO_SOURCE_TYPES = new Set([
  "image-to-video", "video-to-video", "text-to-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "add-captions", "resize-video", "trim-video", "speed-ramp", "loop-video", "fade-video",
  "render-video", "upload-video", "youtube-video",
])

const TRACK_ROLE_OPTIONS = [
  { value: "dialogue", label: "Dialogue", icon: Mic, color: "text-pink-400 bg-pink-500/15" },
  { value: "narration", label: "Narration", icon: Mic, color: "text-purple-400 bg-purple-500/15" },
  { value: "background", label: "Background", icon: Music, color: "text-blue-400 bg-blue-500/15" },
  { value: "effect", label: "Effect", icon: AudioWaveform, color: "text-amber-400 bg-amber-500/15" },
] as const

function getRoleBadgeColor(role: string): string {
  return TRACK_ROLE_OPTIONS.find((o) => o.value === role)?.color ?? "text-muted-foreground bg-muted"
}

function getTrackIcon(sourceType: string) {
  if (sourceType === "text-to-speech") return Mic
  if (sourceType === "generate-music") return Music
  if (sourceType === "text-to-audio") return AudioWaveform
  if (VIDEO_SOURCE_TYPES.has(sourceType)) return Film
  return Volume2
}

function getTrackDefaultRole(sourceType: string): string {
  if (sourceType === "text-to-speech") return "dialogue"
  if (sourceType === "generate-music") return "background"
  if (sourceType === "text-to-audio") return "effect"
  return "background"
}

export function MergeVideoAudioConfig({ data, onUpdate, nodes }: ConfigProps<MergeVideoAudioData>) {
  const edges = useWorkflowStore((s) => s.edges)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)

  const trackSettings = data.trackSettings ?? {}

  const { videoSource, audioSources } = useMemo(() => {
    if (!selectedNodeId) return { videoSource: null, audioSources: [] }
    const incomingEdges = edges.filter((e) => e.target === selectedNodeId)
    const sourceNodes = incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof nodes[number] => n !== undefined)

    let firstVideo: typeof nodes[number] | null = null
    const audios: typeof nodes[number][] = []

    for (const src of sourceNodes) {
      // Resolve sub-workflow output port media type from the edge's sourceHandle
      let effectiveType = src.type as string
      if (src.type === "sub-workflow" || src.type === "sub-workflow-input") {
        const srcEdge = incomingEdges.find((e) => e.source === src.id)
        const handle = srcEdge?.sourceHandle as string | undefined
        const srcData = src.data as Record<string, unknown>
        const snapshot = srcData.routeSnapshot as { outputPorts?: Array<{ id: string; mediaType: string }> } | undefined
        const ports = (src.type === "sub-workflow-input")
          ? (srcData.ports as Array<{ id: string; mediaType: string }> | undefined)
          : snapshot?.outputPorts
        if (handle && ports) {
          const portId = handle.replace(/^out_/, "")
          const port = ports.find((p) => p.id === portId)
          if (port?.mediaType === "audio") effectiveType = "__audio__"
          else if (port?.mediaType === "video") effectiveType = "__video__"
        }
      }

      if (!firstVideo && (VIDEO_SOURCE_TYPES.has(effectiveType) || effectiveType === "__video__")) {
        firstVideo = src
      } else if (AUDIO_SOURCE_TYPES.has(effectiveType) || effectiveType === "__audio__") {
        audios.push(src)
      } else if (firstVideo && (VIDEO_SOURCE_TYPES.has(effectiveType) || effectiveType === "__video__")) {
        audios.push(src)
      }
    }
    return { videoSource: firstVideo, audioSources: audios }
  }, [selectedNodeId, edges, nodes])

  function getTrackSetting(sourceNodeId: string, field: "role" | "volume" | "startTime") {
    const s = trackSettings[sourceNodeId]
    if (!s) {
      const src = audioSources.find((n) => n.id === sourceNodeId)
      if (field === "role") return getTrackDefaultRole(src?.type ?? "")
      if (field === "volume") return 100
      return 0
    }
    return s[field]
  }

  function updateTrackSetting(sourceNodeId: string, field: "role" | "volume" | "startTime", value: string | number) {
    const src = audioSources.find((n) => n.id === sourceNodeId)
    const existing = trackSettings[sourceNodeId] ?? {
      role: getTrackDefaultRole(src?.type ?? ""),
      volume: 100,
      startTime: 0,
    }
    onUpdate({
      trackSettings: {
        ...trackSettings,
        [sourceNodeId]: { ...existing, [field]: value },
      },
    })
  }

  const keepOriginal = data.keepOriginalAudio ?? true
  const origVolume = data.originalAudioVolume ?? 30

  return (
    <div className="flex flex-col gap-4">
      {/* Video Source Section */}
      <div>
        <Label className="text-xs text-[#ff0073] uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
          <Film className="w-3.5 h-3.5" />
          Video Source
        </Label>
        {videoSource ? (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <Film className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium truncate">
                {(videoSource.data as Record<string, unknown>).label as string ?? videoSource.type}
              </span>
            </div>

            {/* Original audio controls */}
            <div className="border-t pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Original Audio</span>
                <button
                  type="button"
                  className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${keepOriginal ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}
                  onClick={() => onUpdate({ keepOriginalAudio: !keepOriginal })}
                >
                  {keepOriginal ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  {keepOriginal ? "Keep" : "Muted"}
                </button>
              </div>

              {keepOriginal && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Vol</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={origVolume}
                      onChange={(e) => onUpdate({ originalAudioVolume: parseInt(e.target.value, 10) })}
                      className="flex-1 h-1.5 accent-[#ff0073] cursor-pointer"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={origVolume}
                      onChange={(e) => onUpdate({ originalAudioVolume: parseInt(e.target.value, 10) || 0 })}
                      className="w-14 h-6 text-xs text-center px-1"
                    />
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-12 shrink-0">Role</span>
                    <Select
                      value={data.originalAudioRole ?? "background"}
                      onValueChange={(v) => onUpdate({ originalAudioRole: v })}
                    >
                      <SelectTrigger className="h-6 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="background">Background</SelectItem>
                        <SelectItem value="narration">Narration</SelectItem>
                        <SelectItem value="effect">Effect</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 text-center">
            <p className="text-xs text-muted-foreground">No video connected</p>
          </div>
        )}
      </div>

      {/* Audio Tracks Section */}
      <div>
        <Label className="text-xs text-[#ff0073] uppercase tracking-wider font-semibold flex items-center gap-1.5 mb-2">
          <Volume2 className="w-3.5 h-3.5" />
          Audio Tracks
          {audioSources.length > 0 && (
            <span className="bg-[#ff0073]/15 text-[#ff0073] text-[10px] rounded-full px-1.5 py-0.5 font-mono">
              {audioSources.length}
            </span>
          )}
        </Label>

        {audioSources.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-3 text-center">
            <p className="text-xs text-muted-foreground">No audio sources connected</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">Connect TTS, Music, or Audio nodes</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...audioSources]
              .sort((a, b) => {
                const aStart = (getTrackSetting(a.id, "startTime") as number) ?? 0
                const bStart = (getTrackSetting(b.id, "startTime") as number) ?? 0
                return aStart - bStart
              })
              .map((src, idx) => {
              const srcLabel = (src.data as Record<string, unknown>).label as string ?? src.type
              const isVideoSource = VIDEO_SOURCE_TYPES.has(src.type)
              const TrackIcon = getTrackIcon(src.type)
              const vol = getTrackSetting(src.id, "volume") as number
              const startTime = getTrackSetting(src.id, "startTime") as number
              const role = getTrackSetting(src.id, "role") as string
              const roleBadge = getRoleBadgeColor(role)
              const srcData = src.data as Record<string, unknown>
              const previewUrl = (srcData.generatedAudioUrl as string)
                ?? (srcData.generatedVideoUrl as string)
                ?? ((srcData.generatedResults as readonly { url: string }[] | undefined)?.[
                  (srcData.activeResultIndex as number | undefined) ?? 0
                ]?.url)
                ?? (srcData.url as string)

              return (
                <div key={src.id} className="rounded-lg border bg-card overflow-hidden">
                  {/* Track header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {idx + 1}
                    </span>
                    <TrackIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate flex-1" title={srcLabel}>
                      {isVideoSource && (
                        <span className="text-amber-400 mr-1" title="Audio extracted from video">
                          {"[vid] "}
                        </span>
                      )}
                      {srcLabel}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${roleBadge}`}>
                      {TRACK_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role}
                    </span>
                    {previewUrl && (
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Preview audio"
                        onClick={() => {
                          const audio = new Audio(previewUrl)
                          audio.volume = Math.min(vol / 100, 1)
                          audio.play()
                        }}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Track controls */}
                  <div className="px-3 py-2 flex flex-col gap-1.5">
                    {/* Role */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Role</span>
                      <Select
                        value={role}
                        onValueChange={(v) => updateTrackSetting(src.id, "role", v)}
                      >
                        <SelectTrigger className="h-6 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRACK_ROLE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Volume */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Vol</span>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={vol}
                        onChange={(e) => updateTrackSetting(src.id, "volume", parseInt(e.target.value, 10))}
                        className="flex-1 h-1.5 accent-[#ff0073] cursor-pointer"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={200}
                        value={vol}
                        onChange={(e) => updateTrackSetting(src.id, "volume", parseInt(e.target.value, 10) || 0)}
                        className="w-14 h-6 text-xs text-center px-1"
                      />
                      <span className="text-[10px] text-muted-foreground">%</span>
                    </div>

                    {/* Start time */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-10 shrink-0">Start</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={startTime}
                        onChange={(e) => updateTrackSetting(src.id, "startTime", parseFloat(e.target.value) || 0)}
                        className="flex-1 h-6 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">s</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
