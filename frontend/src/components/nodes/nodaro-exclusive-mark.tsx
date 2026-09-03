import { NODARO_EXCLUSIVE_NODE_TYPES } from "@/lib/cloud-only-nodes"
import { hasCredits } from "@/lib/edition"
import { useNodaroConnection } from "@/hooks/use-nodaro-connection"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * The NODARO provenance mark for the exclusive nodes (4b).
 *
 * On self-hosted editions these nodes run through the install's nodaro.ai
 * connection; the mark says so wherever the node appears — picker rows, the
 * sidebar catalogue, and the node card's header. On cloud they are native
 * and nothing renders.
 */

export function isNodaroExclusiveType(type: string | undefined | null): boolean {
  return typeof type === "string" && NODARO_EXCLUSIVE_NODE_TYPES.has(type)
}

/** True when the mark applies at all: an exclusive type on a self-host build. */
export function showNodaroMark(type: string | undefined | null): boolean {
  return !hasCredits() && isNodaroExclusiveType(type)
}

/** Compact brand pill for picker/sidebar rows. Render iff {@link showNodaroMark}. */
export function NodaroMark({ className }: { readonly className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[8.5px] font-bold tracking-[0.7px]",
        "bg-[#ff0073]/12 text-[#ff0073]",
        className,
      )}
      title={t("node.runsOnNodaro")}
    >
      NODARO
    </span>
  )
}

/**
 * Node-card header chip. Connected: a quiet provenance pill. Not connected:
 * the pill IS the CTA — links to Integrations, where both connect lanes
 * (OAuth and pasted API key) live. Mount only for exclusive types on
 * self-host ({@link showNodaroMark}) so the connection status fetch never
 * fires for ordinary nodes or cloud builds.
 */
export function NodaroHeaderChip() {
  const t = useT()
  const { connected, checked } = useNodaroConnection()

  if (!checked || connected) {
    return (
      <span
        className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#ff0073]/15 text-[#ff0073] border border-[#ff0073]/30"
        title={t("node.runsOnNodaro")}
      >
        NODARO
      </span>
    )
  }
  return (
    <a
      href="/integrations"
      onClick={(e) => e.stopPropagation()}
      className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#ff0073] text-white hover:bg-[#e0005f] transition-colors"
      title="Requires nodaro.ai — connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API)"
    >
      {t("node.connectNodaro")}
    </a>
  )
}

/**
 * BaseNode's header slot: resolves the node's type from the store by id and
 * mounts the chip only when the mark applies. Kept as its own component so
 * BaseNode pays one O(n) type lookup only on self-host builds, and the
 * connection hook mounts only for the five exclusive types.
 */
export function NodaroHeaderChipForNode({ nodeId }: { readonly nodeId: string }) {
  const nodeType = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.type)
  if (!showNodaroMark(nodeType)) return null
  return <NodaroHeaderChip />
}
