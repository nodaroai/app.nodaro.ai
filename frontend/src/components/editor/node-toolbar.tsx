"use client"

import { useState, useEffect, useCallback } from "react"
import { Type, BookOpen, ImageIcon, Film, Merge, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import type { SceneNodeType } from "@/types/nodes"

interface NodeOption {
  readonly type: SceneNodeType
  readonly label: string
  readonly icon: React.ReactNode
  readonly category: string
}

const NODE_OPTIONS: ReadonlyArray<NodeOption> = [
  { type: "text-prompt", label: "Text Prompt", icon: <Type className="h-4 w-4" />, category: "Input" },
  { type: "generate-script", label: "Generate Script", icon: <BookOpen className="h-4 w-4" />, category: "AI" },
  { type: "generate-image", label: "Generate Image", icon: <ImageIcon className="h-4 w-4" />, category: "AI" },
  { type: "image-to-video", label: "Image to Video", icon: <Film className="h-4 w-4" />, category: "AI" },
  { type: "combine-videos", label: "Combine Videos", icon: <Merge className="h-4 w-4" />, category: "Processing" },
]

const CATEGORIES = Array.from(new Set(NODE_OPTIONS.map((n) => n.category)))

function NodeList({ onAdd }: { readonly onAdd: (type: SceneNodeType) => void }) {
  return (
    <>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase">
            {cat}
          </span>
          {NODE_OPTIONS.filter((n) => n.category === cat).map((node) => (
            <Button
              key={node.type}
              variant="ghost"
              size="sm"
              className="justify-start gap-2 h-10 touch-manipulation"
              onClick={() => onAdd(node.type)}
            >
              {node.icon}
              {node.label}
            </Button>
          ))}
        </div>
      ))}
    </>
  )
}

export function NodeToolbar() {
  const addNode = useWorkflowStore((s) => s.addNode)
  const { screenToFlowPosition } = useReactFlow()
  const [sheetOpen, setSheetOpen] = useState(false)

  const handleAddNode = useCallback(
    (type: SceneNodeType) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      addNode(type, position)
      setSheetOpen(false)
    },
    [addNode, screenToFlowPosition],
  )

  // Close sheet on Escape
  useEffect(() => {
    if (!sheetOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [sheetOpen])

  return (
    <>
      {/* Desktop: static sidebar panel */}
      <div className="absolute top-4 left-4 z-10 hidden md:flex flex-col gap-2 bg-card border rounded-lg p-3 shadow-md w-48">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Add Node
        </span>
        <NodeList onAdd={handleAddNode} />
      </div>

      {/* Mobile: FAB */}
      <Button
        size="sm"
        className="absolute bottom-4 right-4 z-10 h-12 w-12 rounded-full p-0 shadow-lg md:hidden"
        onClick={() => setSheetOpen(true)}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Mobile: bottom sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSheetOpen(false)}
          />
          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 bg-card border-t rounded-t-xl shadow-xl animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-sm font-semibold">Add Node</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-px bg-border" />
            <div className="px-4 py-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              <NodeList onAdd={handleAddNode} />
            </div>
            {/* Safe area padding for devices with home indicator */}
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}
    </>
  )
}
