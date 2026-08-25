import { useCallback, useEffect } from "react"
import type { JSX } from "react"
import { Loader2, ShieldAlert, CheckCircle, X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { moderateImage } from "@/lib/api"
import type { UploadImageData } from "@/types/nodes"

type ModStatus = UploadImageData["moderationStatus"]

/**
 * Upload-time moderation for the upload-image node (G3). A generic
 * "a plugin may provide upload moderation" capability — fail-OPEN, advisory.
 *
 * The `enabled` gate is the deployment capability flag
 * (runtimeUploadModerationEnabled(), computed once by the node and passed in),
 * so an install with no moderation plugin behaves identically to pre-feature
 * mainline.
 *
 * `moderate(url)`:
 *  - no-op unless the deployment wired a moderation provider (`enabled`),
 *    so mainline never fires a call;
 *  - writes "checking" → then "ok"/"blocked" from the verdict;
 *  - on ANY error (absent route / timeout / non-200) CLEARS the status
 *    (fail-open) — never blocks the upload.
 *
 * Mount self-heal: `moderationStatus` persists in workflow JSON, but the
 * in-flight fetch is a per-mount closure. A "checking" reloaded from a saved
 * workflow would otherwise hang forever, so a mount effect clears a stale
 * "checking" (only while enabled).
 */
export function useUploadModeration(
  id: string,
  enabled: boolean,
  status: ModStatus,
): { moderate: (url: string) => void } {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  useEffect(() => {
    if (enabled && status === "checking") {
      updateNodeData(id, { moderationStatus: undefined, moderationReason: undefined })
    }
    // Mount-only self-heal: intentionally not re-run on status changes we
    // ourselves write (that would clear a live in-flight check).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const moderate = useCallback(
    (url: string) => {
      if (!enabled || !url) return
      updateNodeData(id, { moderationStatus: "checking", moderationReason: undefined })
      void (async () => {
        try {
          const { ok, reason } = await moderateImage(url)
          updateNodeData(id, {
            moderationStatus: ok ? "ok" : "blocked",
            moderationReason: ok ? undefined : reason,
          })
        } catch {
          // Fail-open: a moderation hiccup must not block the user.
          updateNodeData(id, { moderationStatus: undefined, moderationReason: undefined })
        }
      })()
    },
    [id, enabled, updateNodeData],
  )

  return { moderate }
}

/**
 * The moderation overlay. Renders nothing unless a provider is wired
 * (`enabled`) AND a status is set — so an imported workflow carrying a stale
 * moderationStatus shows nothing on a mainline install. RTL-aware by
 * inheriting the document direction (the app sets <html dir> from the active
 * locale); no hardcoded dir. "checking" and "blocked" are FULL-node overlays
 * (a corner badge got missed and a blocked reference vanished with no
 * explanation — d10 lesson); "ok" is a small unobtrusive badge.
 */
export function UploadModerationOverlay({
  enabled,
  status,
  reason,
  onRemove,
}: {
  enabled: boolean
  status: ModStatus
  reason?: string
  onRemove: () => void
}): JSX.Element | null {
  const t = useT()
  if (!enabled || !status) return null

  if (status === "checking") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-[2px] rounded-xl z-20">
        <Loader2 className="w-7 h-7 animate-spin text-white" />
        <span className="text-xs font-medium text-white/90">{t("node.moderation.checking")}</span>
      </div>
    )
  }

  if (status === "blocked") {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center bg-red-950/85 backdrop-blur-sm rounded-xl border-2 border-red-500/70 z-20">
        <ShieldAlert className="w-8 h-8 text-red-300" />
        <span className="text-sm font-semibold text-red-100">{t("node.moderation.blockedTitle")}</span>
        <span className="text-[11px] leading-snug text-red-200/80">
          {reason || t("node.moderation.blockedReason")}
        </span>
        <button
          type="button"
          className="mt-1 flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white rounded-md border border-white/20"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          <X className="w-3 h-3" /> {t("node.moderation.remove")}
        </button>
      </div>
    )
  }

  // status === "ok"
  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-green-500/20 text-green-200 border border-green-500/40 backdrop-blur-sm z-10">
      <CheckCircle className="w-3 h-3" />
      <span>{t("node.moderation.ready")}</span>
    </div>
  )
}
