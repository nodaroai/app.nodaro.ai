"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type {
  TextPromptData,
  GenerateImageData,
  ImageToVideoData,
  CombineVideosData,
} from "@/types/nodes"

export function ConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  if (!selectedNode) return null

  function update(data: Record<string, unknown>) {
    if (!selectedNodeId) return
    updateNodeData(selectedNodeId, data)
  }

  function handleDelete() {
    if (!selectedNodeId) return
    deleteNode(selectedNodeId)
  }

  return (
    <div className="absolute top-0 right-0 z-10 h-full w-80 bg-card border-l shadow-lg flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Node Settings</h3>
        <Button variant="ghost" size="icon" onClick={() => selectNode(null)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="node-label">Label</Label>
            <Input
              id="node-label"
              value={(selectedNode.data as { label: string }).label}
              onChange={(e) => update({ label: e.target.value })}
            />
          </div>

          <Separator />

          {selectedNode.type === "text-prompt" && (
            <TextPromptConfig
              data={selectedNode.data as TextPromptData}
              onUpdate={update}
            />
          )}
          {selectedNode.type === "generate-image" && (
            <GenerateImageConfig
              data={selectedNode.data as GenerateImageData}
              onUpdate={update}
            />
          )}
          {selectedNode.type === "image-to-video" && (
            <ImageToVideoConfig
              data={selectedNode.data as ImageToVideoData}
              onUpdate={update}
            />
          )}
          {selectedNode.type === "combine-videos" && (
            <CombineVideosConfig
              data={selectedNode.data as CombineVideosData}
              onUpdate={update}
            />
          )}

          <Separator />

          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete Node
          </Button>
        </div>
      </ScrollArea>
    </div>
  )
}

function TextPromptConfig({
  data,
  onUpdate,
}: {
  readonly data: TextPromptData
  readonly onUpdate: (d: Record<string, unknown>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="prompt-text">Prompt Text</Label>
        <Textarea
          id="prompt-text"
          rows={5}
          value={data.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          placeholder="Enter your story prompt..."
        />
      </div>
    </div>
  )
}

function GenerateImageConfig({
  data,
  onUpdate,
}: {
  readonly data: GenerateImageData
  readonly onUpdate: (d: Record<string, unknown>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as GenerateImageData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nano-banana">Nano Banana</SelectItem>
            <SelectItem value="flux">Flux</SelectItem>
            <SelectItem value="dalle">DALL-E</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Aspect Ratio</Label>
        <Select
          value={data.aspectRatio}
          onValueChange={(v) => onUpdate({ aspectRatio: v as GenerateImageData["aspectRatio"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1:1">1:1 (Square)</SelectItem>
            <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
            <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
            <SelectItem value="4:3">4:3</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="style">Style</Label>
        <Input
          id="style"
          value={data.style}
          onChange={(e) => onUpdate({ style: e.target.value })}
          placeholder="e.g. children-book, photorealistic"
        />
      </div>
      <div>
        <Label htmlFor="negative-prompt">Negative Prompt</Label>
        <Textarea
          id="negative-prompt"
          rows={2}
          value={data.negativePrompt}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid..."
        />
      </div>
    </div>
  )
}

function ImageToVideoConfig({
  data,
  onUpdate,
}: {
  readonly data: ImageToVideoData
  readonly onUpdate: (d: Record<string, unknown>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Provider</Label>
        <Select
          value={data.provider}
          onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="veo">VEO</SelectItem>
            <SelectItem value="kling">Kling</SelectItem>
            <SelectItem value="runway">Runway</SelectItem>
            <SelectItem value="pika">Pika</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="duration">Duration (seconds)</Label>
        <Input
          id="duration"
          type="number"
          min={1}
          max={30}
          value={data.duration}
          onChange={(e) => onUpdate({ duration: parseInt(e.target.value, 10) || 5 })}
        />
      </div>
      <div>
        <Label>Motion</Label>
        <Select
          value={data.motion}
          onValueChange={(v) => onUpdate({ motion: v as ImageToVideoData["motion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="subtle">Subtle</SelectItem>
            <SelectItem value="moderate">Moderate</SelectItem>
            <SelectItem value="dynamic">Dynamic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Camera Motion</Label>
        <Select
          value={data.cameraMotion}
          onValueChange={(v) => onUpdate({ cameraMotion: v as ImageToVideoData["cameraMotion"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="static">Static</SelectItem>
            <SelectItem value="pan-left">Pan Left</SelectItem>
            <SelectItem value="pan-right">Pan Right</SelectItem>
            <SelectItem value="zoom-in">Zoom In</SelectItem>
            <SelectItem value="zoom-out">Zoom Out</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function CombineVideosConfig({
  data,
  onUpdate,
}: {
  readonly data: CombineVideosData
  readonly onUpdate: (d: Record<string, unknown>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Transition</Label>
        <Select
          value={data.transition}
          onValueChange={(v) => onUpdate({ transition: v as CombineVideosData["transition"] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cut">Cut</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="dissolve">Dissolve</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="transition-duration">Transition Duration (s)</Label>
        <Input
          id="transition-duration"
          type="number"
          min={0}
          max={5}
          step={0.1}
          value={data.transitionDuration}
          onChange={(e) =>
            onUpdate({ transitionDuration: parseFloat(e.target.value) || 0.5 })
          }
        />
      </div>
    </div>
  )
}
