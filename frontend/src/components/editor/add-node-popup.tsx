"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from "react";
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
  Frame,
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
  Languages,
  AlignLeft,
  Workflow,
  LogIn,
  LogOut,
  Share2,
  Instagram,
  Youtube,
  Linkedin,
  Twitter,
  Facebook,
  StickyNote,
  UserRound,
  Send,
  GitBranch,
  Puzzle,
  MessageSquare,
  ZoomIn,
  Eraser,
  ListMusic,
} from "lucide-react";
import type { Connection } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { SceneNodeType } from "@/types/nodes";
import type { ConnectionContext, NodeOption } from "@/lib/node-compatibility";
import { getCompatibleNodes, resolveTargetHandle } from "@/lib/node-compatibility";
import { useAuth } from "@/hooks/use-auth";

const ComponentMarketplaceModal = lazy(() => import("./component-marketplace-modal").then(m => ({ default: m.ComponentMarketplaceModal })));
import type { ComponentSelection } from "./component-marketplace-modal";

const EMPTY_SET = new Set<string>();

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
    label: "Table",
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
  {
    type: "webhook-trigger" as const,
    label: "Webhook Trigger",
    icon: <Webhook className="h-4 w-4" />,
    category: "Input",
  },
  {
    type: "schedule-trigger" as const,
    label: "Schedule Trigger",
    icon: <Clock className="h-4 w-4" />,
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
    type: "llm-chat",
    label: "LLM Chat",
    icon: <MessageSquare className="h-4 w-4" />,
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
    type: "modify-image",
    label: "Modify Image",
    icon: <Layers className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  {
    type: "upscale-image",
    label: "Upscale Image",
    icon: <ZoomIn className="h-4 w-4" />,
    category: "AI",
    group: "Image",
  },
  {
    type: "remove-background",
    label: "Remove Background",
    icon: <Eraser className="h-4 w-4" />,
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
    type: "speech-to-video",
    label: "Speech to Video",
    icon: <AudioLines className="h-4 w-4" />,
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
  {
    type: "extend-video",
    label: "Extend Video",
    icon: <FastForward className="h-4 w-4" />,
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
    type: "text-to-dialogue",
    label: "Text to Dialogue",
    icon: <Users className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "voice-changer",
    label: "Voice Changer",
    icon: <AudioWaveform className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "dubbing",
    label: "Dubbing",
    icon: <Languages className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "voice-remix",
    label: "Voice Remix",
    icon: <Mic className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "voice-design",
    label: "Voice Design",
    icon: <Wand2 className="h-4 w-4" />,
    category: "AI",
    group: "Audio & Speech",
  },
  {
    type: "forced-alignment",
    label: "Forced Alignment",
    icon: <AlignLeft className="h-4 w-4" />,
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
    label: "Music Video",
    icon: <Film className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-mashup",
    label: "Suno Mashup",
    icon: <Merge className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-replace-section",
    label: "Suno Replace Section",
    icon: <Scissors className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-style-boost",
    label: "Suno Style Boost",
    icon: <Sparkles className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-add-instrumental",
    label: "Suno Add Instrumental",
    icon: <Music className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-add-vocals",
    label: "Suno Add Vocals",
    icon: <Mic className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-convert-wav",
    label: "Suno Convert WAV",
    icon: <AudioLines className="h-4 w-4" />,
    category: "AI",
    group: "Suno Music",
  },
  {
    type: "suno-upload-extend",
    label: "Suno Upload Extend",
    icon: <FastForward className="h-4 w-4" />,
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
    adminOnly: true,
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
    type: "social-media-format",
    label: "Social Media Format",
    icon: <Share2 className="h-4 w-4" />,
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
    type: "extract-frame",
    label: "Extract Frame",
    icon: <Frame className="h-4 w-4" />,
    category: "Processing",
    group: "Video",
  },
  {
    type: "video-upscale",
    label: "Upscale Video",
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
    type: "trim-audio",
    label: "Trim Audio",
    icon: <AudioLines className="h-4 w-4" />,
    category: "Processing",
    group: "Audio",
  },
  {
    type: "split-media",
    label: "Split Media",
    icon: <Scissors className="h-4 w-4" />,
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
    type: "combine-audio",
    label: "Combine Audio",
    icon: <ListMusic className="h-4 w-4" />,
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
  // Output — Social Media
  {
    type: "instagram-post",
    label: "Instagram Post",
    icon: <Instagram className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "tiktok-post",
    label: "TikTok Post",
    icon: <Video className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "youtube-upload",
    label: "YouTube Upload",
    icon: <Youtube className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "linkedin-post",
    label: "LinkedIn Post",
    icon: <Linkedin className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "x-post",
    label: "X Post",
    icon: <Twitter className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "facebook-post",
    label: "Facebook Post",
    icon: <Facebook className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "telegram-post",
    label: "Telegram Post",
    icon: <Send className="h-4 w-4" />,
    category: "Output",
    group: "Social Media",
  },
  {
    type: "telegram-trigger",
    label: "Telegram Trigger",
    icon: <Send className="h-4 w-4" />,
    category: "Input",
    group: "Triggers",
  },
  // Sub-Workflow
  {
    type: "sub-workflow-input",
    label: "Sub-Workflow Input",
    icon: <LogIn className="h-4 w-4" />,
    category: "Workflow",
  },
  {
    type: "sub-workflow-output",
    label: "Sub-Workflow Output",
    icon: <LogOut className="h-4 w-4" />,
    category: "Workflow",
  },
  {
    type: "sub-workflow",
    label: "Sub-Workflow",
    icon: <Workflow className="h-4 w-4" />,
    category: "Workflow",
  },
  {
    type: "component" as SceneNodeType,
    label: "Component",
    icon: <Puzzle className="h-4 w-4" />,
    category: "Component",
  },
  // Utility
  {
    type: "teleport-send",
    label: "Teleport Send",
    icon: <Send className="h-4 w-4" />,
    category: "Processing",
    group: "Text",
  },
  {
    type: "teleport-receive",
    label: "Teleport Receive",
    icon: <Download className="h-4 w-4" />,
    category: "Processing",
    group: "Text",
  },
  {
    type: "router",
    label: "Router",
    icon: <GitBranch className="h-4 w-4" />,
    category: "Processing",
    group: "Control Flow",
  },
  {
    type: "preview",
    label: "Preview",
    icon: <Eye className="h-4 w-4" />,
    category: "Processing",
    group: "Text",
  },
  {
    type: "sticky-note",
    label: "Sticky Note",
    icon: <StickyNote className="h-4 w-4" />,
    category: "Input",
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
  {
    id: "Workflow",
    label: "WORKFLOW",
    icon: <Workflow className="h-4 w-4" />,
    description: "Sub-Workflows",
  },
  {
    id: "Component",
    label: "COMPONENT",
    icon: <Puzzle className="h-4 w-4" />,
    description: "Reusable Components",
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
  Workflow: "text-[#F59E0B]",
  Component: "text-[#A855F7]",
};

interface AddNodePopupProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAddNode: (type: SceneNodeType, initialData?: Record<string, unknown>) => void;
  readonly position?: { x: number; y: number };
  readonly connectionContext?: ConnectionContext | null;
  readonly storeAddNode?: (type: SceneNodeType, position: { x: number; y: number }, initialData?: Record<string, unknown>) => string | undefined;
  readonly storeOnConnect?: (connection: Connection) => void;
}

export function AddNodePopup({
  open,
  onClose,
  onAddNode,
  position,
  connectionContext,
  storeAddNode,
  storeOnConnect,
}: AddNodePopupProps) {
  const { isAdmin } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [componentBrowserOpen, setComponentBrowserOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const visibleNodes = useMemo(() => NODE_OPTIONS.filter((n) => !n.adminOnly || isAdmin), [isAdmin]);

  // Compatibility filtering for smart edge-drop
  const { compatibilityNodes, isFiltered } = useMemo(() => {
    if (!connectionContext) return { compatibilityNodes: null, isFiltered: false };
    const result = getCompatibleNodes(connectionContext.handleId, connectionContext.direction, visibleNodes);
    if (result.direct.length === 0 && result.compatible.length === 0) {
      return { compatibilityNodes: null, isFiltered: false };
    }
    return { compatibilityNodes: result, isFiltered: true };
  }, [connectionContext, visibleNodes]);

  // Handle node selection — auto-connects edge when connectionContext is present
  const handleNodeSelect = useCallback(
    (type: SceneNodeType) => {
      if (type === "component") {
        setComponentBrowserOpen(true);
        return;
      }
      if (connectionContext && storeAddNode && storeOnConnect) {
        const newNodeId = storeAddNode(type, connectionContext.dropPosition);
        if (!newNodeId) {
          onClose();
          return;
        }
        const resolvedHandle = resolveTargetHandle(type, connectionContext.handleId, connectionContext.direction);
        const connection: Connection =
          connectionContext.direction === "source"
            ? {
                source: connectionContext.nodeId,
                sourceHandle: connectionContext.handleId,
                target: newNodeId,
                targetHandle: resolvedHandle,
              }
            : {
                source: newNodeId,
                sourceHandle: resolvedHandle,
                target: connectionContext.nodeId,
                targetHandle: connectionContext.handleId,
              };
        storeOnConnect(connection);
        onClose();
      } else {
        onAddNode(type);
        onClose();
      }
    },
    [connectionContext, storeAddNode, storeOnConnect, onAddNode, onClose],
  );

  // Handle component selected from marketplace modal
  const handleComponentSelect = useCallback(
    (component: ComponentSelection) => {
      onAddNode("component", component as unknown as Record<string, unknown>);
      onClose();
    },
    [onAddNode, onClose],
  );

  // Effective node pool: filtered by compatibility when edge-dropping, otherwise all visible
  const effectivePool = useMemo(() => {
    if (!isFiltered || !compatibilityNodes) return visibleNodes;
    return [...compatibilityNodes.direct, ...compatibilityNodes.compatible];
  }, [visibleNodes, isFiltered, compatibilityNodes]);

  const directMatchTypes = isFiltered && compatibilityNodes
    ? compatibilityNodes.directTypes
    : EMPTY_SET;

  // Filter nodes based on search query
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return effectivePool.filter(
      (node) =>
        node.label.toLowerCase().includes(query) ||
        node.type.toLowerCase().includes(query) ||
        node.category.toLowerCase().includes(query),
    );
  }, [searchQuery, effectivePool]);

  // Get nodes for selected category
  const categoryNodes = useMemo(() => {
    if (!selectedCategory) return [];
    return effectivePool.filter((node) => node.category === selectedCategory);
  }, [selectedCategory, effectivePool]);

  // Items to display (search results, compatibility tiers, category nodes, or categories)
  const displayItems = useMemo(() => {
    if (searchQuery.trim()) return filteredNodes;
    if (isFiltered && !selectedCategory) return effectivePool;
    if (selectedCategory) return categoryNodes;
    return CATEGORIES;
  }, [searchQuery, filteredNodes, isFiltered, selectedCategory, effectivePool, categoryNodes]);

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
            handleNodeSelect(item.type);
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
    handleNodeSelect,
  ]);

  // Reset highlighted index when items change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, selectedCategory]);

  if (!open && !componentBrowserOpen) return null;

  const popupStyle = position
    ? { left: position.x, top: position.y }
    : { left: 70, top: "50%", transform: "translateY(-50%)" };

  return (
    <>
    {open && !componentBrowserOpen && <div
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
          ) : isFiltered && connectionContext ? (
            <div className="flex items-center gap-2">
              <span>Connect to</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#a78bfa]/20 text-[#a78bfa] border border-[#a78bfa]/30">
                {connectionContext.direction === "source"
                  ? `${connectionContext.handleId} →`
                  : `→ ${connectionContext.handleId}`}
              </span>
            </div>
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
                onClick={() => handleNodeSelect(node.type)}
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
                {directMatchTypes.has(node.type) && (
                  <span className="ml-auto text-[10px] text-[#4ade80] font-medium flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                    direct
                  </span>
                )}
              </button>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#94A3B8]">
              No nodes found
            </div>
          )
        ) : isFiltered && compatibilityNodes && !selectedCategory ? (
          // Smart edge-drop: show direct matches then compatible
          <>
            {compatibilityNodes.direct.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-[#4ade80]/80 font-medium px-4 pt-2 pb-1 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                  Direct Match
                </div>
                {compatibilityNodes.direct.map((node, index) => (
                  <button
                    key={node.type}
                    type="button"
                    onClick={() => handleNodeSelect(node.type)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      index === highlightedIndex
                        ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                        : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    <span className={cn("text-[#64748B] dark:text-[#94A3B8]", CATEGORY_COLORS[node.category])}>
                      {node.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#1E293B] dark:text-white truncate">{node.label}</div>
                      <div className="text-xs text-[#94A3B8]">{node.category}</div>
                    </div>
                    <span className="text-[10px] text-[#4ade80] font-medium flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                      direct
                    </span>
                  </button>
                ))}
              </>
            )}
            {compatibilityNodes.compatible.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-4 pt-2 pb-1">
                  Compatible
                </div>
                {compatibilityNodes.compatible.map((node, rawIndex) => {
                  const index = compatibilityNodes.direct.length + rawIndex;
                  return (
                    <button
                      key={node.type}
                      type="button"
                      onClick={() => handleNodeSelect(node.type)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        index === highlightedIndex
                          ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                          : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
                      )}
                      onMouseEnter={() => setHighlightedIndex(index)}
                    >
                      <span className={cn("text-[#64748B] dark:text-[#94A3B8]", CATEGORY_COLORS[node.category])}>
                        {node.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#1E293B] dark:text-white/70 truncate">{node.label}</div>
                        <div className="text-xs text-[#94A3B8]">{node.category}</div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </>
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
                  onClick={() => handleNodeSelect(node.type)}
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
                  {directMatchTypes.has(node.type) && (
                    <span className="ml-auto text-[10px] text-[#4ade80] font-medium flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
                      direct
                    </span>
                  )}
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
    </div>}

    {/* Component Marketplace Modal */}
    {componentBrowserOpen && (
      <Suspense fallback={null}>
        <ComponentMarketplaceModal
          open={componentBrowserOpen}
          onOpenChange={setComponentBrowserOpen}
          onSelect={handleComponentSelect}
          position={position}
        />
      </Suspense>
    )}
    </>
  );
}
