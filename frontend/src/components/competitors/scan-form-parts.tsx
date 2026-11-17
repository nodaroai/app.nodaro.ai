"use client"

import type { ReactNode } from "react"
import { COMPETITOR_SCHEDULES, type CompetitorSchedule, type SocialPlatform } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { DialogFooter } from "@/components/ui/dialog"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SCHEDULE_LABEL } from "./schedule-label"

/**
 * The parts the two scan forms share (a tracked brand's and a followed
 * topic's): where to search, how often, and the price with Save.
 */

/** The platforms with `p` switched: on when it was off, off when it was on. */
export function togglePlatform<P extends string>(selected: readonly P[], p: P): P[] {
  return selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]
}

/** A row of platform chips, each pressed on or off, under a legend. */
export function PlatformToggleGroup<P extends SocialPlatform>({
  legend,
  platforms,
  selected,
  onToggle,
  children,
}: {
  readonly legend: string
  readonly platforms: readonly P[]
  readonly selected: readonly P[]
  readonly onToggle: (p: P) => void
  /** Shown under the chips (a word on what is missing). */
  readonly children?: ReactNode
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {platforms.map((p) => {
          const on = selected.includes(p)
          return (
            <button
              key={p}
              type="button"
              onClick={() => onToggle(p)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold",
                on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {SOCIAL_PLATFORM_META[p].icon("h-3.5 w-3.5")}
              {SOCIAL_PLATFORM_META[p].name}
            </button>
          )
        })}
      </div>
      {children}
    </fieldset>
  )
}

/** How often a scan runs on its own. */
export function ScheduleSelect({ value, onChange }: { readonly value: CompetitorSchedule; readonly onChange: (schedule: CompetitorSchedule) => void }) {
  const t = useT()
  return (
    <label className="flex items-center gap-2 text-sm">
      {t("competitors.schedule")}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CompetitorSchedule)}
        className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
      >
        {COMPETITOR_SCHEDULES.map((s) => (
          <option key={s} value={s}>
            {t(SCHEDULE_LABEL[s])}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A scan form's foot: what one scan reads and costs, Cancel and Save. */
export function ScanFormFooter({
  priceText,
  credits,
  saveDisabled,
  onCancel,
  onSave,
}: {
  /** "Each scan runs N searches:", in the form's own words. */
  readonly priceText: string
  readonly credits: number
  readonly saveDisabled: boolean
  readonly onCancel: () => void
  readonly onSave: () => void
}) {
  const t = useT()
  return (
    <DialogFooter className="flex flex-wrap items-center gap-3 sm:justify-between">
      <span className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
        {priceText}
        <CreditCost credits={credits} icon="sm" />
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={onSave} disabled={saveDisabled}>
          {t("common.save")}
        </Button>
      </div>
    </DialogFooter>
  )
}
