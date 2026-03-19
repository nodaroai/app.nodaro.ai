import { useMemo } from "react"
import { NodeSection } from "../node-section"
import type { EditableViewProps } from "./types"

interface HorizontalViewProps extends EditableViewProps {
  splitRatio: number
  containerRef: React.RefObject<HTMLDivElement | null>
  handleDividerMouseDown: (e: React.MouseEvent) => void
}

export function HorizontalView({
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
  splitRatio,
  containerRef,
  handleDividerMouseDown,
}: HorizontalViewProps) {
  const leftColumnStyle = useMemo(() => ({
    width: `calc(${splitRatio}% - 8px)`,
    minWidth: '280px',
  }), [splitRatio])
  const rightColumnStyle = useMemo(() => ({
    width: `calc(${100 - splitRatio}% - 8px)`,
    minWidth: '280px',
  }), [splitRatio])

  return (
    <div className="flex-1 flex flex-col overflow-auto p-3 md:p-6" style={{ paddingBottom: 'max(1rem, var(--safe-area-bottom))' }}>
      <div ref={containerRef} className="pres-horiz-container max-w-7xl mx-auto flex gap-0 flex-1 min-h-[400px] overflow-x-auto">
        {/* Inputs column — width overridden to 100% on mobile via CSS */}
        <div className="pres-horiz-column flex flex-col overflow-y-auto md:pr-3" style={leftColumnStyle}>
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
          />
        </div>

        {/* Resizable divider — hidden on mobile via CSS */}
        <div
          className={`pres-horiz-divider relative shrink-0 flex items-center justify-center ${
            isEditing ? "w-4 cursor-col-resize group" : "w-4"
          }`}
          onMouseDown={isEditing ? handleDividerMouseDown : undefined}
        >
          {isEditing && (
            <>
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#ff0073]/30 group-hover:bg-[#ff0073]/60 transition-colors" />
              <div className="relative z-10 w-3 h-8 rounded-full bg-[#ff0073]/20 group-hover:bg-[#ff0073]/40 border border-[#ff0073]/30 flex items-center justify-center transition-colors">
                <div className="w-0.5 h-3 bg-[#ff0073]/60 rounded-full" />
              </div>
            </>
          )}
        </div>

        {/* Mobile separator between In/Out — shown via CSS on <768px */}
        <div className="pres-horiz-separator py-3">
          <div className="border-t border-border" />
        </div>

        {/* Outputs column — width overridden to 100% on mobile via CSS */}
        <div className="pres-horiz-column flex flex-col overflow-y-auto md:pl-3" style={rightColumnStyle}>
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
          />
        </div>
      </div>
    </div>
  )
}
