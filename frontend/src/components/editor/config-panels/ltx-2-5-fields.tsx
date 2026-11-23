// @registry-lookup localizes the label of each resolution option it shows, one option at a time
"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { defaultVideoAspectRatio, videoDurationCappedAt } from "@nodaro/shared/models"
import { getModel, videoDurationsAt, videoFrameRateFor } from "@nodaro/shared/model-catalog"
import { uiResolutionFill } from "@nodaro/shared/video"
import type { FieldMappings } from "@/types/nodes"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { LockableSelectItem } from "./lockable-select-item"
import { MappableField } from "./mappable-field"
import { VIDEO_FPS_OPTIONS, getAspectRatiosForVideoModel, getVideoResolutionOptions } from "./model-options"
import type { SourceNodeInfo } from "./types"

/** The LTX 2.5 node data these fields read and write. */
export interface Ltx25FieldData {
  readonly resolution?: string
  readonly aspectRatio?: string
  readonly fps?: number
  readonly duration?: number
  readonly seed?: number
}

/** A seed the model takes (a whole number 0-2147483647), or undefined. */
export function ltx25SeedInput(raw: string): number | undefined {
  if (raw.trim() === "") return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : undefined
}

/**
 * The lengths an LTX 2.5 node offers at its resolution and frame rate — the
 * catalog's `longClipLimit` (`videoDurationsAt`), the rule the run is priced
 * and sent by: LTX 2.5 Fast shows only 6, 8 and 10 s at 1440p or at 48 / 50 fps.
 */
export function ltx25OfferedDurations(provider: string, data: Ltx25FieldData): readonly number[] {
  return videoDurationsAt(provider, { resolution: data.resolution || uiResolutionFill(provider), fps: data.fps }) ?? []
}

/**
 * The patch that moves a stored length the node no longer renders at its
 * resolution and frame rate onto the nearest one it does (16 s at 1440p → 10 s),
 * the same move the server makes (`videoDurationCappedAt`). `{}` when it fits.
 */
export function ltx25LengthSnap(provider: string, data: Ltx25FieldData): { duration?: number } {
  if (typeof data.duration !== "number") return {}
  const capped = videoDurationCappedAt(provider, data.duration, { resolution: data.resolution || uiResolutionFill(provider), fps: data.fps })
  return capped !== data.duration ? { duration: capped } : {}
}

/**
 * LTX 2.5's levers in a video config panel (Generate Video and the legacy
 * Image to Video / Text to Video): the resolution (displayed default 1080p —
 * `uiResolutionFill`, the tier the bare credit identifier and the runner default
 * to), the frame rate (24 unless set), the aspect ratio (text-only runs: a start
 * frame sets the shape, so the field is hidden while one is wired) and the
 * seed. There is no audio switch — sound is always generated — no end frame,
 * no camera setting and no negative prompt (the panel hides them).
 */
export function Ltx25Fields({
  provider,
  data,
  onUpdate,
  showAspectRatio,
  frameSetsShape,
  idPrefix,
  freeResLock,
  sources,
  fieldMappings,
  onMapField,
}: {
  readonly provider: string
  readonly data: Ltx25FieldData
  readonly onUpdate: (updates: Partial<Ltx25FieldData>) => void
  readonly showAspectRatio: boolean
  /** A start frame is wired (or the node is image-to-video), so the clip takes
   *  its shape: the note says so. A text-only panel that renders its own ratio
   *  picker passes false. */
  readonly frameSetsShape: boolean
  readonly idPrefix: string
  readonly freeResLock: (resolution: string) => string | null | undefined
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const opts = getVideoResolutionOptions(provider)
  const fpsOpts = VIDEO_FPS_OPTIONS[provider] ?? []
  const limit = getModel(provider)?.longClipLimit
  return (
    <>
      {opts && opts.length > 0 ? (
        <MappableField field="resolution" label={t("field.resolution")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.resolution || uiResolutionFill(provider) || opts[0]!.value}
            onValueChange={(v) => onUpdate({ resolution: v, ...ltx25LengthSnap(provider, { ...data, resolution: v }) })}
          >
            <SelectTrigger aria-label={t("field.resolution")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {opts.map((o) => (
                <LockableSelectItem key={o.value} value={o.value} locked={freeResLock(o.value)}>{localizeOption(o.label)}</LockableSelectItem>
              ))}
            </SelectContent>
          </Select>
        </MappableField>
      ) : null}
      {fpsOpts.length > 0 && (
        <MappableField field="fps" label={t("field.fps")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={String(videoFrameRateFor(provider, data.fps) ?? fpsOpts[0]!.value)}
            onValueChange={(v) => {
              const fps = parseInt(v, 10)
              onUpdate({ fps, ...ltx25LengthSnap(provider, { ...data, fps }) })
            }}
          >
            <SelectTrigger id={`${idPrefix}-ltx25Fps`} aria-label={t("field.fps")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {fpsOpts.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MappableField>
      )}
      {limit && (
        <p className="text-[11px] text-muted-foreground px-1">
          {t("vidcfg.ltx25LongClipNote", { max: limit.maxSeconds })}
        </p>
      )}
      {showAspectRatio ? (
        <MappableField field="aspectRatio" label={t("field.aspectRatio")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <AspectRatioSelector
            options={getAspectRatiosForVideoModel(provider)}
            value={data.aspectRatio || defaultVideoAspectRatio(provider)}
            onValueChange={(v) => onUpdate({ aspectRatio: v })}
          />
        </MappableField>
      ) : frameSetsShape ? (
        <p className="text-[11px] text-muted-foreground px-1">{t("vidcfg.ltx25FrameShapeNote")}</p>
      ) : null}
      <div>
        <Label className="text-xs">{t("field.seedOptional")}</Label>
        <Input
          type="number"
          min={0}
          max={2147483647}
          step={1}
          value={data.seed ?? ""}
          onChange={(e) => onUpdate({ seed: ltx25SeedInput(e.target.value) })}
        />
        <p className="text-[11px] text-muted-foreground mt-1">{t("vidcfg.sameSeedSimilar")}</p>
      </div>
      <p className="text-[11px] text-muted-foreground px-1">{t("vidcfg.ltx25Note")}</p>
    </>
  )
}
