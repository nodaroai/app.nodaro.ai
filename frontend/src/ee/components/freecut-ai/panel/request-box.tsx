/**
 * The request, in two places: the field under the abilities, for what the
 * person writes in their own words (with what it will do, "Will do"), and the
 * footer pinned at the bottom, with what the whole request costs and the one
 * button that starts it.
 */
import { useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { creditUnitLabel, creditUnits } from "@/lib/credit-units"
import { ABILITY_NAME } from "@/ee/lib/freecut-ai/abilities"
import type { EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import type { Cost } from "@/ee/lib/freecut-ai/panel-model"

export interface RequestFieldProps {
  readonly value: string
  readonly onChange: (text: string) => void
  readonly onSubmit: () => void
  /** What the request asks for that is not done yet, and what of it is done already. */
  readonly will: readonly EditStep[]
  readonly already: readonly EditStep[]
  readonly disabled: boolean
  /** An earlier run edited this video: the field invites the next step. */
  readonly after: boolean
}

export function RequestField({ value, onChange, onSubmit, will, already, disabled, after }: RequestFieldProps) {
  const t = useT()
  const text = value.trim()
  const names = (steps: readonly EditStep[]) => steps.map((s) => t(ABILITY_NAME[s])).join(t("common.listComma"))
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="freecut-ai-request" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
        {t("freecutAi.ownWords")}
      </label>
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
        className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.035] px-2.5 py-2 text-xs leading-relaxed text-white placeholder:text-white/40 focus:border-[#ff0073]/70 focus:outline-none"
      />
      {text ? (
        <div className="flex flex-col gap-0.5 text-[11px] leading-snug" aria-live="polite">
          {will.length > 0 ? (
            <p className="flex items-start gap-1.5 text-white/80">
              <Check className="mt-px h-3 w-3 shrink-0 text-emerald-300" aria-hidden />
              <span>{t("freecutAi.detectWill", { list: names(will) })}</span>
            </p>
          ) : null}
          {already.length > 0 ? <p className="text-white/55">{t("freecutAi.detectDone", { list: names(already) })}</p> : null}
          {will.length === 0 && already.length === 0 ? <p className="text-white/55">{t("freecutAi.detectRead")}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export interface ActionFooterProps {
  readonly cost: Cost
  readonly estimate: boolean
  /** The request asks for something: the button can start it. */
  readonly ready: boolean
  /** Only things made from the video are asked for. */
  readonly makeOnly: boolean
  readonly disabled: boolean
  readonly onStart: () => void
}

/** The footer: what the request costs (its parts on tap), and the one button that starts it. */
export function ActionFooter({ cost, estimate, ready, makeOnly, disabled, onStart }: ActionFooterProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const unit = creditUnitLabel(t("credits.unitShort"))
  const price = cost.total !== undefined && cost.total > 0 ? t(estimate ? "freecutAi.priceAbout" : "freecutAi.price", { n: formatNumber(creditUnits(cost.total)), u: unit }) : null
  const parts = cost.parts.filter((p) => p.credits !== undefined && p.credits > 0).map((p) => t(p.key, { ...p.vars, n: formatNumber(creditUnits(p.credits!)), u: unit }))
  return (
    <div className="flex flex-col gap-2 border-t border-white/10 bg-[#0e0e15] px-4 py-3">
      {open && parts.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-[11px] text-white/60">
          {parts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!ready || parts.length === 0}
          className={cn("min-w-0 flex-1 truncate text-start text-[11px] text-white/60", parts.length > 0 && "hover:text-white/80")}
          aria-expanded={open}
        >
          {!ready
            ? t("freecutAi.status.readySub")
            : cost.total === undefined
              ? t("freecutAi.priceLoading")
              : price
                ? t("freecutAi.priceNote", { price })
                : t("freecutAi.priceNoteFree")}
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={disabled || !ready}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-cta px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-cta-hover disabled:opacity-45"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t(makeOnly ? "freecutAi.cta.make" : "freecutAi.cta.edit")}
          {price ? <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[11px] font-medium">{price}</span> : null}
        </button>
      </div>
    </div>
  )
}
