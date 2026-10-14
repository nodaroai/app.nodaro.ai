import { getCharacterMotion, getCharacterMotionDiagnostics } from "@nodaro/prompts/pickers"
import { getCharacterMotionBindings } from "@nodaro/prompts/picker-catalogs"
import type { CharacterMotionData } from "@/types/nodes"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { formatCharacterMotionDiagnostic } from "./character-motion-diagnostic-copy"
import { useT } from "@/lib/i18n"
import { useParameterPreviewContext } from "./parameter-preview-context"

export function CharacterMotionDiagnostics({ data }: { data: CharacterMotionData }) {
  const t = useT()
  const { resolveLabel } = useLocalizedCatalog("character-motion")
  const label = (id: string) => resolveLabel(id, getCharacterMotion(id)?.label ?? id)
  const context = useParameterPreviewContext()
  const bindings = context ? getCharacterMotionBindings(context.node, context) : {}
  const diagnostics = getCharacterMotionDiagnostics(data.characterMotion, data, bindings)
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">{t("motionReview.fragment")}</p>
      <div role="status" aria-live="polite" aria-atomic="true">
        {diagnostics.length > 0 && <ul className="space-y-2">
          {[...diagnostics].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((item, i) => (
            <li key={`${item.code}-${i}`} className={item.severity === "error" ? "text-destructive" : item.severity === "warning" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
              <strong>{item.severity === "error" ? t("motionReview.attention") : item.severity === "warning" ? t("motionReview.sequenceWarning") : t("motionReview.requires")}</strong>{" "}{formatCharacterMotionDiagnostic(item, bindings, t, label)}
            </li>
          ))}
        </ul>}
      </div>
    </div>
  )
}
