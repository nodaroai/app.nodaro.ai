import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Play, BookOpen } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { fetchTutorials, type Tutorial } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

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
    // not a valid URL
  }
  return null
}

function getThumbnailUrl(tutorial: Tutorial): string {
  if (tutorial.thumbnailUrl) return tutorial.thumbnailUrl
  const ytId = extractYouTubeId(tutorial.videoUrl)
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
  return ""
}

function formatCategory(category: string): string {
  return category
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function groupByCategory(tutorials: Tutorial[]): Map<string, Tutorial[]> {
  const map = new Map<string, Tutorial[]>()
  for (const t of tutorials) {
    const list = map.get(t.category) ?? []
    list.push(t)
    map.set(t.category, list)
  }
  return map
}

export function TutorialsTab() {
  const [selected, setSelected] = useState<Tutorial | null>(null)

  const { data: tutorials = [], isLoading } = useQuery({
    queryKey: queryKeys.tutorials.all,
    queryFn: () => fetchTutorials(),
    staleTime: 60_000,
  })

  const grouped = useMemo(() => groupByCategory(tutorials), [tutorials])
  const selectedYtId = selected ? extractYouTubeId(selected.videoUrl) : null

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

  if (tutorials.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No tutorials yet</p>
        <p className="text-xs mt-1 opacity-70">Check back soon for step-by-step guides.</p>
      </div>
    )
  }

  return (
    <div className="px-3 pb-3 space-y-4">
      {[...grouped.entries()].map(([category, items]) => (
        <div key={category}>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            {formatCategory(category)}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {items.map((tutorial) => {
              const thumb = getThumbnailUrl(tutorial)
              return (
                <button
                  key={tutorial.id}
                  type="button"
                  onClick={() => setSelected(tutorial)}
                  className="rounded-lg overflow-hidden border border-border hover:border-zinc-400 transition-colors text-left group cursor-pointer"
                >
                  <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={tutorial.title}
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
                    <p className="text-xs font-medium text-foreground truncate">
                      {tutorial.title}
                    </p>
                    {tutorial.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                        {tutorial.description}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Video modal */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          {selected && (
            <>
              <DialogHeader className="px-4 pt-4 pb-2">
                <DialogTitle className="text-base">{selected.title}</DialogTitle>
                {selected.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selected.description}
                  </p>
                )}
              </DialogHeader>
              <div className="aspect-video w-full bg-black">
                {selectedYtId ? (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${selectedYtId}?autoplay=1`}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-popups"
                    referrerPolicy="no-referrer"
                    title={selected.title}
                  />
                ) : (
                  <video
                    src={selected.videoUrl}
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
    </div>
  )
}
