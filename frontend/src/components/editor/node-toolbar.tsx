"use client"

import { Type, ImageIcon, Film, Merge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReactFlow } from "@xyflow/react"
import type { SceneNodeType } from "@/types/nodes"

interface NodeOption {
  readonly type: SceneNodeType
  readonly label: string
  readonly icon: React.ReactNode
  readonly category: string
}

const NODE_OPTIONS: ReadonlyArray<NodeOption> = [
  { type: "text-prompt", label: "Text Prompt", icon: <Type className="h-4 w-4" />, category: "Input" },
  { type: "generate-image", label: "Generate Image", icon: <ImageIcon className="h-4 w-4" />, category: "AI" },
  { type: "image-to-video", label: "Image to Video", icon: <Film className="h-4 w-4" />, category: "AI" },
  { type: "combine-videos", label: "Combine Videos", icon: <Merge className="h-4 w-4" />, category: "Processing" },
]

export function NodeToolbar() {
  const addNode = useWorkflowStore((s) => s.addNode)
  const { screenToFlowPosition } = useReactFlow()

  function handleAddNode(type: SceneNodeType) {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    addNode(type, position)
  }

  const categories = Array.from(
    new Set(NODE_OPTIONS.map((n) => n.category)),
  )

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 bg-card border rounded-lg p-3 shadow-md w-48">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Add Node
      </span>
      {categories.map((cat) => (
        <div key={cat} className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            {cat}
          </span>
          {NODE_OPTIONS.filter((n) => n.category === cat).map((node) => (
            <Button
              key={node.type}
              variant="ghost"
              size="sm"
              className="justify-start gap-2 h-8"
              onClick={() => handleAddNode(node.type)}
            >
              {node.icon}
              {node.label}
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}
