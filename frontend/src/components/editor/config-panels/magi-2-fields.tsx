"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"
import { defaultVideoAspectRatio } from "@nodaro/shared/models"
import type { FieldMappings } from "@/types/nodes"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { MappableField } from "./mappable-field"
import { getAspectRatiosForVideoModel } from "./model-options"
import { ltx25SeedInput } from "./ltx-2-5-fields"
import type { SourceNodeInfo } from "./types"

/** The MAGI-2 node data these fields read and write. */
export interface Magi2FieldData {
  readonly aspectRatio?: string
  readonly generateAudio?: boolean
  readonly seed?: number
}

/**
 * MAGI-2's levers in a video config panel (Generate Video and the legacy Image
 * to Video / Text to Video): the aspect ratio (text and reference runs — a
 * frames-only run keeps the first frame's shape, the note says so), the sound
 * switch (on unless turned off, the same price either way) and the seed
 * (0-2147483647). There is no resolution choice (1080p only) and no negative
 * prompt (the panel hides it).
 */
export function Magi2Fields({
  provider,
  data,
  onUpdate,
  showAspectRatio,
  unsetFollowsFrame = false,
  showReferenceLimits,
  idPrefix,
  sources,
  fieldMappings,
  onMapField,
}: {
  readonly provider: string
  readonly data: Magi2FieldData
  readonly onUpdate: (updates: Partial<Magi2FieldData>) => void
  readonly showAspectRatio: boolean
  /** A frame and a reference are wired: an unset aspect ratio follows the frame's shape, so no ratio shows as chosen. */
  readonly unsetFollowsFrame?: boolean
  /** References are wired: the limits the run is held to are shown. */
  readonly showReferenceLimits: boolean
  readonly idPrefix: string
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}) {
  const t = useT()
  return (
    <>
      {showAspectRatio && (
        <MappableField field="aspectRatio" label={t("field.aspectRatio")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <AspectRatioSelector
            options={getAspectRatiosForVideoModel(provider)}
            value={data.aspectRatio || (unsetFollowsFrame ? "" : defaultVideoAspectRatio(provider))}
            onValueChange={(v) => onUpdate({ aspectRatio: v })}
          />
          {unsetFollowsFrame && !data.aspectRatio && (
            <p className="text-[11px] text-muted-foreground mt-1">{t("vidcfg.magi2AspectFollowsFrame")}</p>
          )}
        </MappableField>
      )}
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={`${idPrefix}-magi2Audio`}
          checked={data.generateAudio ?? true}
          onChange={(e) => onUpdate({ generateAudio: e.target.checked })}
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={`${idPrefix}-magi2Audio`} className="text-xs">{t("vidcfg.generateAudioDefaultOn")}</label>
      </div>
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
      {showReferenceLimits && (
        <p className="text-[11px] leading-snug text-muted-foreground px-1">{t("vidcfg.magi2RefLimits")}</p>
      )}
      <p className="text-[11px] text-muted-foreground px-1">{t("vidcfg.magi2Note")}</p>
    </>
  )
}
