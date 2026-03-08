import { useMemo } from "react"
import { NodeSection } from "../node-section"
import { useIsMobile } from "@/hooks/use-is-mobile"
import type { EditableViewProps } from "./types"

interface HorizontalViewProps extends EditableViewProps {
  splitRatio: number
  containerRef: React.RefObject<HTMLDivElement | null>
  handleDividerMouseDown: (e: React.MouseEvent) => void
}

const CONTAINER_MIN_HEIGHT = { minHeight: 400 } as const

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
  const isMobile = useIsMobile()
  const leftColumnStyle = useMemo(() => ({ width: `${splitRatio}%` }), [splitRatio])
  const rightColumnStyle = useMemo(() => ({ width: `${100 - splitRatio}%` }), [splitRatio])

  // On mobile, stack vertically instead of side-by-side
  if (isMobile) {
    return (
      <div className="flex-1 overflow-auto p-3" style={{ paddingBottom: 'max(1rem, var(--safe-area-bottom))' }}>
        <div className="space-y-6">
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

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div ref={containerRef} className="max-w-7xl mx-auto flex gap-0 h-full" style={CONTAINER_MIN_HEIGHT}>
        {/* Inputs column */}
        <div className="overflow-y-auto pr-3" style={leftColumnStyle}>
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
        </div>

        {/* Resizable divider */}
        <div
          className={`relative shrink-0 flex items-center justify-center ${
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

        {/* Outputs column */}
        <div className="overflow-y-auto pl-3" style={rightColumnStyle}>
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
    </div>
  )
}
