import { useT } from "@/lib/i18n"
import type { UnitConfigKit } from "../exec-kit"

// Remove Audio has no settings — connect a video and run.
export function ConfigPanel({ kit }: { readonly kit: UnitConfigKit }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground">
      <p>{t("proccfg.stripsTheAudioTrackFromThe")}</p>
      <p className="text-xs">{t("proccfg.noSettingsConnectAVideoTo2", { node: kit.localizeNodeLabel("Extract Audio") })}</p>
    </div>
  )
}
