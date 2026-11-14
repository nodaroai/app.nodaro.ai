/**
 * Edit with AI's abilities as cards, in their groups. A card is ticked when
 * the request asks for it; tapping it writes its words into the request, or
 * takes them out. While a run is on, each card shows its step's state; after
 * it, what was done, and a done step cannot be asked for again on this video.
 */
import { AlertTriangle, Captions, Check, Eraser, Loader2, Music, Scissors } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { ABILITIES, ABILITY_GROUPS, ABILITY_HINT, ABILITY_NAME, GROUP_TITLE } from "@/ee/lib/freecut-ai/abilities"
import type { EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import type { EditPrices, StepOutcome, StepOutcomes } from "@/ee/lib/freecut-ai/panel-model"

const ICON: Record<EditStep, typeof Scissors> = {
  pauses: Scissors,
  fillers: Eraser,
  captions: Captions,
  music: Music,
}

export interface AbilityCardsProps {
  /** The steps the request asks for now. */
  readonly asked: readonly EditStep[]
  readonly outcomes: StepOutcomes
  readonly locked: boolean
  readonly prices: EditPrices
  readonly onToggle: (step: EditStep) => void
}

export function AbilityCards({ asked, outcomes, locked, prices, onToggle }: AbilityCardsProps) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      {ABILITY_GROUPS.map((group) => (
        <section key={group} aria-label={t(GROUP_TITLE[group])}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/60">{t(GROUP_TITLE[group])}</p>
          <div className="grid grid-cols-2 gap-2">
            {ABILITIES.filter((a) => a.group === group).map((a) => (
              <AbilityCard key={a.key} step={a.key} checked={asked.includes(a.key)} outcome={outcomes[a.key]} locked={locked} prices={prices} onToggle={onToggle} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function AbilityCard({
  step,
  checked,
  outcome,
  locked,
  prices,
  onToggle,
}: {
  readonly step: EditStep
  readonly checked: boolean
  readonly outcome?: StepOutcome
  readonly locked: boolean
  readonly prices: EditPrices
  readonly onToggle: (step: EditStep) => void
}) {
  const t = useT()
  const Icon = ICON[step]
  const state = outcome?.state
  const done = state === "done"
  const sub = outcome ? t(outcome.key, outcome.vars) : t(ABILITY_HINT[step])
  const price = step === "music"
    ? prices.music !== undefined
      ? t("freecutAi.priceAbout", { n: formatNumber(creditUnits(prices.music)), u: creditUnitLabel(t("credits.unitShort")) })
      : null
    : t("freecutAi.free")
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={locked || done}
      onClick={() => onToggle(step)}
      data-state={state ?? "idle"}
      className={cn(
        "flex min-h-[92px] flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-start transition-colors disabled:cursor-default",
        checked && !done ? "border-[#ff0073]/70 bg-[#ff0073]/10" : "border-[#2D2D2D] bg-[#1E1E1E]",
        !locked && !done && "hover:border-white/30",
        done && "border-emerald-400/40",
      )}
    >
      <span className="flex w-full items-center justify-between gap-1">
        <Icon className="h-4 w-4 text-white/80" aria-hidden />
        {state === "working" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" aria-hidden /> : null}
        {done ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> : null}
        {state === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-200" aria-hidden /> : null}
      </span>
      <span className="text-xs font-semibold leading-tight text-white">{t(ABILITY_NAME[step])}</span>
      <span className={cn("text-[11px] leading-snug", state === "failed" ? "text-amber-200" : "text-white/65")} dir="auto">
        {sub}
      </span>
      {outcome?.detail ? <span className="line-clamp-2 text-[11px] text-white/55" dir="auto" title={outcome.detail}>{outcome.detail}</span> : null}
      <span className="mt-auto flex w-full items-center gap-2">
        {price && !done ? <span className="text-[11px] text-white/60">{price}</span> : null}
        {state === "working" ? (
          <span className="h-1 flex-1 overflow-hidden rounded bg-white/10">
            <span className="block h-full bg-sky-300 transition-[width] duration-300" style={{ width: `${Math.round((outcome?.progress ?? 0) * 100)}%` }} />
          </span>
        ) : null}
      </span>
    </button>
  )
}
