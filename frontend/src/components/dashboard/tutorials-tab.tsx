// Unified Tutorials tab — consumes the grouped GET /v1/tutorials response
// added in Part 1. Renders TWO visually distinct flavors per category:
//
//   📹 Watch & Learn   — video tutorials (read-only, opens in modal)
//   ⚡ Try It Yourself — flow tutorials (clones into a project)
//
// Visual contrast is deliberate: videos sit on a neutral card, flows wear
// the marketplace template colors (preview-led, complexity badge, "Tutorial"
// pill, primary CTA button). Categories with only one flavor collapse the
// subsection heading away to keep the layout tight.

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
// Video card
// ---------------------------------------------------------------------------

function VideoTutorialCard({
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
      className="text-left group rounded-lg overflow-hidden border border-border bg-card hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors cursor-pointer"
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <div className="h-10 w-10 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
          </div>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium text-foreground truncate">{video.title}</p>
        {video.description && (
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
            {video.description}
          </p>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Flow card
// ---------------------------------------------------------------------------

function FlowTutorialCard({
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
      className="group text-left rounded-xl overflow-hidden border border-amber-200/60 dark:border-amber-500/20 bg-gradient-to-b from-amber-50/40 to-card dark:from-amber-500/5 dark:to-card hover:border-amber-400 dark:hover:border-amber-500/50 transition-all flex flex-col cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
            <Zap className="h-8 w-8 text-amber-400/60" />
          </div>
        )}
        {/* "Tutorial" pill — top right */}
        <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-white font-medium flex items-center gap-1">
          <Zap className="h-2.5 w-2.5" fill="currentColor" />
          Tutorial
        </span>
        {complexity && (
          <span
            className={cn(
              "absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded border font-medium",
              complexity.color,
            )}
          >
            {complexity.label}
          </span>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-foreground truncate">{flow.title}</h3>
        {flow.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{flow.description}</p>
        )}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto pt-1">
          {flow.estimatedCredits > 0 && (
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {flow.estimatedCredits} CR
            </span>
          )}
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
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
//
// The /v1/tutorials response is a subset of /v1/templates/browse's row shape —
// the preview modal fetches the full record by slug separately via
// useTemplateDetail, so the only fields we have to surface up front are those
// the modal renders before that detail call resolves (name, description,
// preview media, complexity, nodeCount, estimatedCredits). The rest default
// to neutral placeholders.
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

export function TutorialsTab() {
  const [openVideo, setOpenVideo] = useState<VideoTutorialItem | null>(null)
  const [selectedFlow, setSelectedFlow] = useState<FlowTutorialItem | null>(null)

  const { data, isLoading } = useTutorialsGrouped()
  const { data: projects = [] } = useProjects()
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const toggleFavorite = useToggleTemplateFavoriteMutation()

  // Drop empty categories so the page doesn't render lonely headers.
  const nonEmpty = useMemo(() => {
    const cats = data?.categories ?? []
    return cats.filter((c) => c.videos.length > 0 || c.flows.length > 0)
  }, [data])

  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const handleWatch = useCallback((v: VideoTutorialItem) => setOpenVideo(v), [])
  const handleSelectFlow = useCallback((f: FlowTutorialItem) => setSelectedFlow(f), [])

  if (isLoading) {
    return (
      <div className="px-3 pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden">
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

  if (nonEmpty.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No tutorials yet</p>
        <p className="text-xs mt-1 opacity-70">Check back soon for step-by-step guides.</p>
      </div>
    )
  }

  return (
    <div className="px-3 pb-3 space-y-6">
      {nonEmpty.map((category) => {
        const hasBoth = category.videos.length > 0 && category.flows.length > 0
        return (
          <section key={category.id}>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {category.name}
            </h3>

            {category.videos.length > 0 && (
              <div className={hasBoth ? "mb-4" : ""}>
                {hasBoth && (
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Play className="h-3 w-3" fill="currentColor" />
                    Watch &amp; Learn
                  </h4>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {category.videos.map((v) => (
                    <VideoTutorialCard key={v.id} video={v} onWatch={handleWatch} />
                  ))}
                </div>
              </div>
            )}

            {category.flows.length > 0 && (
              <div>
                {hasBoth && (
                  <h4 className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                    <Zap className="h-3 w-3" fill="currentColor" />
                    Try It Yourself
                  </h4>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {category.flows.map((f) => (
                    <FlowTutorialCard key={f.id} flow={f} onSelect={handleSelectFlow} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )
      })}

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
