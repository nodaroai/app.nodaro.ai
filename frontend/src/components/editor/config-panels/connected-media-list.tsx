"use client"

import { useLocalizeNodeLabel, useLocalizeHandleLabel } from "@/lib/i18n/labels"
import { useT, tx } from "@/lib/i18n"
import type { ReactNode } from "react"
import { GripVertical, ImageIcon, Film, Music } from "lucide-react"
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
import type { SourceNodeInfo } from "./types"

// --- Thumbnail extraction ---

const IMAGE_GEN_TYPES = new Set([
  "generate-image",
  "edit-image",
  "image-to-image",
  "scene",
])

export function getSourceThumbnail(
  source: SourceNodeInfo,
): string | undefined {
  const nd = source.nodeData ?? {}
  if (source.type === "upload-image") return (nd.url as string) || undefined
  if (IMAGE_GEN_TYPES.has(source.type)) {
    const results = nd.generatedResults as
      | Array<{ url?: string }>
      | undefined
    // Edge output mode overrides which result to show
    let idx = (nd.activeResultIndex as number) ?? 0
    if (source.edgeOutputMode?.startsWith("item:")) {
      idx = parseInt(source.edgeOutputMode.split(":")[1], 10)
    } else if (source.edgeOutputMode === "last" && results && results.length > 0) {
      idx = results.length - 1
    }
    return (
      results?.[idx]?.url ||
      results?.[0]?.url ||
      (nd.generatedImageUrl as string) ||
      undefined
    )
  }
  if (
    source.type === "character" ||
    source.type === "face" ||
    source.type === "object" ||
    source.type === "creature" ||
    source.type === "location"
  )
    return (nd.sourceImageUrl as string) || undefined
  return undefined
}

// --- Order utility ---

export function applyMediaOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (!order.length) return [...items]
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = items.find((i) => i.id === id)
    if (item) {
      ordered.push(item)
      seen.add(id)
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item)
    }
  }
  return ordered
}

// --- Types ---

export interface MediaEntry {
  readonly id: string
  readonly label: string
  readonly type: string
  readonly thumbnailUrl?: string
  readonly targetHandle?: string
}

interface ConnectedMediaListProps {
  sources: ReadonlyArray<SourceNodeInfo>
  mediaOrder: readonly string[]
  onUpdateOrder: (order: string[]) => void
  acceptedTypes?: Set<string>
  mediaType?: "image" | "video" | "audio" | "any"
  primaryLabel?: string
  emptyMessage?: string
  /** Override thumbnail resolution per source (falls back to
   *  {@link getSourceThumbnail} when omitted or when it returns undefined).
   *  Lets consumers with wider producer sets (image-collage accepts any
   *  image producer) supply thumbnails for types the default resolver
   *  doesn't know. */
  thumbnailFor?: (source: SourceNodeInfo) => string | undefined
  /** Optional per-row extra content, rendered on a second line inside the
   *  row (below the grip/thumbnail/label line). Used by image-collage for
   *  its per-input size selector so ordering + sizing live in ONE list. */
  renderRowExtra?: (entry: MediaEntry) => ReactNode
}

// --- Default accepted types per media kind ---

const IMAGE_TYPES = new Set([
  "upload-image",
  "generate-image",
  "edit-image",
  "image-to-image",
  "character",
  "face",
  "object",
  "creature",
  "location",
  "scene",
])

const VIDEO_TYPES = new Set([
  "upload-video",
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "extend-video",
  "combine-videos",
  "merge-video-audio",
  "resize-video",
  "trim-video",
  "speed-ramp",
  "loop-video",
  "fade-video",
  "add-captions",
  "render-video",
  "transcode-video",
  "video-upscale",
  "motion-transfer",
  "scene",
])

const AUDIO_TYPES = new Set([
  "upload-audio",
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "text-to-dialogue",
  "trim-audio",
  "mix-audio",
  "adjust-volume",
  "audio-isolation",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
])

function getDefaultAcceptedTypes(
  mediaType?: "image" | "video" | "audio" | "any",
): Set<string> | undefined {
  switch (mediaType) {
    case "image":
      return IMAGE_TYPES
    case "video":
      return VIDEO_TYPES
    case "audio":
      return AUDIO_TYPES
    default:
      return undefined // accept all
  }
}

// --- Type badge ---

function TYPE_BADGE(): Record<string, { label: string; className: string }> {
  return {
  "upload-image": { label: tx("pipe.upload"), className: "bg-blue-500/10 text-blue-500" },
  "upload-video": { label: tx("pipe.upload"), className: "bg-blue-500/10 text-blue-500" },
  "upload-audio": { label: tx("pipe.upload"), className: "bg-blue-500/10 text-blue-500" },
  "generate-image": { label: tx("nodecat.AI"), className: "bg-pink-500/10 text-pink-500" },
  "edit-image": { label: tx("common.edit"), className: "bg-amber-500/10 text-amber-500" },
  "image-to-image": { label: tx("cfgshared.badgeI2I"), className: "bg-purple-500/10 text-purple-500" },
  character: { label: tx("cfgshared.badgeChar"), className: "bg-pink-500/10 text-pink-500" },
  face: { label: tx("assetlib.typeFace"), className: "bg-orange-500/10 text-orange-500" },
  object: { label: tx("cfgshared.badgeObject"), className: "bg-emerald-500/10 text-emerald-500" },
  creature: { label: tx("cfgshared.badgeCreature"), className: "bg-violet-500/10 text-violet-500" },
  location: { label: tx("cfgshared.badgeLocation"), className: "bg-cyan-500/10 text-cyan-500" },
  scene: { label: tx("cfgshared.badgeScene"), className: "bg-pink-500/10 text-pink-500" },
}
}

function getTypeBadge(type: string) {
  return TYPE_BADGE()[type] ?? { label: tx("cfgext.tagTaNodeCategory"), className: "bg-muted text-muted-foreground" }
}

// --- Media icon ---

function MediaIcon({ mediaType, className }: { mediaType?: string; className?: string }) {
  switch (mediaType) {
    case "video":
      return <Film className={className} />
    case "audio":
      return <Music className={className} />
    default:
      return <ImageIcon className={className} />
  }
}

// --- Sortable item ---

function SortableMediaItem({
  entry,
  index,
  isPrimary,
  primaryLabel,
  mediaType,
  rowExtra,
}: {
  entry: MediaEntry
  index: number
  isPrimary: boolean
  primaryLabel?: string
  mediaType?: "image" | "video" | "audio" | "any"
  rowExtra?: ReactNode
}) {
  const localizeNode = useLocalizeNodeLabel()
  const localizeHandle = useLocalizeHandleLabel()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  const badge = getTypeBadge(entry.type)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`px-2 py-1.5 rounded-md text-xs ${
        isPrimary
          ? "bg-pink-500/10 ring-1 ring-pink-500/30"
          : "bg-muted/50"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          {...listeners}
          className="cursor-grab active:cursor-grabbing shrink-0 touch-none"
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
        </span>
        <span className="text-muted-foreground w-4 text-center shrink-0 font-mono text-[10px]">
          #{index + 1}
        </span>
        {mediaType === "image" && entry.thumbnailUrl ? (
          <CachedImage
            src={entry.thumbnailUrl}
            alt={localizeNode(entry.label)}
            className="w-10 h-10 rounded object-cover shrink-0"
            thumbnail
            thumbnailWidth={80}
          />
        ) : mediaType === "image" ? (
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
            <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
            <MediaIcon mediaType={mediaType} className="w-4 h-4 text-muted-foreground/40" />
          </div>
        )}
        <div className="flex flex-col flex-1 min-w-0">
          <span className="truncate" title={localizeNode(entry.label)}>
            {localizeNode(entry.label)}
          </span>
          {isPrimary && primaryLabel && (
            <span className="text-[9px] text-pink-500 font-medium">
              {primaryLabel}
            </span>
          )}
        </div>
        {entry.targetHandle && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {localizeHandle(entry.targetHandle)}
          </span>
        )}
        <span
          className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      {rowExtra != null && <div className="mt-1 ps-9">{rowExtra}</div>}
    </div>
  )
}

// --- Main component ---

export function ConnectedMediaList({
  sources,
  mediaOrder,
  onUpdateOrder,
  acceptedTypes,
  mediaType = "any",
  primaryLabel,
  emptyMessage,
  thumbnailFor,
  renderRowExtra,
}: ConnectedMediaListProps) {
  const localizeNode = useLocalizeNodeLabel()
  const t = useT()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const filterTypes = acceptedTypes ?? getDefaultAcceptedTypes(mediaType)

  // Filter sources and build entries
  const entries: MediaEntry[] = sources
    .filter((s) => !filterTypes || filterTypes.has(s.type))
    .map((s) => ({
      id: s.id,
      label: s.label,
      type: s.type,
      thumbnailUrl: thumbnailFor?.(s) ?? getSourceThumbnail(s),
      targetHandle: s.targetHandle,
    }))

  const orderedEntries = applyMediaOrder(entries, mediaOrder)

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

  if (orderedEntries.length === 0) {
    if (emptyMessage) {
      return (
        <p className="text-[10px] text-muted-foreground/60">{emptyMessage}</p>
      )
    }
    return null
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium">
          {mediaType === "image"
            ? t("cfgshared.connectedImages", { count: orderedEntries.length })
            : mediaType === "video"
              ? t("cfgshared.connectedVideos", { count: orderedEntries.length })
              : mediaType === "audio"
                ? t("cfgshared.connectedTracks", { count: orderedEntries.length })
                : t("cfgshared.connectedMedia", { count: orderedEntries.length })}
        </label>
      </div>

      {orderedEntries.length > 1 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedEntries.map((e) => e.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1">
              {orderedEntries.map((entry, i) => (
                <SortableMediaItem
                  key={entry.id}
                  entry={entry}
                  index={i}
                  isPrimary={i === 0 && !!primaryLabel}
                  primaryLabel={primaryLabel}
                  mediaType={mediaType}
                  rowExtra={renderRowExtra?.(entry)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-1">
          {orderedEntries.map((entry, i) => (
            <div
              key={entry.id}
              className={`px-2 py-1.5 rounded-md text-xs ${
                primaryLabel
                  ? "bg-pink-500/10 ring-1 ring-pink-500/30"
                  : "bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground w-4 text-center shrink-0 font-mono text-[10px]">
                  #{i + 1}
                </span>
                {mediaType === "image" && entry.thumbnailUrl ? (
                  <CachedImage
                    src={entry.thumbnailUrl}
                    alt={localizeNode(entry.label)}
                    className="w-10 h-10 rounded object-cover shrink-0"
                    thumbnail
                    thumbnailWidth={80}
                  />
                ) : mediaType === "image" ? (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                    <MediaIcon mediaType={mediaType} className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                )}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate" title={localizeNode(entry.label)}>
                    {localizeNode(entry.label)}
                  </span>
                  {primaryLabel && (
                    <span className="text-[9px] text-pink-500 font-medium">
                      {primaryLabel}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${getTypeBadge(entry.type).className}`}
                >
                  {getTypeBadge(entry.type).label}
                </span>
              </div>
              {renderRowExtra?.(entry) != null && (
                <div className="mt-1 ps-6">{renderRowExtra?.(entry)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {orderedEntries.length > 1 && (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {t("cfgshared.dragToReorderPrimaryHint")}
        </p>
      )}
    </div>
  )
}
