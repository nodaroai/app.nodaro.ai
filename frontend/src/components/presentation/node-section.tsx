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
  updateCardMeta: (nodeId: string, field: "title" | "description", value: string) => void
  renderCard: (node: WorkflowNode) => React.ReactNode
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
}: NodeSectionProps) {
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
            <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {nodes.map((node) => (
                <SortableCardWrapper
                  key={node.id}
                  id={node.id}
                  isEditMode={isEditing}
                  onRemove={() => onRemove(node.id)}
                  cardDescription={settings.cardMeta?.[node.id]?.description}
                  onDescriptionChange={(v) => updateCardMeta(node.id, "description", v)}
                >
                  {renderCard(node)}
                </SortableCardWrapper>
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
