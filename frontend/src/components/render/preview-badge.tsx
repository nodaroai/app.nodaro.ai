/**
 * The "Preview" label (F1): a render made at `quality: "proxy"` — a private
 * 720p cut for review — says so wherever it is shown: the node, an app's output
 * card, My Library, the editor's library, the config panel's Latest Results, the
 * Executions tab and the fullscreen media preview. Read from what the take IS (its
 * result's or asset's stamped `quality`), never from the node's current setting.
 */
import { useT } from "@/lib/i18n"
import { runResultIdentity } from "@/lib/run-result-identity"
import { cn } from "@/lib/utils"

/** Whether a result, an asset's metadata or a node output is a Preview. */
export function isPreviewQuality(stamped: { readonly quality?: unknown } | null | undefined): boolean {
  return stamped?.quality === "proxy"
}

/** The quality stamped on an asset's metadata (for a caller that hands it on). */
export function qualityOf(stamped: { readonly quality?: unknown } | null | undefined): string | undefined {
  return typeof stamped?.quality === "string" ? stamped.quality : undefined
}

/**
 * Whether a job's or a node's OUTPUT is a Preview: an Apply EDL output stamped
 * `quality: "proxy"`. Gated on the node type — another node's `quality` means
 * something else. (A job read fills the stamp from the order for a render
 * recorded before it was stored, so nothing here reads `input_data`.)
 */
export function isPreviewOutput(nodeType: string | null | undefined, output: unknown): boolean {
  return isPreviewQuality(runResultIdentity(nodeType, output))
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
