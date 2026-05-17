"use client"

/**
 * Unified injected-reference list shown in the config panel of every consumer
 * node (generate-image, image-to-video, lip-sync, …). Renders, in their final
 * post-reorder API position, every reference image that will be sent to the
 * provider — including invisible-in-old-UI sources like @-mention variants
 * and canonical-fallbacks of wired Character nodes.
 *
 * The component is a thin shell around `computeInjectedRefs` (the pure
 * helper that the backend prompt-builder ALSO consults via the same stable
 * ID scheme — see `frontend/src/lib/compute-injected-refs.ts`).
 *
 * Drag-reorder updates `data.referenceOrder` (an array of stable IDs).
 * Remove (×) routes to one of three actions depending on tile origin:
 *
 *   wired-raw                  → delete the upstream edge
 *   wired-character-canonical / canonical-fallback
 *                              → add the character slug to
 *                                `data.suppressedCanonicalCharacterIds`
 *   mention-variant            → strip the matching `@kira:N:smile` token
 *                                from the prompt
 *
 * All three callbacks are provided by the consumer config panel because we
 * don't want this leaf component to depend on the workflow store directly
 * (keeps the component testable in isolation).
 */

import { GripVertical, X } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { CachedImage } from "@/components/ui/cached-image"
import { computeInjectedRefs, type InjectedRefTile } from "@/lib/compute-injected-refs"
import type { ConnectedReference, UsageMode } from "@nodaro/shared"

const USAGE_MODE_LABEL: Record<UsageMode, string> = {
  identical: "match",
  "face-pose": "face+pose",
  face: "face",
  pose: "pose",
  emotion: "emotion",
  style: "style",
  name: "name",
  none: "none",
}

const ORIGIN_BADGE: Record<
  InjectedRefTile["origin"],
  { label: string; className: string }
> = {
  "wired-raw": {
    label: "Wired",
    className: "bg-cyan-500/10 text-cyan-500",
  },
  "wired-character-canonical": {
    label: "Char",
    className: "bg-pink-500/10 text-pink-500",
  },
  "mention-variant": {
    label: "@",
    className: "bg-violet-500/10 text-violet-500",
  },
  "canonical-fallback": {
    label: "Char",
    className: "bg-pink-500/10 text-pink-500",
  },
}

export interface InjectedReferenceListProps {
  /** Same `ConnectedReference[]` the consumer passes to `buildImagePrompt`. */
  readonly connectedReferences: readonly ConnectedReference[]
  readonly prompt: string
  readonly referenceOrder?: readonly string[]
  readonly suppressedCanonicalCharacterIds?: readonly string[]
  /** Optional remapping for wired-raw tile IDs — see compute-injected-refs. */
  readonly sourceNodeIdById?: ReadonlyMap<string, string>

  readonly onUpdateReferenceOrder: (order: string[]) => void
  /** Remove a wired upstream edge. Called when × is clicked on a wired-raw tile. */
  readonly onRemoveWiredSource?: (sourceNodeId: string) => void
  /** Strip an `@-mention` token from the prompt. */
  readonly onRemoveMention?: (mentionToken: string) => void
  /** Add a character slug to the canonical-suppression list. */
  readonly onSuppressCanonical?: (characterSlug: string) => void

  /**
   * Header label override. Default: "Injected references" (the API order).
   * Node-specific UIs may pass "References sent to model" or similar.
   */
  readonly label?: string

  /** Optional empty-state copy. Default omits the section when empty. */
  readonly emptyMessage?: string

  /**
   * When true, the first tile gets the "primary input" pink ring + label.
   * Useful for i2v / i2i where Image 1 is the start frame / main image.
   */
  readonly primaryLabel?: string

  /** Force a node-data-key suffix on test IDs — useful for unit tests. */
  readonly testId?: string
}

function SortableInjectedRefItem({
  tile,
  isPrimary,
  primaryLabel,
  onRemove,
}: {
  tile: InjectedRefTile
  isPrimary: boolean
  primaryLabel?: string
  onRemove?: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tile.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  const badge = ORIGIN_BADGE[tile.origin]
  const usageMode = tile.usageMode ?? null

  // Caption: "Image N — Kira / smile" (variant) or "Image N — Kira" (canonical)
  // or just "Image N" for wired-raw without character context.
  const captionRight = (() => {
    if (tile.characterName && tile.variantDisplayName && tile.variantSlug) {
      return `${tile.characterName} / ${tile.variantDisplayName}`
    }
    if (tile.characterName) return tile.characterName
    return tile.description ?? ""
  })()
  const caption = `Image ${tile.imageIndex}${captionRight ? ` — ${captionRight}` : ""}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs ${
        isPrimary ? "bg-pink-500/10 ring-1 ring-pink-500/30" : "bg-muted/50"
      }`}
      data-testid={`injected-ref-tile-${tile.id}`}
    >
      <span
        {...listeners}
        className="cursor-grab active:cursor-grabbing shrink-0 touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
      </span>
      <span className="text-muted-foreground w-4 text-center shrink-0 font-mono text-[10px]">
        #{tile.imageIndex}
      </span>
      {tile.url ? (
        <CachedImage
          src={tile.url}
          alt={caption}
          className="w-10 h-10 rounded object-cover shrink-0"
          thumbnail
          thumbnailWidth={80}
        />
      ) : (
        <div className="w-10 h-10 rounded bg-muted shrink-0" />
      )}
      <div className="flex flex-col flex-1 min-w-0">
        <span className="truncate" title={caption}>
          {caption}
        </span>
        {isPrimary && primaryLabel ? (
          <span className="text-[9px] text-pink-500 font-medium">{primaryLabel}</span>
        ) : null}
      </div>
      {usageMode && usageMode !== "identical" ? (
        <span className="text-[9px] px-1 py-0.5 rounded shrink-0 bg-amber-500/10 text-amber-500">
          {USAGE_MODE_LABEL[usageMode]}
        </span>
      ) : null}
      <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${badge.className}`}>
        {badge.label}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive shrink-0"
          aria-label={`Remove ${caption}`}
        >
          <X className="w-3 h-3" />
        </button>
      ) : null}
    </div>
  )
}

export function InjectedReferenceList(props: InjectedReferenceListProps) {
  const {
    connectedReferences,
    prompt,
    referenceOrder,
    suppressedCanonicalCharacterIds,
    sourceNodeIdById,
    onUpdateReferenceOrder,
    onRemoveWiredSource,
    onRemoveMention,
    onSuppressCanonical,
    label = "Injected references",
    emptyMessage,
    primaryLabel,
    testId,
  } = props

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const tiles = computeInjectedRefs({
    connectedReferences,
    prompt,
    referenceOrder,
    suppressedCanonicalCharacterIds,
    sourceNodeIdById,
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = tiles.map((t) => t.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = [...ids]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onUpdateReferenceOrder(newOrder)
  }

  function handleRemove(tile: InjectedRefTile) {
    switch (tile.origin) {
      case "wired-raw":
      case "wired-character-canonical": {
        if (tile.sourceNodeId && onRemoveWiredSource) {
          onRemoveWiredSource(tile.sourceNodeId)
        }
        return
      }
      case "mention-variant": {
        if (tile.mentionToken && onRemoveMention) {
          onRemoveMention(tile.mentionToken)
        }
        return
      }
      case "canonical-fallback": {
        if (tile.characterSlug && onSuppressCanonical) {
          onSuppressCanonical(tile.characterSlug)
        }
        return
      }
    }
  }

  function canRemove(tile: InjectedRefTile): boolean {
    switch (tile.origin) {
      case "wired-raw":
      case "wired-character-canonical":
        return Boolean(tile.sourceNodeId && onRemoveWiredSource)
      case "mention-variant":
        return Boolean(tile.mentionToken && onRemoveMention)
      case "canonical-fallback":
        return Boolean(tile.characterSlug && onSuppressCanonical)
    }
  }

  if (tiles.length === 0) {
    if (emptyMessage) {
      return (
        <p className="text-[10px] text-muted-foreground/60" data-testid={testId}>
          {emptyMessage}
        </p>
      )
    }
    return null
  }

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium">
          {label} ({tiles.length})
        </label>
      </div>

      {tiles.length > 1 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={tiles.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1">
              {tiles.map((tile, i) => (
                <SortableInjectedRefItem
                  key={tile.id}
                  tile={tile}
                  isPrimary={i === 0 && Boolean(primaryLabel)}
                  primaryLabel={primaryLabel}
                  onRemove={canRemove(tile) ? () => handleRemove(tile) : undefined}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-1">
          {tiles.map((tile, i) => (
            <SortableInjectedRefItem
              key={tile.id}
              tile={tile}
              isPrimary={i === 0 && Boolean(primaryLabel)}
              primaryLabel={primaryLabel}
              onRemove={canRemove(tile) ? () => handleRemove(tile) : undefined}
            />
          ))}
        </div>
      )}

      {tiles.length > 1 ? (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Drag to reorder — #1 is Image 1 in the assembled prompt.
        </p>
      ) : null}
    </div>
  )
}
