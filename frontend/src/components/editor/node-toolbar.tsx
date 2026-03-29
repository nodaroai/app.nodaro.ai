"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import {
  Type, List, BookOpen, ImageIcon, Film, Merge, Plus, X,
  Upload, Video, Rss, Palette, PaintBucket, Server,
  Hash, Clock, RatioIcon, Mic, ShieldCheck, StickyNote,
  Volume2, Captions, Maximize, AudioLines, Music,
  SlidersHorizontal, Scissors, HardDrive, Webhook, Clapperboard, UserPlus, SmilePlus, Package, MapPin, Wand2, Layers, Disc3, FastForward, FileText, Users, Waypoints, Sparkles, Repeat, Gauge, SunDim, Box, Shapes, AudioWaveform, ArrowUpFromLine, RefreshCw, Eye, Languages, AlignLeft, Workflow, LogIn, LogOut, Share2, Instagram, Youtube, Linkedin, Twitter, Facebook, UserRound, Send, Download, GitBranch, Puzzle, MessageSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
const UnifiedAssetLibraryButton = lazy(() => import("./unified-asset-library").then(m => ({ default: m.UnifiedAssetLibraryButton })))
const ComponentMarketplaceModal = lazy(() => import("./component-marketplace-modal").then(m => ({ default: m.ComponentMarketplaceModal })))
import type { ComponentSelection } from "./component-marketplace-modal"
import type { SceneNodeType } from "@/types/nodes"
import { useAuth } from "@/hooks/use-auth"

interface NodeOption {
  readonly type: SceneNodeType
  readonly label: string
  readonly icon: React.ReactNode
  readonly category: string
  readonly group?: string
  readonly adminOnly?: boolean
}

const NODE_OPTIONS: ReadonlyArray<NodeOption> = [
  // Input
  { type: "text-prompt", label: "Text Prompt", icon: <Type className="h-4 w-4" />, category: "Input" },
  { type: "list", label: "List", icon: <List className="h-4 w-4" />, category: "Input" },
  { type: "loop", label: "Table", icon: <Repeat className="h-4 w-4" />, category: "Input" },
  { type: "upload-image", label: "Upload Image", icon: <Upload className="h-4 w-4" />, category: "Input" },
  { type: "upload-video", label: "Upload Video", icon: <Video className="h-4 w-4" />, category: "Input" },
  { type: "upload-audio", label: "Upload Audio", icon: <Music className="h-4 w-4" />, category: "Input" },
  { type: "rss-feed", label: "RSS Feed", icon: <Rss className="h-4 w-4" />, category: "Input" },
  { type: "youtube-video", label: "Video URL", icon: <Video className="h-4 w-4" />, category: "Input" },
  { type: "reference-audio", label: "Reference Audio", icon: <Music className="h-4 w-4" />, category: "Input" },
  { type: "webhook-trigger" as const, label: "Webhook Trigger", icon: <Webhook className="h-4 w-4" />, category: "Input" },
  { type: "schedule-trigger" as const, label: "Schedule Trigger", icon: <Clock className="h-4 w-4" />, category: "Input" },
  // Parameter
  { type: "tone", label: "Tone", icon: <Palette className="h-4 w-4" />, category: "Parameter" },
  { type: "style-guide", label: "Style Guide", icon: <PaintBucket className="h-4 w-4" />, category: "Parameter" },
  { type: "provider", label: "Provider", icon: <Server className="h-4 w-4" />, category: "Parameter" },
  { type: "scene-count", label: "Scene Count", icon: <Hash className="h-4 w-4" />, category: "Parameter" },
  { type: "duration", label: "Duration", icon: <Clock className="h-4 w-4" />, category: "Parameter" },
  { type: "aspect-ratio", label: "Aspect Ratio", icon: <RatioIcon className="h-4 w-4" />, category: "Parameter" },
  { type: "motion", label: "Motion", icon: <SlidersHorizontal className="h-4 w-4" />, category: "Parameter" },
  { type: "camera-motion", label: "Camera Motion", icon: <Video className="h-4 w-4" />, category: "Parameter" },
  // AI — Script & Text
  { type: "generate-script", label: "Generate Script", icon: <BookOpen className="h-4 w-4" />, category: "AI", group: "Script & Text" },
  { type: "llm-chat", label: "LLM Chat", icon: <MessageSquare className="h-4 w-4" />, category: "AI", group: "Script & Text" },
  { type: "ai-writer", label: "AI Agent", icon: <Sparkles className="h-4 w-4" />, category: "AI", group: "Script & Text" },
  { type: "transcribe", label: "Transcribe", icon: <FileText className="h-4 w-4" />, category: "AI", group: "Script & Text" },
  // AI — Image
  { type: "generate-image", label: "Generate Image", icon: <ImageIcon className="h-4 w-4" />, category: "AI", group: "Image" },
  { type: "edit-image", label: "Edit Image", icon: <Wand2 className="h-4 w-4" />, category: "AI", group: "Image" },
  { type: "image-to-image", label: "Image to Image", icon: <Layers className="h-4 w-4" />, category: "AI", group: "Image" },
  { type: "image-to-text", label: "Describe Image", icon: <Eye className="h-4 w-4" />, category: "AI", group: "Image" },
  // AI — Video
  { type: "image-to-video", label: "Image to Video", icon: <Film className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "video-to-video", label: "Video to Video", icon: <Film className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "text-to-video", label: "Text to Video", icon: <Film className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "lip-sync", label: "Lip Sync", icon: <Users className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "speech-to-video", label: "Speech to Video", icon: <AudioLines className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "sora-storyboard", label: "Sora Storyboard", icon: <Clapperboard className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "sora-character", label: "Sora Character", icon: <UserRound className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "motion-transfer", label: "Motion Transfer", icon: <Waypoints className="h-4 w-4" />, category: "AI", group: "Video" },
  { type: "extend-video", label: "Extend Video", icon: <FastForward className="h-4 w-4" />, category: "AI", group: "Video" },
  // AI — Audio & Speech
  { type: "text-to-speech", label: "Text to Speech", icon: <Mic className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "text-to-audio", label: "Text to Audio", icon: <Volume2 className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "generate-music", label: "Generate Music", icon: <Music className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "audio-isolation", label: "Voice Extractor", icon: <AudioWaveform className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "text-to-dialogue", label: "Text to Dialogue", icon: <Users className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "voice-changer", label: "Voice Changer", icon: <AudioWaveform className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "dubbing", label: "Dubbing", icon: <Languages className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "voice-remix", label: "Voice Remix", icon: <Mic className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "voice-design", label: "Voice Design", icon: <Wand2 className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  { type: "forced-alignment", label: "Forced Alignment", icon: <AlignLeft className="h-4 w-4" />, category: "AI", group: "Audio & Speech" },
  // AI — Suno Music
  { type: "suno-generate", label: "Suno Generate", icon: <Music className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-cover", label: "Suno Cover", icon: <Disc3 className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-extend", label: "Suno Extend", icon: <FastForward className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-lyrics", label: "Suno Lyrics", icon: <FileText className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-separate", label: "Suno Separate", icon: <Scissors className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-music-video", label: "Suno Music Video", icon: <Film className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-mashup", label: "Suno Mashup", icon: <Merge className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-replace-section", label: "Suno Replace Section", icon: <Scissors className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-style-boost", label: "Suno Style Boost", icon: <Sparkles className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-add-instrumental", label: "Suno Add Instrumental", icon: <Music className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-add-vocals", label: "Suno Add Vocals", icon: <Mic className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-convert-wav", label: "Suno Convert WAV", icon: <AudioLines className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  { type: "suno-upload-extend", label: "Suno Upload Extend", icon: <FastForward className="h-4 w-4" />, category: "AI", group: "Suno Music" },
  // AI — Quality
  { type: "qa-check", label: "QA Check", icon: <ShieldCheck className="h-4 w-4" />, category: "AI", group: "Quality", adminOnly: true },
  // Processing — Video
  { type: "combine-videos", label: "Combine Videos", icon: <Merge className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "resize-video", label: "Resize Video", icon: <Maximize className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "social-media-format", label: "Social Media Format", icon: <Share2 className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "trim-video", label: "Trim Video", icon: <Scissors className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "video-upscale", label: "Video Upscale", icon: <ArrowUpFromLine className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "speed-ramp", label: "Adjust Speed", icon: <Gauge className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "loop-video", label: "Loop Video", icon: <Repeat className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "fade-video", label: "Fade In/Out", icon: <SunDim className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "transcode-video", label: "Transcode Video", icon: <RefreshCw className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "manual-edit", label: "Manual Edit", icon: <Scissors className="h-4 w-4" />, category: "Processing", group: "Video" },
  { type: "add-captions", label: "Add Captions", icon: <Captions className="h-4 w-4" />, category: "Processing", group: "Video" },
  // Processing — Audio
  { type: "merge-video-audio", label: "Merge Video & Audio", icon: <Volume2 className="h-4 w-4" />, category: "Processing", group: "Audio" },
  { type: "trim-audio", label: "Trim Audio", icon: <AudioLines className="h-4 w-4" />, category: "Processing", group: "Audio" },
  { type: "split-media", label: "Split Media", icon: <Scissors className="h-4 w-4" />, category: "Processing", group: "Audio" },
  { type: "mix-audio", label: "Mix Audio", icon: <Music className="h-4 w-4" />, category: "Processing", group: "Audio" },
  { type: "adjust-volume", label: "Adjust Volume", icon: <SlidersHorizontal className="h-4 w-4" />, category: "Processing", group: "Audio" },
  // Processing — Text
  { type: "combine-text", label: "Combine Text", icon: <Merge className="h-4 w-4" />, category: "Processing", group: "Text" },
  { type: "split-text", label: "Split Text", icon: <Scissors className="h-4 w-4" />, category: "Processing", group: "Text" },
  // Processing — Video Production
  { type: "video-composer", label: "Compose Video", icon: <Sparkles className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "after-effects", label: "After Effects", icon: <Wand2 className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "lottie-overlay", label: "Lottie Overlay", icon: <Layers className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "3d-title", label: "3D Title", icon: <Box className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "motion-graphics", label: "Motion Graphics", icon: <Shapes className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "composite", label: "Composite", icon: <Layers className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  { type: "render-video", label: "Render Video", icon: <Film className="h-4 w-4" />, category: "Processing", group: "Video Production" },
  // Character
  { type: "character", label: "Create Character", icon: <UserPlus className="h-4 w-4" />, category: "Character" },
  // Face
  { type: "face", label: "Create Face", icon: <SmilePlus className="h-4 w-4" />, category: "Face" },
  // Object
  { type: "object", label: "Create Object", icon: <Package className="h-4 w-4" />, category: "Object" },
  // Location
  { type: "location", label: "Create Location", icon: <MapPin className="h-4 w-4" />, category: "Location" },
  // Scene
  { type: "scene", label: "Scene", icon: <Clapperboard className="h-4 w-4" />, category: "Scene" },
  // Output
  { type: "save-to-storage", label: "Save to Storage", icon: <HardDrive className="h-4 w-4" />, category: "Output" },
  { type: "webhook-output", label: "Webhook Output", icon: <Webhook className="h-4 w-4" />, category: "Output" },
  // Output — Social Media
  { type: "instagram-post", label: "Instagram Post", icon: <Instagram className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "tiktok-post", label: "TikTok Post", icon: <Video className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "youtube-upload", label: "YouTube Upload", icon: <Youtube className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "linkedin-post", label: "LinkedIn Post", icon: <Linkedin className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "x-post", label: "X Post", icon: <Twitter className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "facebook-post", label: "Facebook Post", icon: <Facebook className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "telegram-post", label: "Telegram Post", icon: <Send className="h-4 w-4" />, category: "Output", group: "Social Media" },
  { type: "telegram-trigger", label: "Telegram Trigger", icon: <Send className="h-4 w-4" />, category: "Input", group: "Triggers" },
  // Workflow
  { type: "sub-workflow-input", label: "Sub-Workflow Input", icon: <LogIn className="h-4 w-4" />, category: "Workflow" },
  { type: "sub-workflow-output", label: "Sub-Workflow Output", icon: <LogOut className="h-4 w-4" />, category: "Workflow" },
  { type: "sub-workflow", label: "Sub-Workflow", icon: <Workflow className="h-4 w-4" />, category: "Workflow" },
  { type: "component" as SceneNodeType, label: "Component", icon: <Puzzle className="h-4 w-4" />, category: "Component" },
  // Utility
  { type: "teleport-send", label: "Teleport Send", icon: <Send className="h-4 w-4" />, category: "Processing", group: "Text" },
  { type: "teleport-receive", label: "Teleport Receive", icon: <Download className="h-4 w-4" />, category: "Processing", group: "Text" },
  { type: "router", label: "Router", icon: <GitBranch className="h-4 w-4" />, category: "Processing", group: "Control Flow" },
  { type: "preview", label: "Preview", icon: <Eye className="h-4 w-4" />, category: "Processing", group: "Text" },
  { type: "sticky-note", label: "Sticky Note", icon: <StickyNote className="h-4 w-4" />, category: "Input" },
]

const CATEGORIES = Array.from(new Set(NODE_OPTIONS.map((n) => n.category)))

// Category-specific hover colors for icons
const CATEGORY_ICON_HOVER: Record<string, string> = {
  Input: "group-hover:text-[#007AFF]",
  Parameter: "group-hover:text-[#6366F1]",
  AI: "group-hover:text-[#ff0073]",
  Processing: "group-hover:text-[#475569]",
  Character: "group-hover:text-[#EC4899]",
  Face: "group-hover:text-[#F97316]",
  Object: "group-hover:text-[#10B981]",
  Location: "group-hover:text-[#06B6D4]",
  Scene: "group-hover:text-[#8B5CF6]",
  Output: "group-hover:text-[#22C55E]",
  Workflow: "group-hover:text-[#F59E0B]",
  Component: "group-hover:text-[#A855F7]",
}

function NodeList({ onAdd }: { readonly onAdd: (type: SceneNodeType) => void }) {
  const { isAdmin } = useAuth()
  const visibleNodes = NODE_OPTIONS.filter((n) => !n.adminOnly || isAdmin)
  const categories = Array.from(new Set(visibleNodes.map((n) => n.category)))
  return (
    <>
      {/* Unified My Library - quick access to all assets */}
      <div className="flex flex-col gap-1 pb-3 mb-3 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] dark:text-[#64748B] mb-1">
          Library
        </span>
        <Suspense fallback={null}><UnifiedAssetLibraryButton /></Suspense>
      </div>
      {categories.map((cat) => {
        const catNodes = visibleNodes.filter((n) => n.category === cat)
        return (
          <div key={cat} className="flex flex-col gap-0.5 mb-4">
            <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8] dark:text-[#ff0073] mb-1.5">
              {cat}
            </span>
            {catNodes.map((node, index) => {
              const prevGroup = index > 0 ? catNodes[index - 1].group : undefined
              const showGroupHeader = node.group && node.group !== prevGroup
              return (
                <div key={node.type}>
                  {showGroupHeader && (
                    <>
                      {index > 0 && <div className="border-t border-muted-foreground/10 mx-1 mt-1.5 mb-0.5" />}
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-2.5 pt-2 pb-1">
                        {node.group}
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    className={cn(
                      "group flex items-center gap-2.5 px-2.5 py-2 rounded-lg",
                      "hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D]",
                      "cursor-pointer transition-colors touch-manipulation",
                      "text-left w-full"
                    )}
                    onClick={() => onAdd(node.type)}
                  >
                    <span className={cn(
                      "text-[#64748B] dark:text-[#94A3B8] transition-colors",
                      CATEGORY_ICON_HOVER[node.category] || "group-hover:text-[#ff0073]",
                      "dark:group-hover:text-[#ff0073]"
                    )}>
                      {node.icon}
                    </span>
                    <span className="text-[#1E293B] dark:text-[#E2E8F0] text-sm">
                      {node.label}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

interface NodeToolbarProps {
  readonly visible?: boolean
}

export function NodeToolbar({ visible = false }: NodeToolbarProps) {
  const addNode = useWorkflowStore((s) => s.addNode)
  const { getViewport } = useReactFlow()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [componentBrowserOpen, setComponentBrowserOpen] = useState(false)

  const getViewportCenterPosition = useCallback(() => {
    const el = document.querySelector('.react-flow')
    const rect = el?.getBoundingClientRect()
    const viewportWidth = rect?.width ?? window.innerWidth
    const viewportHeight = rect?.height ?? window.innerHeight
    const { x, y, zoom } = getViewport()
    const z = zoom || 1
    return {
      x: (-x + viewportWidth / 2) / z,
      y: (-y + viewportHeight / 2) / z,
    }
  }, [getViewport])

  const handleAddNode = useCallback(
    (type: SceneNodeType) => {
      if (type === "component") {
        setComponentBrowserOpen(true)
        return
      }
      const position = getViewportCenterPosition()
      addNode(type, position)
      setSheetOpen(false)
    },
    [addNode, getViewportCenterPosition],
  )

  const handleComponentSelect = useCallback(
    (component: ComponentSelection) => {
      const position = getViewportCenterPosition()
      addNode("component", position, component as unknown as Record<string, unknown>)
      setSheetOpen(false)
    },
    [addNode, getViewportCenterPosition],
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
      {/* Desktop: static sidebar panel - hidden by default, shown when visible prop is true */}
      {visible && (
        <div className="absolute top-4 left-16 z-10 hidden md:flex flex-col gap-2 bg-[#F8FAFC] dark:bg-[#1E1E1E]/95 dark:backdrop-blur-sm border border-[#E2E8F0] dark:border-[#2D2D2D] rounded-xl px-3 py-4 w-52 max-h-[calc(100vh-6rem)] overflow-y-auto shadow-lg animate-in slide-in-from-left-2 duration-200">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#ff0073] mb-1">
            Add Node
          </span>
          <NodeList onAdd={handleAddNode} />
        </div>
      )}

      {/* Mobile: FAB - always visible on mobile */}
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
          <div className="absolute bottom-0 left-0 right-0 bg-[#F8FAFC] dark:bg-[#1E1E1E]/95 dark:backdrop-blur-sm border-t border-[#E2E8F0] dark:border-[#2D2D2D] rounded-t-xl shadow-xl animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-sm font-semibold text-[#1E293B] dark:text-[#E2E8F0]">Add Node</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-[#64748B] hover:text-[#1E293B] dark:text-[#94A3B8] dark:hover:text-white"
                onClick={() => setSheetOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-px bg-[#E2E8F0] dark:bg-[#2D2D2D]" />
            <div className="px-4 py-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
              <NodeList onAdd={handleAddNode} />
            </div>
            {/* Safe area padding for devices with home indicator */}
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}

      {/* Component Marketplace Modal */}
      {componentBrowserOpen && (
        <Suspense fallback={null}>
          <ComponentMarketplaceModal
            open={componentBrowserOpen}
            onOpenChange={setComponentBrowserOpen}
            onSelect={handleComponentSelect}
          />
        </Suspense>
      )}
    </>
  )
}
