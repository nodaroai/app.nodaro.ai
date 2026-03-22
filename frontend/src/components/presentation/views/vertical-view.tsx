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
  getNodeColumns,
}: EditableViewProps) {
  return (
    <div className="flex-1 overflow-auto p-3 sm:p-6" style={{ paddingBottom: 'max(1rem, var(--safe-area-bottom))' }}>
      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
        <NodeSection
          label="Inputs"
          nodes={orderedInputNodes}
          isEditing={isEditing}
          sensors={sensors}
          onDragEnd={handleInputDragEnd}
          onAdd={() => setPickerSection("inputs")}
          onRemove={handleRemoveNode}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderInputCard}
          getNodeColumns={getNodeColumns}
        />

        {/* Separator */}
        <div className="border-t border-border" />

        <NodeSection
          label="Outputs"
          nodes={orderedOutputNodes}
          isEditing={isEditing}
          sensors={sensors}
          onDragEnd={handleOutputDragEnd}
          onAdd={() => setPickerSection("outputs")}
          onRemove={handleRemoveNode}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderOutputCard}
          getNodeColumns={getNodeColumns}
        />
      </div>
    </div>
  )
}
