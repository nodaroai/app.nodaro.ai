import { usecaseCamerasReportOf } from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"

/**
 * Who a multicam take put on which camera (decided 2026-10-17), from the
 * node's cameras report (`useCaseCameras`): "Speaker n: Camera k", or the wide
 * shot for a speaker with no camera of their own. Shown in the review's
 * header for a use-case source; nothing for a run with no report.
 */
export function UseCaseCamerasSummary({ report }: { readonly report: unknown }) {
  const t = useT()
  const speakers = usecaseCamerasReportOf(report)?.speakers ?? []
  if (speakers.length === 0) return null
  return (
    <ul data-testid="use-case-cameras-summary" className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {speakers.map((s) => (
        <li key={s.ordinal}>
          {t("proccfg.usecaseSpeakerN", { n: s.ordinal })}: {s.camera === null ? t("proccfg.usecaseCameraWide") : t("proccfg.usecaseCameraN", { n: s.camera })}
        </li>
      ))}
    </ul>
  )
}
