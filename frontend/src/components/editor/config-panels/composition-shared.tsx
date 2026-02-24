"use client"

import { lazy, Suspense } from "react"
import { GripVertical } from "lucide-react"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { SourceNodeInfo } from "./types"

export function SortableAssetItem({ id, index, label, typeLabel }: { id: string; index: number; label: string; typeLabel: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
      <span {...listeners} className="cursor-grab active:cursor-grabbing shrink-0 touch-none">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40" />
      </span>
      <span className="text-muted-foreground w-4 text-center shrink-0">{index + 1}</span>
      <span className="truncate flex-1" title={label}>{label}</span>
      <span className="text-muted-foreground/60 text-[10px] shrink-0">{typeLabel}</span>
    </div>
  )
}

export const RENDER_MEDIA_SOURCE_TYPES = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
  "image-to-video", "video-to-video", "text-to-video", "upload-video",
  "youtube-video", "combine-videos", "lip-sync", "motion-transfer",
  "video-upscale", "suno-music-video", "merge-video-audio", "add-captions",
  "resize-video", "trim-video",
  "text-to-speech", "text-to-audio", "generate-music", "upload-audio",
  "suno-generate", "suno-cover", "suno-extend", "suno-separate",
  "extract-audio", "mix-audio", "adjust-volume", "reference-audio",
])

export function useMediaOrder(
  sources: ReadonlyArray<SourceNodeInfo>,
  assetOrder: string[] | undefined,
  onUpdate: (d: Record<string, unknown>) => void,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const mediaSources = sources.filter((s) => RENDER_MEDIA_SOURCE_TYPES.has(s.type))
  const currentOrder = assetOrder ?? []
  const orderedIds = [
    ...currentOrder.filter((id) => mediaSources.some((s) => s.id === id)),
    ...mediaSources.filter((s) => !currentOrder.includes(s.id)).map((s) => s.id),
  ]
  const orderedSources = orderedIds.map((id) => mediaSources.find((s) => s.id === id)!).filter(Boolean)

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedIds.indexOf(String(active.id))
    const newIndex = orderedIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = [...orderedIds]
    const [moved] = newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, moved)
    onUpdate({ assetOrder: newOrder })
  }

  return { sensors, orderedIds, orderedSources, handleDragEnd }
}

export function MediaOrderList({
  sensors,
  orderedIds,
  orderedSources,
  onDragEnd,
}: {
  sensors: ReturnType<typeof useSensors>
  orderedIds: string[]
  orderedSources: ReadonlyArray<SourceNodeInfo>
  onDragEnd: (event: DragEndEvent) => void
}) {
  if (orderedSources.length === 0) return null
  return (
    <div>
      <Label className="mb-1.5 block">Media Order</Label>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1">
            {orderedSources.map((s, i) => (
              <SortableAssetItem
                key={s.id}
                id={s.id}
                index={i}
                label={s.label}
                typeLabel={s.type.includes("image") ? "img" : "vid"}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

export function VideoSettingsAccordion({
  aspectRatio,
  fps,
  durationSeconds,
  backgroundColor,
  onUpdate,
  idPrefix,
}: {
  aspectRatio: string
  fps: number
  durationSeconds: number
  backgroundColor: string
  onUpdate: (d: Record<string, unknown>) => void
  idPrefix: string
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="advanced" className="border-0">
        <AccordionTrigger className="text-xs text-muted-foreground py-1.5 hover:no-underline">
          Advanced Settings
        </AccordionTrigger>
        <AccordionContent className="space-y-3 pt-1">
          <div>
            <Label>Aspect Ratio</Label>
            <Select value={aspectRatio} onValueChange={(v) => onUpdate({ aspectRatio: v })}>
              <SelectTrigger aria-label="Aspect Ratio"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                <SelectItem value="1:1">1:1 (Square)</SelectItem>
                <SelectItem value="4:5">4:5 (Social)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-fps`}>FPS</Label>
            <Select value={String(fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
              <SelectTrigger aria-label="FPS"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 fps (Film)</SelectItem>
                <SelectItem value="30">30 fps (Standard)</SelectItem>
                <SelectItem value="60">60 fps (Smooth)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-duration`}>Duration (seconds)</Label>
            <Input
              id={`${idPrefix}-duration`}
              type="number"
              min={1}
              max={300}
              value={durationSeconds}
              onChange={(e) => onUpdate({ durationSeconds: parseInt(e.target.value, 10) || 30 })}
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-bg`}>Background Color</Label>
            <Input
              id={`${idPrefix}-bg`}
              type="color"
              value={backgroundColor}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              className="h-8 w-full"
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

const LazySceneGraphPreview = lazy(() => import("@/components/editor/scene-graph-preview").then(m => ({ default: m.SceneGraphPreview })))

export function SceneGraphPreviewInline({
  sceneGraph,
  fps,
  onUpdate,
}: {
  sceneGraph: Record<string, unknown>
  fps: number
  onUpdate: (sg: Record<string, unknown>) => void
}) {
  return (
    <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
      <LazySceneGraphPreview
        sceneGraph={sceneGraph}
        fps={fps}
        onUpdate={onUpdate}
      />
    </Suspense>
  )
}
