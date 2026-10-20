/**
 * The camera note under a multicam take (decided 2026-10-17): what the run's
 * cameras report says a person may want to fix, as short lines — one per
 * speaker Speaker Map found no clear camera for (shown on the wide shot), and
 * one line when Audio Sync left a note (the recordings may be misaligned).
 * Mapped speakers, and a run with no report, say nothing. Pure.
 */
import { usecaseCamerasReportOf } from "@nodaro/render-rules"
import type { MessageKey } from "@/lib/i18n"

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

export function usecaseCameraNoteLines(report: unknown, t: T): string[] {
  const r = usecaseCamerasReportOf(report)
  if (!r) return []
  return [
    ...r.speakers.filter((s) => s.camera === null).map((s) => t("node.usecaseCameraUnclear", { n: s.ordinal })),
    ...(r.syncNotes.length > 0 ? [t("node.usecaseCameraSyncWeak")] : []),
  ]
}
