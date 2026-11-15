/**
 * The original video, shown where the editor is, so the person can compare it
 * with the edit. The editor stays open beneath it, with the edit untouched;
 * "Back to the edit" hides this again.
 */
import { Undo2 } from "lucide-react"
import { useT } from "@/lib/i18n"

export function OriginalView({ url, onBack }: { readonly url: string; readonly onBack: () => void }) {
  const t = useT()
  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-black" dir="ltr">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <video key={url} src={url} controls playsInline preload="metadata" className="max-h-full max-w-full rounded" aria-label={t("freecutAi.originalBadge")} />
      </div>
      <span className="absolute start-4 top-4 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">{t("freecutAi.originalBadge")}</span>
      <div className="flex justify-center pb-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-white hover:bg-cta-hover">
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          {t("freecutAi.backToEdit")}
        </button>
      </div>
    </div>
  )
}
