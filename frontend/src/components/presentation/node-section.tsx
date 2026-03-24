import { useMemo } from "react"
import { Plus, FolderPlus } from "lucide-react"
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core"
import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable"
import { Button } from "@/components/ui/button"
import type { WorkflowNode } from "@/types/nodes"
import type { PresentationItem } from "@nodaro-shared/presentation-types"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import { SortableCardWrapper } from "./sortable-card-wrapper"

interface NodeSectionProps {
  label: string
  nodes: WorkflowNode[]
  isEditing: boolean
  sensors: SensorDescriptor<SensorOptions>[]
  onDragEnd: (event: DragEndEvent) => void
  onAdd: () => void
  onRemove: (nodeId: string) => void
  settings: PresentationSettings
  updateCardMeta: (nodeId: string, field: string, value: unknown) => void
  renderCard: (node: WorkflowNode) => React.ReactNode
  /** Returns resolved columns count per node for grid layout */
  getNodeColumns?: (nodeId: string) => number
  /** Rich items list — when provided, renders items instead of nodes */
  items?: PresentationItem[] | null
  /** Renderer for PresentationItem types */
  renderItem?: (item: PresentationItem) => React.ReactNode
  /** Callback to add a group container */
  onAddGroup?: () => void
}

/** Get the sortable ID for a PresentationItem */
function getItemSortId(item: PresentationItem): string {
  return item.type === "node" ? item.nodeId : item.id
}

export function NodeSection({
  label,
  nodes,
  isEditing,
  sensors,
  onDragEnd,
  onAdd,
  onRemove,
  settings,
  updateCardMeta,
  renderCard,
  getNodeColumns,
  items,
  renderItem,
  onAddGroup,
}: NodeSectionProps) {
  // Items-based rendering when items + renderItem are provided
  const useItems = items && items.length > 0 && renderItem

  const maxCols = useMemo(
    () => {
      if (useItems) return 1 // Not used in items mode
      return Math.max(...nodes.map((n) => getNodeColumns?.(n.id) ?? 1), 1)
    },
    [useItems, nodes, getNodeColumns],
  )
  const strategy = maxCols > 1 ? rectSortingStrategy : verticalListSortingStrategy
  const itemSortIds = useMemo(
    () => (items ?? []).map(getItemSortId),
    [items],
  )

  const isEmpty = useItems ? false : nodes.length === 0

  return (
    <div className="flex-1 flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </h2>
        {isEditing && (
          <div className="flex items-center gap-1">
            {onAddGroup && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={onAddGroup}
              >
                <FolderPlus className="h-3 w-3 mr-1" />Group
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={onAdd}
            >
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          </div>
        )}
      </div>
      {isEmpty ? (
        <div className="text-xs text-muted-foreground p-6 border border-dashed border-border rounded-xl text-center">
          {isEditing ? `Click "Add" to select ${label.toLowerCase()} nodes` : `No ${label.toLowerCase()} configured`}
        </div>
      ) : useItems ? (
        /* Items-based rendering (groups, fields, richtext, nodes) */
        <div className="flex-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={itemSortIds} strategy={verticalListSortingStrategy}>
              <div>
                {items!.map((item) => {
                  const sortId = getItemSortId(item)
                  const rendered = renderItem(item)
                  if (!rendered) return null
                  // Groups and richtext don't get the node-style wrapper
                  if (item.type === "group" || item.type === "richtext") {
                    return (
                      <SortableCardWrapper
                        key={sortId}
                        id={sortId}
                        isEditMode={isEditing}
                      >
                        {rendered}
                      </SortableCardWrapper>
                    )
                  }
                  // Node and field items get the full wrapper with meta editing
                  const nodeId = "nodeId" in item ? (item as { nodeId: string }).nodeId : undefined
                  const isNodeItem = item.type === "node"
                  const metaKey = item.type === "field" ? item.id : nodeId
                  return (
                    <SortableCardWrapper
                      key={sortId}
                      id={sortId}
                      isEditMode={isEditing}
                      onRemove={() => { if (nodeId) onRemove(nodeId) }}
                      cardDescription={metaKey ? settings.cardMeta?.[metaKey]?.description : undefined}
                      onDescriptionChange={(v) => { if (metaKey) updateCardMeta(metaKey, "description", v) }}
                      cardTitle={metaKey ? settings.cardMeta?.[metaKey]?.title : undefined}
                      onTitleChange={metaKey ? (v) => updateCardMeta(metaKey, "title", v) : undefined}
                      cardDisplay={isNodeItem && nodeId ? settings.cardMeta?.[nodeId]?.display : undefined}
                      onDisplayChange={isNodeItem && nodeId ? (d) => updateCardMeta(nodeId, "display", d) : undefined}
                    >
                      {rendered}
                    </SortableCardWrapper>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        /* Legacy node-based rendering */
        <div className="flex-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={nodes.map((n) => n.id)} strategy={strategy}>
              <div
                className={maxCols > 1 ? "grid gap-4" : ""}
                style={maxCols > 1 ? { gridTemplateColumns: `repeat(${maxCols}, 1fr)` } : undefined}
              >
                {nodes.map((node) => (
                  <SortableCardWrapper
                    key={node.id}
                    id={node.id}
                    isEditMode={isEditing}
                    onRemove={() => onRemove(node.id)}
                    cardDescription={settings.cardMeta?.[node.id]?.description}
                    onDescriptionChange={(v) => updateCardMeta(node.id, "description", v)}
                    cardDisplay={settings.cardMeta?.[node.id]?.display}
                    onDisplayChange={(d) => updateCardMeta(node.id, "display", d)}
                  >
                    {renderCard(node)}
                  </SortableCardWrapper>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
