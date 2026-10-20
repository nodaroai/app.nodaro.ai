"use client"

import { USE_CASE_FRAMING_SOURCES, type UseCaseFramingSource } from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"
import { useUseCaseFramesViewer } from "@/lib/use-case-frames-viewer"

const FRAMING_SOURCE_LABEL_KEYS: Readonly<Record<UseCaseFramingSource, MessageKey>> = {
  auto: "proccfg.usecaseFramingAuto",
  static: "proccfg.usecaseFramingStatic",
  tracking: "proccfg.usecaseFramingTracking",
}

/**
 * Where a framed use-case render's boxes come from (decided 2026-10-17): the
 * even split by speaker, Speaker Frames following faces, or automatic —
 * following faces while Speaker Frames is offered. Shared by every use-case
 * node that frames (its keys are hand-written in the dicts: several units
 * read them). The value shown is what the node runs: its stored choice, or
 * `absent` for a node that has none (a saved node runs the even split).
 *
 * Shown only to a viewer Speaker Frames is available to: for anyone else an
 * automatic source IS the even split (`usecaseFramingForViewer`), so there is
 * nothing to choose — except on a node set to follow faces, which their run
 * refuses: the field stays, with a note, so they can choose another.
 */
export function UseCaseFramingSourceField({
  value,
  onChange,
  absent,
}: {
  readonly value: UseCaseFramingSource | undefined
  readonly onChange: (next: UseCaseFramingSource) => void
  readonly absent: UseCaseFramingSource
}) {
  const t = useT()
  const viewer = useUseCaseFramesViewer()
  const shown = value ?? absent
  if (viewer === "loading" || (viewer === "withheld" && shown !== "tracking")) return null
  return (
    <div className="space-y-1.5">
      <Label>{t("proccfg.usecaseFramingSource")}</Label>
      <Select value={shown} onValueChange={(v) => onChange(v as UseCaseFramingSource)}>
        <SelectTrigger aria-label={t("proccfg.usecaseFramingSource")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {USE_CASE_FRAMING_SOURCES.map((s) => (
            <SelectItem key={s} value={s}>{t(FRAMING_SOURCE_LABEL_KEYS[s])}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {viewer === "withheld" ? (
        <p className="text-xs text-red-500">{t("proccfg.usecaseFramingNeedsFrames")}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("proccfg.usecaseFramingHint")}</p>
      )}
    </div>
  )
}
