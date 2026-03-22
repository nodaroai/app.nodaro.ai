import { useMemo } from "react"
import { Plus } from "lucide-react"
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
}: NodeSectionProps) {
  const maxCols = useMemo(
    () => Math.max(...nodes.map((n) => getNodeColumns?.(n.id) ?? 1), 1),
    [nodes, getNodeColumns],
  )
  const strategy = maxCols > 1 ? rectSortingStrategy : verticalListSortingStrategy
  return (
    <div className="flex-1 flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </h2>
        {isEditing && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={onAdd}
          >
            <Plus className="h-3 w-3 mr-1" />Add
          </Button>
        )}
      </div>
      {nodes.length === 0 ? (
        <div className="text-xs text-muted-foreground p-6 border border-dashed border-border rounded-xl text-center">
          {isEditing ? `Click "Add" to select ${label.toLowerCase()} nodes` : `No ${label.toLowerCase()} configured`}
        </div>
      ) : (
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
