"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Type, BookOpen, ImageIcon, Film, Merge, Plus, X,
  Upload, Video, Rss, Palette, PaintBucket, Server,
  Hash, Clock, RatioIcon, Mic, ShieldCheck,
  Volume2, Captions, Maximize, AudioLines, Music,
  SlidersHorizontal, Scissors, HardDrive, Webhook, Clapperboard, UserPlus, Package, MapPin,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { CharacterGalleryButton } from "./character-gallery"
import { ObjectGalleryButton } from "./object-gallery"
import { LocationGalleryButton } from "./location-gallery"
import { UnifiedAssetLibraryButton } from "./unified-asset-library"
import type { SceneNodeType } from "@/types/nodes"

interface NodeOption {
  readonly type: SceneNodeType
  readonly label: string
  readonly icon: React.ReactNode
  readonly category: string
}

const NODE_OPTIONS: ReadonlyArray<NodeOption> = [
  // Input
  { type: "text-prompt", label: "Text Prompt", icon: <Type className="h-4 w-4" />, category: "Input" },
  { type: "upload-image", label: "Upload Image", icon: <Upload className="h-4 w-4" />, category: "Input" },
  { type: "upload-video", label: "Upload Video", icon: <Video className="h-4 w-4" />, category: "Input" },
  { type: "rss-feed", label: "RSS Feed", icon: <Rss className="h-4 w-4" />, category: "Input" },
  { type: "reference-audio", label: "Reference Audio", icon: <Music className="h-4 w-4" />, category: "Input" },
  // Parameter
  { type: "tone", label: "Tone", icon: <Palette className="h-4 w-4" />, category: "Parameter" },
  { type: "style-guide", label: "Style Guide", icon: <PaintBucket className="h-4 w-4" />, category: "Parameter" },
  { type: "provider", label: "Provider", icon: <Server className="h-4 w-4" />, category: "Parameter" },
  { type: "scene-count", label: "Scene Count", icon: <Hash className="h-4 w-4" />, category: "Parameter" },
  { type: "duration", label: "Duration", icon: <Clock className="h-4 w-4" />, category: "Parameter" },
  { type: "aspect-ratio", label: "Aspect Ratio", icon: <RatioIcon className="h-4 w-4" />, category: "Parameter" },
  { type: "motion", label: "Motion", icon: <SlidersHorizontal className="h-4 w-4" />, category: "Parameter" },
  { type: "camera-motion", label: "Camera Motion", icon: <Video className="h-4 w-4" />, category: "Parameter" },
  // AI
  { type: "generate-script", label: "Generate Script", icon: <BookOpen className="h-4 w-4" />, category: "AI" },
  { type: "generate-image", label: "Generate Image", icon: <ImageIcon className="h-4 w-4" />, category: "AI" },
  { type: "image-to-video", label: "Image to Video", icon: <Film className="h-4 w-4" />, category: "AI" },
  { type: "video-to-video", label: "Video to Video", icon: <Film className="h-4 w-4" />, category: "AI" },
  { type: "text-to-video", label: "Text to Video", icon: <Film className="h-4 w-4" />, category: "AI" },
  { type: "text-to-speech", label: "Text to Speech", icon: <Mic className="h-4 w-4" />, category: "AI" },
  { type: "qa-check", label: "QA Check", icon: <ShieldCheck className="h-4 w-4" />, category: "AI" },
  { type: "generate-music", label: "Generate Music", icon: <Music className="h-4 w-4" />, category: "AI" },
  { type: "text-to-audio", label: "Text to Audio", icon: <Volume2 className="h-4 w-4" />, category: "AI" },
  // Processing
  { type: "combine-videos", label: "Combine Videos", icon: <Merge className="h-4 w-4" />, category: "Processing" },
  { type: "merge-video-audio", label: "Merge Video & Audio", icon: <Volume2 className="h-4 w-4" />, category: "Processing" },
  { type: "add-captions", label: "Add Captions", icon: <Captions className="h-4 w-4" />, category: "Processing" },
  { type: "resize-video", label: "Resize Video", icon: <Maximize className="h-4 w-4" />, category: "Processing" },
  { type: "extract-audio", label: "Extract Audio", icon: <AudioLines className="h-4 w-4" />, category: "Processing" },
  { type: "mix-audio", label: "Mix Audio", icon: <Music className="h-4 w-4" />, category: "Processing" },
  { type: "adjust-volume", label: "Adjust Volume", icon: <SlidersHorizontal className="h-4 w-4" />, category: "Processing" },
  { type: "trim-video", label: "Trim Video", icon: <Scissors className="h-4 w-4" />, category: "Processing" },
  // Character
  { type: "character", label: "Character", icon: <UserPlus className="h-4 w-4" />, category: "Character" },
  // Object
  { type: "object", label: "Object", icon: <Package className="h-4 w-4" />, category: "Object" },
  // Location
  { type: "location", label: "Location", icon: <MapPin className="h-4 w-4" />, category: "Location" },
  // Scene
  { type: "scene", label: "Scene", icon: <Clapperboard className="h-4 w-4" />, category: "Scene" },
  // Output
  { type: "save-to-storage", label: "Save to Storage", icon: <HardDrive className="h-4 w-4" />, category: "Output" },
  { type: "webhook-output", label: "Webhook Output", icon: <Webhook className="h-4 w-4" />, category: "Output" },
]

const CATEGORIES = Array.from(new Set(NODE_OPTIONS.map((n) => n.category)))

function NodeList({ onAdd }: { readonly onAdd: (type: SceneNodeType) => void }) {
  return (
    <>
      {/* Unified Asset Library - quick access to all assets */}
      <div className="flex flex-col gap-1 pb-2 mb-2 border-b">
        <span className="text-[10px] font-medium text-muted-foreground uppercase">
          Library
        </span>
        <UnifiedAssetLibraryButton />
      </div>
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
          {cat === "Character" && <CharacterGalleryButton />}
          {cat === "Object" && <ObjectGalleryButton />}
          {cat === "Location" && <LocationGalleryButton />}
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
      <div className="absolute top-4 left-4 z-10 hidden md:flex flex-col gap-2 bg-card border rounded-lg p-3 shadow-md w-48 max-h-[calc(100vh-6rem)] overflow-y-auto">
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
