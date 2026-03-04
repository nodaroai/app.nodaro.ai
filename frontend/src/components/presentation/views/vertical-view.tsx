import { NodeSection } from "../node-section"
import type { EditableViewProps } from "./types"

export function VerticalView({
  orderedInputNodes,
  orderedOutputNodes,
  isEditing,
  sensors,
  handleInputDragEnd,
  handleOutputDragEnd,
  handleRemoveNode,
  settings,
  updateCardMeta,
  setPickerSection,
  renderInputCard,
  renderOutputCard,
}: EditableViewProps) {
  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-8">
        <NodeSection
          label="In"
          nodes={orderedInputNodes}
          isEditing={isEditing}
          sensors={sensors}
          onDragEnd={handleInputDragEnd}
          onAdd={() => setPickerSection("inputs")}
          onRemove={handleRemoveNode}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderInputCard}
        />

        {/* Separator */}
        <div className="border-t border-border" />

        <NodeSection
          label="Out"
          nodes={orderedOutputNodes}
          isEditing={isEditing}
          sensors={sensors}
          onDragEnd={handleOutputDragEnd}
          onAdd={() => setPickerSection("outputs")}
          onRemove={handleRemoveNode}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderOutputCard}
        />
      </div>
    </div>
  )
}
