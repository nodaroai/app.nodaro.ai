/**
 * The "Preview" label (F1): a render made at `quality: "proxy"` — a private
 * 720p cut for review — says so wherever it is shown: the node, an app's output
 * card, My Library and the editor's library. Read from what the take IS (its
 * result's or asset's stamped `quality`), never from the node's current setting.
 */
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Whether a result, an asset's metadata or a node output is a Preview. */
export function isPreviewQuality(stamped: { readonly quality?: unknown } | null | undefined): boolean {
  return stamped?.quality === "proxy"
}

export function PreviewBadge({ className }: { readonly className?: string }) {
  const t = useT()
  return (
    <span
      title={t("node.renderPreviewBadgeHint")}
      className={cn(
        "inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      {t("node.renderPreviewBadge")}
    </span>
  )
}
