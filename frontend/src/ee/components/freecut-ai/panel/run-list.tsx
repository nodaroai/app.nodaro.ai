/**
 * While the agents work: the assistant's answer, then only this run's steps,
 * each as the assistant understood it ("Change the picture: the sky"), with its
 * agent's colour, a live line ("Cut 7 of 23 · −14.2 s") and a thin bar; under
 * them, the last few things the agents said, in the open.
 */
import { AlertTriangle, Check, Loader2 } from "lucide-react"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ABILITY_NAME, ABILITY_OF } from "@/ee/lib/freecut-ai/abilities"
import type { EditPlan, EditStep } from "@/ee/lib/freecut-ai/edit-plan"
import type { StepOutcomes } from "@/ee/lib/freecut-ai/panel-model"
import { AGENT_COLORS } from "@/ee/lib/freecut-ai/run-ai-edit"
import { AGENT_NAME, type FeedLine } from "./use-edit-session"

/** A step as the plan has it: what is changed in the picture, how many clips, which look. */
function stepTitle(step: EditStep, plan: EditPlan, t: ReturnType<typeof useT>): string {
  if (step === "picture" && plan.params.picture?.what) return t("freecutAi.planPicture", { what: plan.params.picture.what })
  if (step === "clips") return t(plan.params.clips === 1 ? "freecutAi.planClipsOne" : "freecutAi.planClips", { n: plan.params.clips })
  if (step === "color") return t(`freecutAi.look.${plan.params.look}` as MessageKey)
  return t(ABILITY_NAME[step])
}

export function RunList({ plan, outcomes }: { readonly plan: EditPlan; readonly outcomes: StepOutcomes }) {
  const t = useT()
  return (
    <section aria-label={t("freecutAi.thisRun")} className="flex flex-col gap-1.5">
      {plan.reply ? <p className="text-xs leading-relaxed text-white/80" dir="auto">{plan.reply}</p> : null}
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">{t("freecutAi.thisRun")}</p>
      {plan.steps.map((step) => {
        const o = outcomes[step]
        const agent = ABILITY_OF[step].agent
        const working = o?.state === "working"
        return (
          <div key={step} className="flex flex-col gap-1 rounded-lg bg-white/[0.035] px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGENT_COLORS[agent] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white" dir="auto">{stepTitle(step, plan, t)}</span>
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" aria-hidden /> : null}
              {o?.state === "done" ? <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> : null}
              {o?.state === "failed" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-200" aria-hidden /> : null}
            </div>
            <p className={cn("truncate text-[11px]", o?.state === "failed" ? "text-amber-200" : "text-white/60")} dir="auto" title={o?.detail}>
              {o ? t(o.key, o.vars) : t("freecutAi.waiting")}
            </p>
            {working ? (
              <span className="h-0.5 overflow-hidden rounded bg-white/10">
                <span className="block h-full transition-[width] duration-300" style={{ width: `${Math.round((o?.progress ?? 0) * 100)}%`, background: AGENT_COLORS[agent] }} />
              </span>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

/** The last few things the agents said, newest last. */
export function Narration({ lines }: { readonly lines: readonly FeedLine[] }) {
  const t = useT()
  const last = lines.slice(-3)
  if (last.length === 0) return null
  return (
    <ol className="flex flex-col gap-0.5 text-[11px]" aria-live="polite">
      {last.map((line) => (
        <li key={line.id} className="flex gap-1.5 leading-snug">
          <span className="shrink-0 font-semibold" style={{ color: AGENT_COLORS[line.agent] }}>{t(AGENT_NAME[line.agent])}</span>
          <span className="min-w-0 truncate text-white/70" dir="auto">{t(line.key, line.vars)}</span>
        </li>
      ))}
    </ol>
  )
}
