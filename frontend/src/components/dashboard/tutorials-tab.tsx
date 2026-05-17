// Unified Tutorials tab — consumes the grouped GET /v1/tutorials response.
//
// Layout mirrors the Templates carousel on the same page: a row of filter
// pills (All / Video Courses / Written Guides) above one or two horizontal
// strips of compact cards. Category (Getting Started / Workflows /
// Advanced) is demoted from a section heading to a chip on each card —
// keeps the page tight when a category has only one or two tutorials.

import { useState, useMemo, useCallback } from "react"
import {
  Play,
  BookOpen,
  Zap,
  Coins,
  Layers,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useTutorialsGrouped } from "@/hooks/queries/use-tutorials"
import { useProjects } from "@/hooks/queries/use-projects-queries"
import {
  useTemplateFavorites,
  useToggleTemplateFavoriteMutation,
} from "@/hooks/queries/use-template-marketplace-queries"
import { TemplatePreviewModal } from "@/components/templates/template-preview-modal"
import {
  type FlowTutorialItem,
  type VideoTutorialItem,
  type TemplateBrowseCard,
} from "@/lib/api"
import { COMPLEXITY_CONFIG, type Complexity } from "@/lib/template-utils"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace("www.", "").replace("m.", "")
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0]
      return id && /^[\w-]{11}$/.test(id) ? id : null
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v")
      if (v && /^[\w-]{11}$/.test(v)) return v
      const match = u.pathname.match(/^\/(embed|shorts)\/([\w-]{11})/)
      if (match) return match[2]
    }
  } catch {
    // not a valid URL — fall through to null
  }
  return null
}

function videoThumbnailUrl(video: VideoTutorialItem): string {
  if (video.thumbnailUrl) return video.thumbnailUrl
  const ytId = extractYouTubeId(video.videoUrl)
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
  return ""
}

// ---------------------------------------------------------------------------
// Filter pill
// ---------------------------------------------------------------------------

interface FilterPillProps {
  readonly active: boolean
  readonly onClick: () => void
  readonly icon?: React.ReactNode
  readonly label: string
  readonly count?: number
}

function FilterPill({ active, onClick, icon, label, count }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-foreground text-background"
          : "bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span className={cn("text-[10px]", active ? "opacity-70" : "opacity-50")}>
          {count}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Compact video card — sized to match the Templates carousel (w-48).
// ---------------------------------------------------------------------------

function CompactVideoCard({
  video,
  onWatch,
}: {
  video: VideoTutorialItem
  onWatch: (v: VideoTutorialItem) => void
}) {
  const thumb = videoThumbnailUrl(video)
  return (
    <button
      type="button"
      onClick={() => onWatch(video)}
      className="text-left group flex-shrink-0 w-48 rounded-lg overflow-hidden border border-border bg-card hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer"
    >
      <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {thumb ? (
          <img
            src={thumb}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <div className="h-9 w-9 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
          </div>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-foreground truncate">{video.title}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
          <Play className="h-2.5 w-2.5" fill="currentColor" />
          Video
        </p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Compact flow card — same shape as CompactVideoCard, amber-tinted to keep
// the visual distinction the original tab established.
// ---------------------------------------------------------------------------

function CompactFlowCard({
  flow,
  onSelect,
}: {
  flow: FlowTutorialItem
  onSelect: (f: FlowTutorialItem) => void
}) {
  const complexity = COMPLEXITY_CONFIG[flow.complexity as Complexity]
  return (
    <button
      type="button"
      onClick={() => onSelect(flow)}
      disabled={!flow.slug}
      className="group text-left flex-shrink-0 w-48 rounded-lg overflow-hidden border border-amber-200/60 dark:border-amber-500/20 bg-gradient-to-b from-amber-50/40 to-card dark:from-amber-500/5 dark:to-card hover:border-amber-400 dark:hover:border-amber-500/50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        {flow.previewMediaUrl ? (
          flow.previewMediaType === "video" ? (
            <video
              src={flow.previewMediaUrl}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
            />
          ) : (
            <img
              src={flow.previewMediaUrl}
              alt={flow.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Zap className="h-6 w-6 text-amber-400/60" />
          </div>
        )}
        {/* Complexity chip (optional) */}
        {complexity && (
          <span
            className={cn(
              "absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded border font-medium",
              complexity.color,
            )}
          >
            {complexity.label}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-foreground truncate">{flow.title}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            <Zap className="h-2.5 w-2.5" fill="currentColor" />
            Guide
          </span>
          {flow.estimatedCredits > 0 && (
            <span className="flex items-center gap-1">
              <Coins className="h-2.5 w-2.5" />
              {flow.estimatedCredits}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Layers className="h-2.5 w-2.5" />
            {flow.nodeCount}
          </span>
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// FlowTutorialItem → TemplateBrowseCard (for reuse of TemplatePreviewModal)
// ---------------------------------------------------------------------------

function flowToTemplateBrowseCard(flow: FlowTutorialItem): TemplateBrowseCard {
  return {
    id: flow.templateId,
    slug: flow.slug ?? "",
    name: flow.title,
    description: flow.description,
    nodeTypesUsed: flow.nodeTypesUsed,
    providersUsed: flow.providersUsed,
    nodeCount: flow.nodeCount,
    estimatedCredits: flow.estimatedCredits,
    complexity: flow.complexity,
    category: "other",
    outputTypes: [],
    tags: [],
    previewMediaUrl: flow.previewMediaUrl,
    previewMediaType: flow.previewMediaType,
    creatorId: "",
    creatorDisplayName: null,
    cloneCount: 0,
    favoriteCount: 0,
    createdAt: flow.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Video player dialog
// ---------------------------------------------------------------------------

function VideoPlayerDialog({
  video,
  onClose,
}: {
  video: VideoTutorialItem | null
  onClose: () => void
}) {
  const ytId = video ? extractYouTubeId(video.videoUrl) : null
  return (
    <Dialog open={!!video} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        {video && (
          <>
            <DialogHeader className="px-4 pt-4 pb-2">
              <DialogTitle className="text-base">{video.title}</DialogTitle>
              {video.description && (
                <DialogDescription className="text-xs">
                  {video.description}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="aspect-video w-full bg-black">
              {ytId ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  referrerPolicy="no-referrer"
                  title={video.title}
                />
              ) : (
                <video
                  src={video.videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full"
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type FilterValue = "all" | "videos" | "flows"

export function TutorialsTab() {
  const [filter, setFilter] = useState<FilterValue>("all")
  const [openVideo, setOpenVideo] = useState<VideoTutorialItem | null>(null)
  const [selectedFlow, setSelectedFlow] = useState<FlowTutorialItem | null>(null)

  const { data, isLoading } = useTutorialsGrouped()
  const { data: projects = [] } = useProjects()
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const toggleFavorite = useToggleTemplateFavoriteMutation()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  // Group the API response by type first, then by category — so each type
  // strip (Video Courses / Written Guides) can render one compact mini-row
  // per category. Empty categories are dropped per type so we don't render
  // a lonely sub-header with nothing underneath.
  const { videoCategories, flowCategories, totalVideos, totalFlows } = useMemo(() => {
    const vc: Array<{ name: string; items: VideoTutorialItem[] }> = []
    const fc: Array<{ name: string; items: FlowTutorialItem[] }> = []
    let totalV = 0
    let totalF = 0
    for (const c of data?.categories ?? []) {
      if (c.videos.length > 0) {
        vc.push({ name: c.name, items: c.videos })
        totalV += c.videos.length
      }
      if (c.flows.length > 0) {
        fc.push({ name: c.name, items: c.flows })
        totalF += c.flows.length
      }
    }
    return { videoCategories: vc, flowCategories: fc, totalVideos: totalV, totalFlows: totalF }
  }, [data])

  const handleWatch = useCallback((v: VideoTutorialItem) => setOpenVideo(v), [])
  const handleSelectFlow = useCallback((f: FlowTutorialItem) => setSelectedFlow(f), [])

  if (isLoading) {
    return (
      <div className="px-3 pb-3 space-y-3">
        <div className="flex gap-2">
          <div className="h-7 w-16 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          <div className="h-7 w-28 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          <div className="h-7 w-28 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-48 rounded-lg overflow-hidden">
              <div className="aspect-video bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                <div className="h-2.5 w-1/2 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (totalVideos === 0 && totalFlows === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No tutorials yet</p>
        <p className="text-xs mt-1 opacity-70">Check back soon for step-by-step guides.</p>
      </div>
    )
  }

  const showVideos = filter === "all" || filter === "videos"
  const showFlows = filter === "all" || filter === "flows"
  const showStripHeaders = filter === "all"

  return (
    <div className="px-3 pb-3 space-y-5">
      {/* Filter pills row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={totalVideos + totalFlows}
        />
        <FilterPill
          active={filter === "videos"}
          onClick={() => setFilter("videos")}
          icon={<Play className="h-3 w-3" fill="currentColor" />}
          label="Video Courses"
          count={totalVideos}
        />
        <FilterPill
          active={filter === "flows"}
          onClick={() => setFilter("flows")}
          icon={<Zap className="h-3 w-3" fill="currentColor" />}
          label="Written Guides"
          count={totalFlows}
        />
      </div>

      {showVideos && totalVideos > 0 && (
        <section className="space-y-3">
          {showStripHeaders && (
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Play className="h-3.5 w-3.5" fill="currentColor" />
              Video Courses
            </h3>
          )}
          {videoCategories.map((cat) => (
            <div key={`v-${cat.name}`}>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                {cat.name}
              </h4>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {cat.items.map((video) => (
                  <CompactVideoCard key={video.id} video={video} onWatch={handleWatch} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {showFlows && totalFlows > 0 && (
        <section className="space-y-3">
          {showStripHeaders && (
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" fill="currentColor" />
              Written Guides
            </h3>
          )}
          {flowCategories.map((cat) => (
            <div key={`f-${cat.name}`}>
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                {cat.name}
              </h4>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {cat.items.map((flow) => (
                  <CompactFlowCard key={flow.id} flow={flow} onSelect={handleSelectFlow} />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* When user filters to a type that has no items, show a quiet empty
          note rather than collapsing the page silently. */}
      {filter === "videos" && totalVideos === 0 && (
        <p className="text-xs text-muted-foreground text-center py-8">
          No video courses available yet.
        </p>
      )}
      {filter === "flows" && totalFlows === 0 && (
        <p className="text-xs text-muted-foreground text-center py-8">
          No written guides available yet.
        </p>
      )}

      <VideoPlayerDialog video={openVideo} onClose={() => setOpenVideo(null)} />

      {selectedFlow && (
        <TemplatePreviewModal
          template={flowToTemplateBrowseCard(selectedFlow)}
          onClose={() => setSelectedFlow(null)}
          isFavorited={favSet.has(selectedFlow.templateId)}
          onToggleFavorite={(id) => toggleFavorite.mutate({ templateId: id })}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
    </div>
  )
}
