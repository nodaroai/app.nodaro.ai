import React, { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Film, Type, Music, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"

interface MediaSegment {
  id: string
  src: string
  mediaType: "image" | "video" | "gif"
  startFrame: number
  durationInFrames: number
  transitionIn?: { type: string; durationFrames: number }
  transitionOut?: { type: string; durationFrames: number }
  effects: Array<{ type: string; startValue: number; endValue: number }>
}

interface TextSegment {
  id: string
  text: string
  startFrame: number
  durationInFrames: number
  position: string
  fontSize: number
  fontFamily?: string
  animation: string
}

interface Track {
  type: "media" | "audio" | "text"
  id: string
  segments?: (MediaSegment | TextSegment)[]
  src?: string
  volume?: number
}

interface SceneGraphPreviewProps {
  sceneGraph: Record<string, unknown>
  fps: number
  onUpdate: (updated: Record<string, unknown>) => void
  onRegenerate?: () => void
  isGenerating?: boolean
}

const TRANSITION_OPTIONS: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "fade", labelKey: "scene.transitionFade" },
  { value: "slide-left", labelKey: "scene.transitionSlideLeft" },
  { value: "slide-right", labelKey: "scene.transitionSlideRight" },
  { value: "slide-up", labelKey: "scene.transitionSlideUp" },
  { value: "slide-down", labelKey: "scene.transitionSlideDown" },
  { value: "dissolve", labelKey: "scene.transitionDissolve" },
  { value: "zoom-in", labelKey: "canvas.zoomIn" },
  { value: "zoom-out", labelKey: "canvas.zoomOut" },
  { value: "none", labelKey: "common.none" },
]

const MEDIA_TYPE_LABEL_KEY: Record<string, MessageKey> = {
  video: "common.video",
  gif: "scene.gifLabel",
  image: "common.image",
}

const MEDIA_TYPE_COLOR: Record<string, string> = {
  video: "#ff0073",
  gif: "#A78BFA",
  image: "#38BDF8",
}

function framesToSeconds(frames: number, fps: number): string {
  return (frames / fps).toFixed(1)
}

function SegmentEditor({
  segment,
  fps,
  trackType,
  onChange,
}: {
  segment: MediaSegment | TextSegment
  fps: number
  trackType: "media" | "text"
  onChange: (updated: MediaSegment | TextSegment) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const durationSeconds = Number(framesToSeconds(segment.durationInFrames, fps))
  const isMedia = trackType === "media"
  const mediaSeg = isMedia ? (segment as MediaSegment) : null

  return (
    <div className="border border-[var(--border-color)] rounded">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full p-2 rounded hover:bg-[var(--card-bg)] text-start text-xs"
      >
        <span className="flex-1 truncate font-medium">
          {isMedia ? (
            <>
              <Film className="inline w-3 h-3 me-1" />
              {t(MEDIA_TYPE_LABEL_KEY[mediaSeg?.mediaType ?? "image"] ?? "common.image")} — {framesToSeconds(segment.startFrame, fps)}s
            </>
          ) : (
            <>
              <Type className="inline w-3 h-3 me-1" />
              {(segment as TextSegment).text.slice(0, 30)}
            </>
          )}
        </span>
        <span className="text-[var(--text-secondary)] tabular-nums">{durationSeconds}s</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="ps-4 pe-2 pb-2 space-y-2">
          {/* Duration input */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] w-16">{t("field.duration")}</span>
            <Input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={durationSeconds}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 1
                onChange({ ...segment, durationInFrames: Math.round(val * fps) })
              }}
              className="h-7 text-xs flex-1"
            />
            <span className="text-xs tabular-nums w-4">s</span>
          </div>

          {/* Font label for text segments */}
          {!isMedia && (segment as TextSegment).fontFamily && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-secondary)] w-16">{t("proccfg.font")}</span>
              <span className="text-xs">{(segment as TextSegment).fontFamily}</span>
            </div>
          )}

          {/* Transition controls for media */}
          {isMedia && mediaSeg && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)] w-16">{t("scene.transIn")}</span>
                <Select
                  value={mediaSeg.transitionIn?.type ?? "none"}
                  onValueChange={(type) => {
                    const transitionIn = type === "none" ? undefined : {
                      type,
                      durationFrames: mediaSeg.transitionIn?.durationFrames ?? 15,
                    }
                    onChange({ ...mediaSeg, transitionIn } as MediaSegment)
                  }}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-secondary)] w-16">{t("scene.transOut")}</span>
                <Select
                  value={mediaSeg.transitionOut?.type ?? "none"}
                  onValueChange={(type) => {
                    const transitionOut = type === "none" ? undefined : {
                      type,
                      durationFrames: mediaSeg.transitionOut?.durationFrames ?? 15,
                    }
                    onChange({ ...mediaSeg, transitionOut } as MediaSegment)
                  }}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Ken Burns toggle */}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={mediaSeg.effects.some((e) => e.type === "ken-burns")}
                  onChange={(e) => {
                    const effects = e.target.checked
                      ? [...mediaSeg.effects, { type: "ken-burns" as const, startValue: 0, endValue: 1 }]
                      : mediaSeg.effects.filter((eff) => eff.type !== "ken-burns")
                    onChange({ ...mediaSeg, effects } as MediaSegment)
                  }}
                  className="accent-[#ff0073]"
                />
                {t("scene.kenBurnsEffect")}
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function SceneGraphPreview({
  sceneGraph,
  fps,
  onUpdate,
  onRegenerate,
  isGenerating,
}: SceneGraphPreviewProps) {
  const t = useT()
  const tracks = (sceneGraph.tracks ?? []) as Track[]
  const totalDuration = (sceneGraph.durationInFrames as number) ?? 0

  const summary = useMemo(() => {
    let mediaSegments = 0
    let textSegments = 0
    let audioTracks = 0

    for (const track of tracks) {
      if (track.type === "media") mediaSegments += (track.segments?.length ?? 0)
      else if (track.type === "text") textSegments += (track.segments?.length ?? 0)
      else if (track.type === "audio") audioTracks++
    }

    return { mediaSegments, textSegments, audioTracks }
  }, [tracks])

  function updateSegment(trackIndex: number, segmentIndex: number, updated: MediaSegment | TextSegment) {
    const newTracks = tracks.map((track, ti) => {
      if (ti !== trackIndex || !track.segments) return track
      const newSegments = track.segments.map((seg, si) =>
        si === segmentIndex ? updated : seg,
      )
      return { ...track, segments: newSegments }
    })

    // Recalculate startFrames for sequential segments
    for (const track of newTracks) {
      if (track.type !== "media" || !track.segments) continue
      let currentFrame = 0
      for (const seg of track.segments) {
        (seg as MediaSegment).startFrame = currentFrame
        currentFrame += seg.durationInFrames
      }
    }

    // Update total duration based on media tracks
    let maxEndFrame = 0
    for (const track of newTracks) {
      if (track.type !== "media" || !track.segments) continue
      for (const seg of track.segments) {
        const end = (seg as MediaSegment).startFrame + seg.durationInFrames
        if (end > maxEndFrame) maxEndFrame = end
      }
    }

    onUpdate({
      ...sceneGraph,
      tracks: newTracks,
      durationInFrames: maxEndFrame || totalDuration,
    })
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1">
          <Film className="w-3 h-3" />
          {t("scene.segmentsCount", { n: summary.mediaSegments })}
        </span>
        {summary.textSegments > 0 && (
          <span className="flex items-center gap-1">
            <Type className="w-3 h-3" />
            {t("scene.textCount", { n: summary.textSegments })}
          </span>
        )}
        {summary.audioTracks > 0 && (
          <span className="flex items-center gap-1">
            <Music className="w-3 h-3" />
            {t("scene.audioCount", { n: summary.audioTracks })}
          </span>
        )}
        <span className="ms-auto tabular-nums">{framesToSeconds(totalDuration, fps)}s</span>
      </div>

      {/* Timeline bar */}
      <div className="relative h-8 rounded bg-[var(--card-bg)] overflow-hidden border border-[var(--border-color)]">
        {tracks.map((track) => {
          if (track.type === "audio") {
            return (
              <div
                key={track.id}
                className="absolute left-0 right-0 bottom-0 h-2 rounded-sm"
                style={{ backgroundColor: "#22c55e", opacity: 0.5 }}
                title={t("scene.audioVolumeTitle", { vol: track.volume ?? 1 })}
              />
            )
          }
          if (track.type !== "media" || !track.segments) return null
          return track.segments.map((seg) => {
            const mediaSeg = seg as MediaSegment
            const left = totalDuration > 0 ? (mediaSeg.startFrame / totalDuration) * 100 : 0
            const width = totalDuration > 0 ? (mediaSeg.durationInFrames / totalDuration) * 100 : 0
            return (
              <div
                key={mediaSeg.id}
                className="absolute top-0.5 rounded-sm"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  height: "calc(100% - 12px)",
                  backgroundColor: MEDIA_TYPE_COLOR[mediaSeg.mediaType] ?? "#38BDF8",
                  opacity: 0.7,
                }}
                title={`${mediaSeg.mediaType} — ${framesToSeconds(mediaSeg.durationInFrames, fps)}s`}
              />
            )
          })
        })}
      </div>

      {/* Per-track segment editors */}
      {tracks.map((track, trackIndex) => {
        if (track.type === "audio") {
          const audioSrc = track.src ?? ""
          const filename = audioSrc.split("/").pop()?.split("?")[0] ?? t("field.audio")
          return (
            <div key={track.id} className="space-y-1">
              <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                {t("scene.audioTrack")}
              </div>
              <div className="border border-[var(--border-color)] rounded p-2 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Music className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate flex-1" title={audioSrc}>{filename}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-secondary)] w-16">{t("field.volume")}</span>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={track.volume ?? 1}
                    onChange={(e) => {
                      const newTracks = tracks.map((t, i) =>
                        i === trackIndex ? { ...t, volume: parseFloat(e.target.value) || 0 } : t,
                      )
                      onUpdate({ ...sceneGraph, tracks: newTracks })
                    }}
                    className="h-7 text-xs flex-1"
                  />
                </div>
              </div>
            </div>
          )
        }

        if (!track.segments || track.segments.length === 0) return null

        return (
          <div key={track.id} className="space-y-1">
            <div className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              {track.type === "media" ? t("scene.mediaTrack") : t("scene.textTrack")}
            </div>
            {track.segments.map((seg, segIndex) => (
              <SegmentEditor
                key={seg.id}
                segment={seg as MediaSegment | TextSegment}
                fps={fps}
                trackType={track.type as "media" | "text"}
                onChange={(updated) => updateSegment(trackIndex, segIndex, updated)}
              />
            ))}
          </div>
        )
      })}

      {/* Regenerate button */}
      {onRegenerate && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isGenerating}
          className="w-full text-xs"
        >
          <RefreshCw className={`w-3 h-3 me-1 ${isGenerating ? "animate-spin" : ""}`} />
          {t("scene.regenerateComposition")}
        </Button>
      )}
    </div>
  )
}
