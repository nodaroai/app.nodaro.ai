import type { SpeakerViewContext } from "@nodaro/render-rules"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { Label } from "@/components/ui/label"
import type { EdlValidity } from "@/lib/edl-validity"
import { useT } from "@/lib/i18n"
import type { SpeakerViewInputProblem, SpeakerViewInputState } from "@/lib/speaker-view-input-state"

const PROBLEM_KEYS = {
  "wire-camera-switch": "speakerView.state.wireCameraSwitch",
  "no-transcript": "speakerView.state.noTranscript",
  "no-speaker-labels": "speakerView.state.noLabels",
} as const

interface SpeakerViewInputSummaryProps {
  readonly state: SpeakerViewInputState
  readonly ctx: SpeakerViewContext | undefined
  readonly verdict: EdlValidity | null
  /** Why the plugin cannot read speakers from this input (SV24), if it cannot. */
  readonly problem: SpeakerViewInputProblem | null
  /** The transcript's speakers against the edit's, when they differ. */
  readonly mismatch: { readonly labels: readonly string[]; readonly names: readonly string[] } | null
}

/**
 * The panel's INPUT section (U2, U2b): what the wired edit holds, and which of
 * the input states applies — no edit, an upstream that has not run, a clip
 * pack, speakers the plugin cannot read (SV24) or a transcript whose speakers
 * are not the edit's. The badge beneath it carries the full list of issues.
 */
export function SpeakerViewInputSummary({ state, ctx, verdict, problem, mismatch }: SpeakerViewInputSummaryProps) {
  const t = useT()
  return (
    <section className="flex flex-col gap-1">
      <Label>{t("speakerView.section.input")}</Label>
      {state.kind === "not-run" ? (
        <p role="status" data-testid="speaker-view-input-state" className="text-[11px] text-muted-foreground">
          {t("speakerView.state.notRun", { producer: state.producer })}
        </p>
      ) : ctx ? (
        <p className="text-[11px] text-muted-foreground" data-testid="speaker-view-input-summary">
          {ctx.clips.length > 1
            ? t("speakerView.inputPack", { clips: ctx.clips.length, min: Math.min(...ctx.clips.map((c) => c.speakerCount)), max: Math.max(...ctx.clips.map((c) => c.speakerCount)) })
            : t("speakerView.inputSummary", { speakers: ctx.clips[0]!.speakerCount, cameras: ctx.clips[0]!.cameras })}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t("speakerView.inputNone")}</p>
      )}
      {problem && (
        <p role="status" data-testid="speaker-view-input-state" className="text-[11px] text-destructive">{t(PROBLEM_KEYS[problem])}</p>
      )}
      {mismatch && (
        <p role="status" data-testid="speaker-view-input-state" className="text-[11px] text-amber-700 dark:text-amber-400">
          {t("speakerView.state.labelMismatch", { labels: mismatch.labels.join(", "), names: mismatch.names.join(", ") })}
        </p>
      )}
      <EdlValidityBadge verdict={verdict} />
    </section>
  )
}
