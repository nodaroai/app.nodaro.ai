// @registry-lookup localizes the label of each quality option it shows, one option at a time
"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { PIXVERSE_V6_MAX_PROVIDER, defaultVideoAspectRatio, videoAudioPricedOn } from "@nodaro/shared/models"
import { uiResolutionFill } from "@nodaro/shared/video"
import type { FieldMappings } from "@/types/nodes"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { LockableSelectItem } from "./lockable-select-item"
import { MappableField } from "./mappable-field"
import { getAspectRatiosForVideoModel, getVideoResolutionOptions } from "./model-options"
import type { SourceNodeInfo } from "./types"

/** The PixVerse V6 Max node data these fields read and write. */
export interface PixverseV6MaxFieldData {
  readonly resolution?: string
  readonly aspectRatio?: string
  readonly sound?: boolean
  /** The older spelling of `sound` a node may still carry; read as a fallback, never written. */
  readonly kling3Sound?: boolean
  /** The older audio field; read after `sound`, never written. */
  readonly generateAudio?: boolean
  readonly seed?: number
}

/**
 * Whether the node's run generates audio — read from the SAME fields every
 * reservation reads (`sound ?? kling3Sound`, then `generateAudio`) through the
 * shared resolver, then the model's default on, so the box can never show one
 * state while the run bills the other. The box writes `sound`, which wins.
 */
export function pixverseV6MaxAudioOn(data: PixverseV6MaxFieldData): boolean {
  return videoAudioPricedOn(PIXVERSE_V6_MAX_PROVIDER, { sound: data.sound ?? data.kling3Sound, generateAudio: data.generateAudio })
}

/** A seed the model takes (a whole number 0-2147483647), or undefined. */
export function pixverseV6MaxSeedInput(raw: string): number | undefined {
  if (raw.trim() === "") return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : undefined
}

/**
 * PixVerse V6 Max's levers in a video config panel (Generate Video and the
 * legacy Image to Video / Text to Video): the quality select (displayed default
 * 720p — `uiResolutionFill`, the tier the bare credit identifier and the runner
 * default to, never the 360p first entry), the aspect ratio (text-only runs;
 * an image-to-video run follows its image, so the Image to Video panel leaves
 * it out), the audio switch (`sound` — the price depends on it, on unless
 * turned off) and the seed.
 */
export function PixverseV6MaxFields({
  provider,
  data,
  onUpdate,
  showAspectRatio,
  idPrefix,
  freeResLock,
  sources,
  fieldMappings,
  onMapField,
}: {
  readonly provider: string
  readonly data: PixverseV6MaxFieldData
  readonly onUpdate: (updates: Partial<PixverseV6MaxFieldData>) => void
  readonly showAspectRatio: boolean
  readonly idPrefix: string
  readonly freeResLock: (resolution: string) => string | null | undefined
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const opts = getVideoResolutionOptions(provider)
  return (
    <>
      {opts && opts.length > 0 ? (
        <MappableField field="resolution" label={t("field.resolution")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select
            value={data.resolution || uiResolutionFill(provider) || opts[0]!.value}
            onValueChange={(v) => onUpdate({ resolution: v })}
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
      {showAspectRatio && (
        <MappableField field="aspectRatio" label={t("field.aspectRatio")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <AspectRatioSelector
            options={getAspectRatiosForVideoModel(provider)}
            value={data.aspectRatio || defaultVideoAspectRatio(provider)}
            onValueChange={(v) => onUpdate({ aspectRatio: v })}
          />
        </MappableField>
      )}
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={`${idPrefix}-pixverseAudio`}
          checked={pixverseV6MaxAudioOn(data)}
          onChange={(e) => onUpdate({ sound: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={`${idPrefix}-pixverseAudio`} className="text-xs">{t("vidcfg.generateAudioPricing")}</label>
      </div>
      <div>
        <Label className="text-xs">{t("field.seedOptional")}</Label>
        <Input
          type="number"
          min={0}
          max={2147483647}
          step={1}
          value={data.seed ?? ""}
          onChange={(e) => onUpdate({ seed: pixverseV6MaxSeedInput(e.target.value) })}
        />
        <p className="text-[11px] text-muted-foreground mt-1">{t("vidcfg.sameSeedSimilar")}</p>
      </div>
      <p className="text-[11px] text-muted-foreground px-1">{t("vidcfg.pixverseV6MaxNote")}</p>
    </>
  )
}
