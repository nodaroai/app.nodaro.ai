/**
 * The request: what the person wants, in their own words or written by the
 * cards, with what it will do ("Will do", "Already done") and what it is
 * charged, beside the button that starts it.
 */
import { Check, Sparkles } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { ABILITY_NAME } from "@/ee/lib/freecut-ai/abilities"
import type { EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import type { Cost } from "@/ee/lib/freecut-ai/panel-model"

export interface RequestBoxProps {
  readonly value: string
  readonly onChange: (text: string) => void
  readonly onSubmit: () => void
  /** What the request asks for that is not done yet, and what of it is done already. */
  readonly will: readonly EditStep[]
  readonly already: readonly EditStep[]
  readonly cost: Cost
  readonly estimate: boolean
  readonly disabled: boolean
  /** An earlier run edited this video: the box invites the next step. */
  readonly after: boolean
}

export function RequestBox({ value, onChange, onSubmit, will, already, cost, estimate, disabled, after }: RequestBoxProps) {
  const t = useT()
  const text = value.trim()
  const unit = creditUnitLabel(t("credits.unitShort"))
  const names = (steps: readonly EditStep[]) => steps.map((s) => t(ABILITY_NAME[s])).join(t("common.listComma"))
  const breakdown = cost.parts
    .map((p) => (p.credits !== undefined ? t(p.key, { n: formatNumber(creditUnits(p.credits)), u: unit }) : null))
    .filter(Boolean)
    .join(" · ")
  const price = cost.total !== undefined
    ? t(estimate ? "freecutAi.priceAbout" : "freecutAi.price", { n: formatNumber(creditUnits(cost.total)), u: unit })
    : null
  const go = will.length > 1 ? t("freecutAi.goCount", { n: will.length }) : t("freecutAi.go")
  return (
    <div className="flex flex-col gap-2 border-b border-[#2D2D2D] px-4 py-3">
      <label htmlFor="freecut-ai-request" className="sr-only">{t("freecutAi.requestLabel")}</label>
      <textarea
        id="freecut-ai-request"
        dir="auto"
        rows={2}
        value={value}
        readOnly={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={t(after ? "freecutAi.placeholderNext" : "freecutAi.placeholder")}
        className="w-full resize-none rounded-md border border-white/15 bg-transparent px-2.5 py-2 text-xs leading-relaxed text-white placeholder:text-white/45 focus:border-[#ff0073] focus:outline-none"
      />
      {text ? (
        <div className="flex flex-col gap-1 text-[11px] leading-snug" aria-live="polite">
          {will.length > 0 ? (
            <p className="flex items-start gap-1.5 text-white/80">
              <Check className="mt-px h-3 w-3 shrink-0 text-emerald-300" aria-hidden />
              <span>{t("freecutAi.detectWill", { list: names(will) })}</span>
            </p>
          ) : null}
          {already.length > 0 ? <p className="text-white/60">{t("freecutAi.detectDone", { list: names(already) })}</p> : null}
          {will.length === 0 && already.length === 0 ? <p className="text-white/60">{t("freecutAi.detectRead")}</p> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[11px] text-white/60", !text && "invisible")} title={breakdown || undefined}>
          {price ? t("freecutAi.costLine", { price }) : null}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !text}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {go}
        </button>
      </div>
    </div>
  )
}
