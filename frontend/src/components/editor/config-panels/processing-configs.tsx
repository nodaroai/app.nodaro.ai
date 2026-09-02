"use client"

import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useT, tx, type MessageKey } from "@/lib/i18n"
import { useState, useEffect, Suspense } from "react"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { COMPOSITION_RATIOS, COLLAGE_ASPECT_RATIOS } from "./model-options"
import { CombineTransitionPicker } from "@/lib/picker-ui"
import { AUDIO_CROSSFADE_CURVES, DEFAULT_AUDIO_CROSSFADE_CURVE_ID } from "@nodaro/shared"
import { isCloud } from "@/lib/edition"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { WaveformAudioPlayer } from "@/components/audio-player"
import type {
  CombineVideosData,
  ImageCollageData,
  AddCaptionsData,
  ResizeVideoData,
  TrimAudioData,
  MixAudioData,
  AdjustVolumeData,
  TrimVideoData,
  ExtractFrameData,
  SpeedRampData,
  LoopVideoData,
  GifToVideoData,
  FadeVideoData,
  TranscodeVideoData,
  ManualEditData,
  SocialMediaFormatData,
  SplitMediaData,
  ExtractAudioData,
  RemoveAudioData,
} from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"
import { ConnectedMediaList, applyMediaOrder, getSourceThumbnail } from "./connected-media-list"
import { isVideoUrl } from "@/lib/media-type"
import { PLATFORM_SPECS, CONTENT_TYPES_BY_PLATFORM, PLATFORM_LABELS, type SocialMediaPlatform } from "@/lib/social-media-specs"
import { PlatformPreview } from "@/components/nodes/platform-preview"
import { Textarea } from "@/components/ui/textarea"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

// Lazy — pulls @remotion/player + remotion (~63KB gz) out of the editor chunk;
// only fetched when an Add Captions node's config panel is opened.
const CaptionsStylePreview = lazyWithRetry(() =>
  import("../captions-style-preview").then((m) => ({ default: m.CaptionsStylePreview })),
)

const KINETIC_STYLE_FONT_DEFAULT = 64
const STATIC_STYLE_FONT_DEFAULT = 32

// Parallel i18n key maps for the two SHARED constant tables rendered below
// (`CONTENT_TYPES_BY_PLATFORM` and `AUDIO_CROSSFADE_CURVES` both live in
// @nodaro/shared and are read by the backend + package tests). The tables keep
// their English as the source of truth; the pickers translate at render and
// fall back to the table's own label/description for any id added upstream
// before a key exists.
const CONTENT_TYPE_LABEL_KEYS: Record<string, MessageKey | undefined> = {
  "instagram:feed-square": "proccfg.feedSquare10801080",
  "instagram:feed-portrait": "proccfg.feedPortrait10801350",
  "instagram:feed-landscape": "proccfg.feedLandscape1080566",
  "instagram:story-reel": "proccfg.storyReel10801920",
  "tiktok:video": "proccfg.video10801920",
  "x:image-landscape": "proccfg.imageLandscape1200675",
  "x:image-square": "proccfg.imageSquare10801080",
  "x:x-video": "proccfg.video19201080",
  "youtube:short": "proccfg.short10801920",
  "facebook:fb-feed-portrait": "proccfg.feedPortrait10801350",
  "facebook:reel": "proccfg.reel10801920",
  "linkedin:li-image-landscape": "proccfg.imageLandscape1200627",
  "linkedin:li-image-square": "proccfg.imageSquare10801080",
  "linkedin:li-video": "proccfg.video19201080",
  "telegram:message": "proccfg.messageText",
}

const CROSSFADE_CURVE_KEYS: Record<
  string,
  { label: MessageKey; description: MessageKey } | undefined
> = {
  linear: { label: "proccfg.linear", description: "proccfg.straightLineFadeDefaultPredictableBut" },
  "equal-power": { label: "proccfg.equalPower", description: "proccfg.quarterSineKeepsPerceivedLoudnessRoughly" },
  smooth: { label: "proccfg.smoothSine", description: "proccfg.halfSineGentlerThanEqualPower" },
  logarithmic: { label: "proccfg.logarithmic", description: "proccfg.compensatesForTheEarSLogarithmic" },
  exponential: { label: "proccfg.exponential", description: "proccfg.sharpOutSlowInOrVice" },
}

export function CombineVideosConfig({ data, onUpdate, sources }: ConfigProps<CombineVideosData>) {
  const t = useT()
  // Fail-safe (CLAUDE.md pitfall-5 pattern): the manual trim fields are
  // HIDDEN under the smart methods (2026-07-24 — manual and smart are
  // ALTERNATIVE boundary-cut methods, not layers), so custom manual values
  // lingering from older workflows would invisibly steer the
  // unmatched-boundary fallback. Clear them — the backend's documented
  // defaults (start 1 / end 2) are the fallback under smart methods.
  useEffect(() => {
    if (data.smartCutEnabled && (data.trimStartFrames !== undefined || data.trimEndFrames !== undefined)) {
      onUpdate({ trimStartFrames: undefined, trimEndFrames: undefined })
    }
  }, [data.smartCutEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <ConnectedMediaList
        sources={sources}
        mediaOrder={data.clipOrder ?? []}
        onUpdateOrder={(order) => onUpdate({ clipOrder: order })}
        mediaType="video"
      />

      <div className="flex flex-col gap-1.5">
        <Label>{t("proccfg.transition")}</Label>
        <CombineTransitionPicker
          value={data.transition}
          onChange={(id) => onUpdate({ transition: id })}
        />
      </div>

      {data.transition !== "cut" && (
        <div>
          <Label htmlFor="transition-duration">
            {t("proccfg.transitionDurationS", { n: data.transitionDuration ?? 0.5 })}
          </Label>
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

      <div className="flex flex-col gap-1.5">
        <Label>{t("field.audio")}</Label>
        <Select
          value={data.audioMode ?? "crossfade"}
          onValueChange={(v) => onUpdate({ audioMode: v as CombineVideosData["audioMode"] })}
        >
          <SelectTrigger aria-label={t("field.audio")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">{t("audiocfg.keepOriginal")}</SelectItem>
            <SelectItem value="crossfade">{t("proccfg.crossfade")}</SelectItem>
            <SelectItem value="remove">{t("proccfg.removeAudio")}</SelectItem>
          </SelectContent>
        </Select>
        {(data.audioMode ?? "crossfade") === "crossfade" && (
          <div className="flex flex-col gap-2 ps-3 border-s-2 border-muted-foreground/20">
            <div className="flex flex-col gap-1">
              <Label htmlFor="audio-crossfade-duration" className="text-[11px] text-muted-foreground">
                {t("proccfg.crossfadeDurationSAudioOnly", { n: data.audioCrossfadeDuration ?? data.transitionDuration ?? 0.5 })}
              </Label>
              <Input
                id="audio-crossfade-duration"
                type="number"
                min={0}
                max={5}
                step={0.1}
                className="h-8 text-xs"
                value={data.audioCrossfadeDuration ?? data.transitionDuration ?? 0.5}
                onChange={(e) =>
                  onUpdate({ audioCrossfadeDuration: e.target.value === "" ? undefined : parseFloat(e.target.value) })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="audio-crossfade-curve" className="text-[11px] text-muted-foreground">
                {t("proccfg.crossfadeCurve")}
              </Label>
              <Select
                value={data.audioCrossfadeCurve ?? DEFAULT_AUDIO_CROSSFADE_CURVE_ID}
                onValueChange={(v) => onUpdate({ audioCrossfadeCurve: v })}
              >
                <SelectTrigger id="audio-crossfade-curve" aria-label={t("proccfg.crossfadeCurve")} className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_CROSSFADE_CURVES.map((c) => {
                    const ck = CROSSFADE_CURVE_KEYS[c.id]
                    return (
                      <SelectItem key={c.id} value={c.id} title={ck ? t(ck.description) : c.description}>
                        {ck ? t(ck.label) : c.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* BOUNDARY CUT METHOD (2026-07-24): ONE selector so Manual and
          the smart algorithms read as ALTERNATIVES, not layers. Manual =
          exact frame trims (available in every edition). The smart methods
          are Cloud-only (the algorithms live in the private plugins
          package; the backend route rejects them elsewhere) and HIDE the
          manual fields — unmatched boundaries fall back to the DEFAULT
          trims (start 1 / end 2), never to hidden custom values (the
          fail-safe effect above clears any that linger). */}
      {isCloud() && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="boundary-cut-method">{t("proccfg.boundaryCut")}</Label>
          <Select
            value={data.smartCutEnabled ? (data.smartCutMode ?? "best-pair") : "manual"}
            onValueChange={(v) =>
              v === "manual"
                ? onUpdate({ smartCutEnabled: false })
                : onUpdate({
                    smartCutEnabled: true,
                    smartCutMode: v as CombineVideosData["smartCutMode"],
                    trimStartFrames: undefined,
                    trimEndFrames: undefined,
                  })
            }
          >
            <SelectTrigger id="boundary-cut-method" aria-label={t("proccfg.boundaryCutMethod")} className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">{t("proccfg.manualTrimAnExactNumberOf")}</SelectItem>
              <SelectItem value="best-pair">{t("proccfg.smartBestPairCutAtThe")}</SelectItem>
              <SelectItem value="preroll-keep-next">{t("proccfg.smartPreRollKeepNextDetect")}</SelectItem>
              <SelectItem value="preroll-keep-prev">{t("proccfg.smartPreRollKeepPrevDetect")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {data.smartCutEnabled
              ? t("proccfg.searchesTheWindowsBelowAtEvery")
              : t("proccfg.dropsAFixedNumberOfFrames")}
          </p>
          {(data.smartCutMode === "preroll-keep-prev" || data.smartCutMode === "preroll-keep-next") && data.smartCutEnabled && (
            <p className="text-[11px] text-muted-foreground">
              {t("proccfg.thePreRollMethodsSuitContinuation")}
            </p>
          )}
        </div>
      )}

      {isCloud() && data.smartCutEnabled && (
        <div className="flex flex-col gap-2 ps-3 border-s-2 border-muted-foreground/20">
          <div>
            <Label htmlFor="smart-cut-prev" className="text-[11px] text-muted-foreground">
              {t("proccfg.searchWindowEndOfPreviousClip", { n: data.smartCutFramesPrev ?? 8 })}
            </Label>
            <Input
              id="smart-cut-prev"
              type="number"
              min={1}
              max={24}
              step={1}
              className="h-8 text-xs"
              value={data.smartCutFramesPrev ?? 8}
              onChange={(e) =>
                onUpdate({ smartCutFramesPrev: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })
              }
            />
          </div>
          <div>
            <Label htmlFor="smart-cut-next" className="text-[11px] text-muted-foreground">
              {t("proccfg.searchWindowStartOfNextClip", { n: data.smartCutFramesNext ?? 8 })}
            </Label>
            <Input
              id="smart-cut-next"
              type="number"
              min={1}
              max={24}
              step={1}
              className="h-8 text-xs"
              value={data.smartCutFramesNext ?? 8}
              onChange={(e) =>
                onUpdate({ smartCutFramesNext: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })
              }
            />
          </div>
        </div>
      )}

      {/* Manual trim fields — ONLY for the Manual method (or non-cloud
          builds, where Manual is the only method). Hidden under the smart
          methods per the boundary-cut-method design above. */}
      {(!isCloud() || !data.smartCutEnabled) && (
        <>
          <div>
            <Label htmlFor="trim-end-frames">
              {t("proccfg.trimEachClipEndFramesExcept", { n: data.trimEndFrames ?? 2 })}
            </Label>
            <Input
              id="trim-end-frames"
              type="number"
              min={0}
              max={120}
              step={1}
              value={data.trimEndFrames ?? 2}
              onChange={(e) =>
                onUpdate({ trimEndFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
              }
            />
          </div>

          <div>
            <Label htmlFor="trim-start-frames">
              {t("proccfg.trimEachClipStartFramesExcept", { n: data.trimStartFrames ?? 1 })}
            </Label>
            <Input
              id="trim-start-frames"
              type="number"
              min={0}
              max={120}
              step={1}
              value={data.trimStartFrames ?? 1}
              onChange={(e) =>
                onUpdate({ trimStartFrames: e.target.value === "" ? 0 : parseInt(e.target.value, 10) })
              }
            />
          </div>
        </>
      )}
    </div>
  )
}

export function AddCaptionsConfig({ data, onUpdate }: ConfigProps<AddCaptionsData>) {
  const t = useT()
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
        <Label>{t("field.style")}</Label>
        <Select
          value={data.style}
          onValueChange={(v) => handleStyleChange(v as AddCaptionsData["style"])}
        >
          <SelectTrigger aria-label={t("field.style")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtitle">{t("proccfg.subtitleStatic")}</SelectItem>
            <SelectItem value="word-highlight">{t("proccfg.wordHighlightKinetic")}</SelectItem>
            <SelectItem value="karaoke">{t("proccfg.karaokeKinetic")}</SelectItem>
            <SelectItem value="tiktok-words">{t("proccfg.tiktokWordsKinetic")}</SelectItem>
            <SelectItem value="word-pop">{t("proccfg.wordPopKinetic")}</SelectItem>
            <SelectItem value="bouncy">{t("proccfg.bouncyKinetic")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
        <CaptionsStylePreview
          style={data.style}
          position={data.position}
          fontSize={data.fontSize}
          color={data.color}
          backgroundColor={data.backgroundColor as string | undefined}
        />
      </Suspense>

      <div>
        <Label>{t("proccfg.position")}</Label>
        <Select value={data.position} onValueChange={(v) => onUpdate({ position: v as AddCaptionsData["position"] })}>
          <SelectTrigger aria-label={t("proccfg.position")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bottom">{t("proccfg.bottom")}</SelectItem>
            <SelectItem value="top">{t("proccfg.top")}</SelectItem>
            <SelectItem value="center">{t("proccfg.center")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="font-size">{t("proccfg.fontSize")}</Label>
        <Input id="font-size" type="number" min={8} max={200}
          value={data.fontSize ?? ""}
          onChange={(e) => onUpdate({ fontSize: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </div>
      <div>
        <Label htmlFor="caption-color">{t("proccfg.color")}</Label>
        <Input id="caption-color" type="color" value={data.color} onChange={(e) => onUpdate({ color: e.target.value })} />
      </div>
      {data.style !== "subtitle" && (
        <div className="text-xs text-muted-foreground">
          {t("proccfg.kineticStylesRenderViaRemotion5", { handle: "captions" })}
        </div>
      )}
    </div>
  )
}

export function ResizeVideoConfig({ data, onUpdate }: ConfigProps<ResizeVideoData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("proccfg.targetAspectRatio")}</Label>
        <AspectRatioSelector
          options={COMPOSITION_RATIOS}
          value={data.targetAspect}
          onValueChange={(v) => onUpdate({ targetAspect: v as ResizeVideoData["targetAspect"] })}
        />
      </div>
      <div>
        <Label>{t("proccfg.method")}</Label>
        <Select
          value={data.method}
          onValueChange={(v) => onUpdate({ method: v as ResizeVideoData["method"] })}
        >
          <SelectTrigger aria-label={t("proccfg.method")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">{t("audiocfg.crop")}</SelectItem>
            <SelectItem value="pad">{t("proccfg.pad")}</SelectItem>
            <SelectItem value="stretch">{t("proccfg.stretch")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="pad-color">{t("proccfg.padColor")}</Label>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("proccfg.audioFormat")}</Label>
        <Select
          value={data.audioFormat}
          onValueChange={(v) => onUpdate({ audioFormat: v as TrimAudioData["audioFormat"] })}
        >
          <SelectTrigger aria-label={t("proccfg.audioFormat2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="start-time">{t("proccfg.startTimeSOptional")}</Label>
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
        <Label htmlFor="end-time">{t("proccfg.endTimeSOptional")}</Label>
        <Input
          id="end-time"
          type="number"
          min={0}
          step={0.1}
          placeholder={t("proccfg.endOfFile")}
          value={(data.endTime as number | undefined) ?? ""}
          onChange={(e) => onUpdate({ endTime: e.target.value ? parseFloat(e.target.value) : undefined })}
        />
      </div>
    </div>
  )
}

export function SplitMediaConfig({ data, onUpdate }: ConfigProps<SplitMediaData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="chunk-duration">{t("proccfg.chunkDurationSeconds")}</Label>
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
        <Label>{t("proccfg.audioFormat")}</Label>
        <Select
          value={data.audioFormat ?? "mp3"}
          onValueChange={(v) => onUpdate({ audioFormat: v as "mp3" | "wav" | "aac" })}
        >
          <SelectTrigger aria-label={t("proccfg.audioFormat2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp3">MP3</SelectItem>
            <SelectItem value="wav">WAV</SelectItem>
            <SelectItem value="aac">AAC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(data.generatedAudioUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("proccfg.outputChunk")}</label>
          <select
            value={data.outputChunkIndex ?? 0}
            onChange={(e) => {
              const val = Number(e.target.value)
              onUpdate({ outputChunkIndex: val })
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {data.generatedAudioUrls!.map((_, i) => (
              <option key={i} value={i}>{t("proccfg.chunk", { n: i + 1 })}</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">{t("proccfg.selectWhichChunkToOutputWhen")}</p>
        </div>
      )}
      {(data.generatedAudioUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {t("proccfg.audioChunks", { count: data.generatedAudioUrls!.length })}
            </label>
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const allSelected = !data.selectedAudioChunks || data.selectedAudioChunks.length === data.generatedAudioUrls!.length
                onUpdate({ selectedAudioChunks: allSelected ? [] : data.generatedAudioUrls!.map((_, idx) => idx) })
              }}
            >
              {!data.selectedAudioChunks || data.selectedAudioChunks.length === data.generatedAudioUrls!.length ? t("lib.deselectAll") : t("lib.selectAll")}
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
                  <span className="text-[11px] text-muted-foreground">{t("proccfg.chunk", { n: i + 1 })}</span>
                  <a href={url} download className="text-[10px] text-primary hover:underline ms-auto" onClick={(e) => e.stopPropagation()}>{t("proccfg.download")}</a>
                </div>
                <WaveformAudioPlayer url={url} variant="compact" className="w-full" />
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.generatedVideoUrls?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {t("proccfg.videoChunks", { count: data.generatedVideoUrls!.length })}
            </label>
            <button
              type="button"
              className="text-[10px] text-primary hover:underline"
              onClick={() => {
                const allSelected = !data.selectedVideoChunks || data.selectedVideoChunks.length === data.generatedVideoUrls!.length
                onUpdate({ selectedVideoChunks: allSelected ? [] : data.generatedVideoUrls!.map((_, idx) => idx) })
              }}
            >
              {!data.selectedVideoChunks || data.selectedVideoChunks.length === data.generatedVideoUrls!.length ? t("lib.deselectAll") : t("lib.selectAll")}
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
                  <span className="text-[11px] text-muted-foreground">{t("proccfg.chunk", { n: i + 1 })}</span>
                  <a href={url} download className="text-[10px] text-primary hover:underline ms-auto" onClick={(e) => e.stopPropagation()}>{t("proccfg.download")}</a>
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

// Extract Audio has no settings — connect a video and run.
export function ExtractAudioConfig(_props: ConfigProps<ExtractAudioData>) {
  const localizeNode = useLocalizeNodeLabel()
  const t = useT()
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>{t("proccfg.extractsTheAudioTrackFromThe")}</p>
      <p className="text-xs">{t("proccfg.noSettingsConnectAVideoTo", { node: localizeNode("Remove Audio") })}</p>
    </div>
  )
}

// Remove Audio has no settings — connect a video and run.
export function RemoveAudioConfig(_props: ConfigProps<RemoveAudioData>) {
  const localizeNode = useLocalizeNodeLabel()
  const t = useT()
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>{t("proccfg.stripsTheAudioTrackFromThe")}</p>
      <p className="text-xs">{t("proccfg.noSettingsConnectAVideoTo2", { node: localizeNode("Extract Audio") })}</p>
    </div>
  )
}

export function MixAudioConfig({ data, onUpdate, nodes, sources }: ConfigProps<MixAudioData>) {
  const t = useT()
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
        <p className="text-xs text-muted-foreground">{t("proccfg.connectAudioNodesToSetPer")}</p>
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
                <span className="text-xs text-muted-foreground ms-2 tabular-nums">{volume}%</span>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="volume">{t("proccfg.volume")}</Label>
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
        <Label htmlFor="normalize">{t("audiocfg.normalize")}</Label>
      </div>
      <div>
        <Label htmlFor="fade-in">{t("proccfg.fadeInS")}</Label>
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
        <Label htmlFor="fade-out">{t("proccfg.fadeOutS")}</Label>
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
  const t = useT()
  const mode = data.trimMode ?? "time"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("proccfg.trimMode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ trimMode: v as TrimVideoData["trimMode"] })}>
          <SelectTrigger aria-label={t("proccfg.trimMode2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="time">{t("proccfg.rangeStartEndSeconds")}</SelectItem>
            <SelectItem value="seconds">{t("proccfg.trimEdgesSeconds")}</SelectItem>
            <SelectItem value="keep-first-seconds">{t("proccfg.keepFirstNSeconds")}</SelectItem>
            <SelectItem value="keep-last-seconds">{t("proccfg.keepLastNSeconds")}</SelectItem>
            <SelectItem value="frames">{t("proccfg.trimEdgesFrames")}</SelectItem>
            <SelectItem value="smart-loop-cut">{t("proccfg.smartLoopCut")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode !== "smart-loop-cut" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="trim-lossless-kf"
            checked={data.losslessKeyframe ?? false}
            onChange={(e) => onUpdate({ losslessKeyframe: e.target.checked })}
            className="rounded border-muted-foreground/40"
          />
          <label htmlFor="trim-lossless-kf" className="text-xs">
            {t("proccfg.losslessSnapToKeyframeNoRe")}
          </label>
        </div>
      )}

      {mode === "time" && (
        <>
          <div>
            <Label htmlFor="start-time">{t("proccfg.startTimeS")}</Label>
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
            <Label htmlFor="end-time">{t("proccfg.endTimeS")}</Label>
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

      {mode === "seconds" && (
        <>
          <div>
            <Label htmlFor="trim-start-seconds">{t("proccfg.trimFromStartS")}</Label>
            <Input
              id="trim-start-seconds"
              type="number"
              min={0}
              step={0.1}
              placeholder="0"
              value={data.trimStartSeconds ?? ""}
              onChange={(e) => onUpdate({ trimStartSeconds: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="trim-end-seconds">{t("proccfg.trimFromEndS")}</Label>
            <Input
              id="trim-end-seconds"
              type="number"
              min={0}
              step={0.1}
              placeholder="0"
              value={data.trimEndSeconds ?? ""}
              onChange={(e) => onUpdate({ trimEndSeconds: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {t("proccfg.secondsMirrorOfTheFramesMode")}
          </p>
        </>
      )}

      {mode === "keep-first-seconds" && (
        <>
          <div>
            <Label htmlFor="keep-first-seconds">{t("proccfg.keepFirstS")}</Label>
            <Input
              id="keep-first-seconds"
              type="number"
              min={0.1}
              step={0.1}
              placeholder="10"
              value={data.keepFirstSeconds ?? ""}
              onChange={(e) => onUpdate({ keepFirstSeconds: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {t("proccfg.outputIsTheFirstNSeconds")}
          </p>
        </>
      )}

      {mode === "keep-last-seconds" && (
        <>
          <div>
            <Label htmlFor="keep-last-seconds">{t("proccfg.keepLastS")}</Label>
            <Input
              id="keep-last-seconds"
              type="number"
              min={0.1}
              step={0.1}
              placeholder="10"
              value={data.keepLastSeconds ?? ""}
              onChange={(e) => onUpdate({ keepLastSeconds: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {t("proccfg.outputIsTheLastNSeconds")}
          </p>
        </>
      )}

      {mode === "frames" && (
        <>
          <div>
            <Label htmlFor="trim-start-frames">{t("proccfg.trimFromStartFrames")}</Label>
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
            <Label htmlFor="trim-end-frames">{t("proccfg.trimFromEndFrames")}</Label>
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
            {t("proccfg.theWorkerProbesTheSourceS")}
          </p>
        </>
      )}

      {mode === "smart-loop-cut" && (
        <>
          <div>
            <Label htmlFor="smart-lookback">{t("proccfg.lookbackWindowFrames")}</Label>
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
            {t("proccfg.picksTheTrailingFrameClosestTo")}
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
        <label htmlFor="outputSilentVideo" className="text-xs text-muted-foreground">{t("proccfg.outputSilentVideo")}</label>
      </div>
    </div>
  )
}

export function ExtractFrameConfig({ data, onUpdate }: ConfigProps<ExtractFrameData>) {
  const t = useT()
  const mode = data.mode || "first"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="extract-mode">{t("proccfg.frameSelection")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as ExtractFrameData["mode"] })}>
          <SelectTrigger id="extract-mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">{t("proccfg.firstFrame")}</SelectItem>
            <SelectItem value="last">{t("proccfg.lastFrame")}</SelectItem>
            <SelectItem value="timestamp">{t("proccfg.atTimestampS")}</SelectItem>
            <SelectItem value="frame-index">{t("proccfg.frameFromStart")}</SelectItem>
            <SelectItem value="frame-from-end">{t("proccfg.frameFromEnd")}</SelectItem>
            <SelectItem value="keyframe">{t("proccfg.nearestKeyframe")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(mode === "timestamp" || mode === "keyframe") && (
        <div>
          <Label htmlFor="extract-timestamp">
            {mode === "keyframe" ? t("proccfg.seekToSeconds") : t("proccfg.timestampSeconds")}
          </Label>
          <Input
            id="extract-timestamp"
            type="number"
            min={0}
            step={0.1}
            value={data.timestamp ?? 0}
            onChange={(e) => onUpdate({ timestamp: e.target.value === "" ? 0 : parseFloat(e.target.value) })}
          />
          {mode === "keyframe" && (
            <p className="text-[10px] text-muted-foreground leading-snug mt-1">
              {t("proccfg.snapsToTheNearestKeyframeAt")}
            </p>
          )}
        </div>
      )}
      {mode === "frame-index" && (
        <div>
          <Label htmlFor="extract-frame-index">{t("proccfg.frameIndexFromStart")}</Label>
          <Input
            id="extract-frame-index"
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={data.frameIndex ?? ""}
            onChange={(e) => onUpdate({ frameIndex: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
          <p className="text-[10px] text-muted-foreground leading-snug mt-1">
            {t("proccfg.0FirstFrameWorkerProbesSource")}
          </p>
        </div>
      )}
      {mode === "frame-from-end" && (
        <div>
          <Label htmlFor="extract-frames-from-end">{t("proccfg.framesBackFromEnd")}</Label>
          <Input
            id="extract-frames-from-end"
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={data.framesFromEnd ?? ""}
            onChange={(e) => onUpdate({ framesFromEnd: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
          />
          <p className="text-[10px] text-muted-foreground leading-snug mt-1">
            {t("proccfg.0LastFrame1SecondTo")}
          </p>
        </div>
      )}
    </div>
  )
}

export function SpeedRampConfig({ data, onUpdate }: ConfigProps<SpeedRampData>) {
  const t = useT()
  const speedLabel = data.speed === 1 ? t("proccfg.1xNormal") : data.speed < 1 ? t("proccfg.xSlowMo", { speed: data.speed }) : t("proccfg.xFast", { speed: data.speed })
  // Resolve effective audio mode for the UI, honoring the legacy adjustAudio shim.
  const audioMode: "pitch-preserve" | "pitch-shift" | "drop" =
    data.audioMode ?? (data.adjustAudio === false ? "drop" : "pitch-preserve")
  const quality = data.quality ?? "fast"
  const reverse = data.reverse ?? false
  const ramps = data.ramps ?? []
  const usingRamps = ramps.length > 0

  function updateRamp(index: number, patch: Partial<{ start: number; end: number; speed: number }>) {
    const next = ramps.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onUpdate({ ramps: next })
  }
  function addRamp() {
    const last = ramps[ramps.length - 1]
    const start = last ? last.end : 0
    onUpdate({ ramps: [...ramps, { start, end: start + 1, speed: 0.5 }] })
  }
  function removeRamp(index: number) {
    onUpdate({ ramps: ramps.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      {!usingRamps && (
        <div>
          <Label htmlFor="speed">{t("proccfg.speed", { label: speedLabel })}</Label>
          <input
            id="speed"
            type="range"
            min={0.1}
            max={10.0}
            step={0.05}
            value={data.speed}
            onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{t("proccfg.x", { n: 0.1 })}</span>
            <span>{t("proccfg.x", { n: 1 })}</span>
            <span>{t("proccfg.x", { n: 10 })}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="speed-reverse"
          checked={reverse}
          onChange={(e) => onUpdate({ reverse: e.target.checked })}
        />
        <Label htmlFor="speed-reverse">{t("proccfg.reversePlayback")}</Label>
      </div>

      <div>
        <Label>{t("field.audio")}</Label>
        <Select
          value={audioMode}
          onValueChange={(v) => onUpdate({
            audioMode: v as "pitch-preserve" | "pitch-shift" | "drop",
            adjustAudio: undefined,
          })}
        >
          <SelectTrigger aria-label={t("proccfg.audioMode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pitch-preserve">{t("proccfg.pitchPreservedNaturalVoice")}</SelectItem>
            <SelectItem value="pitch-shift">{t("proccfg.pitchShiftedChipmunkGiant")}</SelectItem>
            <SelectItem value="drop">{t("proccfg.dropAudio")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>{t("proccfg.frameQuality")}</Label>
        <Select value={quality} onValueChange={(v) => onUpdate({ quality: v as "fast" | "smooth" })}>
          <SelectTrigger aria-label={t("proccfg.frameQuality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">{t("proccfg.fastFrameDuplicate2Cr")}</SelectItem>
            <SelectItem value="smooth">{t("proccfg.smoothMotionInterpolation5Cr")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("proccfg.smoothSynthesizesInBetweenFramesFor")}
        </p>
      </div>

      <div className="border-t border-border/40 pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label>{t("proccfg.speedRampsVariableSpeed")}</Label>
          <button
            type="button"
            onClick={addRamp}
            className="text-[11px] px-2 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073] hover:bg-[#ff0073]/20"
          >
            {t("proccfg.addSegment")}
          </button>
        </div>
        {ramps.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            {t("proccfg.addSegmentsForVariableSpeedE")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ramps.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-muted-foreground w-4">{i + 1}</span>
                <input
                  type="number" min={0} step={0.1} value={r.start}
                  onChange={(e) => updateRamp(i, { start: parseFloat(e.target.value) || 0 })}
                  className="w-14 px-1 py-0.5 rounded border bg-background"
                  aria-label={t("proccfg.segmentStart", { n: i + 1 })}
                />
                <span className="text-muted-foreground">→</span>
                <input
                  type="number" min={0} step={0.1} value={r.end}
                  onChange={(e) => updateRamp(i, { end: parseFloat(e.target.value) || 0 })}
                  className="w-14 px-1 py-0.5 rounded border bg-background"
                  aria-label={t("proccfg.segmentEnd", { n: i + 1 })}
                />
                <span className="text-muted-foreground">{t("proccfg.s")}</span>
                <input
                  type="number" min={0.05} max={100} step={0.05} value={r.speed}
                  onChange={(e) => updateRamp(i, { speed: parseFloat(e.target.value) || 1 })}
                  className="w-14 px-1 py-0.5 rounded border bg-background"
                  aria-label={t("proccfg.segmentSpeed", { n: i + 1 })}
                />
                <span className="text-muted-foreground">x</span>
                <button
                  type="button" aria-label={t("proccfg.removeSegment", { n: i + 1 })}
                  onClick={() => removeRamp(i)}
                  className="ms-auto text-muted-foreground hover:text-red-500"
                >×</button>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              {t("proccfg.audioIsDroppedWhileRampsAre")}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export function LoopVideoConfig({ data, onUpdate }: ConfigProps<LoopVideoData>) {
  const t = useT()
  const mode = data.mode ?? "repeat"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("field.mode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as LoopVideoData["mode"] })}>
          <SelectTrigger aria-label={t("proccfg.loopMode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="repeat">{t("proccfg.repeatNTimes")}</SelectItem>
            <SelectItem value="duration">{t("proccfg.loopToDuration")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "repeat" && (
        <div>
          <Label htmlFor="repeat-count">{t("proccfg.repeatX", { n: data.repeatCount ?? 2 })}</Label>
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
            <span>{t("proccfg.x", { n: 2 })}</span>
            <span>{t("proccfg.x", { n: 10 })}</span>
            <span>{t("proccfg.x", { n: 20 })}</span>
          </div>
        </div>
      )}

      {mode === "duration" && (
        <div>
          <Label htmlFor="target-duration">{t("proccfg.targetDurationS", { n: data.targetDuration ?? 10 })}</Label>
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
            <span>{t("proccfg.s2", { n: 1 })}</span>
            <span>{t("proccfg.s2", { n: 150 })}</span>
            <span>{t("proccfg.s2", { n: 300 })}</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {mode === "repeat"
          ? t("proccfg.theInputVideoWillBeRepeated")
          : t("proccfg.theInputVideoWillLoopUntil")}
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
          <label htmlFor="loop-video-smart-cut-pre" className="text-xs">{t("proccfg.smartCutBeforeLooping")}</label>
        </div>
        <p className="text-[10px] text-muted-foreground px-1 leading-snug">
          {t("proccfg.trimsTheInputClipToIts")}
        </p>
        {data.smartLoopCutBeforeRepeat && (
          <div>
            <Label htmlFor="loop-video-smart-lookback" className="text-xs">{t("proccfg.lookbackWindowFrames")}</Label>
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

export function GifToVideoConfig({ data, onUpdate }: ConfigProps<GifToVideoData>) {
  const t = useT()
  const loopToMinimum = data.loopToMinimum ?? true
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id="gif-loop-to-minimum"
          checked={loopToMinimum}
          onChange={(e) => onUpdate({ loopToMinimum: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor="gif-loop-to-minimum" className="text-xs">{t("proccfg.extendShortGifsToATarget")}</label>
      </div>
      <p className="text-[10px] text-muted-foreground px-1 leading-snug">
        {t("proccfg.mostGifsAreShorterThanThe")}
      </p>

      {loopToMinimum && (
        <div>
          <Label htmlFor="gif-target-duration">{t("proccfg.targetDurationS", { n: data.targetDuration ?? 3 })}</Label>
          <input
            id="gif-target-duration"
            type="range"
            min={2}
            max={8}
            step={1}
            value={data.targetDuration ?? 3}
            onChange={(e) => onUpdate({ targetDuration: parseInt(e.target.value, 10) })}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-[#ff0073] bg-[#F8FAFC] dark:bg-[#121212]"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{t("proccfg.s2", { n: 2 })}</span>
            <span>{t("proccfg.s2", { n: 5 })}</span>
            <span>{t("proccfg.s2", { n: 8 })}</span>
          </div>
        </div>
      )}

      <div>
        <Label>{t("proccfg.motionSmoothing")}</Label>
        <Select value={(data.interpolate ?? true) ? "smooth" : "stepped"} onValueChange={(v) => onUpdate({ interpolate: v === "smooth" })}>
          <SelectTrigger aria-label={t("proccfg.motionSmoothing")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="smooth">{t("proccfg.smoothInterpolateTo24fps")}</SelectItem>
            <SelectItem value="stepped">{t("proccfg.preserveOriginalTiming")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
          {t("proccfg.smoothSynthesisesInBetweenFramesFor")}
        </p>
      </div>

      <div>
        <Label>{t("proccfg.transparentBackground")}</Label>
        <Select value={data.alphaBackground ?? "white"} onValueChange={(v) => onUpdate({ alphaBackground: v as GifToVideoData["alphaBackground"] })}>
          <SelectTrigger aria-label={t("proccfg.transparentBackground")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="white">{t("proccfg.white")}</SelectItem>
            <SelectItem value="black">{t("proccfg.black")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
          {t("proccfg.mp4CanTCarryTransparencyA")}
        </p>
      </div>
    </div>
  )
}

export function FadeVideoConfig({ data, onUpdate }: { data: FadeVideoData; onUpdate: (patch: Partial<FadeVideoData>) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("proccfg.fadeColor")}</Label>
        <Select value={data.color ?? "black"} onValueChange={(v) => onUpdate({ color: v as "black" | "white" })}>
          <SelectTrigger aria-label={t("proccfg.fadeColor2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="black">{t("proccfg.black")}</SelectItem>
            <SelectItem value="white">{t("proccfg.white")}</SelectItem>
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
        <Label htmlFor="fade-in-toggle" className="mb-0">{t("proccfg.fadeIn")}</Label>
      </div>
      {data.fadeIn !== false && (
        <div>
          <Label htmlFor="fade-in-dur">{t("proccfg.durationS", { n: data.fadeInDuration ?? 0.5 })}</Label>
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
            <span>{t("proccfg.s2", { n: 0.1 })}</span>
            <span>{t("proccfg.s2", { n: 1.5 })}</span>
            <span>{t("proccfg.s2", { n: 3 })}</span>
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
        <Label htmlFor="fade-out-toggle" className="mb-0">{t("proccfg.fadeOut")}</Label>
      </div>
      {data.fadeOut !== false && (
        <div>
          <Label htmlFor="fade-out-dur">{t("proccfg.durationS", { n: data.fadeOutDuration ?? 0.5 })}</Label>
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
            <span>{t("proccfg.s2", { n: 0.1 })}</span>
            <span>{t("proccfg.s2", { n: 1.5 })}</span>
            <span>{t("proccfg.s2", { n: 3 })}</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {t("proccfg.applyFadeInOutTransitionsTo")}
      </p>
    </div>
  )
}

export function TranscodeVideoConfig({ data, onUpdate }: ConfigProps<TranscodeVideoData>) {
  const t = useT()
  const [showAdvanced, setShowAdvanced] = useState(false)
  const isDefault = data.codec === "h264" && (data.crf ?? 23) === 23 && data.resolution === "original" && data.audioBitrate === "128k"

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("proccfg.autoTranscodesVideoToBrowserPhone")}
      </p>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {t("proccfg.advancedSettings")} {isDefault && t("proccfg.usingDefaults")}
      </button>

      {showAdvanced && (
        <div className="flex flex-col gap-3 ps-1 border-s-2 border-muted-foreground/10 ms-1">
          <div>
            <Label>{t("proccfg.codec")}</Label>
            <Select
              value={data.codec ?? "h264"}
              onValueChange={(v) => onUpdate({ codec: v as TranscodeVideoData["codec"] })}
            >
              <SelectTrigger aria-label={t("proccfg.codec")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="h264">{t("proccfg.h264Recommended")}</SelectItem>
                <SelectItem value="h265">H.265 (HEVC)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="transcode-crf">{t("proccfg.qualityCrf", { n: data.crf ?? 23 })}</Label>
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
              <span>{t("proccfg.0Best")}</span>
              <span>{t("proccfg.23Default")}</span>
              <span>{t("proccfg.51Worst")}</span>
            </div>
          </div>

          <div>
            <Label>{t("field.resolution")}</Label>
            <Select
              value={data.resolution ?? "original"}
              onValueChange={(v) => onUpdate({ resolution: v as TranscodeVideoData["resolution"] })}
            >
              <SelectTrigger aria-label={t("field.resolution")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="original">{t("proccfg.original")}</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="480p">480p</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t("proccfg.audioBitrate")}</Label>
            <Select
              value={data.audioBitrate ?? "128k"}
              onValueChange={(v) => onUpdate({ audioBitrate: v as TranscodeVideoData["audioBitrate"] })}
            >
              <SelectTrigger aria-label={t("proccfg.audioBitrate2")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="128k">{t("proccfg.128KbpsDefault")}</SelectItem>
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

/** Per-image size hint options — wire values 0–3 (see ImageCollageData.imageSizeBySource). */
function COLLAGE_SIZE_OPTIONS() {
  return [
  { value: 0, label: tx("imgcfg.styleAuto") },
  { value: 1, label: tx("proccfg.big") },
  { value: 2, label: tx("proccfg.med") },
  { value: 3, label: tx("proccfg.small") },
] as const
}

export function ImageCollageConfig({ data, onUpdate, sources }: ConfigProps<ImageCollageData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground px-1">
        {t("proccfg.arrangesEveryConnectedImageIntoOne")}
      </p>
      <div>
        <Label>{t("proccfg.layout")}</Label>
        <Select
          value={data.layout ?? "smart"}
          onValueChange={(v) => onUpdate({ layout: v as ImageCollageData["layout"] })}
        >
          <SelectTrigger aria-label={t("proccfg.layout")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="smart">{t("proccfg.smartJustifiedAspectAware")}</SelectItem>
            <SelectItem value="grid">{t("proccfg.gridUniformCells")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="collage-numbered" className="text-xs font-medium">
            {t("proccfg.numberImagesStoryboard")}
          </Label>
          <Switch
            id="collage-numbered"
            checked={!!data.numbered}
            // `undefined` rather than `false` when off, so a node that never
            // touched this stays byte-identical to a pre-feature workflow.
            onCheckedChange={(v) => onUpdate({ numbered: v ? true : undefined })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("proccfg.123AtEachImage")}
        </p>
      </div>
      <div>
        <Label>{t("proccfg.badgeCorner")}</Label>
        <Select
          value={data.badgePosition === "top-right" ? "top-right" : "top-left"}
          // Top-left is the default: store `undefined` for it so a node that never
          // touched this stays byte-identical to a pre-feature workflow.
          onValueChange={(v) => onUpdate({ badgePosition: v === "top-right" ? "top-right" : undefined })}
        >
          <SelectTrigger aria-label={t("proccfg.badgeCorner")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="top-left">{t("proccfg.topLeftStoryboardConvention")}</SelectItem>
            <SelectItem value="top-right">{t("proccfg.topRight")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("proccfg.whereTheNumberAndLabelSit")}
        </p>
      </div>
      {sources.length > 0 && (
        <div>
          {/* ONE sortable list for both concerns: drag rows to set the collage
              order (persisted as imageOrder — the `in` handle's parallel order
              field, cleared when the handle popover reorders edges), and pick
              each input's size hint on the row's second line. The collage
              accepts ANY image producer, so the accepted set is simply every
              connected source (the handle's accepts-gate already filtered),
              with a generic generated-image thumbnail fallback for types the
              default resolver doesn't know (extract-frame, modify-image, …). */}
          <ConnectedMediaList
            sources={sources}
            mediaOrder={data.imageOrder ?? []}
            onUpdateOrder={(order) => onUpdate({ imageOrder: order })}
            acceptedTypes={new Set(sources.map((s) => s.type))}
            mediaType="image"
            emptyMessage={t("proccfg.connect2ImageProducersToArrange")}
            thumbnailFor={(s) => {
              const nd = s.nodeData ?? {}
              const results = nd.generatedResults as Array<{ url?: string }> | undefined
              return (
                getSourceThumbnail(s) ??
                results?.[(nd.activeResultIndex as number) ?? 0]?.url ??
                (nd.generatedImageUrl as string | undefined) ??
                (nd.url as string | undefined)
              )
            }}
            renderRowExtra={(entry) => {
              const current = data.imageSizeBySource?.[entry.id] ?? 0
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <div
                    className="flex rounded-md border border-border overflow-hidden w-fit"
                    role="radiogroup"
                    aria-label={t("proccfg.sizeFor", { label: entry.label })}
                  >
                    {COLLAGE_SIZE_OPTIONS().map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={current === opt.value}
                        className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                          current === opt.value
                            ? "bg-[#ff0073] text-white"
                            : "bg-transparent text-muted-foreground hover:bg-muted"
                        }`}
                        onClick={() =>
                          onUpdate({
                            imageSizeBySource: {
                              ...(data.imageSizeBySource ?? {}),
                              [entry.id]: opt.value,
                            },
                          })
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    className="h-6 w-32 text-[11px]"
                    placeholder={t("proccfg.labelOptional")}
                    maxLength={80}
                    aria-label={t("proccfg.labelFor", { label: entry.label })}
                    value={data.imageLabelBySource?.[entry.id] ?? ""}
                    onChange={(e) => {
                      const next = { ...(data.imageLabelBySource ?? {}) }
                      const v = e.target.value
                      if (v) next[entry.id] = v
                      else delete next[entry.id]
                      onUpdate({ imageLabelBySource: next })
                    }}
                  />
                </div>
              )
            }}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {(data.layout ?? "smart") === "grid"
              ? t("proccfg.dragToReorderReadingOrderSize")
              : t("proccfg.dragToReorderReadingOrderSizes")}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {t("proccfg.labelsShowAfterTheNumberE")}
          </p>
        </div>
      )}
      <div>
        <Label>{t("field.aspectRatio")}</Label>
        <AspectRatioSelector
          options={COLLAGE_ASPECT_RATIOS}
          value={data.aspectRatio ?? "4:3"}
          onValueChange={(v) => onUpdate({ aspectRatio: v })}
        />
      </div>
      <div>
        <Label>{t("field.resolution")}</Label>
        <Select
          value={data.resolution ?? "2K"}
          onValueChange={(v) => onUpdate({ resolution: v as ImageCollageData["resolution"] })}
        >
          <SelectTrigger aria-label={t("field.resolution")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="2K">{t("proccfg.2k2560PxLongEdge")}</SelectItem>
            <SelectItem value="4K">{t("proccfg.4k3840PxLongEdge")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="collage-gap">{t("proccfg.gapPx", { n: data.gap ?? 24 })}</Label>
        <input
          id="collage-gap"
          type="range"
          min={0}
          max={120}
          step={2}
          value={data.gap ?? 24}
          onChange={(e) => onUpdate({ gap: parseInt(e.target.value, 10) })}
          className="w-full accent-[#ff0073]"
        />
      </div>
      <div>
        <Label htmlFor="collage-bg">{t("proccfg.backgroundColor")}</Label>
        <Input
          id="collage-bg"
          type="color"
          value={data.backgroundColor ?? "#ffffff"}
          onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
        />
      </div>
    </div>
  )
}

export function SocialMediaFormatConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SocialMediaFormatData>) {
  const t = useT()
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
        <Label>{t("proccfg.platform")}</Label>
        <Select value={platform} onValueChange={handlePlatformChange}>
          <SelectTrigger aria-label={t("proccfg.platform")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PLATFORM_LABELS) as SocialMediaPlatform[]).map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>{t("proccfg.contentType")}</Label>
        <Select value={data.specKey} onValueChange={handleContentTypeChange}>
          <SelectTrigger aria-label={t("proccfg.contentType2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {contentTypes.map((ct) => {
              const labelKey = CONTENT_TYPE_LABEL_KEYS[ct.key]
              return (
                <SelectItem key={ct.key} value={ct.key}>{labelKey ? t(labelKey) : ct.label}</SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {spec && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between"><span>{t("proccfg.dimensions")}</span><span className="font-medium text-foreground">{spec.width}×{spec.height}</span></div>
          <div className="flex justify-between"><span>{t("field.aspectRatio")}</span><span className="font-medium text-foreground">{(spec.width / spec.height).toFixed(2)}:1</span></div>
          {spec.maxDurationSeconds && (
            <div className="flex justify-between"><span>{t("proccfg.maxDuration")}</span><span className="font-medium text-foreground">{t("proccfg.s2", { n: spec.maxDurationSeconds })}</span></div>
          )}
          <div className="flex justify-between"><span>{t("proccfg.textLimit")}</span><span className="font-medium text-foreground">{t("proccfg.chars", { count: spec.textLimit.toLocaleString() })}</span></div>
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
        <Label>{t("proccfg.resizeMethod")}</Label>
        <Select value={data.method} onValueChange={(v) => onUpdate({ method: v as SocialMediaFormatData["method"] })}>
          <SelectTrigger aria-label={t("proccfg.resizeMethod2")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="crop">{t("proccfg.cropFillCutEdges")}</SelectItem>
            <SelectItem value="pad">{t("proccfg.padFitAddBars")}</SelectItem>
            <SelectItem value="stretch">{t("proccfg.stretchDistort")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data.method === "pad" && (
        <div>
          <Label htmlFor="smf-pad-color">{t("proccfg.padColor")}</Label>
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
        label={t("proccfg.captionPostText")}
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
          placeholder={t("proccfg.enterPostTextOptional")}
          className="min-h-[60px] text-xs"
        />
        {isOverLimit && (
          <p className="text-[10px] text-red-500 mt-1">
            {t("proccfg.textExceedsSCharacterLimitBy", { platform: PLATFORM_LABELS[platform], limit: textLimit, over: textLen - textLimit })}
          </p>
        )}
      </MappableField>

      <p className="text-[10px] text-muted-foreground">
        {t("proccfg.ffmpegProcessingReformatsMediaToSpecs", { platform: PLATFORM_LABELS[platform] })}
      </p>
    </div>
  )
}

export function ManualEditConfig({ data, onUpdate }: ConfigProps<ManualEditData>) {
  const t = useT()
  const status = data.executionStatus ?? "idle"
  const mode = data.mode ?? "bypass"
  const editorLoad = data.editorLoad ?? "first"

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("proccfg.runMode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as "bypass" | "wait" })}>
          <SelectTrigger aria-label={t("proccfg.runMode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bypass">{t("proccfg.bypassPassThrough")}</SelectItem>
            <SelectItem value="wait">{t("proccfg.waitForEdit")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {mode === "bypass" ? t("proccfg.passesInputThroughDuringWorkflowRun") : t("proccfg.pausesWorkflowUntilYouFinishEditing")}
        </p>
      </div>

      <div>
        <Label>{t("proccfg.editorLoad")}</Label>
        <Select value={editorLoad} onValueChange={(v) => onUpdate({ editorLoad: v as "first" | "all" })}>
          <SelectTrigger aria-label={t("proccfg.editorLoad")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first">{t("proccfg.firstAssetToTimeline")}</SelectItem>
            <SelectItem value="all">{t("proccfg.allAssetsToTimeline")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          {editorLoad === "first" ? t("proccfg.firstVideoOnTimelineOthersIn") : t("proccfg.allAssetsLoadedToTimelineOn")}
        </p>
      </div>

      {status === "awaiting-user" && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs font-medium text-amber-500">{t("proccfg.waitingForYourEdit")}</span>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {t("proccfg.0CreditsConnectVideosImagesAnd")}
      </p>
    </div>
  )
}
