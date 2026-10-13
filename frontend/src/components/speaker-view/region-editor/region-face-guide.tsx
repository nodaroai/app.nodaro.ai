"use client"

/**
 * The guide's step on screen (tap-first, decided 2026-10-13; `face-guide.ts`):
 * "Which face is {speaker}?" — answered by clicking a face's label on the
 * frame — or "Who is this face?" for a fragment tied to no one, answered with
 * a speaker, Nobody, or Skip. When the last step is answered it says what is
 * left to do: Save, then Update preview.
 */
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import type { FaceGuideStep } from "./face-guide"
import type { TrackEdit } from "./use-region-tracks"

interface RegionFaceGuideProps {
  /** The step to answer; null when none is left. */
  readonly step: FaceGuideStep | null
  /** Steps were asked in this session, so an empty guide means "done", not "nothing to ask". */
  readonly done: boolean
  /** The clip's speakers, as the editor names them. */
  readonly speakers: readonly string[]
  /** How a speaker shows (today's rename map). */
  readonly nameOf: (speaker: string) => string
  readonly readOnly?: boolean
  readonly onAssign: (trackId: string, value: TrackEdit) => void
  readonly onSkip: (step: FaceGuideStep) => void
}

export function RegionFaceGuide({ step, done, speakers, nameOf, readOnly, onAssign, onSkip }: RegionFaceGuideProps) {
  const t = useT()
  if (!step) {
    if (!done) return null
    return (
      <p role="status" data-testid="region-face-guide-done" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        {t("speakerView.framing.guideDone")}
      </p>
    )
  }
  return (
    <section data-testid="region-face-guide" aria-live="polite" className="flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
      {step.kind === "speaker" ? (
        <>
          <p className="font-medium">{t("speakerView.framing.whichFace", { speaker: nameOf(step.speaker) })}</p>
          <p className="text-[11px] text-muted-foreground">{t("speakerView.framing.whichFaceHint")}</p>
        </>
      ) : (
        <>
          <p className="font-medium">{t("speakerView.framing.whoIsThis")}</p>
          <p className="text-[11px] text-muted-foreground">{t("speakerView.framing.whoIsThisHint", { track: step.trackId })}</p>
          <div className="flex flex-wrap gap-1">
            {speakers.map((s) => (
              <Button key={s} type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={readOnly} onClick={() => onAssign(step.trackId, s)}>
                {nameOf(s)}
              </Button>
            ))}
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={readOnly} onClick={() => onAssign(step.trackId, null)}>
              {t("speakerView.framing.assignNobody")}
            </Button>
          </div>
        </>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-7 self-end text-xs" onClick={() => onSkip(step)}>
        {t("speakerView.framing.guideSkip")}
      </Button>
    </section>
  )
}
