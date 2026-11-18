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

type RowState = "done" | "working" | "failed" | "waiting"

/** A step's state word, set at the end of its row like an instrument's readout. */
const STATE_WORD: Record<RowState, MessageKey> = {
  done: "freecutAi.stateDone",
  working: "freecutAi.stateWorking",
  failed: "freecutAi.stateFailed",
  waiting: "freecutAi.stateWaiting",
}

/** The disc at the start of a step's row: a check once done, lit while it works, hollow while it waits. */
function StateDisc({ state }: { readonly state: RowState }) {
  if (state === "done") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.6)]" aria-hidden>
        <Check className="h-2.5 w-2.5 text-[#0b0b11]" strokeWidth={3.5} />
      </span>
    )
  }
  if (state === "working") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#ff0073] shadow-[0_0_10px_rgb(255_0_115/0.7)]" aria-hidden>
        <Loader2 className="h-2.5 w-2.5 animate-spin text-white" strokeWidth={3} />
      </span>
    )
  }
  if (state === "failed") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-300" aria-hidden>
        <AlertTriangle className="h-2.5 w-2.5 text-[#0b0b11]" strokeWidth={3} />
      </span>
    )
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border border-white/25" aria-hidden />
}

const STATE_INK: Record<RowState, string> = {
  done: "text-emerald-300",
  working: "text-[#ff4f9a]",
  failed: "text-amber-200",
  waiting: "text-white/35",
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
        const state: RowState = o?.state === "done" || o?.state === "working" || o?.state === "failed" ? o.state : "waiting"
        return (
          <div
            key={step}
            className={cn(
              "flex flex-col gap-1 rounded-lg border px-2.5 py-2",
              working ? "border-[#ff0073]/45 bg-[#ff0073]/[0.07]" : "border-transparent bg-white/[0.035]",
            )}
          >
            <div className="flex items-center gap-2">
              <StateDisc state={state} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white" dir="auto">{stepTitle(step, plan, t)}</span>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AGENT_COLORS[agent] }} aria-hidden />
              <span className={cn("shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]", STATE_INK[state])}>{t(STATE_WORD[state])}</span>
            </div>
            <p className={cn("truncate ps-6 text-[11px]", o?.state === "failed" ? "text-amber-200" : "text-white/60")} dir="auto" title={o?.detail}>
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
