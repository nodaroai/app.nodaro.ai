"use client"

import { WifiOff } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"

/**
 * "Reconnecting…" on a running node whose job the editor cannot currently read.
 *
 * The job is fine: it keeps running on the server, and the node's poll loop
 * keeps trying (poll-connection.ts). This badge only says why the card is not
 * moving. Like <NodePolicyOverlay>, it is mounted once by BaseNode and reads
 * the store by node id, so every node card shows it without a prop.
 *
 * It renders only while the node is running, so a flag left behind by a run
 * that has since ended can never sit on a finished card.
 */
export function NodeConnectionBadge({ nodeId }: { readonly nodeId: string }) {
  const t = useT()
  const lost = useWorkflowStore(
    useShallow((s: { nodes: Array<{ id: string; data?: unknown }> }) => {
      const d = s.nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined
      return d?.jobConnectionLost === true && d?.executionStatus === "running"
    }),
  )

  if (!lost) return null

  return (
    <div
      role="status"
      title={t("node.connectionLostDesc")}
      className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/60 bg-amber-950/80 px-2.5 py-1 text-[11px] font-medium text-amber-100 backdrop-blur-[2px]"
    >
      <WifiOff className="h-3.5 w-3.5 text-amber-300" aria-hidden />
      <span>{t("node.connectionLost")}</span>
      {/* The hover title reaches mouse users only; a screen reader reads this
          line when the status region appears. */}
      <span className="sr-only">{t("node.connectionLostDesc")}</span>
    </div>
  )
}
