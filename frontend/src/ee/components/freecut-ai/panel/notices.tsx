/**
 * What the panel says about the request itself: what you asked, a part it
 * cannot do or a price it did not show (ask before going on), and a request
 * that ended before anything was edited.
 */
import { Ban } from "lucide-react"
import { useT } from "@/lib/i18n"
import type { EditPlan } from "@/ee/lib/freecut-ai/edit-plan"
import type { DeclinedReason } from "@/ee/lib/freecut-ai/run-ai-edit"

export function AskedBubble({ text }: { readonly text: string }) {
  const t = useT()
  return (
    <div className="self-end rounded-lg bg-white/10 px-3 py-2 text-xs">
      <span className="block text-[11px] text-white/60">{t("freecutAi.youAsked")}</span>
      <span dir="auto">{text}</span>
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
 * costs more than the price shown (each paid part it adds, with its price, and
 * what the whole plan is charged). Run it, or change the request.
 */
export function ConfirmPartial({
  plan,
  lines,
  total,
  onAnswer,
}: {
  readonly plan: EditPlan
  /** Each paid part the plan adds beyond the price shown, in words ("Music: 33 CR"). */
  readonly lines: readonly string[]
  /** What the whole plan is charged, in words ("56 CR"), when every price is known. */
  readonly total?: string
  readonly onAnswer: (yes: boolean) => void
}) {
  const t = useT()
  const title = plan.cannot.length > 0 ? t("freecutAi.confirmTitle") : t("freecutAi.confirmCostTitle")
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2.5" role="group" aria-label={title}>
      <p className="text-xs font-semibold">{title}</p>
      {plan.cannot.length > 0 ? <CannotList items={plan.cannot} /> : null}
      {lines.length > 0 ? (
        <div className="flex flex-col gap-0.5 text-xs text-white/85">
          <p>{t("freecutAi.confirmAlso")}</p>
          <ul className="flex flex-col gap-0.5 ps-3 text-white/75">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {total ? <p className="font-medium text-white">{t("freecutAi.confirmTotal", { price: total })}</p> : null}
        </div>
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
      <div className="rounded-lg border border-[#262633] bg-[#121219] px-3 py-2.5" role="status">
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
