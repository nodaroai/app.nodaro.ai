import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { isCollectInEdge } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { CollectNodeData } from "@/types/nodes"
import type { ConfigProps } from "./types"

function SortableRow({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 p-2 bg-muted/50 hover:bg-muted border border-border rounded mb-1 cursor-grab text-foreground transition-colors"
    >
      <span className="text-xs text-muted-foreground">⋮⋮</span>
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function CollectConfig({ data, nodeId }: ConfigProps<CollectNodeData> & { nodeId?: string }) {
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()
  const allNodes = useWorkflowStore((s) => s.nodes)
  const allEdges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  if (!nodeId) {
    return <div className="text-xs text-muted-foreground">{t("cfgext.collectNodeIdUnavailable")}</div>
  }

  const incoming = allEdges.filter(
    (e) => e.target === nodeId && isCollectInEdge(e),
  )
  const order = data.order ?? []
  const sourceIds =
    order.length > 0
      ? order.filter((sid) => incoming.some((e) => e.source === sid))
      : incoming.map((e) => e.source)

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const oldIdx = sourceIds.indexOf(String(e.active.id))
    const newIdx = sourceIds.indexOf(String(e.over.id))
    if (oldIdx === -1 || newIdx === -1) return
    const next = arrayMove(sourceIds, oldIdx, newIdx)
    updateNodeData(nodeId, { order: next })
  }

  return (
    <div className="collect-config">
      <h3 className="text-sm font-medium mb-2">{t("cfgext.collectOrder")}</h3>
      {sourceIds.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("cfgext.collectNoConnections")}</div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sourceIds} strategy={verticalListSortingStrategy}>
            {sourceIds.map((sid) => {
              const src = allNodes.find((n) => n.id === sid)
              const label = (src?.data as { label?: string } | undefined)?.label ?? src?.type ?? sid
              return <SortableRow key={sid} id={sid} label={localizeNode(label)} />
            })}
          </SortableContext>
        </DndContext>
      )}
      <button
        onClick={() => updateNodeData(nodeId, { order: incoming.map((e) => e.source) })}
        className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("cfgext.collectResetOrder")}
      </button>
    </div>
  )
}
