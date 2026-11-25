"use client"

/**
 * The Set switch and its count on Generate Image, for a model that makes sets
 * (its catalog `imageSet`: Kling Image 4.0, 2 to 10 images). Hidden for every
 * other model, whose stored count the panel's fail-safe clears
 * (`imageSetFailSafe`). Off is no count at all: one image per run.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useT } from "@/lib/i18n"
import { imageSetRangeFor } from "./model-options"

/** The count a newly switched-on set starts at. */
const SET_START = 4

export function ImageSetField({ provider, value, onChange }: {
  /** The one model the node runs; undefined with several models selected. */
  readonly provider: string | undefined
  readonly value: number | undefined
  readonly onChange: (imageSetCount: number | undefined) => void
}) {
  const t = useT()
  const range = imageSetRangeFor(provider)
  if (!range) return null
  const on = value != null && value >= range.min
  const counts = Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="image-set-switch" className="text-xs font-medium">{t("field.imageSet")}</label>
        <Switch
          id="image-set-switch"
          checked={on}
          onCheckedChange={(checked) => onChange(checked ? Math.min(Math.max(SET_START, range.min), range.max) : undefined)}
        />
      </div>
      {on && (
        <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
          <SelectTrigger aria-label={t("field.imageSetCount")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {counts.map((n) => (
              <SelectItem key={n} value={String(n)}>{String(n)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-[11px] text-muted-foreground">{t("field.imageSetHint")}</p>
    </div>
  )
}
