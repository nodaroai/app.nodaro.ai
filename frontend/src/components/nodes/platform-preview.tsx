"use client"

import { memo } from "react"
import { Heart, MessageCircle, Send, Share2 } from "lucide-react"
import { PLATFORM_SPECS, PLATFORM_LABELS } from "@/lib/social-media-specs"
import type { SocialMediaPlatform } from "@/lib/social-media-specs"
import { CachedImage } from "@/components/ui/cached-image"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"
// MediaSlot is a sub-component without a node ID, so it uses zoom directly
import { useWorkflowStore } from "@/hooks/use-workflow-store"

export const PLATFORM_COLORS: Record<SocialMediaPlatform, string> = {
  instagram: "#E1306C",
  tiktok: "#00F2EA",
  x: "#1D9BF0",
  youtube: "#FF0000",
  facebook: "#1877F2",
  linkedin: "#0A66C2",
  telegram: "#2AABEE",
}

const SIZE_CONFIG = {
  sm: { outerW: 180, iconSize: "w-2.5 h-2.5", avatarSize: "w-4 h-4", textSize: "text-[8px]", labelSize: "text-[7px]" },
  lg: { outerW: 280, iconSize: "w-3.5 h-3.5", avatarSize: "w-5 h-5", textSize: "text-[10px]", labelSize: "text-[9px]" },
} as const

const CAPTION_MAX = 60

function isPhoneFrame(w: number, h: number): boolean {
  return w / h < 0.7 // 9:16 → 0.5625
}

interface PlatformPreviewProps {
  platform: SocialMediaPlatform
  specKey: string
  mediaUrl?: string
  isVideo?: boolean
  caption?: string
  size: "sm" | "lg"
}

function PlatformPreviewComponent({
  platform,
  specKey,
  mediaUrl,
  isVideo,
  caption,
  size,
}: PlatformPreviewProps) {
  const spec = PLATFORM_SPECS[specKey]
  if (!spec) return null

  const color = PLATFORM_COLORS[platform] ?? "#888"
  const label = PLATFORM_LABELS[platform] ?? platform
  const { outerW, iconSize, avatarSize, textSize, labelSize } = SIZE_CONFIG[size]
  const captionText = caption && caption.length > CAPTION_MAX
    ? caption.slice(0, CAPTION_MAX - 3) + "..."
    : (caption ?? "")

  if (isPhoneFrame(spec.width, spec.height)) {
    return (
      <PhoneFrame
        outerW={outerW} color={color} label={label}
        specWidth={spec.width} specHeight={spec.height}
        mediaUrl={mediaUrl} isVideo={isVideo}
        captionText={captionText} textSize={textSize} labelSize={labelSize}
      />
    )
  }

  return (
    <FeedCard
      outerW={outerW} color={color} label={label}
      mediaAspect={spec.width / spec.height}
      mediaUrl={mediaUrl} isVideo={isVideo}
      captionText={captionText}
      iconSize={iconSize} avatarSize={avatarSize}
      textSize={textSize} labelSize={labelSize}
    />
  )
}

function PhoneFrame({
  outerW, color, label, specWidth, specHeight, mediaUrl, isVideo, captionText, textSize, labelSize,
}: {
  outerW: number; color: string; label: string; specWidth: number; specHeight: number
  mediaUrl?: string; isVideo?: boolean; captionText: string; textSize: string; labelSize: string
}) {
  const phoneH = Math.round(outerW * (16 / 9))
  const innerW = outerW - 8
  const innerH = phoneH - 28

  return (
    <div
      className="relative rounded-xl border-2 overflow-hidden bg-black mx-auto"
      style={{ width: outerW, height: phoneH, borderColor: color }}
    >
      {/* Status bar */}
      <div className="flex items-center justify-between px-2 h-[14px] bg-black/80">
        <span className={`${labelSize} text-white/60 font-medium`}>9:41</span>
        <div className="flex gap-0.5">
          <div className="w-1 h-1 rounded-full bg-white/40" />
          <div className="w-1 h-1 rounded-full bg-white/40" />
          <div className="w-1.5 h-1 rounded-sm bg-white/40" />
        </div>
      </div>

      {/* Content area */}
      <div className="relative" style={{ width: innerW, height: innerH, margin: "0 auto" }}>
        <MediaSlot mediaUrl={mediaUrl} isVideo={isVideo} className="w-full h-full object-cover" />
      </div>

      {/* Bottom overlay */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full border border-white/60" style={{ borderColor: color }} />
          <span className={`${labelSize} font-semibold text-white/80`}>{label}</span>
        </div>
        {captionText && (
          <p className={`${textSize} text-white/60 truncate mt-0.5`}>{captionText}</p>
        )}
      </div>

      {/* Dimensions badge */}
      <div className={`absolute top-[16px] right-1 ${labelSize} text-white/50 bg-black/50 px-1 rounded`}>
        {specWidth}x{specHeight}
      </div>
    </div>
  )
}

function FeedCard({
  outerW, color, label, mediaAspect, mediaUrl, isVideo, captionText, iconSize, avatarSize, textSize, labelSize,
}: {
  outerW: number; color: string; label: string; mediaAspect: number; mediaUrl?: string; isVideo?: boolean
  captionText: string; iconSize: string; avatarSize: string; textSize: string; labelSize: string
}) {
  const mediaH = Math.round(outerW / mediaAspect)

  return (
    <div
      className="rounded-lg border overflow-hidden mx-auto bg-card"
      style={{ width: outerW, borderColor: `${color}40` }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b" style={{ borderColor: `${color}20` }}>
        <div
          className={`${avatarSize} rounded-full shrink-0`}
          style={{ background: `linear-gradient(135deg, ${color}, ${color}88)` }}
        />
        <span className={`${labelSize} font-semibold text-foreground/80 flex-1 truncate`}>{label}</span>
        <span className={`${textSize} text-muted-foreground`}>...</span>
      </div>

      {/* Media area */}
      <div className="relative bg-muted/30" style={{ height: mediaH }}>
        <MediaSlot mediaUrl={mediaUrl} isVideo={isVideo} className="w-full h-full object-cover" />
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 px-2 py-1 border-t" style={{ borderColor: `${color}20` }}>
        <Heart className={iconSize} color={color} strokeWidth={2} />
        <MessageCircle className={iconSize} color={color} strokeWidth={2} />
        <Send className={iconSize} color={color} strokeWidth={2} />
      </div>

      {/* Caption */}
      {captionText && (
        <div className="px-2 pb-1">
          <p className={`${textSize} text-muted-foreground truncate`}>{captionText}</p>
        </div>
      )}
    </div>
  )
}

function MediaSlot({
  mediaUrl, isVideo, className,
}: {
  mediaUrl?: string; isVideo?: boolean; className: string
}) {
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const { zoom } = useCanvasZoom()
  const useFull = zoom >= 0.8

  if (!mediaUrl) {
    return (
      <div className={`${className} flex items-center justify-center bg-muted/20`}>
        <Share2 className="w-6 h-6 text-muted-foreground/30" />
      </div>
    )
  }

  if (isVideo) {
    return (
      <video
        src={mediaUrl}
        crossOrigin="anonymous"
        className={className}
        muted
        loop={videoAutoplay}
        playsInline
        autoPlay={videoAutoplay}
      />
    )
  }

  return (
    <CachedImage
      src={mediaUrl}
      alt="Preview"
      className={className}
      thumbnail={!useFull}
      thumbnailWidth={320}
    />
  )
}

export const PlatformPreview = memo(PlatformPreviewComponent)
