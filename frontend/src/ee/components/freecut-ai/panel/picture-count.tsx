/**
 * Under a row, before anything is paid: how many of something the run makes,
 * with fewer and more. Under the pictures-on-the-words row it is the number
 * of pictures (the video's length sets it: four for half a minute, eight for
 * a minute), and the price on the button follows.
 */
import { Minus, Plus } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"
import { BROLL_MAX_SHOTS, BROLL_MIN_SHOTS } from "@/ee/lib/freecut-ai/run/broll"

export interface CountStepperProps {
  readonly count: number
  readonly min: number
  readonly max: number
  /** The count in words ("8 pictures"). */
  readonly label: string
  readonly fewer: string
  readonly more: string
  readonly locked: boolean
  readonly onCount: (count: number) => void
}

export function CountStepper({ count, min, max, label, fewer, more, locked, onCount }: CountStepperProps) {
  const step = "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
  return (
    <div className="ms-9 flex items-center gap-1 rounded-lg bg-white/[0.05] p-0.5">
      <button type="button" aria-label={fewer} disabled={locked || count <= min} onClick={() => onCount(count - 1)} className={step}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <p className="min-w-0 flex-1 text-center text-[11px] font-medium text-white" role="status">
        {label}
      </p>
      <button type="button" aria-label={more} disabled={locked || count >= max} onClick={() => onCount(count + 1)} className={step}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export interface PictureCountProps {
  readonly count: number
  readonly locked: boolean
  readonly onCount: (count: number) => void
}

export function PictureCount({ count, locked, onCount }: PictureCountProps) {
  const t = useT()
  return (
    <CountStepper
      count={count}
      min={BROLL_MIN_SHOTS}
      max={BROLL_MAX_SHOTS}
      label={count === 1 ? t("freecutAi.pictures.countOne") : t("freecutAi.pictures.count", { n: formatNumber(count) })}
      fewer={t("freecutAi.pictures.fewer")}
      more={t("freecutAi.pictures.more")}
      locked={locked}
      onCount={onCount}
    />
  )
}
