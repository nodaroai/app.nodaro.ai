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
  handleRemoveItem,
  settings,
  updateCardMeta,
  setPickerSection,
  renderInputCard,
  renderOutputCard,
  getNodeColumns,
  inputItems,
  outputItems,
  renderInputItem,
  renderOutputItem,
  addGroup,
}: EditableViewProps) {
  return (
    <div className="flex-1 overflow-auto px-3 pt-3 sm:px-6 sm:pt-5 pb-20 md:pb-5">
      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
        <NodeSection
          label="Inputs"
          nodes={orderedInputNodes}
          isEditing={isEditing}
          sensors={sensors}
          onDragEnd={handleInputDragEnd}
          onAdd={() => setPickerSection("inputs")}
          onRemove={handleRemoveNode}
          onRemoveItem={(sortId) => handleRemoveItem(sortId, "inputs")}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderInputCard}
          getNodeColumns={getNodeColumns}
          items={inputItems}
          renderItem={renderInputItem}
          onAddGroup={addGroup ? () => addGroup("input") : undefined}
          showDisplayConfig={false}
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
          onRemoveItem={(sortId) => handleRemoveItem(sortId, "outputs")}
          settings={settings}
          updateCardMeta={updateCardMeta}
          renderCard={renderOutputCard}
          getNodeColumns={getNodeColumns}
          items={outputItems}
          renderItem={renderOutputItem}
          onAddGroup={addGroup ? () => addGroup("output") : undefined}
        />
      </div>
    </div>
  )
}
