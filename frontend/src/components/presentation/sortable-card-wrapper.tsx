import { GripVertical, X } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { PresentationDisplay } from "@/types/nodes"
import { PresentationDisplayConfig } from "@/components/editor/config-panels/presentation-display-config"

/** Sortable card wrapper with grip handle, remove button, and description editing */
export function SortableCardWrapper({
  id,
  isEditMode,
  onRemove,
  cardTitle,
  onTitleChange,
  cardDescription,
  onDescriptionChange,
  cardDisplay,
  onDisplayChange,
  showElementSize,
  viewModes,
  children,
}: {
  id: string
  isEditMode: boolean
  onRemove?: () => void
  cardTitle?: string
  onTitleChange?: (value: string) => void
  cardDescription?: string
  onDescriptionChange?: (value: string) => void
  cardDisplay?: Partial<PresentationDisplay>
  onDisplayChange?: (display: Partial<PresentationDisplay>) => void
  showElementSize?: boolean
  viewModes?: { value: string; label: string }[]
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group mb-3">
      {isEditMode && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-2 -right-2 z-10 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full bg-red-500/80 text-white hover:bg-red-500 transition-colors"
          title="Remove from presentation"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {isEditMode ? (
        <div className="flex items-start gap-1">
          <div
            {...attributes}
            {...listeners}
            className="shrink-0 mt-4 w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            {children}
          </div>
        </div>
      ) : (
        children
      )}

      {/* Editable title below card — edit mode only, for field items */}
      {isEditMode && onTitleChange && (
        <div className="mt-1 px-1">
          <input
            type="text"
            value={cardTitle ?? ""}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Custom title..."
            className="w-full bg-transparent border-none text-[11px] font-medium text-muted-foreground/60 placeholder:text-muted-foreground/30 focus:text-muted-foreground focus:outline-none"
          />
        </div>
      )}

      {/* Editable description below card — edit mode only */}
      {isEditMode && onDescriptionChange && (
        <div className="mt-1 px-1">
          <input
            type="text"
            value={cardDescription ?? ""}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Add description..."
            className="w-full bg-transparent border-none text-[11px] text-muted-foreground/50 placeholder:text-muted-foreground/30 focus:text-muted-foreground focus:outline-none"
          />
        </div>
      )}

      {isEditMode && onDisplayChange && (
        <div className="mt-2 px-1">
          <PresentationDisplayConfig
            display={cardDisplay ?? {}}
            onChange={onDisplayChange}
            showElementSize={showElementSize}
            viewModes={viewModes}
          />
        </div>
      )}

      {/* Show description in view mode if set */}
      {!isEditMode && cardDescription && (
        <p className="mt-1 px-1 text-[11px] text-muted-foreground/60">{cardDescription}</p>
      )}
    </div>
  )
}
