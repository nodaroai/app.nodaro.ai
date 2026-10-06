"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { ttsSupportsStitching } from "@nodaro/shared"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { FieldMappings } from "@/types/nodes"
import { MappableField } from "./mappable-field"
import type { SourceNodeInfo } from "./types"

/** The text-to-speech node fields these controls read and write. */
export interface TtsContinuityFields {
  previousText?: string
  nextText?: string
}

interface ContinuityProps {
  readonly provider: string | undefined
  readonly data: TtsContinuityFields
  readonly onUpdate: (patch: Partial<TtsContinuityFields>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

/**
 * "Continuity" config section of a text-to-speech node — the lines spoken just
 * before and just after this clip in the finished piece. Context the model reads,
 * never spoken: a stitching model picks up the intonation of the line before and
 * leads into the one after. Collapsed by default; a badge keeps a hidden value
 * visible. Both fields are mappable, so a wired Text node (the previous shot's
 * line) can supply them.
 *
 * Rendered only for a model whose sheet stitches (`ttsSupportsStitching` — the
 * same sheet the provider funnel reads; never a model-id comparison). For the
 * others nothing is shown, and a user's switch to one empties the fields
 * (`ttsModelSwitchPatch`), so a hidden value never comes back on the next switch.
 *
 * Writes ONLY in the user's own edit handlers — never from an effect on
 * `provider` or `data`: one panel instance is reused across text-to-speech nodes
 * (config-panel-tts-model-switch.test.tsx).
 */
export function TtsContinuitySection({ provider, data, onUpdate, sources, fieldMappings, onMapField }: ContinuityProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [expanded, setExpanded] = useState(false)
  if (!ttsSupportsStitching(provider)) return null

  const previous = data.previousText ?? ""
  const next = data.nextText ?? ""
  const setCount = (previous.trim() ? 1 : 0) + (next.trim() ? 1 : 0)

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <button
          type="button"
          data-testid="tts-continuity-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 text-start"
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className={cn("w-3 h-3 text-muted-foreground", isRtl && "rotate-180")} />}
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] cursor-pointer">
            {t("audiocfg.continuityTitle")}
          </Label>
          {setCount > 0 && (
            <span
              data-testid="tts-continuity-badge"
              className="ms-auto rounded-full bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300"
            >
              {t("audiocfg.continuitySetCount", { count: setCount })}
            </span>
          )}
        </button>
        {expanded && (
          <div className="space-y-2">
            <MappableField field="previousText" label={t("audiocfg.previousText")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Textarea
                id="tts-previous-text"
                aria-label={t("audiocfg.previousText")}
                rows={2}
                value={previous}
                onChange={(e) => onUpdate({ previousText: e.target.value })}
                placeholder={t("audiocfg.previousTextPh")}
                dir="auto"
              />
            </MappableField>
            <MappableField field="nextText" label={t("audiocfg.nextText")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
              <Textarea
                id="tts-next-text"
                aria-label={t("audiocfg.nextText")}
                rows={2}
                value={next}
                onChange={(e) => onUpdate({ nextText: e.target.value })}
                placeholder={t("audiocfg.nextTextPh")}
                dir="auto"
              />
            </MappableField>
            <p className="text-[10px] text-muted-foreground">{t("audiocfg.continuityHint")}</p>
          </div>
        )}
      </div>
    </>
  )
}
