"use client"

import { GripVertical, X, Upload, Loader2 } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import type { ManualReferenceImage } from "@/types/nodes"

export interface ReferenceImageEntry {
  readonly id: string
  readonly url: string
  readonly label: string
  readonly source: "uploaded" | "wired" | "character"
}

interface ReferenceImageListProps {
  manualImages: readonly ManualReferenceImage[]
  imageOrder: readonly string[]
  wiredImages: { id: string; url: string; label: string }[]
  charRefImages: { id: string; url: string; label: string }[]
  maxImages: number
  onUpdateManualImages: (images: ManualReferenceImage[]) => void
  onUpdateOrder: (order: string[]) => void
  onUpload: () => void
  uploadingRef: boolean
}

function buildEntryMap(
  manualImages: readonly ManualReferenceImage[],
  wiredImages: { id: string; url: string; label: string }[],
  charRefImages: { id: string; url: string; label: string }[],
): Map<string, ReferenceImageEntry> {
  const map = new Map<string, ReferenceImageEntry>()
  for (const img of manualImages) {
    map.set(img.id, { id: img.id, url: img.url, label: "Uploaded", source: "uploaded" })
  }
  for (const img of wiredImages) {
    map.set(img.id, { id: img.id, url: img.url, label: img.label, source: "wired" })
  }
  for (const img of charRefImages) {
    map.set(img.id, { id: img.id, url: img.url, label: img.label, source: "character" })
  }
  return map
}

function applyOrder(entryMap: Map<string, ReferenceImageEntry>, imageOrder: readonly string[]): ReferenceImageEntry[] {
  const ordered: ReferenceImageEntry[] = []
  const seen = new Set<string>()
  for (const id of imageOrder) {
    const entry = entryMap.get(id)
    if (entry) {
      ordered.push(entry)
      seen.add(id)
    }
  }
  // Append any entries not in the order
  for (const [id, entry] of entryMap) {
    if (!seen.has(id)) {
      ordered.push(entry)
    }
  }
  return ordered
}

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Uploaded", className: "bg-blue-500/10 text-blue-500" },
  wired: { label: "Wired", className: "bg-cyan-500/10 text-cyan-500" },
  character: { label: "Character", className: "bg-pink-500/10 text-pink-500" },
}

function SortableRefImageItem({
  entry,
  index,
  isMajor,
  onRemove,
}: {
  entry: ReferenceImageEntry
  index: number
  isMajor: boolean
  onRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  const badge = SOURCE_BADGE[entry.source]

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs ${
        isMajor ? "bg-pink-500/10 ring-1 ring-pink-500/30" : "bg-muted/50"
      }`}
    >
      <span {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 touch-none">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
      </span>
      <span className="text-muted-foreground w-4 text-center shrink-0 font-mono text-[10px]">#{index + 1}</span>
      <CachedImage
        src={entry.url}
        alt={entry.label}
        className="w-10 h-10 rounded object-cover shrink-0"
        thumbnail
        thumbnailWidth={80}
      />
      <span className="truncate flex-1 min-w-0" title={entry.label}>{entry.label}</span>
      <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${badge.className}`}>{badge.label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

export function ReferenceImageList({
  manualImages,
  imageOrder,
  wiredImages,
  charRefImages,
  maxImages,
  onUpdateManualImages,
  onUpdateOrder,
  onUpload,
  uploadingRef,
}: ReferenceImageListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const entryMap = buildEntryMap(manualImages, wiredImages, charRefImages)
  const orderedEntries = applyOrder(entryMap, imageOrder)
  const totalCount = orderedEntries.length
  const canUpload = totalCount < maxImages

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = orderedEntries.map((e) => e.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = [...ids]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onUpdateOrder(newOrder)
  }

  function handleRemove(id: string) {
    const newManual = manualImages.filter((img) => img.id !== id)
    onUpdateManualImages([...newManual])
    // Also remove from order
    const newOrder = imageOrder.filter((oid) => oid !== id)
    onUpdateOrder([...newOrder])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium">
          Reference Images{totalCount > 0 && ` (${totalCount}/${maxImages})`}
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2"
          onClick={onUpload}
          disabled={uploadingRef || !canUpload}
        >
          {uploadingRef ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
          Upload
        </Button>
      </div>

      {totalCount > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedEntries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1">
              {orderedEntries.map((entry, i) => (
                <SortableRefImageItem
                  key={entry.id}
                  entry={entry}
                  index={i}
                  isMajor={i === 0}
                  onRemove={entry.source === "uploaded" ? () => handleRemove(entry.id) : undefined}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-[10px] text-muted-foreground/60">
          No reference images. Upload or wire upstream image nodes.
        </p>
      )}

      {totalCount > 0 && (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Tip: Use {"{image:1}"}, {"{image:2}"} in prompt to reference by position
        </p>
      )}
    </div>
  )
}
