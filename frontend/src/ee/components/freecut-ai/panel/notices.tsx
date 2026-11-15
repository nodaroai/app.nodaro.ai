/**
 * What the panel says about the request itself: what you asked, the plan the
 * assistant made of it, a part it cannot do (ask before going on), and a
 * request that ended before anything was edited.
 */
import { Ban, Check } from "lucide-react"
import { useT } from "@/lib/i18n"
import { ABILITY_NAME } from "@/ee/lib/freecut-ai/abilities"
import type { EditPlan } from "@/ee/lib/freecut-ai/edit-plan"
import type { DeclinedReason, ExtraCharge } from "@/ee/lib/freecut-ai/run-ai-edit"

export function AskedBubble({ text }: { readonly text: string }) {
  const t = useT()
  return (
    <div className="self-end rounded-lg bg-white/10 px-3 py-2 text-xs">
      <span className="block text-[11px] text-white/60">{t("freecutAi.youAsked")}</span>
      <span dir="auto">{text}</span>
    </div>
  )
}

export function PlanCard({ plan }: { readonly plan: EditPlan }) {
  const t = useT()
  if (plan.steps.length === 0) return null
  return (
    <div className="rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("freecutAi.plan")}</p>
      <ol className="mt-1.5 flex flex-col gap-1 text-xs text-white/85">
        {plan.steps.map((step) => (
          <li key={step} className="flex items-center gap-1.5">
            <Check className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden />
            {t(ABILITY_NAME[step])}
          </li>
        ))}
      </ol>
      {plan.reply ? <p className="mt-2 text-xs text-white/75" dir="auto">{plan.reply}</p> : null}
      {plan.cannot.length > 0 ? <CannotList items={plan.cannot} /> : null}
    </div>
  )
}

function CannotList({ items }: { readonly items: readonly string[] }) {
  const t = useT()
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-amber-200">{t("freecutAi.cannotHead")}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-white/85">
        {items.map((thing) => (
          <li key={thing} className="flex items-start gap-1.5" dir="auto">
            <Ban className="mt-0.5 h-3 w-3 shrink-0 text-amber-200" aria-hidden />
            <span>{thing}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Before anything paid starts: the plan leaves part of the request out, or it
 * costs more than the price shown (it also needs to listen to the video, or
 * music). Run it, or change the request.
 */
export function ConfirmPartial({
  plan,
  extra,
  total,
  onAnswer,
}: {
  readonly plan: EditPlan
  readonly extra: ExtraCharge
  /** What the whole plan is charged, in words ("56 CR"), when every price is known. */
  readonly total?: string
  readonly onAnswer: (yes: boolean) => void
}) {
  const t = useT()
  const title = plan.cannot.length > 0 ? t("freecutAi.confirmTitle") : t("freecutAi.confirmCostTitle")
  const needs = [extra.listen ? t("freecutAi.extra.listen") : null, extra.music ? t("freecutAi.extra.music") : null].filter(Boolean) as string[]
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5" role="group" aria-label={title}>
      <p className="text-xs font-semibold">{title}</p>
      {needs.length > 0 ? (
        <p className="text-xs text-white/85">
          {total ? t("freecutAi.confirmCostLine", { list: needs.join(t("common.listComma")), price: total }) : t("freecutAi.confirmCostLineNoPrice", { list: needs.join(t("common.listComma")) })}
        </p>
      ) : null}
      <p className="text-[11px] leading-snug text-white/65">{t("freecutAi.confirmNote")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onAnswer(true)} className="rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover">
          {plan.cannot.length > 0 ? t("freecutAi.confirmGo") : t("freecutAi.confirmGoAhead")}
        </button>
        <button type="button" onClick={() => onAnswer(false)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10">
          {t("freecutAi.confirmEdit")}
        </button>
      </div>
    </div>
  )
}

/** A request that ended before anything was edited: why, what it can do instead, and what was charged. */
export function Declined({ plan, reason }: { readonly plan: EditPlan; readonly reason: DeclinedReason }) {
  const t = useT()
  if (reason === "done") {
    return (
      <div className="rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2.5" role="status">
        <p className="text-xs text-white/80">{t("freecutAi.declinedDone")}</p>
        <p className="mt-1 text-[11px] text-white/60">{t("freecutAi.nothingEdited")}</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5" role="status">
      {plan.reply ? <p className="text-xs text-white/85" dir="auto">{plan.reply}</p> : null}
      {plan.cannot.length > 0 ? <CannotList items={plan.cannot} /> : null}
      <p className="mt-2 text-xs text-white/70">{t("freecutAi.canDo")}</p>
      <p className="mt-1 text-[11px] text-white/60">{t("freecutAi.nothingEdited")}</p>
    </div>
  )
}
