"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Type,
  List,
  BookOpen,
  ImageIcon,
  Film,
  Merge,
  Upload,
  Video,
  Rss,
  Palette,
  PaintBucket,
  Server,
  Hash,
  Clock,
  RatioIcon,
  Mic,
  ShieldCheck,
  Volume2,
  Captions,
  Maximize,
  AudioLines,
  Music,
  SlidersHorizontal,
  Scissors,
  HardDrive,
  Webhook,
  Clapperboard,
  UserPlus,
  Package,
  MapPin,
  ChevronRight,
  Search,
  Download,
  ArrowLeft,
  Wand2,
  Layers,
  Users,
  Waypoints,
  ArrowUpFromLine,
  FileText,
  Disc3,
  FastForward,
  Smile,
  Sparkles,
  Repeat,
  Gauge,
  SunDim,
  RefreshCw,
  Shapes,
  Box,
  AudioWaveform,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SceneNodeType } from "@/types/nodes";

interface NodeOption {
  readonly type: SceneNodeType;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly category: string;
  readonly group?: string;
}

export const NODE_OPTIONS: ReadonlyArray<NodeOption> = [
  // Input
  {
    type: "text-prompt",
    label: "Text Prompt",
    icon: <Type className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "list",
    label: "List",
    icon: <List className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "loop",
    label: "Loop",
    icon: <Repeat className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "upload-image",
    label: "Upload Image",
    icon: <Upload className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "upload-video",
    label: "Upload Video",
    icon: <Video className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    icon: <Music className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "rss-feed",
    label: "RSS Feed",
    icon: <Rss className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "youtube-video",
    label: "Video URL",
    icon: <Video className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "reference-audio",
    label: "Reference Audio",
    icon: <Music className="h-4 w-4" />,
    category: "Input",
  },
  // Parameter
  {
    type: "tone",
    label: "Tone",
    icon: <Palette className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "style-guide",
    label: "Style Guide",
    icon: <PaintBucket className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "provider",
    label: "Provider",
    icon: <Server className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "scene-count",
    label: "Scene Count",
    icon: <Hash className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "duration",
    label: "Duration",
    icon: <Clock className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "aspect-ratio",
    label: "Aspect Ratio",
    icon: <RatioIcon className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "motion",
    label: "Motion",
    icon: <SlidersHorizontal className="h-4 w-4" />,
    category: "Parameter",
  },
  {
    type: "camera-motion",
    label: "Camera Motion",
    icon: <Video className="h-4 w-4" />,
    category: "Parameter",
  },
  // AI — Script & Text
  {
    type: "generate-script",
    label: "Generate Script",
    icon: <BookOpen className="h-4 w-4" />,
    category: "AI",
    group: "Script & Text",
  },
  {
    type: "ai-writer",
    label: "AI Agent",
    icon: <Sparkles className="h-4 w-4" />,
    category: "AI",
    group: "Script & Text",
  },
  {
    type: "transcribe",
    label: "Transcribe",
    icon: <FileText className="h-4 w-4" />,
    category: "AI",
    group: "Script & Text",
  },
  // AI — Image
  {
    type: "generate-image",
    label: "Generate Image",
    icon: <ImageIcon className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  {
    type: "edit-image",
    label: "Edit Image",
    icon: <Wand2 className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  {
    type: "image-to-image",
    label: "Image to Image",
    icon: <Layers className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  {
    type: "image-to-text",
    label: "Describe Image",
    icon: <Eye className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  // AI — Video
  {
    type: "image-to-video",
    label: "Image to Video",
    icon: <Film className="h-4 w-4" />,
    category: "AI",
    group: "Video",
  },
  {
    type: "video-to-video",
    label: "Video to Video",
    icon: <Film className="h-4 w-4" />,
    category: "AI",
    group: "Video",
  },
  {
    type: "text-to-video",
    label: "Text to Video",
    icon: <Film className="h-4 w-4" />,
    category: "AI",
    group: "Video",
  },
  {
    type: "lip-sync",
    label: "Lip Sync",
    icon: <Users className="h-4 w-4" />,
    category: "AI",
    group: "Video",
  },
  {
    type: "motion-transfer",
    label: "Motion Transfer",
    icon: <Waypoints className="h-4 w-4" />,
    category: "AI",
    group: "Video",
  },
  // AI — Audio & Speech
  {
    type: "text-to-speech",
    label: "Text to Speech",
    icon: <Mic className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "text-to-audio",
    label: "Text to Audio",
    icon: <Volume2 className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "audio-isolation",
    label: "Voice Extractor",
    icon: <AudioWaveform className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "generate-music",
    label: "Generate Music",
    icon: <Music className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  // AI — Suno Music
  {
    type: "suno-generate",
    label: "Suno Generate",
    icon: <Music className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-cover",
    label: "Suno Cover",
    icon: <Disc3 className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-extend",
    label: "Suno Extend",
    icon: <FastForward className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-lyrics",
    label: "Suno Lyrics",
    icon: <FileText className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-separate",
    label: "Suno Separate",
    icon: <Scissors className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-music-video",
    label: "Suno Music Video",
    icon: <Film className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  // AI — Quality
  {
    type: "qa-check",
    label: "QA Check",
    icon: <ShieldCheck className="h-4 w-4" />,
    category: "AI",
    group: "Quality",
  },
  // Processing — Video
  {
    type: "combine-videos",
    label: "Combine Videos",
    icon: <Merge className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "resize-video",
    label: "Resize Video",
    icon: <Maximize className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "trim-video",
    label: "Trim Video",
    icon: <Scissors className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "video-upscale",
    label: "Video Upscale",
    icon: <ArrowUpFromLine className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "add-captions",
    label: "Add Captions",
    icon: <Captions className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  // Processing — Video Production
  {
    type: "video-composer",
    label: "Compose Video",
    icon: <Sparkles className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "after-effects",
    label: "After Effects",
    icon: <Wand2 className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "lottie-overlay",
    label: "Lottie Overlay",
    icon: <Layers className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "3d-title",
    label: "3D Title",
    icon: <Box className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "motion-graphics",
    label: "Motion Graphics",
    icon: <Shapes className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "composite",
    label: "Composite",
    icon: <Layers className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "render-video",
    label: "Render Video",
    icon: <Film className="h-4 w-4" />,
    category: "Processing",
    group: "Video Production",
  },
  {
    type: "speed-ramp",
    label: "Adjust Speed",
    icon: <Gauge className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "loop-video",
    label: "Loop Video",
    icon: <Repeat className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "fade-video",
    label: "Fade In/Out",
    icon: <SunDim className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "transcode-video",
    label: "Transcode Video",
    icon: <RefreshCw className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "manual-edit",
    label: "Manual Edit",
    icon: <Scissors className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  // Processing — Audio
  {
    type: "merge-video-audio",
    label: "Merge Video & Audio",
    icon: <Volume2 className="h-4 w-4" />,
    category: "Processing",
    group: "Audio",
  },
  {
    type: "extract-audio",
    label: "Extract Audio",
    icon: <AudioLines className="h-4 w-4" />,
    category: "Processing",
    group: "Audio",
  },
  {
    type: "mix-audio",
    label: "Mix Audio",
    icon: <Music className="h-4 w-4" />,
    category: "Processing",
    group: "Audio",
  },
  {
    type: "adjust-volume",
    label: "Adjust Volume",
    icon: <SlidersHorizontal className="h-4 w-4" />,
    category: "Processing",
    group: "Audio",
  },
  // Processing — Text
  {
    type: "combine-text",
    label: "Combine Text",
    icon: <Merge className="h-4 w-4" />,
    category: "Processing",
    group: "Text",
  },
  {
    type: "split-text",
    label: "Split Text",
    icon: <Scissors className="h-4 w-4" />,
    category: "Processing",
    group: "Text",
  },
  // Assets
  {
    type: "character",
    label: "Create Character",
    icon: <UserPlus className="h-4 w-4" />,
    category: "Assets",
  },
  {
    type: "object",
    label: "Create Object",
    icon: <Package className="h-4 w-4" />,
    category: "Assets",
  },
  {
    type: "location",
    label: "Create Location",
    icon: <MapPin className="h-4 w-4" />,
    category: "Assets",
  },
  {
    type: "face",
    label: "Create Face",
    icon: <Smile className="h-4 w-4" />,
    category: "Assets",
  },
  {
    type: "scene",
    label: "Scene",
    icon: <Clapperboard className="h-4 w-4" />,
    category: "Assets",
  },
  // Output
  {
    type: "save-to-storage",
    label: "Save to Storage",
    icon: <HardDrive className="h-4 w-4" />,
    category: "Output",
  },
  {
    type: "webhook-output",
    label: "Webhook Output",
    icon: <Webhook className="h-4 w-4" />,
    category: "Output",
  },
];

export const CATEGORIES = [
  {
    id: "Input",
    label: "INPUT",
    icon: <Download className="h-4 w-4" />,
    description: "Text, Images, Video",
  },
  {
    id: "Parameter",
    label: "PARAMETER",
    icon: <SlidersHorizontal className="h-4 w-4" />,
    description: "Tone, Style, Duration",
  },
  {
    id: "AI",
    label: "AI",
    icon: <BookOpen className="h-4 w-4" />,
    description: "Generate Script, Image",
  },
  {
    id: "Processing",
    label: "PROCESSING",
    icon: <Merge className="h-4 w-4" />,
    description: "Combine, Merge, Trim",
  },
  {
    id: "Assets",
    label: "ASSETS",
    icon: <UserPlus className="h-4 w-4" />,
    description: "Character, Face, Object, Location",
  },
  {
    id: "Output",
    label: "OUTPUT",
    icon: <HardDrive className="h-4 w-4" />,
    description: "Save, Webhook",
  },
];

// Category icon colors
const CATEGORY_COLORS: Record<string, string> = {
  Input: "text-[#007AFF]",
  Parameter: "text-[#6366F1]",
  AI: "text-[#ff0073]",
  Processing: "text-[#475569]",
  Assets: "text-[#EC4899]",
  Output: "text-[#22C55E]",
};

interface AddNodePopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAddNode: (type: SceneNodeType) => void;
  readonly position?: { x: number; y: number };
}

export function AddNodePopup({
  open,
  onClose,
  onAddNode,
  position,
}: AddNodePopupProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter nodes based on search query
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return NODE_OPTIONS.filter(
      (node) =>
        node.label.toLowerCase().includes(query) ||
        node.type.toLowerCase().includes(query) ||
        node.category.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  // Get nodes for selected category
  const categoryNodes = useMemo(() => {
    if (!selectedCategory) return [];
    return NODE_OPTIONS.filter((node) => node.category === selectedCategory);
  }, [selectedCategory]);

  // Items to display (search results, category nodes, or categories)
  const displayItems = searchQuery.trim()
    ? filteredNodes
    : selectedCategory
      ? categoryNodes
      : CATEGORIES;

  // Reset state when opening/closing
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedCategory(null);
      setHighlightedIndex(0);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Handle click outside
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (selectedCategory && !searchQuery) {
          setSelectedCategory(null);
          setHighlightedIndex(0);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          Math.min(prev + 1, displayItems.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = displayItems[highlightedIndex];
        if (item) {
          if ("type" in item) {
            // It's a node
            onAddNode(item.type);
            onClose();
          } else {
            // It's a category
            setSelectedCategory(item.id);
            setHighlightedIndex(0);
          }
        }
      } else if (e.key === "Backspace" && !searchQuery && selectedCategory) {
        setSelectedCategory(null);
        setHighlightedIndex(0);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    displayItems,
    highlightedIndex,
    selectedCategory,
    searchQuery,
    onClose,
    onAddNode,
  ]);

  // Reset highlighted index when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, selectedCategory]);

  if (!open) return null;

  const popupStyle = position
    ? { left: position.x, top: position.y }
    : { left: 70, top: "50%", transform: "translateY(-50%)" };

  return (
    <div
      ref={popupRef}
      className={cn(
        "fixed z-[100] w-72",
        "bg-white dark:bg-[#1E1E1E]",
        "border border-[#E2E8F0] dark:border-[#2D2D2D]",
        "rounded-xl shadow-xl",
        "overflow-hidden",
      )}
      style={popupStyle}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
        <h3 className="text-sm font-semibold text-[#1E293B] dark:text-white">
          {selectedCategory ? (
            <button
              onClick={() => setSelectedCategory(null)}
              className="flex items-center gap-2 hover:text-[#ff0073] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {selectedCategory}
            </button>
          ) : (
            "What do you want to create?"
          )}
        </h3>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full pl-9 pr-3 py-2 text-sm",
              "bg-[#F8FAFC] dark:bg-[#121212]",
              "border border-[#E2E8F0] dark:border-[#2D2D2D]",
              "rounded-lg",
              "text-[#1E293B] dark:text-white",
              "placeholder:text-[#94A3B8]",
              "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/50 focus:border-[#ff0073]",
            )}
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto py-2">
        {searchQuery.trim() ? (
          // Search results
          filteredNodes.length > 0 ? (
            filteredNodes.map((node, index) => (
              <button
                key={node.type}
                type="button"
                onClick={() => {
                  onAddNode(node.type);
                  onClose();
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                  "transition-colors",
                  index === highlightedIndex
                    ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                    : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span
                  className={cn(
                    "text-[#64748B] dark:text-[#94A3B8]",
                    CATEGORY_COLORS[node.category],
                  )}
                >
                  {node.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#1E293B] dark:text-white truncate">
                    {node.label}
                  </div>
                  <div className="text-xs text-[#94A3B8]">{node.category}</div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#94A3B8]">
              No nodes found
            </div>
          )
        ) : selectedCategory ? (
          // Category nodes — with optional group sub-headers
          categoryNodes.map((node, index) => {
            const prevGroup =
              index > 0 ? categoryNodes[index - 1].group : undefined;
            const showGroupHeader = node.group && node.group !== prevGroup;
            return (
              <div key={node.type}>
                {showGroupHeader && (
                  <>
                    {index > 0 && (
                      <div className="border-t border-muted-foreground/10 mx-3 mt-1" />
                    )}
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-4 pt-2 pb-1">
                      {node.group}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onAddNode(node.type);
                    onClose();
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                    "transition-colors",
                    index === highlightedIndex
                      ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                      : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <span
                    className={cn(
                      "text-[#64748B] dark:text-[#94A3B8]",
                      CATEGORY_COLORS[node.category],
                    )}
                  >
                    {node.icon}
                  </span>
                  <span className="text-sm text-[#1E293B] dark:text-white">
                    {node.label}
                  </span>
                </button>
              </div>
            );
          })
        ) : (
          // Categories
          CATEGORIES.map((cat, index) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelectedCategory(cat.id);
                setHighlightedIndex(0);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left",
                "transition-colors",
                index === highlightedIndex
                  ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                  : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span
                className={cn(
                  "text-[#64748B] dark:text-[#94A3B8]",
                  CATEGORY_COLORS[cat.id],
                )}
              >
                {cat.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#1E293B] dark:text-white">
                  {cat.label}
                </div>
                <div className="text-xs text-[#94A3B8]">{cat.description}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#94A3B8]" />
            </button>
          ))
        )}
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-[#E2E8F0] dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212]">
        <div className="flex items-center gap-4 text-[10px] text-[#94A3B8]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">
              ↵
            </kbd>
            Select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white dark:bg-[#2D2D2D] rounded border border-[#E2E8F0] dark:border-[#3D3D3D]">
              Esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
